/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./notebook';
import * as DOM from 'vs/base/browser/dom';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import * as marked from 'vs/base/common/marked/marked';
import { IModelService } from 'vs/editor/common/services/modelService';
import { URI } from 'vs/base/common/uri';
import { deepClone } from 'vs/base/common/objects';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { getZoomLevel } from 'vs/base/browser/browser';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Action } from 'vs/base/common/actions';
import { IDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { MimeTypeRenderer } from 'vs/workbench/contrib/notebook/browser/outputRenderer';
import { ITextModel } from 'vs/editor/common/model';
import { IModeService } from 'vs/editor/common/services/modeService';
import { Emitter } from 'vs/base/common/event';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import * as UUID from 'vs/base/common/uuid';
import { ICell } from 'vs/editor/common/modes';
import { getResizesObserver } from 'vs/workbench/contrib/notebook/browser/sizeObserver';

export const CELL_MARGIN = 24;

export class ViewCell extends Disposable {
	private _textModel: ITextModel | null = null;
	private _mdRenderer: marked.Renderer | null = null;
	private _html: string | null = null;
	private _dynamicHeight: number | null = null;

	protected readonly _onDidDispose = new Emitter<void>();
	readonly onDidDispose = this._onDidDispose.event;

	protected readonly _onDidChangeEditingState = new Emitter<void>();
	readonly onDidChangeEditingState = this._onDidChangeEditingState.event;

	protected readonly _onDidChangeOutputs = new Emitter<void>();
	readonly onDidChangeOutputs = this._onDidChangeOutputs.event;

	get cellType() {
		return this.cell.cell_type;
	}

	get lineCount() {
		return this.cell.source.length;
	}

	get outputs() {
		return this.cell.outputs;
	}

	get isEditing(): boolean {
		return this._isEditing;
	}

	set isEditing(newState: boolean) {
		this._isEditing = newState;
		this._onDidChangeEditingState.fire();
	}

	public id: string;

	constructor(
		public viewType: string,
		public notebookHandle: number,
		public cell: ICell,
		private _isEditing: boolean,
		private readonly modelService: IModelService,
		private readonly modeService: IModeService
	) {
		super();

		this.id = UUID.generateUuid();
		if (this.cell.onDidChangeOutputs) {
			this.cell.onDidChangeOutputs(() => {
				this._onDidChangeOutputs.fire();
			});
		}
	}

	hasDynamicHeight() {
		if (this._dynamicHeight !== null) {
			return false;
		}

		if (this.cellType === 'code') {
			if (this.outputs && this.outputs.length > 0) {
				// for (let i = 0; i < this.outputs.length; i++) {
				// 	if (this.outputs[i].output_type === 'display_data' || this.outputs[i].output_type === 'execute_result') {
				// 		return false;
				// 	}
				// }

				return true;
			} else {
				return false;
			}
		}

		return true;
	}

	setDynamicHeight(height: number) {
		this._dynamicHeight = height;
	}

	getDynamicHeight() {
		return this._dynamicHeight;
	}

	getHeight(lineHeight: number) {
		if (this._dynamicHeight) {
			return this._dynamicHeight;
		}

		if (this.cellType === 'markdown') {
			return 100;
		} else {
			return this.lineCount * lineHeight + 16;
		}
	}

	setText(strs: string[]) {
		this.cell.source = strs;
		this._html = null;
	}

	save() {
		if (this._textModel && (this.cell.isDirty || this.isEditing)) {
			let cnt = this._textModel.getLineCount();
			this.cell.source = this._textModel.getLinesContent().map((str, index) => str + (index !== cnt - 1 ? '\n' : ''));
		}
	}

	getText(): string {
		return this.cell.source.join('\n');
	}

	getHTML(): string | null {
		if (this.cellType === 'markdown') {
			if (this._html) {
				return this._html;
			}

			let renderer = this.getMDRenderer();
			this._html = marked(this.getText(), { renderer: renderer });
			return this._html;
		}

		return null;
	}

	getTextModel(): ITextModel {
		if (!this._textModel) {
			let mode = this.modeService.create(this.cellType === 'markdown' ? 'markdown' : this.cell.language);
			let ext = this.cellType === 'markdown' ? 'md' : 'py';
			let resource = URI.parse(`notebookcell-${Date.now()}.${ext}`);
			resource = resource.with({ authority: `notebook+${this.viewType}-${this.notebookHandle}-${this.cell.handle}` });
			let content = this.cell.source.join('\n');
			this._textModel = this.modelService.createModel(content, mode, resource, false);
			this._register(this._textModel);
			this._register(this._textModel.onDidChangeContent(() => {
				this.cell.isDirty = true;
			}));
		}

		return this._textModel;
	}

	private getMDRenderer() {

		if (!this._mdRenderer) {
			this._mdRenderer = new marked.Renderer({ gfm: true });
		}

		return this._mdRenderer;
	}
}

export interface NotebookHandler {
	insertEmptyNotebookCell(listIndex: number | undefined, cell: ViewCell, type: 'markdown' | 'code', direction: 'above' | 'below'): Promise<void>;
	deleteNotebookCell(listIndex: number | undefined, cell: ViewCell): void;
	editNotebookCell(listIndex: number | undefined, cell: ViewCell): void;
	saveNotebookCell(listIndex: number | undefined, cell: ViewCell): void;
	layoutElement(cell: ViewCell, height: number): void;
	createContentWidget(cell: ViewCell, index: number, shadowContent: string, offset: number): void;
	disposeViewCell(cell: ViewCell): void;
	triggerWheel(event: IMouseWheelEvent): void;
	getFontInfo(): BareFontInfo | undefined;
	getListDimension(): DOM.Dimension | null;
}

export interface CellRenderTemplate {
	container: HTMLElement;
	cellContainer: HTMLElement;
	menuContainer?: HTMLElement;
	editingContainer?: HTMLElement;
	outputContainer?: HTMLElement;
	editor?: CodeEditorWidget;
	model?: ITextModel;
	index: number;
}

export class NotebookCellListDelegate implements IListVirtualDelegate<ViewCell> {
	private _lineHeight: number;
	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this._lineHeight = BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel()).lineHeight;
	}

	getHeight(element: ViewCell): number {
		return element.getHeight(this._lineHeight);
	}

	hasDynamicHeight(element: ViewCell): boolean {
		return element.hasDynamicHeight();
	}

	getDynamicHeight(element: ViewCell) {
		return element.getDynamicHeight() || 0;
	}

	getTemplateId(element: ViewCell): string {
		if (element.cellType === 'markdown') {
			return MarkdownCellRenderer.TEMPLATE_ID;
		} else {
			return CodeCellRenderer.TEMPLATE_ID;
		}
	}
}

