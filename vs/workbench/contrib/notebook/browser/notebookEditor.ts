/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomLevel } from 'vs/base/browser/browser';
import * as DOM from 'vs/base/browser/dom';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import 'vs/css!./notebook';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { contrastBorder, editorBackground, focusBorder, foreground, textBlockQuoteBackground, textBlockQuoteBorder, textLinkActiveForeground, textLinkForeground, textPreformatForeground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions, IEditorMemento, ICompositeCodeEditor, IEditorCloseEvent } from 'vs/workbench/common/editor';
import { INotebookEditor, NotebookFindDelegate, CellFindMatch } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEditorInput, NotebookEditorModel } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { INotebookService } from 'vs/workbench/contrib/notebook/browser/notebookService';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { BackLayerWebView } from 'vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView';
import { CodeCellRenderer, MarkdownCellRenderer, NotebookCellListDelegate } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellRenderer';
import { CELL_MARGIN, NotebookCellsSplice, IOutput, parseCellUri, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { getExtraColor } from 'vs/workbench/contrib/welcome/walkThrough/common/walkThroughUtils';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditor } from 'vs/editor/common/editorCommon';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { Emitter, Event } from 'vs/base/common/event';
import { NotebookCellList } from 'vs/workbench/contrib/notebook/browser/view/notebookCellList';
import { NotebookFindWidget } from 'vs/workbench/contrib/notebook/browser/contrib/notebookFindWidget';
import { NotebookViewModel, INotebookEditorViewState, IModelDecorationsChangeAccessor } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IEditorGroupView } from 'vs/workbench/browser/parts/editor/editor';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookCellViewModel';

const $ = DOM.$;
const NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'NotebookEditorViewState';

export const NOTEBOOK_EDITOR_FOCUSED = new RawContextKey<boolean>('notebookEditorFocused', false);

export class NotebookCodeEditors implements ICompositeCodeEditor {

	private readonly _disposables = new DisposableStore();
	private readonly _onDidChangeActiveEditor = new Emitter<this>();
	readonly onDidChangeActiveEditor: Event<this> = this._onDidChangeActiveEditor.event;

	constructor(
		private _list: NotebookCellList<CellViewModel>,
		private _renderedEditors: Map<CellViewModel, ICodeEditor | undefined>
	) {
		_list.onDidChangeFocus(e => this._onDidChangeActiveEditor.fire(this), undefined, this._disposables);
	}

	dispose(): void {
		this._onDidChangeActiveEditor.dispose();
		this._disposables.dispose();
	}

	get activeCodeEditor(): IEditor | undefined {
		const [focused] = this._list.getFocusedElements();
		return focused instanceof CellViewModel
			? this._renderedEditors.get(focused)
			: undefined;
	}

	activate(input: IResourceEditorInput): ICodeEditor | undefined {
		const data = parseCellUri(input.resource);
		if (!data) {
			return undefined;
		}
		// find the CellViewModel which represents the cell with the
		// given uri, scroll it into view so that the editor is alive,
		// and then set selection et al..
		for (let i = 0; i < this._list.length; i++) {
			const item = this._list.element(i);
			if (item.cell.uri.toString() === input.resource.toString()) {
				this._list.reveal(i, 0.2);
				this._list.setFocus([i]);
				const editor = this._renderedEditors.get(item);
				if (!editor) {
					break;
				}
				if (input.options?.selection) {
					const { selection } = input.options;
					editor.setSelection({
						...selection,
						endLineNumber: selection.endLineNumber || selection.startLineNumber,
						endColumn: selection.endColumn || selection.startColumn
					});
				}
				if (!input.options?.preserveFocus) {
					editor.focus();
				}
				return editor;
			}
		}
		return undefined;
	}
}

