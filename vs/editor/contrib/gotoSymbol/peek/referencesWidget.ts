/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./referencesWidget';
import * as dom from 'vs/base/browser/dom';
import { IMouseEvent } from 'vs/base/browser/mouseEvent';
import { Orientation } from 'vs/base/browser/ui/sash/sash';
import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { dispose, IDisposable, IReference, DisposableStore } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { basenameOrAuthority, dirname, isEqual } from 'vs/base/common/resources';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EmbeddedCodeEditorWidget } from 'vs/editor/browser/widget/embeddedCodeEditorWidget';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IRange, Range } from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { IModelDeltaDecoration, TrackedRangeStickiness } from 'vs/editor/common/model';
import { ModelDecorationOptions, TextModel } from 'vs/editor/common/model/textModel';
import { Location } from 'vs/editor/common/modes';
import { ITextEditorModel, ITextModelService } from 'vs/editor/common/services/resolverService';
import { AriaProvider, DataSource, Delegate, FileReferencesRenderer, OneReferenceRenderer, TreeElement, StringRepresentationProvider, IdentityProvider } from 'vs/editor/contrib/gotoSymbol/peek/referencesTree';
import * as nls from 'vs/nls';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { activeContrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { ITheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import * as peekView from 'vs/editor/contrib/peekView/peekView';
import { FileReferences, OneReference, ReferencesModel } from '../referencesModel';
import { IAsyncDataTreeOptions } from 'vs/base/browser/ui/tree/asyncDataTree';
import { FuzzyScore } from 'vs/base/common/filters';
import { SplitView, Sizing } from 'vs/base/browser/ui/splitview/splitview';


class DecorationsManager implements IDisposable {

	private static readonly DecorationOptions = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'reference-decoration'
	});

	private _decorations = new Map<string, OneReference>();
	private _decorationIgnoreSet = new Set<string>();
	private readonly _callOnDispose = new DisposableStore();
	private readonly _callOnModelChange = new DisposableStore();

	constructor(private _editor: ICodeEditor, private _model: ReferencesModel) {
		this._callOnDispose.add(this._editor.onDidChangeModel(() => this._onModelChanged()));
		this._onModelChanged();
	}

	dispose(): void {
		this._callOnModelChange.dispose();
		this._callOnDispose.dispose();
		this.removeDecorations();
	}

	private _onModelChanged(): void {
		this._callOnModelChange.clear();
		const model = this._editor.getModel();
		if (model) {
			for (const ref of this._model.groups) {
				if (isEqual(ref.uri, model.uri)) {
					this._addDecorations(ref);
					return;
				}
			}
		}
	}

	private _addDecorations(reference: FileReferences): void {
		if (!this._editor.hasModel()) {
			return;
		}
		this._callOnModelChange.add(this._editor.getModel().onDidChangeDecorations((event) => this._onDecorationChanged()));

		const newDecorations: IModelDeltaDecoration[] = [];
		const newDecorationsActualIndex: number[] = [];

		for (let i = 0, len = reference.children.length; i < len; i++) {
			let oneReference = reference.children[i];
			if (this._decorationIgnoreSet.has(oneReference.id)) {
				continue;
			}
			newDecorations.push({
				range: oneReference.range,
				options: DecorationsManager.DecorationOptions
			});
			newDecorationsActualIndex.push(i);
		}

		const decorations = this._editor.deltaDecorations([], newDecorations);
		for (let i = 0; i < decorations.length; i++) {
			this._decorations.set(decorations[i], reference.children[newDecorationsActualIndex[i]]);
		}
	}

	private _onDecorationChanged(): void {
		const toRemove: string[] = [];

		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		this._decorations.forEach((reference, decorationId) => {
			const newRange = model.getDecorationRange(decorationId);

			if (!newRange) {
				return;
			}

			let ignore = false;

			if (Range.equalsRange(newRange, reference.range)) {
				return;

			} else if (Range.spansMultipleLines(newRange)) {
				ignore = true;

			} else {
				const lineLength = reference.range.endColumn - reference.range.startColumn;
				const newLineLength = newRange.endColumn - newRange.startColumn;

				if (lineLength !== newLineLength) {
					ignore = true;
				}
			}

			if (ignore) {
				this._decorationIgnoreSet.add(reference.id);
				toRemove.push(decorationId);
			} else {
				reference.range = newRange;
			}
		});

		for (let i = 0, len = toRemove.length; i < len; i++) {
			this._decorations.delete(toRemove[i]);
		}
		this._editor.deltaDecorations(toRemove, []);
	}

	removeDecorations(): void {
		let toRemove: string[] = [];
		this._decorations.forEach((value, key) => {
			toRemove.push(key);
		});
		this._editor.deltaDecorations(toRemove, []);
		this._decorations.clear();
	}
}

