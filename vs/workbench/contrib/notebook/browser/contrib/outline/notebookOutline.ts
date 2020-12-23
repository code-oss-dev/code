/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./notebookOutline';
import { Codicon } from 'vs/base/common/codicons';
import { Emitter, Event } from 'vs/base/common/event';
import { combinedDisposable, IDisposable, Disposable, DisposableStore, MutableDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IOutline, IOutlineBreadcrumbsConfig, IOutlineComparator, IOutlineCreator, IOutlineQuickPickConfig, IOutlineService, IOutlineTreeConfig, IQuickPickDataSource, OutlineChangeEvent } from 'vs/workbench/services/outline/browser/outline';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IEditorPane } from 'vs/workbench/common/editor';
import { IKeyboardNavigationLabelProvider, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IDataSource, ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { createMatches, FuzzyScore } from 'vs/base/common/filters';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { getIconClassesForModeId } from 'vs/editor/common/services/getIconClasses';
import { SymbolKind } from 'vs/editor/common/modes';
import { IWorkbenchDataTreeOptions } from 'vs/platform/list/browser/listService';
import { localize } from 'vs/nls';
import { IMarkerService, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { listErrorForeground, listWarningForeground } from 'vs/platform/theme/common/colorRegistry';
import { isEqual } from 'vs/base/common/resources';
import { IdleValue } from 'vs/base/common/async';

export interface IOutlineMarkerInfo {
	readonly count: number;
	readonly topSev: MarkerSeverity;
}

export class OutlineEntry {

	private _children: OutlineEntry[] = [];
	private _parent: OutlineEntry | undefined;
	private _markerInfo: IOutlineMarkerInfo | undefined;

	constructor(
		readonly index: number,
		readonly level: number,
		readonly cell: ICellViewModel,
		readonly label: string,
		readonly icon: ThemeIcon
	) { }

	addChild(entry: OutlineEntry) {
		this._children.push(entry);
		entry._parent = this;
	}

	get parent(): OutlineEntry | undefined {
		return this._parent;
	}

	get children(): Iterable<OutlineEntry> {
		return this._children;
	}

	get markerInfo(): IOutlineMarkerInfo | undefined {
		return this._markerInfo;
	}

	updateMarkers(markerService: IMarkerService): void {
		if (this.cell.cellKind === CellKind.Code) {
			// a code cell can have marker
			const marker = markerService.read({ resource: this.cell.uri, severities: MarkerSeverity.Error | MarkerSeverity.Warning });
			if (marker.length === 0) {
				this._markerInfo = undefined;
			} else {
				const topSev = marker.find(a => a.severity === MarkerSeverity.Error)?.severity ?? MarkerSeverity.Warning;
				this._markerInfo = { topSev, count: marker.length };
			}
		} else {
			// a markdown cell can inherit markers from its children
			let topChild: MarkerSeverity | undefined;
			for (let child of this.children) {
				child.updateMarkers(markerService);
				if (child.markerInfo) {
					topChild = !topChild ? child.markerInfo.topSev : Math.max(child.markerInfo.topSev, topChild);
				}
			}
			this._markerInfo = topChild && { topSev: topChild, count: 0 };
		}
	}

	find(cell: ICellViewModel, parents: OutlineEntry[]): OutlineEntry | undefined {
		if (cell.id === this.cell.id) {
			return this;
		}
		parents.push(this);
		for (let child of this.children) {
			const result = child.find(cell, parents);
			if (result) {
				return result;
			}
		}
		parents.pop();
		return undefined;
	}

	asFlatList(bucket: OutlineEntry[]): void {
		bucket.push(this);
		for (let child of this.children) {
			child.asFlatList(bucket);
		}
	}
}

class NotebookOutlineTemplate {

	static readonly templateId = 'NotebookOutlineRenderer';

	constructor(
		readonly iconClass: HTMLElement,
		readonly iconLabel: IconLabel,
		readonly decoration: HTMLElement
	) { }
}

class NotebookOutlineRenderer implements ITreeRenderer<OutlineEntry, FuzzyScore, NotebookOutlineTemplate> {

	templateId: string = NotebookOutlineTemplate.templateId;

	constructor(@IThemeService private readonly _themeService: IThemeService) { }

	renderTemplate(container: HTMLElement): NotebookOutlineTemplate {
		container.classList.add('notebook-outline-element', 'show-file-icons');
		const iconClass = document.createElement('div');
		container.append(iconClass);
		const iconLabel = new IconLabel(container, { supportHighlights: true });
		const decoration = document.createElement('div');
		decoration.className = 'element-decoration';
		container.append(decoration);
		return new NotebookOutlineTemplate(iconClass, iconLabel, decoration);
	}

	renderElement(element: ITreeNode<OutlineEntry, FuzzyScore>, _index: number, template: NotebookOutlineTemplate, _height: number | undefined): void {
		template.iconLabel.setLabel(element.element.label, undefined, { matches: createMatches(element.filterData) });
		if (this._themeService.getFileIconTheme().hasFileIcons) {
			template.iconClass.className = 'element-icon ' + getIconClassesForModeId(element.element.cell.language ?? '').join(' ');
		} else {
			template.iconClass.className = 'element-icon ' + ThemeIcon.asClassNameArray(element.element.icon).join(' ');
		}

		const { markerInfo } = element.element;
		if (!markerInfo) {
			template.decoration.style.removeProperty('--outline-element-color');
			template.decoration.textContent = '';
		} else {
			if (markerInfo.count === 0) {
				template.decoration.classList.add('bubble');
				template.decoration.innerText = '\uea71';
			} else {
				template.decoration.classList.remove('bubble');
				template.decoration.textContent = markerInfo.count > 9 ? '9+' : String(markerInfo.count);
			}
			const color = this._themeService.getColorTheme().getColor(markerInfo.topSev === MarkerSeverity.Error ? listErrorForeground : listWarningForeground);
			template.decoration.style.setProperty('--outline-element-color', color?.toString() ?? 'inherit');
		}
	}

	disposeTemplate(templateData: NotebookOutlineTemplate): void {
		templateData.iconLabel.dispose();
	}
}

class NotebookOutlineAccessibility implements IListAccessibilityProvider<OutlineEntry> {
	getAriaLabel(element: OutlineEntry): string | null {
		return element.label;
	}
	getWidgetAriaLabel(): string {
		return '';
	}
}

class NotebookNavigationLabelProvider implements IKeyboardNavigationLabelProvider<OutlineEntry> {
	getKeyboardNavigationLabel(element: OutlineEntry): { toString(): string | undefined; } | { toString(): string | undefined; }[] | undefined {
		return element.label;
	}
}

class NotebookOutlineVirtualDelegate implements IListVirtualDelegate<OutlineEntry> {

	getHeight(_element: OutlineEntry): number {
		return 22;
	}

	getTemplateId(_element: OutlineEntry): string {
		return NotebookOutlineTemplate.templateId;
	}
}

class NotebookQuickPickProvider implements IQuickPickDataSource<OutlineEntry> {

	constructor(
		private _getEntries: () => OutlineEntry[],
		@IThemeService private readonly _themeService: IThemeService
	) { }

	getQuickPickElements(): Iterable<{ element: OutlineEntry; kind?: SymbolKind | undefined; label: string; iconClasses?: string[] | undefined; ariaLabel?: string | undefined; description?: string | undefined; }> {

		let bucket: OutlineEntry[] = [];
		for (let entry of this._getEntries()) {
			entry.asFlatList(bucket);
		}

		return bucket.map(entry => {
			return {
				element: entry,
				iconClasses: this._themeService.getFileIconTheme().hasFileIcons ? getIconClassesForModeId(entry.cell.language ?? '') : ThemeIcon.asClassNameArray(entry.icon),
				label: entry.label,
				ariaLabel: entry.label
			};
		});
	}
}

class NotebookComparator implements IOutlineComparator<OutlineEntry> {

	private readonly _collator = new IdleValue<Intl.Collator>(() => new Intl.Collator(undefined, { numeric: true }));


	compareByPosition(a: OutlineEntry, b: OutlineEntry): number {
		return a.index - b.index;
	}
	compareByType(a: OutlineEntry, b: OutlineEntry): number {
		return a.cell.cellKind - b.cell.cellKind || this._collator.value.compare(a.label, b.label);
	}
	compareByName(a: OutlineEntry, b: OutlineEntry): number {
		return this._collator.value.compare(a.label, b.label);
	}
}

class NotebookCellOutline implements IOutline<OutlineEntry> {

	private readonly _dispoables = new DisposableStore();

	private readonly _onDidChange = new Emitter<OutlineChangeEvent>();

	readonly onDidChange: Event<OutlineChangeEvent> = this._onDidChange.event;

	private _entries: OutlineEntry[] = [];
	private _activeEntry?: OutlineEntry;
	private readonly _entriesDisposables = new DisposableStore();

	readonly breadcrumbsConfig: IOutlineBreadcrumbsConfig<OutlineEntry>;
	readonly treeConfig: IOutlineTreeConfig<OutlineEntry>;
	readonly quickPickConfig: IOutlineQuickPickConfig<OutlineEntry>;

	readonly outlineKind = 'notebookCells';

	get activeElement(): OutlineEntry | undefined {
		return this._activeEntry;
	}

	constructor(
		private readonly _editor: NotebookEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IMarkerService private readonly _markerService: IMarkerService,
	) {
		const selectionListener = new MutableDisposable();
		this._dispoables.add(selectionListener);
		const installSelectionListener = () => {
			if (!_editor.viewModel) {
				selectionListener.clear();
			} else {
				selectionListener.value = combinedDisposable(
					_editor.viewModel.onDidChangeSelection(() => this._recomputeActive()),
					_editor.viewModel.onDidChangeViewCells(() => this._recomputeState())
				);
			}
		};

		this._dispoables.add(_editor.onDidChangeModel(() => {
			this._recomputeState();
			installSelectionListener();
		}));

		this._recomputeState();
		installSelectionListener();

		const options: IWorkbenchDataTreeOptions<OutlineEntry, FuzzyScore> = {
			collapseByDefault: true,
			expandOnlyOnTwistieClick: true,
			multipleSelectionSupport: false,
			accessibilityProvider: new NotebookOutlineAccessibility(),
			identityProvider: { getId: element => element.cell.id },
			keyboardNavigationLabelProvider: new NotebookNavigationLabelProvider()
		};

		const treeDataSource: IDataSource<this, OutlineEntry> = { getChildren: parent => parent instanceof NotebookCellOutline ? this._entries : parent.children };
		const delegate = new NotebookOutlineVirtualDelegate();
		const renderers = [instantiationService.createInstance(NotebookOutlineRenderer)];
		const comparator = new NotebookComparator();

		this.breadcrumbsConfig = {
			breadcrumbsDataSource: {
				getBreadcrumbElements: () => {
					let result: OutlineEntry[] = [];
					let candidate = this._activeEntry;
					while (candidate) {
						result.unshift(candidate);
						candidate = candidate.parent;
					}
					return result;
				}
			},
			treeDataSource,
			delegate,
			renderers,
			comparator,
			options
		};

		this.treeConfig = {
			treeDataSource,
			delegate,
			renderers,
			comparator,
			options
		};

		this.quickPickConfig = {
			quickPickDataSource: instantiationService.createInstance(NotebookQuickPickProvider, () => this._entries),
		};
	}

	dispose(): void {
		this._dispoables.dispose();
		this._entriesDisposables.dispose();
	}

	private _recomputeState(): void {
		this._entriesDisposables.clear();
		this._activeEntry = undefined;
		this._entries.length = 0;

		const { viewModel } = this._editor;
		if (!viewModel) {
			return;
		}

		const [selected] = viewModel.selectionHandles;
		const entries: OutlineEntry[] = [];

		for (let i = 0; i < viewModel.viewCells.length; i++) {
			const cell = viewModel.viewCells[i];
			const content = cell.getText();
			const isMarkdown = cell.cellKind === CellKind.Markdown;

			// find first none empty line or use default text
			const lineMatch = content.match(/^.*\w+.*\w*$/m);
			const preview = lineMatch ? lineMatch[0].trim() : localize('empty', "empty cell");

			let level = 7;
			if (isMarkdown) {
				const headers = content.match(/^[ \t]*(\#+)/gm);
				if (headers) {
					for (let j = 0; j < headers.length; j++) {
						level = Math.min(level, headers[j].length);
					}
				}
			}

			const entry = new OutlineEntry(i, level, cell, preview, isMarkdown ? Codicon.markdown : Codicon.code);
			entries.push(entry);
			if (cell.handle === selected) {
				this._activeEntry = entry;
			}

			// send an event whenever any of the cells change
			this._entriesDisposables.add(cell.model.onDidChangeContent(() => {
				this._recomputeState();
				this._onDidChange.fire({});
			}));
		}

		// build a tree from the list of entries
		if (entries.length > 0) {
			let result: OutlineEntry[] = [entries[0]];
			let parentStack: OutlineEntry[] = [entries[0]];

			for (let i = 1; i < entries.length; i++) {
				let entry = entries[i];

				while (true) {
					const len = parentStack.length;
					if (len === 0) {
						// root node
						result.push(entry);
						parentStack.push(entry);
						break;

					} else {
						let parentCandidate = parentStack[len - 1];
						if (parentCandidate.level < entry.level) {
							parentCandidate.addChild(entry);
							parentStack.push(entry);
							break;
						} else {
							parentStack.pop();
						}
					}
				}
			}

			this._entries = result;
		}

		// feature: show markers with each cell
		const updateMarker = () => {
			for (let entry of this._entries) {
				entry.updateMarkers(this._markerService);
			}
		};
		this._entriesDisposables.add(this._markerService.onMarkerChanged(e => {
			if (e.some(uri => viewModel.viewCells.some(cell => isEqual(cell.uri, uri)))) {
				updateMarker();
				this._onDidChange.fire({});
			}
		}));
		updateMarker();

		this._onDidChange.fire({});
	}

	private _recomputeActive(): void {
		let newActive: OutlineEntry | undefined;
		const { viewModel } = this._editor;

		if (viewModel) {
			const [selected] = viewModel.selectionHandles;
			const cell = viewModel.getCellByHandle(selected);
			if (cell) {
				for (let entry of this._entries) {
					newActive = entry.find(cell, []);
					if (newActive) {
						break;
					}
				}
			}
		}
		if (newActive !== this._activeEntry) {
			this._activeEntry = newActive;
			this._onDidChange.fire({ affectOnlyActiveElement: true });
		}
	}

	get isEmpty(): boolean {
		return this._entries.length === 0;
	}

	async reveal(entry: OutlineEntry, options: IEditorOptions, sideBySide: boolean): Promise<void> {

		await this._editorService.openEditor({
			resource: entry.cell.uri,
			options: { ...options }
		}, sideBySide ? SIDE_GROUP : undefined);
	}

	preview(entry: OutlineEntry): IDisposable {
		const widget = this._editor.getControl();
		if (!widget) {
			return Disposable.None;
		}
		widget.revealInCenterIfOutsideViewport(entry.cell);
		const ids = widget.deltaCellDecorations([], [{
			handle: entry.cell.handle,
			options: { className: 'nb-symbolHighlight', outputClassName: 'nb-symbolHighlight' }
		}]);
		return toDisposable(() => { widget.deltaCellDecorations(ids, []); });

	}

	getParent(_entry: OutlineEntry): OutlineEntry | undefined {
		return undefined;
	}
}

class NotebookOutlineCreator implements IOutlineCreator<NotebookEditor, OutlineEntry> {

	readonly dispose: () => void;

	constructor(
		@IOutlineService outlineService: IOutlineService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		const reg = outlineService.registerOutlineCreator(this);
		this.dispose = () => reg.dispose();
	}

	matches(candidate: IEditorPane): candidate is NotebookEditor {
		return candidate.getId() === NotebookEditor.ID;
	}

	async createOutline(editor: NotebookEditor): Promise<IOutline<OutlineEntry> | undefined> {
		return this._instantiationService.createInstance(NotebookCellOutline, editor);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(NotebookOutlineCreator, LifecyclePhase.Eventually);
