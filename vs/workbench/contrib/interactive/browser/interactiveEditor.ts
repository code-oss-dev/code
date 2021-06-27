/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/interactive';
import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IDecorationOptions } from 'vs/editor/common/editorCommon';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { editorForeground, registerColor, resolveColorValue } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';
import { InteractiveEditorInput } from 'vs/workbench/contrib/interactive/browser/interactiveEditorInput';
import { INotebookEditorOptions } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEditorExtensionsRegistry } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { IBorrowValue, INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/notebookEditorService';
import { NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ExecutionStateCellStatusBarContrib, TimerCellStatusBarContrib } from 'vs/workbench/contrib/notebook/browser/contrib/cellStatusBar/executionStatusBarItemController';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { PLAINTEXT_LANGUAGE_IDENTIFIER } from 'vs/editor/common/modes/modesRegistry';
import { IModeService } from 'vs/editor/common/services/modeService';
import { MenuId } from 'vs/platform/actions/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INTERACTIVE_INPUT_CURSOR_BOUNDARY } from 'vs/workbench/contrib/interactive/browser/interactiveCommon';
import { IInteractiveHistoryService } from 'vs/workbench/contrib/interactive/browser/interactiveHistoryService';
import { IInteractiveDocumentService } from 'vs/workbench/contrib/interactive/browser/interactiveDocumentService';
import { peekViewEditorBackground } from 'vs/editor/contrib/peekView/peekView';

const DECORATION_KEY = 'interactiveInputDecoration';
const INPUT_CONTAINER_PADDING = 10;
const INPUT_WIDGET_HEIGHT = 19;
const INPUT_CONTAINER_HEIGHT = INPUT_WIDGET_HEIGHT + 2 * INPUT_CONTAINER_PADDING;

export class InteractiveEditor extends EditorPane {
	static readonly ID: string = 'workbench.editor.interactive';

	#rootElement!: HTMLElement;
	#notebookEditorContainer!: HTMLElement;
	#notebookWidget: IBorrowValue<NotebookEditorWidget> = { value: undefined };
	#inputEditorContainer!: HTMLElement;
	#codeEditorWidget!: CodeEditorWidget;
	// #inputLineCount = 1;
	#notebookWidgetService: INotebookEditorService;
	#instantiationService: IInstantiationService;
	#modelService: IModelService;
	#modeService: IModeService;
	#contextKeyService: IContextKeyService;
	#notebookKernelService: INotebookKernelService;
	#keybindingService: IKeybindingService;
	#historyService: IInteractiveHistoryService;
	#interactiveDocumentService: IInteractiveDocumentService;
	#widgetDisposableStore: DisposableStore = this._register(new DisposableStore());
	#dimension?: DOM.Dimension;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotebookEditorService notebookWidgetService: INotebookEditorService,
		@IModelService modelService: IModelService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@INotebookKernelService notebookKernelService: INotebookKernelService,
		@IModeService modeService: IModeService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInteractiveHistoryService historyService: IInteractiveHistoryService,
		@IInteractiveDocumentService interactiveDocumentService: IInteractiveDocumentService
	) {
		super(
			InteractiveEditor.ID,
			telemetryService,
			themeService,
			storageService
		);
		this.#instantiationService = instantiationService;
		this.#notebookWidgetService = notebookWidgetService;
		this.#modelService = modelService;
		this.#contextKeyService = contextKeyService;
		this.#notebookKernelService = notebookKernelService;
		this.#modeService = modeService;
		this.#keybindingService = keybindingService;
		this.#historyService = historyService;
		this.#interactiveDocumentService = interactiveDocumentService;

		codeEditorService.registerDecorationType('interactive-decoration', DECORATION_KEY, {});
	}

	protected createEditor(parent: HTMLElement): void {
		this.#rootElement = DOM.append(parent, DOM.$('.interactive-editor'));
		this.#rootElement.style.position = 'relative';
		this.#notebookEditorContainer = DOM.append(this.#rootElement, DOM.$('.notebook-editor-container'));
		this.#inputEditorContainer = DOM.append(this.#rootElement, DOM.$('.input-editor-container'));
		this.#inputEditorContainer.style.position = 'absolute';
		this.#inputEditorContainer.style.height = `${INPUT_WIDGET_HEIGHT}px`;
	}

	override async setInput(input: InteractiveEditorInput, options: INotebookEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		const group = this.group!;
		const notebookInput = input.notebookEditorInput;

		// there currently is a widget which we still own so
		// we need to hide it before getting a new widget
		if (this.#notebookWidget.value) {
			this.#notebookWidget.value.onWillHide();
		}

		if (this.#codeEditorWidget) {
			this.#codeEditorWidget.dispose();
		}

		this.#widgetDisposableStore.clear();

		this.#notebookWidget = this.#instantiationService.invokeFunction(this.#notebookWidgetService.retrieveWidget, group, notebookInput, {
			isEmbedded: true,
			isReadOnly: true,
			contributions: NotebookEditorExtensionsRegistry.getSomeEditorContributions([
				ExecutionStateCellStatusBarContrib.id,
				TimerCellStatusBarContrib.id
			]),
			menuIds: {
				notebookToolbar: MenuId.InteractiveToolbar,
				cellTitleToolbar: MenuId.InteractiveCellTitle,
				cellInsertToolbar: MenuId.NotebookCellBetween,
				cellTopInsertToolbar: MenuId.NotebookCellListTop,
				cellExecuteToolbar: MenuId.InteractiveCellExecute
			},
			cellEditorContributions: []
		});
		this.#codeEditorWidget = this.#instantiationService.createInstance(CodeEditorWidget, this.#inputEditorContainer, getSimpleEditorOptions(), {
			...getSimpleCodeEditorWidgetOptions(),
			...{
				isSimpleWidget: false
			}
		});

		if (this.#dimension) {
			this.#notebookWidget.value!.layout(this.#dimension.with(this.#dimension.width, this.#dimension.height - INPUT_CONTAINER_HEIGHT), this.#rootElement);
			this.#codeEditorWidget.layout(new DOM.Dimension(this.#dimension.width, INPUT_WIDGET_HEIGHT));
			this.#inputEditorContainer.style.top = `${this.#dimension.height - INPUT_CONTAINER_HEIGHT}px`;
			this.#inputEditorContainer.style.width = `${this.#dimension.width}px`;
			this.#inputEditorContainer.style.paddingTop = `${INPUT_CONTAINER_PADDING}px`;
			this.#inputEditorContainer.style.paddingBottom = `${INPUT_CONTAINER_PADDING}px`;
		}

		await super.setInput(input, options, context, token);
		const model = await input.resolve();

		if (model === null) {
			throw new Error('?');
		}

		this.#notebookWidget.value?.setParentContextKeyService(this.#contextKeyService);
		await this.#notebookWidget.value!.setModel(model.notebook, undefined);
		this.#notebookWidget.value!.setOptions({
			isReadOnly: true
		});

		let editorModel = this.#modelService.getModel(input.inputResource);

		if (!editorModel) {
			this.#interactiveDocumentService.willCreateInteractiveDocument(input.resource!, input.inputResource, this.#notebookWidget.value?.activeKernel?.supportedLanguages[0] ?? 'plaintext');
			editorModel = this.#modelService.createModel('', null, input.inputResource, false);

			// willCreateInteractiveDocument refs the input model, then we should de-ref it on close.
			this.#widgetDisposableStore.add({
				dispose: () => {
					this.#interactiveDocumentService.willRemoveInteractiveDocument(input.resource!, input.inputResource);
					editorModel?.dispose();
				}
			});
		}

		this.#codeEditorWidget.setModel(editorModel);
		this.#widgetDisposableStore.add(this.#codeEditorWidget.onDidContentSizeChange(e => {
			if (!e.contentHeightChanged) {
				return;
			}

			const contentHeight = this.#codeEditorWidget.getContentHeight();

			if (this.#dimension) {
				this.#notebookWidget.value!.layout(this.#dimension.with(this.#dimension.width, this.#dimension.height - contentHeight - 2 * INPUT_CONTAINER_PADDING), this.#rootElement);
				this.#codeEditorWidget.layout(new DOM.Dimension(this.#dimension.width, contentHeight));
				this.#inputEditorContainer.style.top = `${this.#dimension.height - contentHeight - 2 * INPUT_CONTAINER_PADDING}px`;
				this.#inputEditorContainer.style.width = `${this.#dimension.width}px`;
				this.#inputEditorContainer.style.height = `${contentHeight}px`;
				this.#inputEditorContainer.style.paddingTop = `${INPUT_CONTAINER_PADDING}px`;
				this.#inputEditorContainer.style.paddingBottom = `${INPUT_CONTAINER_PADDING}px`;
			}
		}));

		this.#widgetDisposableStore.add(this.#notebookKernelService.onDidChangeNotebookAffinity(this.#updateInputEditorLanguage, this));
		this.#widgetDisposableStore.add(this.#notebookKernelService.onDidChangeSelectedNotebooks(this.#updateInputEditorLanguage, this));

		this.#widgetDisposableStore.add(this.themeService.onDidColorThemeChange(() => {
			if (this.isVisible()) {
				this.#updateInputDecoration();
			}
		}));

		this.#widgetDisposableStore.add(this.#codeEditorWidget.onDidChangeModelContent(() => {
			if (this.isVisible()) {
				this.#updateInputDecoration();
			}
		}));

		const cursorAtBoundaryContext = INTERACTIVE_INPUT_CURSOR_BOUNDARY.bindTo(this.#contextKeyService);
		cursorAtBoundaryContext.set('none');

		this.#widgetDisposableStore.add(this.#codeEditorWidget.onDidChangeCursorPosition(({ position }) => {
			const viewModel = this.#codeEditorWidget._getViewModel()!;
			const lastLineNumber = viewModel.getLineCount();
			const lastLineCol = viewModel.getLineContent(lastLineNumber).length + 1;
			const viewPosition = viewModel.coordinatesConverter.convertModelPositionToViewPosition(position);
			const firstLine = viewPosition.lineNumber === 1 && viewPosition.column === 1;
			const lastLine = viewPosition.lineNumber === lastLineNumber && viewPosition.column === lastLineCol;

			if (firstLine) {
				if (lastLine) {
					cursorAtBoundaryContext.set('both');
				} else {
					cursorAtBoundaryContext.set('top');
				}
			} else {
				if (lastLine) {
					cursorAtBoundaryContext.set('bottom');
				} else {
					cursorAtBoundaryContext.set('none');
				}
			}
		}));

		this.#widgetDisposableStore.add(editorModel.onDidChangeContent(() => {
			if (this.input?.resource) {
				this.#historyService.replaceLast(this.input.resource, editorModel!.getValue());
			}
		}));

		this.#updateInputDecoration();
		this.#updateInputEditorLanguage();
	}

	#updateInputEditorLanguage() {
		const notebook = this.#notebookWidget.value?.textModel;
		const textModel = this.#codeEditorWidget.getModel();

		if (!notebook || !textModel) {
			return;
		}

		const info = this.#notebookKernelService.getMatchingKernel(notebook);
		const selectedOrSuggested = info.selected ?? info.suggested;

		if (selectedOrSuggested) {
			const language = selectedOrSuggested.supportedLanguages[0];
			const newMode = language ? this.#modeService.create(language).languageIdentifier : PLAINTEXT_LANGUAGE_IDENTIFIER;
			textModel.setMode(newMode);
		}
	}

	layout(dimension: DOM.Dimension): void {
		this.#rootElement.classList.toggle('mid-width', dimension.width < 1000 && dimension.width >= 600);
		this.#rootElement.classList.toggle('narrow-width', dimension.width < 600);
		this.#dimension = dimension;

		if (!this.#notebookWidget.value) {
			return;
		}

		this.#notebookEditorContainer.style.height = `${this.#dimension.height - INPUT_CONTAINER_HEIGHT}px`;
		this.#inputEditorContainer.style.top = `${this.#dimension.height - INPUT_CONTAINER_HEIGHT}px`;
		this.#inputEditorContainer.style.width = `${this.#dimension.width}px`;
		this.#inputEditorContainer.style.paddingTop = `${INPUT_CONTAINER_PADDING}px`;
		this.#inputEditorContainer.style.paddingBottom = `${INPUT_CONTAINER_PADDING}px`;

		this.#codeEditorWidget.layout(new DOM.Dimension(this.#dimension.width, INPUT_WIDGET_HEIGHT));
		this.#notebookWidget.value!.layout(this.#dimension.with(this.#dimension.width, this.#dimension.height - INPUT_CONTAINER_HEIGHT), this.#rootElement);
	}

	#updateInputDecoration(): void {
		if (!this.#codeEditorWidget) {
			return;
		}

		if (!this.#codeEditorWidget.hasModel()) {
			return;
		}

		const model = this.#codeEditorWidget.getModel();

		const decorations: IDecorationOptions[] = [];

		if (model?.getValueLength() === 0) {
			const transparentForeground = resolveColorValue(editorForeground, this.themeService.getColorTheme())?.transparent(0.4);
			const keybinding = this.#keybindingService.lookupKeybinding('interactive.execute')?.getLabel();
			const text = nls.localize('interactiveInputPlaceHolder', "Type code here and press {0} to run", keybinding ?? 'Ctrl+Enter');
			decorations.push({
				range: {
					startLineNumber: 0,
					endLineNumber: 0,
					startColumn: 0,
					endColumn: 1
				},
				renderOptions: {
					after: {
						fontStyle: 'italic',
						contentText: text,
						color: transparentForeground ? transparentForeground.toString() : undefined
					}
				}
			});
		}

		this.#codeEditorWidget.setDecorations('interactive-decoration', DECORATION_KEY, decorations);
	}

	override focus() {
		this.#codeEditorWidget.focus();
	}

	override setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		super.setEditorVisible(visible, group);

		if (!visible) {
			if (this.input && this.#notebookWidget.value) {
				this.#notebookWidget.value.onWillHide();
			}
		}
	}

	override clearInput() {
		if (this.#notebookWidget.value) {
			this.#notebookWidget.value.onWillHide();
		}

		if (this.#codeEditorWidget) {
			this.#codeEditorWidget.dispose();
		}

		this.#notebookWidget = { value: undefined };
		this.#widgetDisposableStore.clear();

		super.clearInput();
	}

	override getControl(): { notebookEditor: NotebookEditorWidget | undefined, codeEditor: CodeEditorWidget; } {
		return {
			notebookEditor: this.#notebookWidget.value,
			codeEditor: this.#codeEditorWidget
		};
	}
}

export const interactiveInputEditorBackground = registerColor('interactive.inputEditorBackground', {
	dark: peekViewEditorBackground,
	light: peekViewEditorBackground,
	hc: peekViewEditorBackground
}, nls.localize('interactive.inputEditorBackground', "The background color of the input editor."));

registerThemingParticipant((theme, collector) => {
	const editorBackgroundColor = theme.getColor(interactiveInputEditorBackground) ?? theme.getColor(interactiveInputEditorBackground);
	if (editorBackgroundColor) {
		collector.addRule(`.interactive-editor .input-editor-container,
		.interactive-editor .input-editor-container .monaco-editor-background { background: ${editorBackgroundColor}; }`);
	}
});