export class LayoutData {
	ratio: number = 0.7;
	heightInLines: number = 18;

	static fromJSON(raw: string): LayoutData {
		let ratio: number | undefined;
		let heightInLines: number | undefined;
		try {
			const data = <LayoutData>JSON.parse(raw);
			ratio = data.ratio;
			heightInLines = data.heightInLines;
		} catch {
			//
		}
		return {
			ratio: ratio || 0.7,
			heightInLines: heightInLines || 18
		};
	}
}

export interface SelectionEvent {
	readonly kind: 'goto' | 'show' | 'side' | 'open';
	readonly source: 'editor' | 'tree' | 'title';
	readonly element?: Location;
}

/**
 * ZoneWidget that is shown inside the editor
 */
export class ReferenceWidget extends peekView.PeekViewWidget {

	private _model?: ReferencesModel;
	private _decorationsManager?: DecorationsManager;

	private readonly _disposeOnNewModel = new DisposableStore();
	private readonly _callOnDispose = new DisposableStore();

	private readonly _onDidSelectReference = new Emitter<SelectionEvent>();
	readonly onDidSelectReference = this._onDidSelectReference.event;

	private _tree!: WorkbenchAsyncDataTree<ReferencesModel | FileReferences, TreeElement, FuzzyScore>;
	private _treeContainer!: HTMLElement;
	private _splitView!: SplitView;
	private _preview!: ICodeEditor;
	private _previewModelReference!: IReference<ITextEditorModel>;
	private _previewNotAvailableMessage!: TextModel;
	private _previewContainer!: HTMLElement;
	private _messageContainer!: HTMLElement;
	private _dim: dom.Dimension = { height: 0, width: 0 };

	constructor(
		editor: ICodeEditor,
		private _defaultTreeKeyboardSupport: boolean,
		public layoutData: LayoutData,
		@IThemeService themeService: IThemeService,
		@ITextModelService private readonly _textModelResolverService: ITextModelService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@peekView.IPeekViewService private readonly _peekViewService: peekView.IPeekViewService,
		@ILabelService private readonly _uriLabel: ILabelService
	) {
		super(editor, { showFrame: false, showArrow: true, isResizeable: true, isAccessible: true });

		this._applyTheme(themeService.getTheme());
		this._callOnDispose.add(themeService.onThemeChange(this._applyTheme.bind(this)));
		this._peekViewService.addExclusiveWidget(editor, this);
		this.create();
	}

	dispose(): void {
		this.setModel(undefined);
		this._callOnDispose.dispose();
		this._disposeOnNewModel.dispose();
		this._preview.setModel(null); // drop all view-zones, workaround for https://github.com/microsoft/vscode/issues/84726
		dispose(this._preview);
		dispose(this._previewNotAvailableMessage);
		dispose(this._tree);
		dispose(this._previewModelReference);
		this._splitView.dispose();
		super.dispose();
	}

	private _applyTheme(theme: ITheme) {
		const borderColor = theme.getColor(peekView.peekViewBorder) || Color.transparent;
		this.style({
			arrowColor: borderColor,
			frameColor: borderColor,
			headerBackgroundColor: theme.getColor(peekView.peekViewTitleBackground) || Color.transparent,
			primaryHeadingColor: theme.getColor(peekView.peekViewTitleForeground),
			secondaryHeadingColor: theme.getColor(peekView.peekViewTitleInfoForeground)
		});
	}

	show(where: IRange) {
		this.editor.revealRangeInCenterIfOutsideViewport(where, editorCommon.ScrollType.Smooth);
		super.show(where, this.layoutData.heightInLines || 18);
	}

	focus(): void {
		this._tree.domFocus();
	}