class AbstractCellRenderer {
	protected editorOptions: IEditorOptions;

	constructor(
		protected handler: NotebookHandler,
		private contextMenuService: IContextMenuService,
		private configurationService: IConfigurationService,
		language: string
	) {
		const editorOptions = deepClone(this.configurationService.getValue<IEditorOptions>('editor', { overrideIdentifier: language }));
		this.editorOptions = {
			...editorOptions,
			scrollBeyondLastLine: false,
			scrollbar: {
				verticalScrollbarSize: 14,
				horizontal: 'auto',
				useShadows: true,
				verticalHasArrows: false,
				horizontalHasArrows: false,
				alwaysConsumeMouseWheel: false
			},
			overviewRulerLanes: 3,
			fixedOverflowWidgets: false,
			lineNumbersMinChars: 1,
			minimap: { enabled: false },
		};
	}

	showContextMenu(listIndex: number | undefined, element: ViewCell, x: number, y: number) {
		const actions: Action[] = [];
		const insertAbove = new Action(
			'workbench.notebook.code.insertCellAbove',
			'Insert Code Cell Above',
			undefined,
			true,
			async () => {
				await this.handler.insertEmptyNotebookCell(listIndex, element, 'code', 'above');
			}
		);
		actions.push(insertAbove);

		const insertBelow = new Action(
			'workbench.notebook.code.insertCellBelow',
			'Insert Code Cell Below',
			undefined,
			true,
			async () => {
				await this.handler.insertEmptyNotebookCell(listIndex, element, 'code', 'below');
			}
		);
		actions.push(insertBelow);

		const insertMarkdownAbove = new Action(
			'workbench.notebook.markdown.insertCellAbove',
			'Insert Markdown Cell Above',
			undefined,
			true,
			async () => {
				await this.handler.insertEmptyNotebookCell(listIndex, element, 'markdown', 'above');
			}
		);
		actions.push(insertMarkdownAbove);

		const insertMarkdownBelow = new Action(
			'workbench.notebook.markdown.insertCellBelow',
			'Insert Markdown Cell Below',
			undefined,
			true,
			async () => {
				await this.handler.insertEmptyNotebookCell(listIndex, element, 'markdown', 'below');
			}
		);
		actions.push(insertMarkdownBelow);

		if (element.cellType === 'markdown') {
			const editAction = new Action(
				'workbench.notebook.editCell',
				'Edit Cell',
				undefined,
				true,
				async () => {
					this.handler.editNotebookCell(listIndex, element);
				}
			);

			actions.push(editAction);

			const saveAction = new Action(
				'workbench.notebook.saveCell',
				'Save Cell',
				undefined,
				true,
				async () => {
					this.handler.saveNotebookCell(listIndex, element);
				}
			);

			actions.push(saveAction);
		}

		const deleteCell = new Action(
			'workbench.notebook.deleteCell',
			'Delete Cell',
			undefined,
			true,
			async () => {
				this.handler.deleteNotebookCell(listIndex, element);
			}
		);

		actions.push(deleteCell);

		this.contextMenuService.showContextMenu({
			getAnchor: () => {
				return {
					x,
					y
				};
			},
			getActions: () => {
				return actions;
			},
			autoSelectFirstItem: true
		});
	}
}

