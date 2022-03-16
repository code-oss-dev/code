/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PixelRatio } from 'vs/base/browser/browser';
import * as DOM from 'vs/base/browser/dom';
import { FastDomNode } from 'vs/base/browser/fastDomNode';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { Color } from 'vs/base/common/color';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { EditorOption, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { Range } from 'vs/editor/common/core/range';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import * as languages from 'vs/editor/common/languages';
import { PLAINTEXT_LANGUAGE_ID } from 'vs/editor/common/languages/modesRegistry';
import { tokenizeLineToHTML } from 'vs/editor/common/languages/textToHtmlTokenizer';
import { ITextModel } from 'vs/editor/common/model';
import { localize } from 'vs/nls';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ICellViewModel, INotebookEditorDelegate } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellComments } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellComments';
import { CellContextKeyManager } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellContextKeys';
import { CellDecorations } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellDecorations';
import { CellDragAndDropController } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellDnd';
import { CellEditorOptions } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellEditorOptions';
import { CellExecutionPart } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellExecution';
import { CellFocusIndicator } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellFocusIndicator';
import { CellProgressBar } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellProgressBar';
import { CellEditorStatusBar } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellStatusPart';
import { BetweenCellToolbar, CellTitleToolbarPart } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellToolbars';
import { CodeCell } from 'vs/workbench/contrib/notebook/browser/view/cellParts/codeCell';
import { RunToolbar } from 'vs/workbench/contrib/notebook/browser/view/cellParts/codeCellRunToolbar';
import { CollapsedCellInput } from 'vs/workbench/contrib/notebook/browser/view/cellParts/collapsedCellInput';
import { CollapsedCellOutput } from 'vs/workbench/contrib/notebook/browser/view/cellParts/collapsedCellOutput';
import { FoldedCellHint } from 'vs/workbench/contrib/notebook/browser/view/cellParts/foldedCellHint';
import { StatefulMarkdownCell } from 'vs/workbench/contrib/notebook/browser/view/cellParts/markdownCell';
import { BaseCellRenderTemplate, CodeCellRenderTemplate, MarkdownCellRenderTemplate } from 'vs/workbench/contrib/notebook/browser/view/notebookRenderingCommon';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { MarkupCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markupCellViewModel';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModelImpl';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';

const $ = DOM.$;

export class NotebookCellListDelegate extends Disposable implements IListVirtualDelegate<CellViewModel> {
	private readonly lineHeight: number;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this.lineHeight = BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.value).lineHeight;
	}

	getHeight(element: CellViewModel): number {
		return element.getHeight(this.lineHeight);
	}

	hasDynamicHeight(element: CellViewModel): boolean {
		return element.hasDynamicHeight();
	}

	getDynamicHeight(element: CellViewModel): number | null {
		return element.getDynamicHeight();
	}

	getTemplateId(element: CellViewModel): string {
		if (element.cellKind === CellKind.Markup) {
			return MarkupCellRenderer.TEMPLATE_ID;
		} else {
			return CodeCellRenderer.TEMPLATE_ID;
		}
	}
}

abstract class AbstractCellRenderer {
	protected readonly editorOptions: CellEditorOptions;

	constructor(
		protected readonly instantiationService: IInstantiationService,
		protected readonly notebookEditor: INotebookEditorDelegate,
		protected readonly contextMenuService: IContextMenuService,
		protected readonly menuService: IMenuService,
		configurationService: IConfigurationService,
		protected readonly keybindingService: IKeybindingService,
		protected readonly notificationService: INotificationService,
		protected readonly contextKeyServiceProvider: (container: HTMLElement) => IContextKeyService,
		language: string,
		protected dndController: CellDragAndDropController | undefined
	) {
		this.editorOptions = new CellEditorOptions(notebookEditor, notebookEditor.notebookOptions, configurationService, language);
	}

	dispose() {
		this.editorOptions.dispose();
		this.dndController = undefined;
	}

	protected commonRenderTemplate(templateData: BaseCellRenderTemplate): void {
		templateData.templateDisposables.add(DOM.addDisposableListener(templateData.container, DOM.EventType.FOCUS, () => {
			if (templateData.currentRenderedCell) {
				this.notebookEditor.focusElement(templateData.currentRenderedCell);
			}
		}, true));
	}

	protected commonRenderElement(element: ICellViewModel, templateData: BaseCellRenderTemplate): void {
		this.dndController?.renderElement(element, templateData);
		templateData.elementDisposables.add(new CellDecorations(templateData.rootContainer, templateData.decorationContainer, element));
		templateData.elementDisposables.add(templateData.instantiationService.createInstance(CellContextKeyManager, this.notebookEditor, element));
	}
}

