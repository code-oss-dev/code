/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { getZoomLevel } from 'vs/base/browser/browser';
import * as DOM from 'vs/base/browser/dom';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import 'vs/css!./notebook';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { contrastBorder, editorBackground, focusBorder, foreground, textBlockQuoteBackground, textBlockQuoteBorder, textLinkActiveForeground, textLinkForeground, textPreformatForeground, registerColor } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions, IEditorMemento, IEditorCloseEvent } from 'vs/workbench/common/editor';
import { INotebookEditor, NotebookLayoutInfo, CellState, NOTEBOOK_EDITOR_FOCUSED, CellFocusMode, ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEditorInput, NotebookEditorModel } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { INotebookService } from 'vs/workbench/contrib/notebook/browser/notebookService';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { BackLayerWebView } from 'vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView';
import { CodeCellRenderer, MarkdownCellRenderer, NotebookCellListDelegate } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellRenderer';
import { IOutput, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { getExtraColor } from 'vs/workbench/contrib/welcome/walkThrough/common/walkThroughUtils';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditor, ICompositeCodeEditor } from 'vs/editor/common/editorCommon';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { Emitter, Event } from 'vs/base/common/event';
import { NotebookCellList } from 'vs/workbench/contrib/notebook/browser/view/notebookCellList';
import { NotebookFindWidget } from 'vs/workbench/contrib/notebook/browser/contrib/notebookFindWidget';
import { NotebookViewModel, INotebookEditorViewState, IModelDecorationsChangeAccessor, CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IEditorGroupView } from 'vs/workbench/browser/parts/editor/editor';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { Range } from 'vs/editor/common/core/range';
import { CELL_MARGIN, RUN_BUTTON_WIDTH } from 'vs/workbench/contrib/notebook/browser/constants';
import { Color, RGBA } from 'vs/base/common/color';

const $ = DOM.$;
const NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'NotebookEditorViewState';

export class NotebookEditorOptions extends EditorOptions {

	readonly cellOptions?: IResourceEditorInput;

	constructor(options: Partial<NotebookEditorOptions>) {
		super();
		this.overwrite(options);
		this.cellOptions = options.cellOptions;
	}

	with(options: Partial<NotebookEditorOptions>): NotebookEditorOptions {
		return new NotebookEditorOptions({ ...this, ...options });
	}
}

export class NotebookCodeEditors implements ICompositeCodeEditor {

	private readonly _disposables = new DisposableStore();
	private readonly _onDidChangeActiveEditor = new Emitter<this>();
	readonly onDidChangeActiveEditor: Event<this> = this._onDidChangeActiveEditor.event;

	constructor(
		private _list: NotebookCellList,
		private _renderedEditors: Map<ICellViewModel, ICodeEditor | undefined>
	) {
		_list.onDidChangeFocus(_e => this._onDidChangeActiveEditor.fire(this), undefined, this._disposables);
	}

	dispose(): void {
		this._onDidChangeActiveEditor.dispose();
		this._disposables.dispose();
	}

	get activeCodeEditor(): IEditor | undefined {
		const [focused] = this._list.getFocusedElements();
		return this._renderedEditors.get(focused);
	}
}

