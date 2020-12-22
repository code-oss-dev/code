/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IBreadcrumbsDataSource, IOutline, IOutlineCreator, IOutlineService, OutlineTarget, OutlineTreeConfiguration } from 'vs/workbench/services/outline/browser/outline';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IEditorPane } from 'vs/workbench/common/editor';
import { OutlineAccessibilityProvider, OutlineElementRenderer, OutlineFilter, OutlineGroupRenderer, OutlineIdentityProvider, OutlineItemComparator, OutlineNavigationLabelProvider, OutlineSortOrder, OutlineVirtualDelegate } from 'vs/editor/contrib/documentSymbols/outlineTree';
import { ICodeEditor, isCodeEditor, isDiffEditor } from 'vs/editor/browser/editorBrowser';
import { OutlineGroup, OutlineElement, OutlineModel, TreeElement } from 'vs/editor/contrib/documentSymbols/outlineModel';
import { DocumentSymbolProviderRegistry } from 'vs/editor/common/modes';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { raceCancellation, TimeoutTimer, timeout } from 'vs/base/common/async';
import { equals } from 'vs/base/common/arrays';
import { onUnexpectedError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IPosition } from 'vs/editor/common/core/position';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { Range } from 'vs/editor/common/core/range';
import { IEditorOptions, TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IModelContentChangedEvent } from 'vs/editor/common/model/textModelEvents';

type DocumentSymbolItem = OutlineGroup | OutlineElement;

class DocumentSymbolBreadcrumbsSource implements IBreadcrumbsDataSource<DocumentSymbolItem>{

	private _breadcrumbs: (OutlineGroup | OutlineElement)[] = [];

	constructor(
		private readonly _editor: ICodeEditor,
		@ITextResourceConfigurationService private readonly _textResourceConfigurationService: ITextResourceConfigurationService,
	) { }

	getBreadcrumbElements(): Iterable<DocumentSymbolItem> {
		return this._breadcrumbs;
	}

	clear(): boolean {
		return this._updateBreadcrumbs([]);
	}

	update(model: OutlineModel, position: IPosition): boolean {
		const newElements = this._computeBreadcrumbs(model, position);
		return this._updateBreadcrumbs(newElements);
	}

	private _updateBreadcrumbs(newElements: (OutlineGroup | OutlineElement)[]): boolean {
		if (!equals(newElements, this._breadcrumbs, DocumentSymbolBreadcrumbsSource._outlineElementEquals)) {
			this._breadcrumbs = newElements;
			return true;
		}
		return false;
	}

	private _computeBreadcrumbs(model: OutlineModel, position: IPosition): Array<OutlineGroup | OutlineElement> {
		let item: OutlineGroup | OutlineElement | undefined = model.getItemEnclosingPosition(position);
		if (!item) {
			return [];
		}
		let chain: Array<OutlineGroup | OutlineElement> = [];
		while (item) {
			chain.push(item);
			let parent: any = item.parent;
			if (parent instanceof OutlineModel) {
				break;
			}
			if (parent instanceof OutlineGroup && parent.parent && parent.parent.children.size === 1) {
				break;
			}
			item = parent;
		}
		let result: Array<OutlineGroup | OutlineElement> = [];
		for (let i = chain.length - 1; i >= 0; i--) {
			let element = chain[i];
			if (this._isFiltered(element)) {
				break;
			}
			result.push(element);
		}
		if (result.length === 0) {
			return [];
		}
		return result;
	}

	private _isFiltered(element: TreeElement): boolean {
		if (!(element instanceof OutlineElement)) {
			return false;
		}
		const key = `breadcrumbs.${OutlineFilter.kindToConfigName[element.symbol.kind]}`;
		let uri: URI | undefined;
		if (this._editor && this._editor.getModel()) {
			const model = this._editor.getModel() as ITextModel;
			uri = model.uri;
		}
		return !this._textResourceConfigurationService.getValue<boolean>(uri, key);
	}

	private static _outlineElementEquals(a: OutlineGroup | OutlineElement, b: OutlineGroup | OutlineElement): boolean {
		if (a === b) {
			return true;
		} else if (!a || !b) {
			return false;
		} else {
			return a.id === b.id;
		}
	}
}

class DocumentSymbolsOutline implements IOutline<DocumentSymbolItem> {

	private readonly _disposables = new DisposableStore();
	private readonly _onDidChange = new Emitter<this>();
	private readonly _onDidChangeActive = new Emitter<void>();

	readonly onDidChange: Event<this> = this._onDidChange.event;
	readonly onDidChangeActive: Event<void> = this._onDidChangeActive.event;
	readonly config: OutlineTreeConfiguration<DocumentSymbolItem>;

	private _outlineModel?: OutlineModel;
	private _outlineDisposables = new DisposableStore();