export class MarkupCellRenderer extends AbstractCellRenderer implements IListRenderer<MarkupCellViewModel, MarkdownCellRenderTemplate> {
	static readonly TEMPLATE_ID = 'markdown_cell';

	constructor(
		notebookEditor: INotebookEditorDelegate,
		dndController: CellDragAndDropController,
		private renderedEditors: Map<ICellViewModel, ICodeEditor>,
		contextKeyServiceProvider: (container: HTMLElement) => IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
	) {
		super(instantiationService, notebookEditor, contextMenuService, menuService, configurationService, keybindingService, notificationService, contextKeyServiceProvider, 'markdown', dndController);
	}

	get templateId() {
		return MarkupCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(rootContainer: HTMLElement): MarkdownCellRenderTemplate {
		rootContainer.classList.add('markdown-cell-row');
		const container = DOM.append(rootContainer, DOM.$('.cell-inner-container'));
		const templateDisposables = new DisposableStore();
		const contextKeyService = templateDisposables.add(this.contextKeyServiceProvider(container));
		const decorationContainer = DOM.append(rootContainer, $('.cell-decoration'));
		const titleToolbarContainer = DOM.append(container, $('.cell-title-toolbar'));

		const focusIndicatorTop = new FastDomNode(DOM.append(container, $('.cell-focus-indicator.cell-focus-indicator-top')));
		const focusIndicatorLeft = new FastDomNode(DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-left')));
		const foldingIndicator = DOM.append(focusIndicatorLeft.domNode, DOM.$('.notebook-folding-indicator'));
		const focusIndicatorRight = new FastDomNode(DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-right')));

		const codeInnerContent = DOM.append(container, $('.cell.code'));
		const editorPart = DOM.append(codeInnerContent, $('.cell-editor-part'));
		const cellInputCollapsedContainer = DOM.append(codeInnerContent, $('.input-collapse-container'));
		const editorContainer = DOM.append(editorPart, $('.cell-editor-container'));
		editorPart.style.display = 'none';

		const cellCommentPartContainer = DOM.append(container, $('.cell-comment-container'));
		const cellCommentPart = templateDisposables.add(this.instantiationService.createInstance(CellComments, this.notebookEditor, cellCommentPartContainer));

		const innerContent = DOM.append(container, $('.cell.markdown'));
		const bottomCellContainer = DOM.append(container, $('.cell-bottom-toolbar-container'));

		const scopedInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, contextKeyService]));
		const rootClassDelegate = {
			toggle: (className: string, force?: boolean) => container.classList.toggle(className, force)
		};
		const titleToolbar = templateDisposables.add(scopedInstaService.createInstance(
			CellTitleToolbarPart,
			titleToolbarContainer,
			rootClassDelegate,
			this.notebookEditor.creationOptions.menuIds.cellTitleToolbar,
			this.notebookEditor));
		const betweenCellToolbar = templateDisposables.add(scopedInstaService.createInstance(BetweenCellToolbar, this.notebookEditor, titleToolbarContainer, bottomCellContainer));
		const focusIndicatorBottom = new FastDomNode(DOM.append(container, $('.cell-focus-indicator.cell-focus-indicator-bottom')));
		const statusBar = templateDisposables.add(this.instantiationService.createInstance(CellEditorStatusBar, this.notebookEditor, container, editorPart));
		const foldedCellHint = templateDisposables.add(scopedInstaService.createInstance(FoldedCellHint, this.notebookEditor, DOM.append(container, $('.notebook-folded-hint'))));

		const focusIndicator = templateDisposables.add(new CellFocusIndicator(this.notebookEditor, titleToolbar, focusIndicatorTop, focusIndicatorLeft, focusIndicatorRight, focusIndicatorBottom));
		const cellParts = [
			betweenCellToolbar,
			titleToolbar,
			statusBar,
			focusIndicator,
			foldedCellHint,
			templateDisposables.add(new CollapsedCellInput(this.notebookEditor, cellInputCollapsedContainer)),
			cellCommentPart
		];

		const templateData: MarkdownCellRenderTemplate = {
			rootContainer,
			cellInputCollapsedContainer,
			instantiationService: scopedInstaService,
			container,
			decorationContainer,
			cellContainer: innerContent,
			editorPart,
			editorContainer,
			foldingIndicator,
			templateDisposables,
			elementDisposables: new DisposableStore(),
			statusBar,
			cellParts,
			toJSON: () => { return {}; }
		};

		this.commonRenderTemplate(templateData);

		return templateData;
	}