class StatefullMarkdownCell extends Disposable {
	private editor: CodeEditorWidget | null = null;
	private cellContainer: HTMLElement;
	private menuContainer?: HTMLElement;
	private editingContainer?: HTMLElement;

	constructor(
		handler: NotebookHandler,
		viewCell: ViewCell,
		templateData: CellRenderTemplate,
		editorOptions: IEditorOptions,
		instantiationService: IInstantiationService
	) {
		super();

		this.cellContainer = templateData.cellContainer;
		this.menuContainer = templateData.menuContainer;
		this.editingContainer = templateData.editingContainer;

		const viewUpdate = () => {
			if (viewCell.isEditing) {
				// switch to editing mode
				let width;
				const listDimension = handler.getListDimension();
				if (listDimension) {
					width = listDimension.width - CELL_MARGIN * 2;
				} else {
					width = this.cellContainer.clientWidth - 24 /** for scrollbar and margin right */;
				}

				const lineNum = viewCell.lineCount;
				const lineHeight = handler.getFontInfo()?.lineHeight ?? 18;
				const totalHeight = Math.max(lineNum, 1) * lineHeight;

				if (this.editor) {
					// not first time, we don't need to create editor or bind listeners
					this.editingContainer!.style.display = 'block';
				} else {
					this.editingContainer!.style.display = 'block';
					this.editingContainer!.innerHTML = '';
					this.editor = instantiationService.createInstance(CodeEditorWidget, this.editingContainer!, {
						...editorOptions,
						dimension: {
							width: width,
							height: totalHeight
						}
					}, {});
					const model = viewCell.getTextModel();
					this.editor.setModel(model);
					let scrollHeight = this.editor!.getLinesTotalHeight();

					if (scrollHeight !== totalHeight) {
						this.editor!.layout(
							{
								width: width,
								height: scrollHeight
							}
						);
					}

					let cellWidthResizeObserver = getResizesObserver(templateData.editingContainer!, {
						width: width,
						height: totalHeight
					}, () => {
						let newWidth = cellWidthResizeObserver.getWidth();
						let scrollHeight = this.editor!.getLinesTotalHeight();
						this.editor!.layout(
							{
								width: newWidth,
								height: scrollHeight
							}
						);
					});

					cellWidthResizeObserver.startObserving();

					// @TODO dispose?

					templateData.cellContainer.innerHTML = viewCell.getHTML() || '';

					model.onDidChangeContent(() => {
						viewCell.setText(model.getLinesContent());

						let viewLayout = this.editor!.getLayoutInfo();
						let scrollHeight = this.editor!.getLinesTotalHeight();

						if (scrollHeight !== viewLayout.contentHeight) {
							this.editor!.layout(
								{
									width: viewLayout.width,
									height: scrollHeight
								}
							);
						}

						this.cellContainer.innerHTML = viewCell.getHTML() || '';

						const clientHeight = this.cellContainer.clientHeight;
						handler.layoutElement(viewCell, totalHeight + 32 + clientHeight);
					});
				}

				const clientHeight = this.cellContainer.clientHeight;
				handler.layoutElement(viewCell, totalHeight + 32 + clientHeight);
				this.editor.focus();
			} else {
				if (this.editor) {
					// switch from editing mode
					this.editingContainer!.style.display = 'none';
					const clientHeight = this.cellContainer.clientHeight;
					handler.layoutElement(viewCell, clientHeight);
				} else {
					// first time, readonly mode
					this.editingContainer!.style.display = 'none';
					this.cellContainer.innerHTML = viewCell.getHTML() || '';
				}
			}
		};

		this._register(viewCell.onDidChangeEditingState(() => {
			viewUpdate();
		}));

		viewUpdate();
	}
}