	protected _onTitleClick(e: IMouseEvent): void {
		if (this._preview && this._preview.getModel()) {
			this._onDidSelectReference.fire({
				element: this._getFocusedReference(),
				kind: e.ctrlKey || e.metaKey || e.altKey ? 'side' : 'open',
				source: 'title'
			});
		}
	}

	protected _fillBody(containerElement: HTMLElement): void {
		this.setCssClass('reference-zone-widget');

		// message pane
		this._messageContainer = dom.append(containerElement, dom.$('div.messages'));
		dom.hide(this._messageContainer);

		this._splitView = new SplitView(containerElement, { orientation: Orientation.HORIZONTAL });

		// editor
		this._previewContainer = dom.append(containerElement, dom.$('div.preview.inline'));
		let options: IEditorOptions = {
			scrollBeyondLastLine: false,
			scrollbar: {
				verticalScrollbarSize: 14,
				horizontal: 'auto',
				useShadows: true,
				verticalHasArrows: false,
				horizontalHasArrows: false
			},
			overviewRulerLanes: 2,
			fixedOverflowWidgets: true,
			minimap: {
				enabled: false
			}
		};
		this._preview = this._instantiationService.createInstance(EmbeddedCodeEditorWidget, this._previewContainer, options, this.editor);
		dom.hide(this._previewContainer);
		this._previewNotAvailableMessage = TextModel.createFromString(nls.localize('missingPreviewMessage', "no preview available"));

		// tree
		this._treeContainer = dom.append(containerElement, dom.$('div.ref-tree.inline'));
		const treeOptions: IAsyncDataTreeOptions<TreeElement, FuzzyScore> = {
			ariaLabel: nls.localize('treeAriaLabel', "References"),
			keyboardSupport: this._defaultTreeKeyboardSupport,
			accessibilityProvider: new AriaProvider(),
			keyboardNavigationLabelProvider: this._instantiationService.createInstance(StringRepresentationProvider),
			identityProvider: new IdentityProvider()
		};
		this._tree = this._instantiationService.createInstance<typeof WorkbenchAsyncDataTree, WorkbenchAsyncDataTree<ReferencesModel | FileReferences, TreeElement, FuzzyScore>>(
			WorkbenchAsyncDataTree,
			'ReferencesWidget',
			this._treeContainer,
			new Delegate(),
			[
				this._instantiationService.createInstance(FileReferencesRenderer),
				this._instantiationService.createInstance(OneReferenceRenderer),
			],
			this._instantiationService.createInstance(DataSource),
			treeOptions
		);

		// split stuff
		this._splitView.addView({
			onDidChange: Event.None,
			element: this._previewContainer,
			minimumSize: 200,
			maximumSize: Number.MAX_VALUE,
			layout: (width) => {
				this._preview.layout({ height: this._dim.height, width });
			}
		}, Sizing.Distribute);

		this._splitView.addView({
			onDidChange: Event.None,
			element: this._treeContainer,
			minimumSize: 100,
			maximumSize: Number.MAX_VALUE,
			layout: (width) => {
				this._treeContainer.style.height = `${this._dim.height}px`;
				this._treeContainer.style.width = `${width}px`;
				this._tree.layout(this._dim.height, width);
			}
		}, Sizing.Distribute);

		this._disposables.add(this._splitView.onDidSashChange(() => {
			if (this._dim.width) {
				this.layoutData.ratio = this._splitView.getViewSize(0) / this._dim.width;
			}
		}, undefined));

		// listen on selection and focus
		let onEvent = (element: any, kind: 'show' | 'goto' | 'side') => {
			if (element instanceof OneReference) {
				if (kind === 'show') {
					this._revealReference(element, false);
				}
				this._onDidSelectReference.fire({ element, kind, source: 'tree' });
			}
		};
		this._tree.onDidChangeFocus(e => {
			onEvent(e.elements[0], 'show');
		});
		this._tree.onDidOpen(e => {
			if (e.browserEvent instanceof MouseEvent && (e.browserEvent.ctrlKey || e.browserEvent.metaKey || e.browserEvent.altKey)) {
				// modifier-click -> open to the side
				onEvent(e.elements[0], 'side');
			} else if (e.browserEvent instanceof KeyboardEvent || (e.browserEvent instanceof MouseEvent && e.browserEvent.detail === 2)) {
				// keybinding (list service command) OR double click -> close widget and goto target
				onEvent(e.elements[0], 'goto');
			} else {
				// preview location
				onEvent(e.elements[0], 'show');
			}
		});

		dom.hide(this._treeContainer);
	}