	renderElement(element: MarkupCellViewModel, index: number, templateData: MarkdownCellRenderTemplate, height: number | undefined): void {
		if (!this.notebookEditor.hasModel()) {
			throw new Error('The notebook editor is not attached with view model yet.');
		}

		this.commonRenderElement(element, templateData);

		templateData.currentRenderedCell = element;
		templateData.currentEditor = undefined;
		templateData.editorPart.style.display = 'none';
		templateData.cellContainer.innerText = '';

		if (height === undefined) {
			return;
		}

		templateData.elementDisposables.add(templateData.instantiationService.createInstance(StatefulMarkdownCell, this.notebookEditor, element, templateData, this.renderedEditors));
	}

	disposeTemplate(templateData: MarkdownCellRenderTemplate): void {
		templateData.templateDisposables.clear();
	}

	disposeElement(_element: ICellViewModel, _index: number, templateData: MarkdownCellRenderTemplate): void {
		templateData.elementDisposables.clear();
	}
}

class EditorTextRenderer {

	private static _ttPolicy = window.trustedTypes?.createPolicy('cellRendererEditorText', {
		createHTML(input) { return input; }
	});

	getRichText(editor: ICodeEditor, modelRange: Range): HTMLElement | null {
		const model = editor.getModel();
		if (!model) {
			return null;
		}

		const colorMap = this.getDefaultColorMap();
		const fontInfo = editor.getOptions().get(EditorOption.fontInfo);
		const fontFamilyVar = '--notebook-editor-font-family';
		const fontSizeVar = '--notebook-editor-font-size';
		const fontWeightVar = '--notebook-editor-font-weight';

		const style = ``
			+ `color: ${colorMap[languages.ColorId.DefaultForeground]};`
			+ `background-color: ${colorMap[languages.ColorId.DefaultBackground]};`
			+ `font-family: var(${fontFamilyVar});`
			+ `font-weight: var(${fontWeightVar});`
			+ `font-size: var(${fontSizeVar});`
			+ `line-height: ${fontInfo.lineHeight}px;`
			+ `white-space: pre;`;

		const element = DOM.$('div', { style });

		const fontSize = fontInfo.fontSize;
		const fontWeight = fontInfo.fontWeight;
		element.style.setProperty(fontFamilyVar, fontInfo.fontFamily);
		element.style.setProperty(fontSizeVar, `${fontSize}px`);
		element.style.setProperty(fontWeightVar, fontWeight);

		const linesHtml = this.getRichTextLinesAsHtml(model, modelRange, colorMap);
		element.innerHTML = linesHtml as string;
		return element;
	}

	private getRichTextLinesAsHtml(model: ITextModel, modelRange: Range, colorMap: string[]): string | TrustedHTML {
		const startLineNumber = modelRange.startLineNumber;
		const startColumn = modelRange.startColumn;
		const endLineNumber = modelRange.endLineNumber;
		const endColumn = modelRange.endColumn;

		const tabSize = model.getOptions().tabSize;

		let result = '';

		for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
			const lineTokens = model.getLineTokens(lineNumber);
			const lineContent = lineTokens.getLineContent();
			const startOffset = (lineNumber === startLineNumber ? startColumn - 1 : 0);
			const endOffset = (lineNumber === endLineNumber ? endColumn - 1 : lineContent.length);

			if (lineContent === '') {
				result += '<br>';
			} else {
				result += tokenizeLineToHTML(lineContent, lineTokens.inflate(), colorMap, startOffset, endOffset, tabSize, platform.isWindows);
			}
		}

		return EditorTextRenderer._ttPolicy?.createHTML(result) ?? result;
	}

	private getDefaultColorMap(): string[] {
		const colorMap = languages.TokenizationRegistry.getColorMap();
		const result: string[] = ['#000000'];
		if (colorMap) {
			for (let i = 1, len = colorMap.length; i < len; i++) {
				result[i] = Color.Format.CSS.formatHex(colorMap[i]);
			}
		}
		return result;
	}
}

class CodeCellDragImageRenderer {
	getDragImage(templateData: BaseCellRenderTemplate, editor: ICodeEditor, type: 'code' | 'markdown'): HTMLElement {
		let dragImage = this.getDragImageImpl(templateData, editor, type);
		if (!dragImage) {
			// TODO@roblourens I don't think this can happen
			dragImage = document.createElement('div');
			dragImage.textContent = '1 cell';
		}

		return dragImage;
	}