export class NotebookEditor extends BaseEditor implements INotebookEditor {
	static readonly ID: string = 'workbench.editor.notebook';
	private rootElement!: HTMLElement;
	private body!: HTMLElement;
	private webview: BackLayerWebView | null = null;
	private list: NotebookCellList | undefined;
	private control: ICompositeCodeEditor | undefined;
	private renderedEditors: Map<ICellViewModel, ICodeEditor | undefined> = new Map();
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
		DOM.append(parent, this.findWidget.getDomNode());
	}

	private createCellList(): void {
		DOM.addClass(this.body, 'cell-list-container');

		const renders = [
			this.instantiationService.createInstance(CodeCellRenderer, this, this.renderedEditors),
			this.instantiationService.createInstance(MarkdownCellRenderer, this),
		];

		this.list = <NotebookCellList>this.instantiationService.createInstance(
			NotebookCellList,
			'NotebookCellList',
			this.body,
			this.instantiationService.createInstance(NotebookCellListDelegate),
			renders,
			this.contextKeyService,
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
			},
		);

		this.control = new NotebookCodeEditors(this.list, this.renderedEditors);
		this.webview = new BackLayerWebView(this.webviewService, this.notebookService, this, this.environmentSerice);
		this._register(this.webview.onMessage(message => {
			if (this.viewModel) {
				this.notebookService.onDidReceiveMessage(this.viewModel.viewType, this.viewModel.uri, message);
			}
		}));
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
			this.notebookService.destoryNotebookDocument(this.notebookViewModel.viewType!, this.notebookViewModel!.notebookDocument);
			this.notebookViewModel.dispose();
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

		if (this.notebookViewModel === undefined || !this.notebookViewModel.equal(model) || this.webview === null) {
			this.detachModel();
			await this.attachModel(input, model);
		}

		// reveal cell if editor options tell to do so
		if (options instanceof NotebookEditorOptions && options.cellOptions) {
			const cellOptions = options.cellOptions;
			const cell = this.notebookViewModel!.viewCells.find(cell => cell.uri.toString() === cellOptions.resource.toString());
			if (cell) {
				this.revealInCenterIfOutsideViewport(cell);
				const editor = this.renderedEditors.get(cell)!;
				if (editor) {
					if (cellOptions.options?.selection) {
						const { selection } = cellOptions.options;
						editor.setSelection({
							...selection,
							endLineNumber: selection.endLineNumber || selection.startLineNumber,
							endColumn: selection.endColumn || selection.startColumn
						});
					}
					if (!cellOptions.options?.preserveFocus) {
						editor.focus();
					}
				}
			}
		}
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
		this.findWidget.clear();
	}

	private async attachModel(input: NotebookEditorInput, model: NotebookEditorModel) {
		if (!this.webview) {
			this.webview = new BackLayerWebView(this.webviewService, this.notebookService, this, this.environmentSerice);
			this.list?.rowsContainer.insertAdjacentElement('afterbegin', this.webview!.element);
		}

		this.notebookViewModel = this.instantiationService.createInstance(NotebookViewModel, input.viewType!, model);
		this.notebookViewModel?.updateLayoutInfo(this.getLayoutInfo());
		const viewState = this.loadTextEditorViewState(input);
		this.notebookViewModel.restoreEditorViewState(viewState);

		this.localStore.add(this.notebookViewModel.onDidChangeViewCells((e) => {
			if (e.synchronous) {
				e.splices.reverse().forEach((diff) => {
					this.list?.splice(diff[0], diff[1], diff[2]);
				});
			} else {
				DOM.scheduleAtNextAnimationFrame(() => {
					e.splices.reverse().forEach((diff) => {
						this.list?.splice(diff[0], diff[1], diff[2]);
					});
				});
			}
		}));

		this.webview?.updateRendererPreloads(this.notebookViewModel.renderers);

		this.localStore.add(this.list!.onWillScroll(e => {
			this.webview!.updateViewScrollTop(-e.scrollTop, []);
		}));

		this.localStore.add(this.list!.onDidChangeContentHeight(() => {
			const scrollTop = this.list?.scrollTop || 0;
			const scrollHeight = this.list?.scrollHeight || 0;
			this.webview!.element.style.height = `${scrollHeight}px`;
			let updateItems: { cell: CodeCellViewModel, output: IOutput, cellTop: number }[] = [];

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
				this.notebookService.updateNotebookActiveCell(input.viewType!, input.resource!, e.elements[0].handle);
			}
		}));

		this.list?.splice(0, this.list?.length || 0);
		this.list?.splice(0, 0, this.notebookViewModel!.viewCells as CellViewModel[]);
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
		this.notebookViewModel?.updateLayoutInfo(this.getLayoutInfo());
	}

	protected saveState(): void {
		if (this.input instanceof NotebookEditorInput) {
			this.saveTextEditorViewState(this.input);
		}

		super.saveState();
	}

	//#endregion

	//#region Editor Features

	selectElement(cell: ICellViewModel) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.setSelection([index]);
			this.list?.setFocus([index]);
		}
	}

	revealInView(cell: ICellViewModel) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealInView(index);
		}
	}

	revealInCenterIfOutsideViewport(cell: ICellViewModel) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealInCenterIfOutsideViewport(index);
		}
	}

	revealInCenter(cell: ICellViewModel) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealInCenter(index);
		}
	}

	revealLineInView(cell: ICellViewModel, line: number): void {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealLineInView(index, line);
		}
	}

	revealLineInCenter(cell: ICellViewModel, line: number) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealLineInCenter(index, line);
		}
	}

	revealLineInCenterIfOutsideViewport(cell: ICellViewModel, line: number) {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealLineInCenterIfOutsideViewport(index, line);
		}
	}

	revealRangeInView(cell: ICellViewModel, range: Range): void {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealRangeInView(index, range);
		}
	}

	revealRangeInCenter(cell: ICellViewModel, range: Range): void {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealRangeInCenter(index, range);
		}
	}

	revealRangeInCenterIfOutsideViewport(cell: ICellViewModel, range: Range): void {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.revealRangeInCenterIfOutsideViewport(index, range);
		}
	}

	setCellSelection(cell: ICellViewModel, range: Range): void {
		const index = this.notebookViewModel?.getViewCellIndex(cell);

		if (index !== undefined) {
			this.list?.setCellSelection(index, range);
		}
	}

	changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any {
		return this.notebookViewModel?.changeDecorations(callback);
	}

	//#endregion

	//#region Find Delegate

	public showFind() {
		this.findWidget.reveal();
	}

	public hideFind() {
		this.findWidget.hide();
		this.focus();
	}

	//#endregion

	//#region Cell operations
	layoutNotebookCell(cell: ICellViewModel, height: number) {
		let relayout = (cell: ICellViewModel, height: number) => {
			let index = this.notebookViewModel!.getViewCellIndex(cell);
			if (index >= 0) {
				this.list?.updateElementHeight(index, height);
			}
		};

		DOM.scheduleAtNextAnimationFrame(() => {
			relayout(cell, height);
		});
	}

	async insertNotebookCell(cell: ICellViewModel, type: CellKind, direction: 'above' | 'below', initialText: string = ''): Promise<void> {
		const newLanguages = this.notebookViewModel!.languages;
		const language = newLanguages && newLanguages.length ? newLanguages[0] : 'markdown';
		const index = this.notebookViewModel!.getViewCellIndex(cell);
		const insertIndex = direction === 'above' ? index : index + 1;
		const newModeCell = await this.notebookService.createNotebookCell(this.notebookViewModel!.viewType, this.notebookViewModel!.uri, insertIndex, language, type);
		newModeCell!.source = initialText.split(/\r?\n/g);
		const newCell = this.notebookViewModel!.insertCell(insertIndex, newModeCell!, true);
		this.list?.setFocus([insertIndex]);

		if (type === CellKind.Markdown) {
			newCell.state = CellState.Editing;
		}

		DOM.scheduleAtNextAnimationFrame(() => {
			this.list?.revealInCenterIfOutsideViewport(insertIndex);
		});
	}

	async deleteNotebookCell(cell: ICellViewModel): Promise<void> {
		(cell as CellViewModel).save();
		const index = this.notebookViewModel!.getViewCellIndex(cell);
		await this.notebookService.deleteNotebookCell(this.notebookViewModel!.viewType, this.notebookViewModel!.uri, index);
		this.notebookViewModel!.deleteCell(index, true);
	}

	moveCellDown(cell: ICellViewModel): void {
		const index = this.notebookViewModel!.getViewCellIndex(cell);
		const newIdx = index + 1;
		this.moveCellToIndex(cell, index, newIdx);
	}

	moveCellUp(cell: ICellViewModel): void {
		const index = this.notebookViewModel!.getViewCellIndex(cell);
		const newIdx = index - 1;
		this.moveCellToIndex(cell, index, newIdx);
	}

	private moveCellToIndex(cell: ICellViewModel, index: number, newIdx: number): void {
		if (!this.notebookViewModel!.moveCellToIdx(index, newIdx, true)) {
			return;
		}

		DOM.scheduleAtNextAnimationFrame(() => {
			this.list?.revealInCenterIfOutsideViewport(index + 1);
		});
	}

	editNotebookCell(cell: CellViewModel): void {
		cell.state = CellState.Editing;

		this.renderedEditors.get(cell)?.focus();
	}

	saveNotebookCell(cell: ICellViewModel): void {
		cell.state = CellState.Preview;
	}

	getActiveCell() {
		let elements = this.list?.getFocusedElements();

		if (elements && elements.length) {
			return elements[0];
		}

		return undefined;
	}

	focusNotebookCell(cell: ICellViewModel, focusEditor: boolean) {
		const index = this.notebookViewModel!.getViewCellIndex(cell);

		if (focusEditor) {
			this.list?.setFocus([index]);
			this.list?.setSelection([index]);
			this.list?.focusView();

			cell.state = CellState.Editing;
			cell.focusMode = CellFocusMode.Editor;
			this.revealInCenterIfOutsideViewport(cell);
		} else {
			let itemDOM = this.list?.domElementAtIndex(index);
			if (document.activeElement && itemDOM && itemDOM.contains(document.activeElement)) {
				(document.activeElement as HTMLElement).blur();
			}

			cell.state = CellState.Preview;
			cell.focusMode = CellFocusMode.Editor;

			this.list?.setFocus([index]);
			this.list?.setSelection([index]);
			this.revealInCenterIfOutsideViewport(cell);
			this.list?.focusView();
		}
	}

	//#endregion

	//#region MISC

	getLayoutInfo(): NotebookLayoutInfo {
		if (!this.list) {
			throw new Error('Editor is not initalized successfully');
		}

		return {
			width: this.dimension!.width,
			height: this.dimension!.height,
			fontInfo: this.fontInfo!
		};
	}

	triggerScroll(event: IMouseWheelEvent) {
		this.list?.triggerScrollFromMouseWheelEvent(event);
	}

	createInset(cell: CodeCellViewModel, output: IOutput, shadowContent: string, offset: number) {
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

	postMessage(message: any) {
		this.webview?.webview.sendMessage(message);
	}

	//#endregion

	toJSON(): any {
		return {
			notebookHandle: this.viewModel?.handle
		};
	}
}

