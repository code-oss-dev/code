/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Disposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { dirname } from 'vs/base/common/resources';
import { isArray } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { IEditorConstructionOptions } from 'vs/editor/browser/editorBrowser';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { handleANSIOutput } from 'vs/workbench/contrib/debug/browser/debugANSIHandling';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { ICellOutputViewModel, ICommonNotebookEditor, IOutputTransformContribution as IOutputRendererContribution, IRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { OutputRendererRegistry } from 'vs/workbench/contrib/notebook/browser/view/output/rendererRegistry';
import { truncatedArrayOfString } from 'vs/workbench/contrib/notebook/browser/view/output/transforms/textHelper';
import { IOutputItemDto } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';


class JavaScriptRendererContrib extends Disposable implements IOutputRendererContribution {
	getType() {
		return RenderOutputType.Html;
	}

	getMimetypes() {
		return ['application/javascript'];
	}

	constructor(
		public notebookEditor: ICommonNotebookEditor,
	) {
		super();
	}

	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI): IRenderOutput {
		let scriptVal = '';
		items.forEach(item => {
			const str = getStringValue(item);
			scriptVal += `<script type="application/javascript">${str}</script>`;

		});
		return {
			type: RenderOutputType.Html,
			source: output,
			htmlContent: scriptVal
		};
	}
}

class CodeRendererContrib extends Disposable implements IOutputRendererContribution {
	getType() {
		return RenderOutputType.Mainframe;
	}

	getMimetypes() {
		return ['text/x-javascript'];
	}

	constructor(
		public notebookEditor: ICommonNotebookEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
	) {
		super();
	}

	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement): IRenderOutput {
		const value = items.map(getStringValue).join('');
		return this._render(output, container, value, 'javascript');
	}

	protected _render(output: ICellOutputViewModel, container: HTMLElement, value: string, modeId: string): IRenderOutput {
		const disposable = new DisposableStore();
		const editor = this.instantiationService.createInstance(CodeEditorWidget, container, getOutputSimpleEditorOptions(), { isSimpleWidget: true });

		const mode = this.modeService.create(modeId);
		const textModel = this.modelService.createModel(value, mode, undefined, false);
		editor.setModel(textModel);

		const width = this.notebookEditor.getCellOutputLayoutInfo(output.cellViewModel).width;
		const fontInfo = this.notebookEditor.getCellOutputLayoutInfo(output.cellViewModel).fontInfo;
		const height = Math.min(textModel.getLineCount(), 16) * (fontInfo.lineHeight || 18);

		editor.layout({ height, width });

		disposable.add(editor);
		disposable.add(textModel);

		container.style.height = `${height + 8}px`;

		return { type: RenderOutputType.Mainframe, initHeight: height, disposable };
	}
}

class JSONRendererContrib extends CodeRendererContrib {

	override getMimetypes() {
		return ['application/json'];
	}

	override render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement): IRenderOutput {
		const str = items.map(item => {
			if (isArray(item.valueBytes)) {
				return getStringValue(item);
			} else {
				return JSON.stringify(item.value, null, '\t');
			}
		}).join('');

		return this._render(output, container, str, 'jsonc');
	}
}

class StreamRendererContrib extends Disposable implements IOutputRendererContribution {
	getType() {
		return RenderOutputType.Mainframe;
	}

	getMimetypes() {
		return ['application/x.notebook.stdout', 'application/x.notebook.stream'];
	}

	constructor(
		public notebookEditor: ICommonNotebookEditor,
		@IOpenerService private readonly openerService: IOpenerService,
		@IThemeService private readonly themeService: IThemeService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI): IRenderOutput {
		const linkDetector = this.instantiationService.createInstance(LinkDetector);

		items.forEach(item => {
			const text = getStringValue(item);
			const contentNode = DOM.$('span.output-stream');
			truncatedArrayOfString(notebookUri!, output.cellViewModel, contentNode, [text], linkDetector, this.openerService, this.textFileService, this.themeService);
			container.appendChild(contentNode);
		});

		return { type: RenderOutputType.Mainframe };
	}
}