	private getDragImageImpl(templateData: BaseCellRenderTemplate, editor: ICodeEditor, type: 'code' | 'markdown'): HTMLElement | null {
		const dragImageContainer = templateData.container.cloneNode(true) as HTMLElement;
		dragImageContainer.classList.forEach(c => dragImageContainer.classList.remove(c));
		dragImageContainer.classList.add('cell-drag-image', 'monaco-list-row', 'focused', `${type}-cell-row`);

		const editorContainer: HTMLElement | null = dragImageContainer.querySelector('.cell-editor-container');
		if (!editorContainer) {
			return null;
		}

		const richEditorText = new EditorTextRenderer().getRichText(editor, new Range(1, 1, 1, 1000));
		if (!richEditorText) {
			return null;
		}
		DOM.reset(editorContainer, richEditorText);

		return dragImageContainer;
	}
}

export class CodeCellRenderer extends AbstractCellRenderer implements IListRenderer<CodeCellViewModel, CodeCellRenderTemplate> {
	static readonly TEMPLATE_ID = 'code_cell';

	constructor(
		notebookEditor: INotebookEditorDelegate,
		private renderedEditors: Map<ICellViewModel, ICodeEditor>,
		dndController: CellDragAndDropController,
		contextKeyServiceProvider: (container: HTMLElement) => IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService menuService: IMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
	) {
		super(instantiationService, notebookEditor, contextMenuService, menuService, configurationService, keybindingService, notificationService, contextKeyServiceProvider, PLAINTEXT_LANGUAGE_ID, dndController);
	}