export class NotebookEditor extends BaseEditor implements INotebookEditor, NotebookFindDelegate {
	static readonly ID: string = 'workbench.editor.notebook';
	private rootElement!: HTMLElement;
	private body!: HTMLElement;
	private webview: BackLayerWebView | null = null;
	private list: NotebookCellList<CellViewModel> | undefined;
	private control: ICompositeCodeEditor | undefined;
	private renderedEditors: Map<CellViewModel, ICodeEditor | undefined> = new Map();
	private notebookViewModel: NotebookViewModel | undefined;
	private localStore: DisposableStore = this._register(new DisposableStore());
	private editorMemento: IEditorMemento<INotebookEditorViewState>;
	private readonly groupListener = this._register(new MutableDisposable());
	private fontInfo: BareFontInfo | undefined;
	private dimension: DOM.Dimension | null = null;
	private editorFocus: IContextKey<boolean> | null = null;
	private outputRenderer: OutputRenderer;
	private findWidget: NotebookFindWidget;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private webviewService: IWebviewService,
		@INotebookService private notebookService: INotebookService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEnvironmentService private readonly environmentSerice: IEnvironmentService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super(NotebookEditor.ID, telemetryService, themeService, storageService);

		this.editorMemento = this.getEditorMemento<INotebookEditorViewState>(editorGroupService, NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY);
		this.outputRenderer = new OutputRenderer(this, this.instantiationService);
		this.findWidget = this.instantiationService.createInstance(NotebookFindWidget, this);
		this.findWidget.updateTheme(this.themeService.getColorTheme());
	}

	get viewModel() {
		return this.notebookViewModel;
	}

	get minimumWidth(): number { return 375; }
	get maximumWidth(): number { return Number.POSITIVE_INFINITY; }

	// these setters need to exist because this extends from BaseEditor
	set minimumWidth(value: number) { /*noop*/ }
	set maximumWidth(value: number) { /*noop*/ }

	get viewType() { return this.notebookViewModel?.viewType; }


	//#region Editor Core


	public get isNotebookEditor() {
		return true;
	}

	protected createEditor(parent: HTMLElement): void {
		this.rootElement = DOM.append(parent, $('.notebook-editor'));
		this.createBody(this.rootElement);
		this.generateFontInfo();
		this.editorFocus = NOTEBOOK_EDITOR_FOCUSED.bindTo(this.contextKeyService);
		this._register(this.onDidFocus(() => {
			this.editorFocus?.set(true);
		}));

		this._register(this.onDidBlur(() => {
			this.editorFocus?.set(false);
		}));
	}

	private generateFontInfo(): void {
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this.fontInfo = BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel());
	}

	private createBody(parent: HTMLElement): void {
		this.body = document.createElement('div');
		DOM.addClass(this.body, 'cell-list-container');
		this.createCellList();
		DOM.append(parent, this.body);
		DOM.append(this.body, this.findWidget.getDomNode());
	}

	private createCellList(): void {
		DOM.addClass(this.body, 'cell-list-container');

		const renders = [
			this.instantiationService.createInstance(CodeCellRenderer, this, this.renderedEditors),
			this.instantiationService.createInstance(MarkdownCellRenderer, this),
		];

		this.list = <NotebookCellList<CellViewModel>>this.instantiationService.createInstance(
			NotebookCellList,
			'NotebookCellList',
			this.body,
			this.instantiationService.createInstance(NotebookCellListDelegate),
			renders,
			{
				setRowLineHeight: false,
				setRowHeight: false,
				supportDynamicHeights: true,
				horizontalScrolling: false,
				keyboardSupport: false,
				mouseSupport: true,
				multipleSelectionSupport: false,
				enableKeyboardNavigation: true,
				overrideStyles: {
					listBackground: editorBackground,
					listActiveSelectionBackground: editorBackground,
					listActiveSelectionForeground: foreground,
					listFocusAndSelectionBackground: editorBackground,
					listFocusAndSelectionForeground: foreground,
					listFocusBackground: editorBackground,
					listFocusForeground: foreground,
					listHoverForeground: foreground,
					listHoverBackground: editorBackground,
					listHoverOutline: focusBorder,
					listFocusOutline: focusBorder,
					listInactiveSelectionBackground: editorBackground,
					listInactiveSelectionForeground: foreground,
					listInactiveFocusBackground: editorBackground,
					listInactiveFocusOutline: editorBackground,
				}
			}
		);

		this.control = new NotebookCodeEditors(this.list, this.renderedEditors);
		this.webview = new BackLayerWebView(this.webviewService, this.notebookService, this, this.environmentSerice);
		this.list.rowsContainer.appendChild(this.webview.element);
		this._register(this.list);
	}

	getControl() {
		return this.control;
	}

	onHide() {
		this.editorFocus?.set(false);
		if (this.webview) {
			this.localStore.clear();
			this.list?.rowsContainer.removeChild(this.webview?.element);
			this.webview?.dispose();
			this.webview = null;
		}

		this.list?.splice(0, this.list?.length);

		if (this.notebookViewModel && !this.notebookViewModel.isDirty()) {
			this.notebookService.destoryNotebookDocument(this.viewType!, this.notebookViewModel!.notebookDocument);
			this.notebookViewModel = undefined;
		}

		super.onHide();
	}

	setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		super.setEditorVisible(visible, group);
		this.groupListener.value = ((group as IEditorGroupView).onWillCloseEditor(e => this.onWillCloseEditorInGroup(e)));
	}

	private onWillCloseEditorInGroup(e: IEditorCloseEvent): void {
		const editor = e.editor;
		if (!(editor instanceof NotebookEditorInput)) {
			return; // only handle files
		}

		if (editor === this.input) {
			this.saveTextEditorViewState(editor);
		}
	}

	focus() {
		super.focus();
		this.editorFocus?.set(true);
	}

	async setInput(input: NotebookEditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {
		if (this.input instanceof NotebookEditorInput) {
			this.saveTextEditorViewState(this.input);
		}

		await super.setInput(input, options, token);
		const model = await input.resolve();

		if (this.notebookViewModel !== undefined && this.notebookViewModel.equal(model) && this.webview !== null) {
			return;
		}

		this.detachModel();
		await this.attachModel(input, model);
	}

	clearInput(): void {
		if (this.input && this.input instanceof NotebookEditorInput && !this.input.isDisposed()) {
			this.saveTextEditorViewState(this.input);
		}

		super.clearInput();
	}

	private detachModel() {
		this.localStore.clear();
		this.notebookViewModel?.dispose();
		this.notebookViewModel = undefined;
		this.webview?.clearInsets();
		this.webview?.clearPreloadsCache();
	}

	private async attachModel(input: NotebookEditorInput, model: NotebookEditorModel) {
		if (!this.webview) {
			this.webview = new BackLayerWebView(this.webviewService, this.notebookService, this, this.environmentSerice);
			this.list?.rowsContainer.insertAdjacentElement('afterbegin', this.webview!.element);
		}

		this.notebookViewModel = this.instantiationService.createInstance(NotebookViewModel, input.viewType!, model);
		const viewState = this.loadTextEditorViewState(input);
		this.notebookViewModel.restoreEditorViewState(viewState);

		this.localStore.add(this.notebookViewModel.onDidChangeCells((e) => {
			this.updateViewCells(e);
		}));

		this.webview?.updateRendererPreloads(this.notebookViewModel.renderers);

		this.localStore.add(this.list!.onWillScroll(e => {
			this.webview!.updateViewScrollTop(-e.scrollTop, []);
		}));

		this.localStore.add(this.list!.onDidChangeContentHeight(() => {
			const scrollTop = this.list?.scrollTop || 0;
			const scrollHeight = this.list?.scrollHeight || 0;
			this.webview!.element.style.height = `${scrollHeight}px`;
			let updateItems: { cell: CellViewModel, output: IOutput, cellTop: number }[] = [];

			if (this.webview?.insetMapping) {
				this.webview?.insetMapping.forEach((value, key) => {
					let cell = value.cell;
					let index = this.notebookViewModel!.getViewCellIndex(cell);
					let cellTop = this.list?.getAbsoluteTop(index) || 0;
					if (this.webview!.shouldUpdateInset(cell, key, cellTop)) {
						updateItems.push({
							cell: cell,
							output: key,
							cellTop: cellTop
						});
					}
				});

				if (updateItems.length) {
					this.webview?.updateViewScrollTop(-scrollTop, updateItems);
				}
			}
		}));

		this.localStore.add(this.list!.onDidChangeFocus((e) => {
			if (e.elements.length > 0) {
				this.notebookService.updateNotebookActiveCell(input.viewType!, input.resource!, e.elements[0].cell.handle);
			}
		}));

		this.list?.splice(0, this.list?.length || 0);
		this.list?.splice(0, 0, this.notebookViewModel!.viewCells);
		this.list?.layout();
	}

	private saveTextEditorViewState(input: NotebookEditorInput): void {
		if (this.group && this.notebookViewModel) {
			const state = this.notebookViewModel.saveEditorViewState();
			this.editorMemento.saveEditorState(this.group, input.resource, state);
		}
	}

	private loadTextEditorViewState(input: NotebookEditorInput): INotebookEditorViewState | undefined {
		if (this.group) {
			return this.editorMemento.loadEditorState(this.group, input.resource);
		}

		return;
	}

	layout(dimension: DOM.Dimension): void {
		this.dimension = new DOM.Dimension(dimension.width, dimension.height);
		DOM.toggleClass(this.rootElement, 'mid-width', dimension.width < 1000 && dimension.width >= 600);
		DOM.toggleClass(this.rootElement, 'narrow-width', dimension.width < 600);
		DOM.size(this.body, dimension.width, dimension.height);
		this.list?.layout(dimension.height, dimension.width);
	}

	protected saveState(): void {
		if (this.input instanceof NotebookEditorInput) {
			this.saveTextEditorViewState(this.input);
		}

		super.saveState();
	}

	//#endregion

	//#region Editor Features

	revealInView(cell: CellViewModel, offset?: number) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealInView(index, offset);
		}
	}

	revealInCenterIfOutsideViewport(cell: CellViewModel, offset?: number) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealInCenterIfOutsideViewport(index, offset);
		}
	}

	revealInCenter(cell: CellViewModel, offset?: number) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealInCenter(index, offset);
		}
	}

	changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any {
		return this.notebookViewModel?.changeDecorations(callback);
	}

	//#endregion

	//#region Find Delegate
	startFind(value: string): CellFindMatch[] {
		let matches: CellFindMatch[] = [];
		this.notebookViewModel!.viewCells.forEach(cell => {
			let cellMatches = cell.startFind(value);
			if (cellMatches) {
				matches.push(cellMatches);
			}
		});

		return matches;
	}

	stopFind(keepSelection?: boolean | undefined): void {
	}

	focusNext(match: CellFindMatch) {
		let cell = match.cell;
		let index = this.notebookViewModel!.viewCells.indexOf(cell);

		this.list?.revealInView(index);
	}

	public showFind() {
		this.findWidget.reveal();
	}

	public hideFind() {
		this.findWidget.hide();
	}

	//#endregion

	//#region Cell operations
	layoutNotebookCell(cell: CellViewModel, height: number) {
		let relayout = (cell: CellViewModel, height: number) => {
			let index = this.notebookViewModel!.getViewCellIndex(cell);
			if (index >= 0) {
				this.list?.updateElementHeight(index, height);
			}
		};

		DOM.scheduleAtNextAnimationFrame(() => {
			relayout(cell, height);
		});
	}

	updateViewCells(splices: NotebookCellsSplice[]) {
		DOM.scheduleAtNextAnimationFrame(() => {
			splices.reverse().forEach((diff) => {
				this.list?.splice(diff[0], diff[1], diff[2].map(cell => {
					return this.instantiationService.createInstance(CellViewModel, this.viewType!, this.notebookViewModel!.handle, cell);
				}));
			});
		});
	}

	async insertEmptyNotebookCell(cell: CellViewModel, type: CellKind, direction: 'above' | 'below'): Promise<void> {
		const newLanguages = this.notebookViewModel!.languages;
		const language = newLanguages && newLanguages.length ? newLanguages[0] : 'markdown';
		const index = this.notebookViewModel!.getViewCellIndex(cell);
		const insertIndex = direction === 'above' ? index : index + 1;
		const newModeCell = await this.notebookService.createNotebookCell(this.viewType!, this.notebookViewModel!.uri, insertIndex, language, type);
		const newCell = this.instantiationService.createInstance(CellViewModel, this.viewType!, this.notebookViewModel!.handle, newModeCell!);

		this.notebookViewModel!.insertCell(insertIndex, newCell);
		this.list?.splice(insertIndex, 0, [newCell]);
		this.list?.setFocus([insertIndex]);

		if (type === CellKind.Markdown) {
			newCell.isEditing = true;
		}

		DOM.scheduleAtNextAnimationFrame(() => {
			this.list?.revealInCenterIfOutsideViewport(insertIndex);
		});
	}

	async deleteNotebookCell(cell: CellViewModel): Promise<void> {
		const index = this.notebookViewModel!.getViewCellIndex(cell);
		await this.notebookService.deleteNotebookCell(this.viewType!, this.notebookViewModel!.uri, index);
		this.notebookViewModel!.deleteCell(index);
		this.list?.splice(index, 1);
	}

	editNotebookCell(cell: CellViewModel): void {
		cell.isEditing = true;

		this.renderedEditors.get(cell)?.focus();
	}

	saveNotebookCell(cell: CellViewModel): void {
		cell.isEditing = false;
	}

	getActiveCell() {
		let elements = this.list?.getFocusedElements();

		if (elements && elements.length) {
			return elements[0];
		}

		return undefined;
	}

	focusNotebookCell(cell: CellViewModel, focusEditor: boolean) {
		const index = this.notebookViewModel!.getViewCellIndex(cell);

		if (focusEditor) {

		} else {
			let itemDOM = this.list?.domElementAtIndex(index);
			if (document.activeElement && itemDOM && itemDOM.contains(document.activeElement)) {
				(document.activeElement as HTMLElement).blur();
			}

			cell.isEditing = false;
		}

		this.list?.setFocus([index]);
		this.list?.focusView();
	}

	//#endregion

	//#region MISC

	getFontInfo(): BareFontInfo | undefined {
		return this.fontInfo;
	}

	getListDimension(): DOM.Dimension | null {
		return this.dimension;
	}

	triggerScroll(event: IMouseWheelEvent) {
		this.list?.triggerScrollFromMouseWheelEvent(event);
	}

	createInset(cell: CellViewModel, output: IOutput, shadowContent: string, offset: number) {
		if (!this.webview) {
			return;
		}

		let preloads = this.notebookViewModel!.renderers;

		if (!this.webview!.insetMapping.has(output)) {
			let index = this.notebookViewModel!.getViewCellIndex(cell);
			let cellTop = this.list?.getAbsoluteTop(index) || 0;

			this.webview!.createInset(cell, output, cellTop, offset, shadowContent, preloads);
		} else {
			let index = this.notebookViewModel!.getViewCellIndex(cell);
			let cellTop = this.list?.getAbsoluteTop(index) || 0;
			let scrollTop = this.list?.scrollTop || 0;

			this.webview!.updateViewScrollTop(-scrollTop, [{ cell: cell, output: output, cellTop: cellTop }]);
		}
	}

	removeInset(output: IOutput) {
		if (!this.webview) {
			return;
		}

		this.webview!.removeInset(output);
	}

	getOutputRenderer(): OutputRenderer {
		return this.outputRenderer;
	}

	//#endregion
}