export class MarkdownCellRenderer extends AbstractCellRenderer implements IListRenderer<ViewCell, CellRenderTemplate> {
	static readonly TEMPLATE_ID = 'markdown_cell';
	private disposables: Map<ViewCell, DisposableStore> = new Map();
	private count = 0;

	constructor(
		handler: NotebookHandler,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService
	) {
		super(handler, contextMenuService, configurationService, 'markdown');
	}

	get templateId() {
		return MarkdownCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): CellRenderTemplate {
		const codeInnerContent = document.createElement('div');
		DOM.addClasses(codeInnerContent, 'cell', 'code');
		codeInnerContent.style.display = 'none';

		container.appendChild(codeInnerContent);

		const innerContent = document.createElement('div');
		DOM.addClasses(innerContent, 'cell', 'markdown');
		container.appendChild(innerContent);

		const action = document.createElement('div');
		DOM.addClasses(action, 'menu', 'codicon-settings-gear', 'codicon');
		container.appendChild(action);

		const template = {
			container: container,
			cellContainer: innerContent,
			menuContainer: action,
			editingContainer: codeInnerContent,
			index: ++this.count
		};

		return template;
	}

	renderElement(element: ViewCell, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		templateData.editingContainer!.style.display = 'none';
		templateData.cellContainer.innerHTML = element.getHTML() || '';

		if (height) {
			this.disposables.get(element)?.clear();
			if (!this.disposables.has(element)) {
				this.disposables.set(element, new DisposableStore());
			}
			let elementDisposable = this.disposables.get(element);

			elementDisposable!.add(DOM.addStandardDisposableListener(templateData.menuContainer!, 'mousedown', e => {
				const { top, height } = DOM.getDomNodePagePosition(templateData.menuContainer!);
				e.preventDefault();

				const listIndexAttr = templateData.menuContainer?.parentElement?.getAttribute('data-index');
				const listIndex = listIndexAttr ? Number(listIndexAttr) : undefined;
				this.showContextMenu(listIndex, element, e.posx, top + height);
			}));

			elementDisposable!.add(new StatefullMarkdownCell(this.handler, element, templateData, this.editorOptions, this.instantiationService));
		}
	}

	disposeTemplate(templateData: CellRenderTemplate): void {
		// throw nerendererw Error('Method not implemented.');

	}

	disposeElement(element: ViewCell, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		if (height) {
			this.disposables.get(element)?.clear();
		}
	}
}

export class CodeCellRenderer extends AbstractCellRenderer implements IListRenderer<ViewCell, CellRenderTemplate> {
	static readonly TEMPLATE_ID = 'code_cell';
	private disposables: Map<HTMLElement, IDisposable> = new Map();
	private count = 0;