const embeddedEditorBackground = 'walkThrough.embeddedEditorBackground';

export const focusedCellIndicator = registerColor('notebook.focusedCellIndicator', {
	light: new Color(new RGBA(102, 175, 224)),
	dark: new Color(new RGBA(12, 125, 157)),
	hc: new Color(new RGBA(0, 73, 122))
}, nls.localize('notebook.focusedCellIndicator', "The color of the focused notebook cell indicator."));


registerThemingParticipant((theme, collector) => {
	const color = getExtraColor(theme, embeddedEditorBackground, { dark: 'rgba(0, 0, 0, .4)', extra_dark: 'rgba(200, 235, 255, .064)', light: '#f4f4f4', hc: null });
	if (color) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .cell .monaco-editor-background,
			.monaco-workbench .part.editor > .content .notebook-editor .cell .margin-view-overlays { background: ${color}; }`);
	}
	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .cell .output a { color: ${link}; }`);
	}
	const activeLink = theme.getColor(textLinkActiveForeground);
	if (activeLink) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .cell .output a:hover,
			.monaco-workbench .part.editor > .content .notebook-editor .cell .output a:active { color: ${activeLink}; }`);
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

	const focusedCellIndicatorColor = theme.getColor(focusedCellIndicator);
	if (focusedCellIndicatorColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .monaco-list-row.focused .notebook-cell-focus-indicator { border-color: ${focusedCellIndicatorColor}; }`);
		collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .monaco-list-row.selected .notebook-cell-focus-indicator { border-color: ${focusedCellIndicatorColor}; }`);
	}

	// Cell Margin
	collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .monaco-list-row > div.cell { padding: 8px ${CELL_MARGIN}px 8px ${CELL_MARGIN}px; }`);
	collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .output { margin: 8px ${CELL_MARGIN}px 8px ${CELL_MARGIN + RUN_BUTTON_WIDTH}px }`);

	collector.addRule(`.monaco-workbench .part.editor > .content .notebook-editor .cell .cell-editor-container { width: calc(100% - ${RUN_BUTTON_WIDTH}px); }`);
});
