/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { PieceTreeTextBufferFactory } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { CellKind, generateCellPath, ICell, INotebook, IOutput, NotebookCellOutputsSplice, NotebookCellsSplice } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookViewModel, IModelDecorationsChangeAccessor } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookCellViewModel';
import { NotebookEditorModel } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { INotebookEditor, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';

export class TestCell implements ICell {
	uri: URI;
	private _onDidChangeOutputs = new Emitter<NotebookCellOutputsSplice[]>();
	onDidChangeOutputs: Event<NotebookCellOutputsSplice[]> = this._onDidChangeOutputs.event;
	private _isDirty: boolean = false;
	private _outputs: IOutput[];
	get outputs(): IOutput[] {
		return this._outputs;
	}

	get isDirty() {
		return this._isDirty;
	}

	set isDirty(newState: boolean) {
		this._isDirty = newState;

	}

	constructor(
		public viewType: string,
		public handle: number,
		public source: string[],
		public language: string,
		public cellKind: CellKind,
		outputs: IOutput[]
	) {
		this._outputs = outputs;
		this.uri = URI.from({
			scheme: 'vscode-notebook',
			authority: viewType,
			path: generateCellPath(cellKind, handle),
			query: ''
		});
	}

	resolveTextBufferFactory(): PieceTreeTextBufferFactory {
		throw new Error('Method not implemented.');
	}
}

export class TestNotebook extends Disposable implements INotebook {
	private readonly _onDidChangeCells = new Emitter<NotebookCellsSplice[]>();
	get onDidChangeCells(): Event<NotebookCellsSplice[]> { return this._onDidChangeCells.event; }
	private _onDidChangeDirtyState = new Emitter<boolean>();
	onDidChangeDirtyState: Event<boolean> = this._onDidChangeDirtyState.event;
	private readonly _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;
	cells: TestCell[];
	activeCell: TestCell | undefined;
	languages: string[] = [];
	renderers = new Set<number>();


	constructor(
		public handle: number,
		public viewType: string,
		public uri: URI
	) {
		super();

		this.cells = [];
	}

	save(): Promise<boolean> {
		throw new Error('Method not implemented.');
	}
}

export class TestNotebookEditor implements INotebookEditor {

	get viewModel() {
		return undefined;
	}

	constructor(
	) {

	}
	getLayoutInfo(): NotebookLayoutInfo {
		throw new Error('Method not implemented.');
	}
	revealLineInCenterIfOutsideViewport(cell: CellViewModel, line: number): void {
		throw new Error('Method not implemented.');
	}
	revealLineInCenter(cell: CellViewModel, line: number): void {
		throw new Error('Method not implemented.');
	}
	focus(): void {
		throw new Error('Method not implemented.');
	}
	showFind(): void {
		throw new Error('Method not implemented.');
	}
	hideFind(): void {
		throw new Error('Method not implemented.');
	}
	revealInView(cell: CellViewModel, offset?: number | undefined): void {
		throw new Error('Method not implemented.');
	}
	revealInCenter(cell: CellViewModel, offset?: number | undefined): void {
		throw new Error('Method not implemented.');
	}
	revealInCenterIfOutsideViewport(cell: CellViewModel, offset?: number | undefined): void {
		throw new Error('Method not implemented.');
	}
	async insertEmptyNotebookCell(cell: CellViewModel, type: CellKind, direction: 'above' | 'below'): Promise<void> {
		// throw new Error('Method not implemented.');
	}
	deleteNotebookCell(cell: CellViewModel): void {
		// throw new Error('Method not implemented.');
	}
	editNotebookCell(cell: CellViewModel): void {
		// throw new Error('Method not implemented.');
	}
	saveNotebookCell(cell: CellViewModel): void {
		// throw new Error('Method not implemented.');
	}
	focusNotebookCell(cell: CellViewModel, focusEditor: boolean): void {
		// throw new Error('Method not implemented.');
	}
	getActiveCell(): CellViewModel | undefined {
		// throw new Error('Method not implemented.');
		return;
	}
	layoutNotebookCell(cell: CellViewModel, height: number): void {
		// throw new Error('Method not implemented.');
	}
	createInset(cell: CellViewModel, output: IOutput, shadowContent: string, offset: number): void {
		// throw new Error('Method not implemented.');
	}
	removeInset(output: IOutput): void {
		// throw new Error('Method not implemented.');
	}
	triggerScroll(event: IMouseWheelEvent): void {
		// throw new Error('Method not implemented.');
	}
	getFontInfo(): BareFontInfo | undefined {
		return BareFontInfo.createFromRawSettings({
			fontFamily: 'Monaco',
		}, 1, true);
	}
	getOutputRenderer(): OutputRenderer {
		throw new Error('Method not implemented.');
	}

	changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any {
		throw new Error('Method not implemented.');
	}
}

export function createTestCellViewModel(instantiationService: IInstantiationService, viewType: string, notebookHandle: number, cellhandle: number, source: string[], language: string, cellKind: CellKind, outputs: IOutput[]) {
	const mockCell = new TestCell(viewType, cellhandle, source, language, cellKind, outputs);
	return instantiationService.createInstance(CellViewModel, viewType, notebookHandle, mockCell);
}

export function withTestNotebook(instantiationService: IInstantiationService, cells: [string[], string, CellKind, IOutput[]][], callback: (editor: TestNotebookEditor, viewModel: NotebookViewModel) => void) {
	const viewType = 'notebook';
	const editor = new TestNotebookEditor();
	const notebook = new TestNotebook(0, viewType, URI.parse('test'));
	notebook.cells = cells.map((cell, index) => {
		return new TestCell(viewType, index, cell[0], cell[1], cell[2], cell[3]);
	});
	const model = new NotebookEditorModel(notebook);
	const viewModel = new NotebookViewModel(viewType, model, instantiationService);

	callback(editor, viewModel);

	viewModel.dispose();
	return;
}