	get templateId() {
		return CodeCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(rootContainer: HTMLElement): CodeCellRenderTemplate {
		rootContainer.classList.add('code-cell-row');
		const container = DOM.append(rootContainer, DOM.$('.cell-inner-container'));
		const templateDisposables = new DisposableStore();
		const contextKeyService = templateDisposables.add(this.contextKeyServiceProvider(container));
		const decorationContainer = DOM.append(rootContainer, $('.cell-decoration'));
		const focusIndicatorTop = new FastDomNode(DOM.append(container, $('.cell-focus-indicator.cell-focus-indicator-top')));
		const titleToolbarContainer = DOM.append(container, $('.cell-title-toolbar'));

		// This is also the drag handle
		const focusIndicatorLeft = new FastDomNode(DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-left')));

		const cellContainer = DOM.append(container, $('.cell.code'));
		const runButtonContainer = DOM.append(cellContainer, $('.run-button-container'));
		const cellInputCollapsedContainer = DOM.append(cellContainer, $('.input-collapse-container'));

		const runToolbar = templateDisposables.add(this.instantiationService.createInstance(RunToolbar, this.notebookEditor, contextKeyService, container, runButtonContainer));
		const executionOrderLabel = DOM.append(focusIndicatorLeft.domNode, $('div.execution-count-label'));
		executionOrderLabel.title = localize('cellExecutionOrderCountLabel', 'Execution Order');

		const editorPart = DOM.append(cellContainer, $('.cell-editor-part'));
		const editorContainer = DOM.append(editorPart, $('.cell-editor-container'));

		const cellCommentPartContainer = DOM.append(container, $('.cell-comment-container'));
		const cellCommentPart = templateDisposables.add(this.instantiationService.createInstance(CellComments, this.notebookEditor, cellCommentPartContainer));

		// create a special context key service that set the inCompositeEditor-contextkey
		const editorContextKeyService = templateDisposables.add(this.contextKeyServiceProvider(editorPart));
		const editorInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
		EditorContextKeys.inCompositeEditor.bindTo(editorContextKeyService).set(true);

		const editor = editorInstaService.createInstance(CodeEditorWidget, editorContainer, {
			...this.editorOptions.getDefaultValue(),
			dimension: {
				width: 0,
				height: 0
			},
			// overflowWidgetsDomNode: this.notebookEditor.getOverflowContainerDomNode()
		}, {
			contributions: this.notebookEditor.creationOptions.cellEditorContributions
		});

		templateDisposables.add(editor);

		const progressBar = templateDisposables.add(this.instantiationService.createInstance(CellProgressBar, editorPart, cellInputCollapsedContainer));

		const statusBar = templateDisposables.add(this.instantiationService.createInstance(CellEditorStatusBar, this.notebookEditor, container, editorPart));

		const outputContainer = new FastDomNode(DOM.append(container, $('.output')));
		const cellOutputCollapsedContainer = DOM.append(outputContainer.domNode, $('.output-collapse-container'));
		const outputShowMoreContainer = new FastDomNode(DOM.append(container, $('.output-show-more-container')));

		const focusIndicatorRight = new FastDomNode(DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-right')));

		const focusSinkElement = DOM.append(container, $('.cell-editor-focus-sink'));
		focusSinkElement.setAttribute('tabindex', '0');
		const bottomCellToolbarContainer = DOM.append(container, $('.cell-bottom-toolbar-container'));
		const focusIndicatorBottom = new FastDomNode(DOM.append(container, $('.cell-focus-indicator.cell-focus-indicator-bottom')));

		const scopedInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, contextKeyService]));
		const rootClassDelegate = {
			toggle: (className: string, force?: boolean) => container.classList.toggle(className, force)
		};
		const titleToolbar = templateDisposables.add(scopedInstaService.createInstance(
			CellTitleToolbarPart,
			titleToolbarContainer,
			rootClassDelegate,
			this.notebookEditor.creationOptions.menuIds.cellTitleToolbar,
			this.notebookEditor));

		const focusIndicatorPart = templateDisposables.add(new CellFocusIndicator(this.notebookEditor, titleToolbar, focusIndicatorTop, focusIndicatorLeft, focusIndicatorRight, focusIndicatorBottom));
		const cellParts = [
			focusIndicatorPart,
			templateDisposables.add(scopedInstaService.createInstance(BetweenCellToolbar, this.notebookEditor, titleToolbarContainer, bottomCellToolbarContainer)),
			statusBar,
			progressBar,
			titleToolbar,
			runToolbar,
			templateDisposables.add(new CellExecutionPart(this.notebookEditor, executionOrderLabel)),
			templateDisposables.add(this.instantiationService.createInstance(CollapsedCellOutput, this.notebookEditor, cellOutputCollapsedContainer)),
			templateDisposables.add(new CollapsedCellInput(this.notebookEditor, cellInputCollapsedContainer)),
			cellCommentPart
		];

		const templateData: CodeCellRenderTemplate = {
			rootContainer,
			editorPart,
			cellInputCollapsedContainer,
			cellOutputCollapsedContainer,
			instantiationService: scopedInstaService,
			container,
			decorationContainer,
			cellContainer,
			statusBar,
			focusSinkElement,
			outputContainer,
			outputShowMoreContainer,
			editor,
			templateDisposables,
			elementDisposables: new DisposableStore(),
			cellParts,
			toJSON: () => { return {}; }
		};

		// focusIndicatorLeft covers the left margin area
		// code/outputFocusIndicator need to be registered as drag handlers so their click handlers don't take over
		const dragHandles = [focusIndicatorLeft.domNode, focusIndicatorPart.codeFocusIndicator.domNode, focusIndicatorPart.outputFocusIndicator.domNode];
		this.dndController?.registerDragHandle(templateData, rootContainer, dragHandles, () => new CodeCellDragImageRenderer().getDragImage(templateData, templateData.editor, 'code'));

		templateDisposables.add(DOM.addDisposableListener(focusSinkElement, DOM.EventType.FOCUS, () => {
			if (templateData.currentRenderedCell && (templateData.currentRenderedCell as CodeCellViewModel).outputsViewModels.length) {
				this.notebookEditor.focusNotebookCell(templateData.currentRenderedCell, 'output');
			}
		}));

		this.commonRenderTemplate(templateData);

		return templateData;
	}

	renderElement(element: CodeCellViewModel, index: number, templateData: CodeCellRenderTemplate, height: number | undefined): void {
		if (!this.notebookEditor.hasModel()) {
			throw new Error('The notebook editor is not attached with view model yet.');
		}

		this.commonRenderElement(element, templateData);

		templateData.currentRenderedCell = element;

		if (height === undefined) {
			return;
		}

		templateData.outputContainer.domNode.innerText = '';
		templateData.outputContainer.domNode.appendChild(templateData.cellOutputCollapsedContainer);

		const elementDisposables = templateData.elementDisposables;

		elementDisposables.add(templateData.instantiationService.createInstance(CodeCell, this.notebookEditor, element, templateData));
		this.renderedEditors.set(element, templateData.editor);
	}

	disposeTemplate(templateData: CodeCellRenderTemplate): void {
		templateData.templateDisposables.clear();
	}

	disposeElement(element: ICellViewModel, index: number, templateData: CodeCellRenderTemplate, height: number | undefined): void {
		templateData.elementDisposables.clear();
		this.renderedEditors.delete(element);
	}
}
