/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as UUID from 'vs/base/common/uuid';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { Range } from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import * as model from 'vs/editor/common/model';
import { SearchParams } from 'vs/editor/common/model/textModelSearch';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { MarkdownRenderer } from 'vs/workbench/contrib/notebook/browser/view/renderers/mdRenderer';
import { CellKind, EDITOR_BOTTOM_PADDING, EDITOR_TOP_PADDING, ICell, IOutput, NotebookCellOutputsSplice } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CellFindMatch } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export class CellViewModel extends Disposable {

	private _mdRenderer: MarkdownRenderer | null = null;
	private _html: HTMLElement | null = null;
	protected readonly _onDidDispose = new Emitter<void>();
	readonly onDidDispose = this._onDidDispose.event;
	protected readonly _onDidChangeEditingState = new Emitter<void>();
	readonly onDidChangeEditingState = this._onDidChangeEditingState.event;
	protected readonly _onDidChangeOutputs = new Emitter<NotebookCellOutputsSplice[]>();
	readonly onDidChangeOutputs = this._onDidChangeOutputs.event;
	private _outputCollection: number[] = [];
	protected _outputsTop: PrefixSumComputer | null = null;

	get handle() {
		return this.cell.handle;
	}

	get cellKind() {
		return this.cell.cellKind;
	}
	get lineCount() {
		return this.cell.source.length;
	}
	get outputs() {
		return this.cell.outputs;
	}

	private _isEditing: boolean;

	get isEditing(): boolean {
		return this._isEditing;
	}
	set isEditing(newState: boolean) {
		this._isEditing = newState;
		this._onDidChangeEditingState.fire();
	}

	private _selfSizeMonitoring: boolean = false;

	set selfSizeMonitoring(newVal: boolean) {
		this._selfSizeMonitoring = newVal;
	}

	get selfSizeMonitoring() {
		return this._selfSizeMonitoring;
	}

	private _editorHeight = 0;
	set editorHeight(height: number) {
		this._editorHeight = height;
	}

	get editorHeight(): number {
		return this._editorHeight;
	}

	protected readonly _onDidChangeEditorAttachState = new Emitter<boolean>();
	readonly onDidChangeEditorAttachState = this._onDidChangeEditorAttachState.event;

	get editorAttached(): boolean {
		return !!this._textEditor;
	}

	private _textModel?: model.ITextModel;
	private _textEditor?: ICodeEditor;
	private _buffer: model.ITextBuffer | null;
	private _editorViewStates: editorCommon.ICodeEditorViewState | null;
	private _lastDecorationId: number = 0;
	private _resolvedDecorations = new Map<string, { id?: string, options: model.IModelDeltaDecoration }>();

	readonly id: string = UUID.generateUuid();

	constructor(
		readonly viewType: string,
		readonly notebookHandle: number,
		readonly cell: ICell,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ITextModelService private readonly _modelService: ITextModelService,
	) {
		super();
		if (this.cell.onDidChangeOutputs) {
			this._register(this.cell.onDidChangeOutputs((splices) => {
				this._outputCollection = new Array(this.cell.outputs.length);
				this._outputsTop = null;
				this._onDidChangeOutputs.fire(splices);
			}));
		}

		this._outputCollection = new Array(this.cell.outputs.length);
		this._buffer = null;
		this._editorViewStates = null;
		this._isEditing = false;
	}

	restoreEditorViewState(editorViewStates: editorCommon.ICodeEditorViewState | null) {
		this._editorViewStates = editorViewStates;
	}

	saveEditorViewState() {
		if (this._textEditor) {
			this._editorViewStates = this.saveViewState();
		}

		return this._editorViewStates;
	}


	//#region Search
	private readonly _hasFindResult = this._register(new Emitter<boolean>());
	public readonly hasFindResult: Event<boolean> = this._hasFindResult.event;

	startFind(value: string): CellFindMatch | null {
		let cellMatches: model.FindMatch[] = [];
		if (this.cellKind === CellKind.Markdown) {
			return null;
		}

		if (this.assertTextModelAttached()) {
			cellMatches = this._textModel!.findMatches(value, false, false, false, null, false);
		} else {
			if (!this._buffer) {
				this._buffer = this.cell.resolveTextBufferFactory().create(model.DefaultEndOfLine.LF);
			}

			const lineCount = this._buffer.getLineCount();
			const fullRange = new Range(1, 1, lineCount, this._buffer.getLineLength(lineCount) + 1);
			const searchParams = new SearchParams(value, false, false, null);
			const searchData = searchParams.parseSearchRequest();

			if (!searchData) {
				return null;
			}

			cellMatches = this._buffer.findMatchesLineByLine(fullRange, searchData, false, 1000);
		}

		return {
			cell: this,
			matches: cellMatches
		};
	}

	assertTextModelAttached(): boolean {
		if (this._textModel && this._textEditor && this._textEditor.getModel() === this._textModel) {
			return true;
		}

		return false;
	}

	private saveViewState(): editorCommon.ICodeEditorViewState | null {
		if (!this._textEditor) {
			return null;
		}

		return this._textEditor.saveViewState();
	}


	private restoreViewState(state: editorCommon.ICodeEditorViewState | null): void {
		if (state) {
			this._textEditor?.restoreViewState(state);
		}
	}

	//#endregion

	hasDynamicHeight() {
		if (this.selfSizeMonitoring) {
			// if there is an output rendered in the webview, it should always be false
			return false;
		}

		if (this.cellKind === CellKind.Code) {
			if (this.outputs && this.outputs.length > 0) {
				// if it contains output, it will be marked as dynamic height
				// thus when it's being rendered, the list view will `probeHeight`
				// inside which, we will check domNode's height directly instead of doing another `renderElement` with height undefined.
				return true;
			}
			else {
				return false;
			}
		}

		return true;
	}

	getHeight(lineHeight: number) {
		if (this.cellKind === CellKind.Markdown) {
			return 100;
		}
		else {
			return this.lineCount * lineHeight + 16 + EDITOR_TOP_PADDING + EDITOR_BOTTOM_PADDING;
		}
	}
	setText(strs: string[]) {
		this.cell.source = strs;
		this._html = null;
	}
	save() {
		if (this._textModel && !this._textModel.isDisposed() && (this.cell.isDirty || this.isEditing)) {
			let cnt = this._textModel.getLineCount();
			this.cell.source = this._textModel.getLinesContent().map((str, index) => str + (index !== cnt - 1 ? '\n' : ''));
		}
	}
	getText(): string {
		if (this._textModel) {
			return this._textModel.getValue();
		}

		return this.cell.source.join('\n');
	}

	getHTML(): HTMLElement | null {
		if (this.cellKind === CellKind.Markdown) {
			if (this._html) {
				return this._html;
			}
			let renderer = this.getMarkdownRenderer();
			this._html = renderer.render({ value: this.getText(), isTrusted: true }).element;
			return this._html;
		}
		return null;
	}

	async resolveTextModel(): Promise<model.ITextModel> {
		if (!this._textModel) {
			const ref = await this._modelService.createModelReference(this.cell.uri);
			this._textModel = ref.object.textEditorModel;
			this._buffer = this._textModel.getTextBuffer();
			this._register(ref);
			this._register(this._textModel.onDidChangeContent(() => {
				this.cell.isDirty = true;
			}));
		}
		return this._textModel;
	}

	attachTextEditor(editor: ICodeEditor) {
		this._textEditor = editor;

		if (this._editorViewStates) {
			this.restoreViewState(this._editorViewStates);
		}

		this._resolvedDecorations.forEach((value, key) => {
			if (key.startsWith('_lazy_')) {
				// lazy ones

				const ret = this._textEditor!.deltaDecorations([], [value.options]);
				this._resolvedDecorations.get(key)!.id = ret[0];
			} else {
				const ret = this._textEditor!.deltaDecorations([], [value.options]);
				this._resolvedDecorations.get(key)!.id = ret[0];
			}
		});

		this._onDidChangeEditorAttachState.fire(true);
	}

	detachTextEditor() {
		this._editorViewStates = this.saveViewState();

		// decorations need to be cleared first as editors can be resued.
		this._resolvedDecorations.forEach(value => {
			let resolvedid = value.id;

			if (resolvedid) {
				this._textEditor?.deltaDecorations([resolvedid], []);
			}
		});
		this._textEditor = undefined;
		this._onDidChangeEditorAttachState.fire(false);
	}

	getLineScrollTopOffset(line: number): number {
		if (!this._textEditor) {
			return 0;
		}

		return this._textEditor.getTopForLineNumber(line);
	}

	addDecoration(decoration: model.IModelDeltaDecoration): string {
		if (!this._textEditor) {
			const id = ++this._lastDecorationId;
			const decorationId = `_lazy_${this.id};${id}`;

			this._resolvedDecorations.set(decorationId, { options: decoration });
			return decorationId;
		}

		const result = this._textEditor.deltaDecorations([], [decoration]);
		this._resolvedDecorations.set(result[0], { id: result[0], options: decoration });

		return result[0];
	}

	removeDecoration(decorationId: string) {
		const realDecorationId = this._resolvedDecorations.get(decorationId);

		if (this._textEditor && realDecorationId && realDecorationId.id !== undefined) {
			this._textEditor.deltaDecorations([realDecorationId.id!], []);
		}

		// lastly, remove all the cache
		this._resolvedDecorations.delete(decorationId);
	}

	deltaDecorations(oldDecorations: string[], newDecorations: model.IModelDeltaDecoration[]): string[] {
		oldDecorations.forEach(id => {
			this.removeDecoration(id);
		});

		const ret = newDecorations.map(option => {
			return this.addDecoration(option);
		});

		return ret;
	}

	getMarkdownRenderer() {
		if (!this._mdRenderer) {
			this._mdRenderer = this._instaService.createInstance(MarkdownRenderer);
		}
		return this._mdRenderer;
	}

	updateOutputHeight(index: number, height: number) {
		if (index >= this._outputCollection.length) {
			throw new Error('Output index out of range!');
		}

		this._outputCollection[index] = height;
		this._ensureOutputsTop();
		this._outputsTop!.changeValue(index, height);
	}

	getOutputOffset(index: number): number {
		if (index >= this._outputCollection.length) {
			throw new Error('Output index out of range!');
		}

		this._ensureOutputsTop();

		return this._outputsTop!.getAccumulatedValue(index - 1);
	}

	getOutputHeight(output: IOutput): number | undefined {
		let index = this.cell.outputs.indexOf(output);

		if (index < 0) {
			return undefined;
		}

		if (index < this._outputCollection.length) {
			return this._outputCollection[index];
		}

		return undefined;
	}

	getOutputTotalHeight(): number {
		this._ensureOutputsTop();

		return this._outputsTop!.getTotalValue();
	}

	spliceOutputHeights(start: number, deleteCnt: number, heights: number[]) {
		this._ensureOutputsTop();

		this._outputsTop!.removeValues(start, deleteCnt);
		if (heights.length) {
			const values = new Uint32Array(heights.length);
			for (let i = 0; i < heights.length; i++) {
				values[i] = heights[i];
			}

			this._outputsTop!.insertValues(start, values);
		}
	}

	protected _ensureOutputsTop(): void {
		if (!this._outputsTop) {
			const values = new Uint32Array(this._outputCollection.length);
			for (let i = 0; i < this._outputCollection.length; i++) {
				values[i] = this._outputCollection[i];
			}

			this._outputsTop = new PrefixSumComputer(values);
		}
	}
}