class StderrRendererContrib extends StreamRendererContrib {
	override getType() {
		return RenderOutputType.Mainframe;
	}

	override getMimetypes() {
		return ['application/x.notebook.stderr'];
	}

	override render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI): IRenderOutput {
		const result = super.render(output, items, container, notebookUri);
		container.classList.add('error');
		return result;
	}
}

/** @deprecated */
class ErrorRendererContrib extends Disposable implements IOutputRendererContribution {
	getType() {
		return RenderOutputType.Mainframe;
	}

	getMimetypes() {
		return ['application/x.notebook.error-traceback'];
	}

	constructor(
		public notebookEditor: ICommonNotebookEditor,
		@IThemeService private readonly themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,

	) {
		super();
	}

	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI): IRenderOutput {
		const linkDetector = this.instantiationService.createInstance(LinkDetector);
		items.forEach(item => {
			const data: any = item.value;
			const header = document.createElement('div');
			const headerMessage = data.ename && data.evalue
				? `${data.ename}: ${data.evalue}`
				: data.ename || data.evalue;
			if (headerMessage) {
				header.innerText = headerMessage;
				container.appendChild(header);
			}
			const traceback = document.createElement('pre');
			traceback.classList.add('traceback');
			if (data.traceback) {
				for (let j = 0; j < data.traceback.length; j++) {
					traceback.appendChild(handleANSIOutput(data.traceback[j], linkDetector, this.themeService, undefined));
				}
			}
			container.appendChild(traceback);
			container.classList.add('error');
			return { type: RenderOutputType.Mainframe };

		});

		return { type: RenderOutputType.Mainframe };
	}

	_render() {
	}
}

class JSErrorRendererContrib implements IOutputRendererContribution {

	constructor(
		public notebookEditor: ICommonNotebookEditor,
		@IThemeService private readonly _themeService: IThemeService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) { }

	dispose(): void {
		// nothing
	}

	getType() {
		return RenderOutputType.Mainframe;
	}

	getMimetypes() {
		return ['application/x.notebook.error'];
	}

	render(_output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, _notebookUri: URI): IRenderOutput {
		const linkDetector = this._instantiationService.createInstance(LinkDetector);

		for (let item of items) {
			let err: Error;
			try {
				err = <Error>JSON.parse(getStringValue(item));
			} catch (e) {
				this._logService.warn('INVALID output item (failed to parse)', e);
				continue;
			}

			const header = document.createElement('div');
			const headerMessage = err.name && err.message ? `${err.name}: ${err.message}` : err.name || err.message;
			if (headerMessage) {
				header.innerText = headerMessage;
				container.appendChild(header);
			}
			const stack = document.createElement('pre');
			stack.classList.add('traceback');
			if (err.stack) {
				stack.appendChild(handleANSIOutput(err.stack, linkDetector, this._themeService, undefined));
			}
			container.appendChild(stack);
			container.classList.add('error');
		}

		return { type: RenderOutputType.Mainframe };
	}
}

class PlainTextRendererContrib extends Disposable implements IOutputRendererContribution {
	getType() {
		return RenderOutputType.Mainframe;
	}

	getMimetypes() {
		return ['text/plain'];
	}

	constructor(
		public notebookEditor: ICommonNotebookEditor,
		@IOpenerService private readonly openerService: IOpenerService,
		@IThemeService private readonly themeService: IThemeService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI): IRenderOutput {
		const linkDetector = this.instantiationService.createInstance(LinkDetector);

		const str = items.map(getStringValue);
		const contentNode = DOM.$('.output-plaintext');
		truncatedArrayOfString(notebookUri!, output.cellViewModel, contentNode, str, linkDetector, this.openerService, this.textFileService, this.themeService);
		container.appendChild(contentNode);

		return { type: RenderOutputType.Mainframe, supportAppend: true };
	}
}

class HTMLRendererContrib extends Disposable implements IOutputRendererContribution {
	getType() {
		return RenderOutputType.Html;
	}

	getMimetypes() {
		return ['text/html', 'image/svg+xml'];
	}