const embeddedEditorBackground = 'walkThrough.embeddedEditorBackground';

registerThemingParticipant((theme, collector) => {
	const color = getExtraColor(theme, embeddedEditorBackground, { dark: 'rgba(0, 0, 0, .4)', extra_dark: 'rgba(200, 235, 255, .064)', light: '#f4f4f4', hc: null });
	if (color) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .cell .monaco-editor-background,
			.monaco-workbench .part.editor > .content .notebook-editor .cell .margin-view-overlays { background: ${color}; }`);
	}
	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor a { color: ${link}; }`);
	}
	const activeLink = theme.getColor(textLinkActiveForeground);
	if (activeLink) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor a:hover,
			.monaco-workbench .part.editor > .content .notebook-editor a:active { color: ${activeLink}; }`);
	}
	const shortcut = theme.getColor(textPreformatForeground);
	if (shortcut) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor code,
			.monaco-workbench .part.editor > .content .notebook-editor .shortcut { color: ${shortcut}; }`);
	}
	const border = theme.getColor(contrastBorder);
	if (border) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .monaco-editor { border-color: ${border}; }`);
	}
	const quoteBackground = theme.getColor(textBlockQuoteBackground);
	if (quoteBackground) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor blockquote { background: ${quoteBackground}; }`);
	}
	const quoteBorder = theme.getColor(textBlockQuoteBorder);
	if (quoteBorder) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor blockquote { border-color: ${quoteBorder}; }`);
	}

	const inactiveListItem = theme.getColor('list.inactiveSelectionBackground');

	if (inactiveListItem) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .output { background-color: ${inactiveListItem}; }`);
	}

	// Cell Margin
	collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .monaco-list-row > div.cell { padding: 8px ${CELL_MARGIN}px 8px ${CELL_MARGIN}px; }`);
	collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .output { margin: 8px ${CELL_MARGIN}px; }`);
});