	private readonly _breadcrumbsDataSource: DocumentSymbolBreadcrumbsSource;

	constructor(
		private readonly _editor: ICodeEditor,
		target: OutlineTarget,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		// @IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {

		this._breadcrumbsDataSource = new DocumentSymbolBreadcrumbsSource(_editor, textResourceConfigurationService);

		const sorter = new OutlineItemComparator();
		this.config = new OutlineTreeConfiguration(
			this._breadcrumbsDataSource,
			{ getQuickPickElements: () => { throw new Error('not implemented'); } },
			{
				getChildren: (parent) => {
					if (parent instanceof OutlineElement || parent instanceof OutlineGroup) {
						return parent.children.values();
					}
					if (parent === this && this._outlineModel) {
						return this._outlineModel.children.values();
					}
					return [];
				}
			},
			new OutlineVirtualDelegate(),
			[new OutlineGroupRenderer(), instantiationService.createInstance(OutlineElementRenderer)],
			{
				collapseByDefault: true,
				expandOnlyOnTwistieClick: true,
				multipleSelectionSupport: false,
				accessibilityProvider: new OutlineAccessibilityProvider(target === OutlineTarget.Breadcrumbs ? 'breadcrumbs' : 'outline'),
				identityProvider: new OutlineIdentityProvider(),
				keyboardNavigationLabelProvider: new OutlineNavigationLabelProvider(),
				filter: instantiationService.createInstance(OutlineFilter, target === OutlineTarget.Breadcrumbs ? 'breadcrumbs' : 'outline'),
				sorter
			}
		);

		// special sorting for breadcrumbs
		if (target === OutlineTarget.Breadcrumbs) {
			const updateSort = () => {
				const uri = this._outlineModel?.uri;
				const value = textResourceConfigurationService.getValue(uri, `breadcrumbs.symbolSortOrder`);
				if (value === 'name') {
					sorter.type = OutlineSortOrder.ByName;
				} else if (value === 'type') {
					sorter.type = OutlineSortOrder.ByKind;
				} else {
					sorter.type = OutlineSortOrder.ByPosition;
				}
			};
			this._disposables.add(textResourceConfigurationService.onDidChangeConfiguration(() => updateSort()));
			updateSort();
		}


		// update as language, model, providers changes
		this._disposables.add(DocumentSymbolProviderRegistry.onDidChange(_ => this._createOutline()));
		this._disposables.add(this._editor.onDidChangeModel(_ => this._createOutline()));
		this._disposables.add(this._editor.onDidChangeModelLanguage(_ => this._createOutline()));

		// TODO@jrieken
		// update when config changes (re-render)
		// this._disposables.add(this._configurationService.onDidChangeConfiguration(e => {
		// 	if (e.affectsConfiguration('breadcrumbs')) {
		// 		this._createOutline(true);
		// 		return;
		// 	}
		// 	if (this._editor && this._editor.getModel()) {
		// 		const editorModel = this._editor.getModel() as ITextModel;
		// 		const languageName = editorModel.getLanguageIdentifier().language;

		// 		// Checking for changes in the current language override config.
		// 		// We can't be more specific than this because the ConfigurationChangeEvent(e) only includes the first part of the root path
		// 		if (e.affectsConfiguration(`[${languageName}]`)) {
		// 			this._createOutline(true);
		// 		}
		// 	}
		// }));

		// update soon'ish as model content change
		const updateSoon = new TimeoutTimer();
		this._disposables.add(updateSoon);
		this._disposables.add(this._editor.onDidChangeModelContent(event => {
			const timeout = OutlineModel.getRequestDelay(this._editor!.getModel());
			updateSoon.cancelAndSet(() => this._createOutline(event), timeout);
		}));
		this._createOutline();

		// stop when editor dies
		this._disposables.add(this._editor.onDidDispose(() => this._outlineDisposables.clear()));
	}

	dispose(): void {
		this._disposables.dispose();
		this._outlineDisposables.dispose();
	}

	get isEmpty(): boolean {
		return !this._outlineModel;
	}

	async reveal(entry: DocumentSymbolItem, options: IEditorOptions, sideBySide: boolean): Promise<void> {
		if (entry instanceof OutlineElement) {
			const position = Range.getStartPosition(entry.symbol.selectionRange);
			this._editor.revealPositionInCenterIfOutsideViewport(position, ScrollType.Immediate);
			this._editor.setPosition(position);
		}
		this._editor.focus();

		const model = OutlineModel.get(entry);
		if (!model || !(entry instanceof OutlineElement)) {
			return;
		}
		await this._codeEditorService.openCodeEditor({
			resource: model.uri,
			options: {
				...options,
				selection: Range.collapseToStart(entry.symbol.selectionRange),
				selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport,
			}
		}, this._editor, sideBySide);
	}