	protected _onWidth(width: number) {
		if (this._dim) {
			this._doLayoutBody(this._dim.height, width);
		}
	}

	protected _doLayoutBody(heightInPixel: number, widthInPixel: number): void {
		super._doLayoutBody(heightInPixel, widthInPixel);
		this._dim = { height: heightInPixel, width: widthInPixel };
		this.layoutData.heightInLines = this._viewZone ? this._viewZone.heightInLines : this.layoutData.heightInLines;
		this._splitView.layout(widthInPixel);
		this._splitView.resizeView(0, widthInPixel * this.layoutData.ratio);
	}

	setSelection(selection: OneReference): Promise<any> {
		return this._revealReference(selection, true).then(() => {
			if (!this._model) {
				// disposed
				return;
			}
			// show in tree
			this._tree.setSelection([selection]);
			this._tree.setFocus([selection]);
		});
	}

	setModel(newModel: ReferencesModel | undefined): Promise<any> {
		// clean up
		this._disposeOnNewModel.clear();
		this._model = newModel;
		if (this._model) {
			return this._onNewModel();
		}
		return Promise.resolve();
	}

	private _onNewModel(): Promise<any> {
		if (!this._model) {
			return Promise.resolve(undefined);
		}

		if (this._model.isEmpty) {
			this.setTitle('');
			this._messageContainer.innerHTML = nls.localize('noResults', "No results");
			dom.show(this._messageContainer);
			return Promise.resolve(undefined);
		}

		dom.hide(this._messageContainer);
		this._decorationsManager = new DecorationsManager(this._preview, this._model);
		this._disposeOnNewModel.add(this._decorationsManager);

		// listen on model changes
		this._disposeOnNewModel.add(this._model.onDidChangeReferenceRange(reference => this._tree.rerender(reference)));

		// listen on editor
		this._disposeOnNewModel.add(this._preview.onMouseDown(e => {
			const { event, target } = e;
			if (event.detail !== 2) {
				return;
			}
			const element = this._getFocusedReference();
			if (!element) {
				return;
			}
			this._onDidSelectReference.fire({
				element: { uri: element.uri, range: target.range! },
				kind: (event.ctrlKey || event.metaKey || event.altKey) ? 'side' : 'open',
				source: 'editor'
			});
		}));

		// make sure things are rendered
		dom.addClass(this.container!, 'results-loaded');
		dom.show(this._treeContainer);
		dom.show(this._previewContainer);
		this._splitView.layout(this._dim.width);
		this.focus();

		// pick input and a reference to begin with
		return this._tree.setInput(this._model.groups.length === 1 ? this._model.groups[0] : this._model);
	}

	private _getFocusedReference(): OneReference | undefined {
		const [element] = this._tree.getFocus();
		if (element instanceof OneReference) {
			return element;
		} else if (element instanceof FileReferences) {
			if (element.children.length > 0) {
				return element.children[0];
			}
		}
		return undefined;
	}

	private _revealedReference?: OneReference;

	private async _revealReference(reference: OneReference, revealParent: boolean): Promise<void> {

		// check if there is anything to do...
		if (this._revealedReference === reference) {
			return;
		}
		this._revealedReference = reference;

		// Update widget header
		if (reference.uri.scheme !== Schemas.inMemory) {
			this.setTitle(basenameOrAuthority(reference.uri), this._uriLabel.getUriLabel(dirname(reference.uri)));
		} else {
			this.setTitle(nls.localize('peekView.alternateTitle', "References"));
		}

		const promise = this._textModelResolverService.createModelReference(reference.uri);

		if (this._tree.getInput() === reference.parent) {
			this._tree.reveal(reference);
		} else {
			if (revealParent) {
				this._tree.reveal(reference.parent);
			}
			await this._tree.expand(reference.parent);
			this._tree.reveal(reference);
		}

		const ref = await promise;

		if (!this._model) {
			// disposed
			ref.dispose();
			return;
		}

		dispose(this._previewModelReference);

		// show in editor
		const model = ref.object;
		if (model) {
			const scrollType = this._preview.getModel() === model.textEditorModel ? editorCommon.ScrollType.Smooth : editorCommon.ScrollType.Immediate;
			const sel = Range.lift(reference.range).collapseToStart();
			this._previewModelReference = ref;
			this._preview.setModel(model.textEditorModel);
			this._preview.setSelection(sel);
			this._preview.revealRangeInCenter(sel, scrollType);
		} else {
			this._preview.setModel(this._previewNotAvailableMessage);
			ref.dispose();
		}
	}
}