	constructor(
		protected handler: NotebookHandler,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService,
		@IWebviewService private readonly webviewService: IWebviewService
	) {
		super(handler, contextMenuService, configurationService, 'python');
	}

	get templateId() {
		return CodeCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): CellRenderTemplate {
		const innerContent = document.createElement('div');
		DOM.addClasses(innerContent, 'cell', 'code');
		container.appendChild(innerContent);
		const editor = this.instantiationService.createInstance(CodeEditorWidget, innerContent, {
			...this.editorOptions,
			dimension: {
				width: 0,
				height: 0
			}
		}, {});
		const action = document.createElement('div');
		DOM.addClasses(action, 'menu', 'codicon-settings-gear', 'codicon');
		container.appendChild(action);

		const outputContainer = document.createElement('div');
		DOM.addClasses(outputContainer, 'output');
		container.appendChild(outputContainer);

		let tempalte = {
			container: container,
			cellContainer: innerContent,
			menuContainer: action,
			outputContainer: outputContainer,
			editor,
			index: ++this.count
		};

		return tempalte;
	}

	renderElement(element: ViewCell, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		let width;
		const listDimension = this.handler.getListDimension();
		if (listDimension) {
			width = listDimension.width - CELL_MARGIN * 2;
		} else {
			width = templateData.container.clientWidth - 24 /** for scrollbar and margin right */;
		}

		const lineNum = element.lineCount;
		const lineHeight = this.handler.getFontInfo()?.lineHeight ?? 18;
		const totalHeight = lineNum * lineHeight;
		const model = element.getTextModel();
		templateData.editor?.setModel(model);
		templateData.editor?.layout(
			{
				width: width,
				height: totalHeight
			}
		);

		let scrollHeight = templateData.editor?.getLinesTotalHeight();

		if (scrollHeight !== undefined && scrollHeight !== totalHeight) {
			templateData.editor?.layout(
				{
					width: width,
					height: scrollHeight
				}
			);
		}

		let cellWidthResizeObserver = getResizesObserver(templateData.cellContainer, {
			width: width,
			height: totalHeight
		}, () => {
			let newWidth = cellWidthResizeObserver.getWidth();
			let scrollHeight = templateData.editor!.getLinesTotalHeight();
			templateData.editor?.layout(
				{
					width: newWidth,
					height: scrollHeight
				}
			);
		});

		cellWidthResizeObserver.startObserving();

		let contentChangeListener = templateData.editor?.onDidChangeModelContent(() => {
			let scrollHeight = templateData.editor!.getLinesTotalHeight();
			let contentHeight = templateData.editor!.getLayoutInfo().contentHeight;
			let contentWidth = templateData.editor!.getLayoutInfo().width;

			if (scrollHeight !== contentHeight) {
				templateData.editor!.layout(
					{
						width: contentWidth,
						height: scrollHeight
					}
				);
			}
		});

		let listener = DOM.addStandardDisposableListener(templateData.menuContainer!, 'mousedown', e => {
			let { top, height } = DOM.getDomNodePagePosition(templateData.menuContainer!);
			e.preventDefault();

			const listIndexAttr = templateData.menuContainer?.parentElement?.getAttribute('data-index');
			const listIndex = listIndexAttr ? Number(listIndexAttr) : undefined;

			this.showContextMenu(listIndex, element, e.posx, top + height);
		});

		let rerenderOutput = element.onDidChangeOutputs(() => {
			if (element.outputs.length > 0) {
				let hasDynamicHeight = true;
				for (let i = 0; i < element.outputs.length; i++) {
					let result = MimeTypeRenderer.render(element.outputs[i], this.themeService, this.webviewService);
					if (result) {
						hasDynamicHeight = hasDynamicHeight || result?.hasDynamicHeight;
						templateData.outputContainer?.appendChild(result.element);
						if (result.shadowContent) {
							hasDynamicHeight = false;
							this.handler.createContentWidget(element, i, result.shadowContent, totalHeight + 8);
						}
					}
				}

				if (height !== undefined && hasDynamicHeight) {
					let clientHeight = templateData.outputContainer!.clientHeight;
					let listDimension = this.handler.getListDimension();
					let dimension = listDimension ? {
						width: listDimension.width - CELL_MARGIN * 2,
						height: clientHeight
					} : undefined;
					const elementSizeObserver = getResizesObserver(templateData.outputContainer!, dimension, () => {
						if (templateData.outputContainer && document.body.contains(templateData.outputContainer!)) {
							let height = elementSizeObserver.getHeight();
							if (clientHeight !== height) {
								element.setDynamicHeight(totalHeight + 32 + height);
								this.handler.layoutElement(element, totalHeight + 32 + height);
							}

							elementSizeObserver.dispose();
						}
					});
					// const elementSizeObserver = new ElementSizeObserver();
					elementSizeObserver.startObserving();
					if (!hasDynamicHeight && clientHeight !== 0) {
						element.setDynamicHeight(totalHeight + 32 + clientHeight);
						this.handler.layoutElement(element, totalHeight + 32 + clientHeight);
					}

					this.disposables.set(templateData.cellContainer, {
						dispose: () => {
							elementSizeObserver.dispose();
						}
					});
				}
			}
		});

		this.disposables.set(templateData.menuContainer!, listener!);

		this.disposables.set(templateData.cellContainer, {
			dispose: () => {
				listener.dispose();
				contentChangeListener?.dispose();
				rerenderOutput.dispose();
				cellWidthResizeObserver.stopObserving();
				cellWidthResizeObserver.dispose();
			}
		});

		if (templateData.outputContainer) {
			templateData.outputContainer!.innerHTML = '';
		}

		if (element.outputs.length > 0) {
			let hasDynamicHeight = true;
			for (let i = 0; i < element.outputs.length; i++) {
				let result = MimeTypeRenderer.render(element.outputs[i], this.themeService, this.webviewService);
				if (result) {
					hasDynamicHeight = hasDynamicHeight || result?.hasDynamicHeight;
					templateData.outputContainer?.appendChild(result.element);
					if (result.shadowContent) {
						hasDynamicHeight = false;
						this.handler.createContentWidget(element, i, result.shadowContent, totalHeight + 8);
					}
				}
			}

			if (height !== undefined && hasDynamicHeight) {
				let clientHeight = templateData.outputContainer!.clientHeight;
				let listDimension = this.handler.getListDimension();
				let dimension = listDimension ? {
					width: listDimension.width - CELL_MARGIN * 2,
					height: clientHeight
				} : undefined;
				const elementSizeObserver = getResizesObserver(templateData.outputContainer!, dimension, () => {
					if (templateData.outputContainer && document.body.contains(templateData.outputContainer!)) {
						let height = elementSizeObserver.getHeight();
						if (clientHeight !== height) {
							element.setDynamicHeight(totalHeight + 32 + height);
							this.handler.layoutElement(element, totalHeight + 32 + height);
						}

						elementSizeObserver.dispose();
					}
				});
				elementSizeObserver.startObserving();
				if (!hasDynamicHeight && clientHeight !== 0) {
					element.setDynamicHeight(totalHeight + 32 + clientHeight);
					this.handler.layoutElement(element, totalHeight + 32 + clientHeight);
				}

				this.disposables.set(templateData.cellContainer, {
					dispose: () => {
						elementSizeObserver.dispose();
					}
				});
			}
		}

	}

	disposeTemplate(templateData: CellRenderTemplate): void {
		// throw nerendererw Error('Method not implemented.');
	}


	disposeElement(element: ViewCell, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		let menuContainer = this.disposables.get(templateData.menuContainer!);

		if (menuContainer) {
			menuContainer.dispose();
			this.disposables.delete(templateData.menuContainer!);
		}

		let cellDisposable = this.disposables.get(templateData.cellContainer);

		if (cellDisposable) {
			cellDisposable.dispose();
			this.disposables.delete(templateData.cellContainer);
		}

		if (templateData.outputContainer) {
			let outputDisposable = this.disposables.get(templateData.outputContainer!);

			if (outputDisposable) {
				outputDisposable.dispose();
				this.disposables.delete(templateData.outputContainer!);
			}
		}

		this.handler.disposeViewCell(element);
	}
}