	preview(entry: DocumentSymbolItem): IDisposable {
		if (!(entry instanceof OutlineElement)) {
			return Disposable.None;
		}
		// todo@jrieken
		// if (!editorViewState) {
		// 	editorViewState = withNullAsUndefined(editor.saveViewState());
		// }
		const { symbol } = entry;
		this._editor.revealRangeInCenterIfOutsideViewport(symbol.range, ScrollType.Smooth);
		const ids = this._editor.deltaDecorations([], [{
			range: symbol.range,
			options: {
				className: 'rangeHighlight',
				isWholeLine: true
			}
		}]);
		return toDisposable(() => this._editor.deltaDecorations(ids, []));
	}

	private async _createOutline(contentChangeEvent?: IModelContentChangedEvent): Promise<void> {

		this._outlineDisposables.clear();
		if (!contentChangeEvent) {
			this._updateOutlineModel(undefined);
		}

		if (!this._editor.hasModel()) {
			return;
		}
		const buffer = this._editor.getModel();
		if (!DocumentSymbolProviderRegistry.has(buffer)) {
			return;
		}

		const cts = new CancellationTokenSource();
		const versionIdThen = buffer.getVersionId();
		const timeoutTimer = new TimeoutTimer();

		this._outlineDisposables.add({
			dispose: () => {
				cts.dispose(true);
				timeoutTimer.dispose();
			}
		});

		try {
			let model = await OutlineModel.create(buffer, cts.token);
			if (cts.token.isCancellationRequested) {
				// cancelled -> do nothing
				return;
			}

			if (TreeElement.empty(model) || !this._editor.hasModel()) {
				// empty -> no outline elements
				this._updateOutlineModel(model);
				return;
			}

			// heuristic: when the symbols-to-lines ratio changes by 50% between edits
			// wait a little (and hope that the next change isn't as drastic).
			if (contentChangeEvent && this._outlineModel && buffer.getLineCount() >= 25) {
				const newSize = TreeElement.size(model);
				const newLength = buffer.getValueLength();
				const newRatio = newSize / newLength;
				const oldSize = TreeElement.size(this._outlineModel);
				const oldLength = newLength - contentChangeEvent.changes.reduce((prev, value) => prev + value.rangeLength, 0);
				const oldRatio = oldSize / oldLength;
				if (newRatio <= oldRatio * 0.5 || newRatio >= oldRatio * 1.5) {
					// wait for a better state and ignore current model when more
					// typing has happened
					const value = await raceCancellation(timeout(2000).then(() => true), cts.token, false);
					if (!value) {
						return;
					}
				}
			}

			// copy the model
			model = model.adopt();

			this._updateOutlineModel(model);
			this._outlineDisposables.add(this._editor.onDidChangeCursorPosition(_ => {
				timeoutTimer.cancelAndSet(() => {
					if (!buffer.isDisposed() && versionIdThen === buffer.getVersionId() && this._editor.hasModel()) {
						this._breadcrumbsDataSource.update(model, this._editor.getPosition());
						this._onDidChangeActive.fire();
					}
				}, 150);
			}));


		} catch (err) {
			this._updateOutlineModel(undefined);
			onUnexpectedError(err);
		}
	}

	private _updateOutlineModel(model: OutlineModel | undefined) {
		const position = this._editor.getPosition();
		if (!position || !model) {
			this._outlineModel = undefined;
			this._breadcrumbsDataSource.clear();
		} else {
			this._outlineModel = model;
			this._breadcrumbsDataSource.update(model, position);
		}
		this._onDidChange.fire(this);
	}
}

class DocumentSymbolsOutlineCreator implements IOutlineCreator<IEditorPane, DocumentSymbolItem> {

	readonly dispose: () => void;

	constructor(
		@IOutlineService outlineService: IOutlineService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		const reg = outlineService.registerOutlineCreator(this);
		this.dispose = () => reg.dispose();
	}

	matches(candidate: IEditorPane): candidate is IEditorPane {
		const ctrl = candidate.getControl();
		return isCodeEditor(ctrl) || isDiffEditor(ctrl);
	}

	async createOutline(pane: IEditorPane, target: OutlineTarget, token: CancellationToken): Promise<IOutline<DocumentSymbolItem> | undefined> {
		const control = pane.getControl();
		let editor: ICodeEditor | undefined;
		if (isCodeEditor(control)) {
			editor = control as ICodeEditor;
		} else if (isDiffEditor(control)) {
			editor = control.getModifiedEditor();
		}
		if (!editor) {
			return undefined;
		}
		return this._instantiationService.createInstance(DocumentSymbolsOutline, editor, target);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(DocumentSymbolsOutlineCreator, LifecyclePhase.Eventually);