	constructor(
		public notebookEditor: ICommonNotebookEditor,
	) {
		super();
	}

	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI): IRenderOutput {
		const str = items.map(getStringValue).join('');
		return {
			type: RenderOutputType.Html,
			source: output,
			htmlContent: str
		};
	}
}

class MdRendererContrib extends Disposable implements IOutputRendererContribution {
	getType() {
		return RenderOutputType.Mainframe;
	}

	getMimetypes() {
		return ['text/markdown'];
	}

	constructor(
		public notebookEditor: ICommonNotebookEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI): IRenderOutput {
		const disposable = new DisposableStore();
		for (let item of items) {
			const str = getStringValue(item);
			const mdOutput = document.createElement('div');
			const mdRenderer = this.instantiationService.createInstance(MarkdownRenderer, { baseUrl: dirname(notebookUri) });
			mdOutput.appendChild(mdRenderer.render({ value: str, isTrusted: true, supportThemeIcons: true }, undefined, { gfm: true }).element);
			container.appendChild(mdOutput);
			disposable.add(mdRenderer);
		}
		return { type: RenderOutputType.Mainframe, disposable };
	}
}

class ImgRendererContrib extends Disposable implements IOutputRendererContribution {
	getType() {
		return RenderOutputType.Mainframe;
	}

	getMimetypes() {
		return ['image/png', 'image/jpeg', 'image/gif'];
	}

	constructor(
		public notebookEditor: ICommonNotebookEditor,
	) {
		super();
	}

	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI): IRenderOutput {
		const disposable = new DisposableStore();

		for (let item of items) {

			let src: string;
			if (Array.isArray(item.valueBytes)) {
				const bytes = new Uint8Array(item.valueBytes);
				const blob = new Blob([bytes], { type: item.mime });
				src = URL.createObjectURL(blob);
				disposable.add(toDisposable(() => URL.revokeObjectURL(src)));
			} else {
				// OLD
				const imagedata = item.value;
				src = `data:${item.mime};base64,${imagedata}`;
			}

			const image = document.createElement('img');
			image.src = src;
			const display = document.createElement('div');
			display.classList.add('display');
			display.appendChild(image);
			container.appendChild(display);
		}
		return { type: RenderOutputType.Mainframe, disposable };
	}
}

OutputRendererRegistry.registerOutputTransform(JSONRendererContrib);
OutputRendererRegistry.registerOutputTransform(JavaScriptRendererContrib);
OutputRendererRegistry.registerOutputTransform(HTMLRendererContrib);
OutputRendererRegistry.registerOutputTransform(MdRendererContrib);
OutputRendererRegistry.registerOutputTransform(ImgRendererContrib);
OutputRendererRegistry.registerOutputTransform(PlainTextRendererContrib);
OutputRendererRegistry.registerOutputTransform(CodeRendererContrib);
OutputRendererRegistry.registerOutputTransform(JSErrorRendererContrib);
OutputRendererRegistry.registerOutputTransform(StreamRendererContrib);
OutputRendererRegistry.registerOutputTransform(StderrRendererContrib);
OutputRendererRegistry.registerOutputTransform(ErrorRendererContrib);

// --- utils ---
function getStringValue(item: IOutputItemDto): string {
	if (Array.isArray(item.valueBytes)) {
		// todo@jrieken NOT proper, should be VSBuffer
		return new TextDecoder().decode(new Uint8Array(item.valueBytes));
	} else {
		// "old" world
		return Array.isArray(item.value) ? item.value.join('') : String(item.value);
	}
}

function getOutputSimpleEditorOptions(): IEditorConstructionOptions {
	return {
		dimension: { height: 0, width: 0 },
		readOnly: true,
		wordWrap: 'on',
		overviewRulerLanes: 0,
		glyphMargin: false,
		selectOnLineNumbers: false,
		hideCursorInOverviewRuler: true,
		selectionHighlight: false,
		lineDecorationsWidth: 0,
		overviewRulerBorder: false,
		scrollBeyondLastLine: false,
		renderLineHighlight: 'none',
		minimap: {
			enabled: false
		},
		lineNumbers: 'off',
		scrollbar: {
			alwaysConsumeMouseWheel: false
		},
		automaticLayout: true,
	};
}