// theming


registerThemingParticipant((theme, collector) => {
	const findMatchHighlightColor = theme.getColor(peekView.peekViewResultsMatchHighlight);
	if (findMatchHighlightColor) {
		collector.addRule(`.monaco-editor .reference-zone-widget .ref-tree .referenceMatch .highlight { background-color: ${findMatchHighlightColor}; }`);
	}
	const referenceHighlightColor = theme.getColor(peekView.peekViewEditorMatchHighlight);
	if (referenceHighlightColor) {
		collector.addRule(`.monaco-editor .reference-zone-widget .preview .reference-decoration { background-color: ${referenceHighlightColor}; }`);
	}
	const referenceHighlightBorder = theme.getColor(peekView.peekViewEditorMatchHighlightBorder);
	if (referenceHighlightBorder) {
		collector.addRule(`.monaco-editor .reference-zone-widget .preview .reference-decoration { border: 2px solid ${referenceHighlightBorder}; box-sizing: border-box; }`);
	}
	const hcOutline = theme.getColor(activeContrastBorder);
	if (hcOutline) {
		collector.addRule(`.monaco-editor .reference-zone-widget .ref-tree .referenceMatch .highlight { border: 1px dotted ${hcOutline}; box-sizing: border-box; }`);
	}
	const resultsBackground = theme.getColor(peekView.peekViewResultsBackground);
	if (resultsBackground) {
		collector.addRule(`.monaco-editor .reference-zone-widget .ref-tree { background-color: ${resultsBackground}; }`);
	}
	const resultsMatchForeground = theme.getColor(peekView.peekViewResultsMatchForeground);
	if (resultsMatchForeground) {
		collector.addRule(`.monaco-editor .reference-zone-widget .ref-tree { color: ${resultsMatchForeground}; }`);
	}
	const resultsFileForeground = theme.getColor(peekView.peekViewResultsFileForeground);
	if (resultsFileForeground) {
		collector.addRule(`.monaco-editor .reference-zone-widget .ref-tree .reference-file { color: ${resultsFileForeground}; }`);
	}
	const resultsSelectedBackground = theme.getColor(peekView.peekViewResultsSelectionBackground);
	if (resultsSelectedBackground) {
		collector.addRule(`.monaco-editor .reference-zone-widget .ref-tree .monaco-list:focus .monaco-list-rows > .monaco-list-row.selected:not(.highlighted) { background-color: ${resultsSelectedBackground}; }`);
	}
	const resultsSelectedForeground = theme.getColor(peekView.peekViewResultsSelectionForeground);
	if (resultsSelectedForeground) {
		collector.addRule(`.monaco-editor .reference-zone-widget .ref-tree .monaco-list:focus .monaco-list-rows > .monaco-list-row.selected:not(.highlighted) { color: ${resultsSelectedForeground} !important; }`);
	}
	const editorBackground = theme.getColor(peekView.peekViewEditorBackground);
	if (editorBackground) {
		collector.addRule(
			`.monaco-editor .reference-zone-widget .preview .monaco-editor .monaco-editor-background,` +
			`.monaco-editor .reference-zone-widget .preview .monaco-editor .inputarea.ime-input {` +
			`	background-color: ${editorBackground};` +
			`}`);
	}
	const editorGutterBackground = theme.getColor(peekView.peekViewEditorGutterBackground);
	if (editorGutterBackground) {
		collector.addRule(
			`.monaco-editor .reference-zone-widget .preview .monaco-editor .margin {` +
			`	background-color: ${editorGutterBackground};` +
			`}`);
	}
});
