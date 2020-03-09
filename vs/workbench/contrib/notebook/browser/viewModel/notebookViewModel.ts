/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { NotebookEditorModel } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookCellViewModel';
import { NotebookCellsSplice, ICell } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IModelDeltaDecoration } from 'vs/editor/common/model';
import { onUnexpectedError } from 'vs/base/common/errors';
import { CellFindMatch } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export interface INotebookEditorViewState {
	editingCells: { [key: number]: boolean };
	editorViewStates: { [key: number]: editorCommon.ICodeEditorViewState | null };
}

export interface ICellModelDecorations {
	ownerId: number;
	decorations: string[];
}

export interface ICellModelDeltaDecorations {
	ownerId: number;
	decorations: IModelDeltaDecoration[];
}

export interface IModelDecorationsChangeAccessor {
	deltaDecorations(oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]): ICellModelDecorations[];
}

const invalidFunc = () => { throw new Error(`Invalid change accessor`); };


export class NotebookViewModel extends Disposable {
	private _localStore: DisposableStore = this._register(new DisposableStore());
	private _viewCells: CellViewModel[] = [];

	get viewCells() {
		return this._viewCells;
	}

	get notebookDocument() {
		return this._model.notebook;
	}

	get renderers() {
		return this._model.notebook!.renderers;
	}

	get handle() {
		return this._model.notebook.handle;
	}

	get languages() {
		return this._model.notebook.languages;
	}

	get uri() {
		return this._model.notebook.uri;
	}

	private readonly _onDidChangeCells = new Emitter<NotebookCellsSplice[]>();
	get onDidChangeCells(): Event<NotebookCellsSplice[]> { return this._onDidChangeCells.event; }

	constructor(
		public viewType: string,
		private _model: NotebookEditorModel,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this._register(this._model.onDidChangeCells(e => this._onDidChangeCells.fire(e)));
		this._viewCells = this._model!.notebook!.cells.map(cell => {
			const viewCell = this.instantiationService.createInstance(CellViewModel, this.viewType, this._model!.notebook!.handle, cell);
			this._localStore.add(viewCell);
			return viewCell;
		});
	}

	isDirty() {
		return this._model.isDirty();
	}

	hide() {
		this.viewCells.forEach(cell => {
			if (cell.getText() !== '') {
				cell.isEditing = false;
			}
		});
	}

	getViewCellIndex(cell: CellViewModel) {
		return this.viewCells.indexOf(cell);
	}

	/**
	 * Search in notebook text model
	 * @param value
	 */
	find(value: string): CellFindMatch[] {
		const matches: CellFindMatch[] = [];
		this.viewCells.forEach(cell => {
			const cellMatches = cell.startFind(value);
			if (cellMatches) {
				matches.push(cellMatches);
			}
		});

		return matches;
	}

	insertCell(index: number, cell: ICell): CellViewModel {
		const newCell = this.instantiationService.createInstance(CellViewModel, this.viewType, this.handle, cell);
		this.viewCells!.splice(index, 0, newCell);
		this._model.insertCell(newCell.cell, index);
		this._localStore.add(newCell);
		return newCell;
	}

	deleteCell(index: number) {
		let viewCell = this.viewCells[index];
		this.viewCells.splice(index, 1);
		this._model.deleteCell(viewCell.cell);
		viewCell.dispose();
	}

	saveEditorViewState(): INotebookEditorViewState {
		const state: { [key: number]: boolean } = {};
		this.viewCells.filter(cell => cell.isEditing).forEach(cell => state[cell.cell.handle] = true);
		const editorViewStates: { [key: number]: editorCommon.ICodeEditorViewState } = {};
		this.viewCells.map(cell => ({ handle: cell.cell.handle, state: cell.saveEditorViewState() })).forEach(viewState => {
			if (viewState.state) {
				editorViewStates[viewState.handle] = viewState.state;
			}
		});

		return {
			editingCells: state,
			editorViewStates: editorViewStates
		};
	}

	restoreEditorViewState(viewState: INotebookEditorViewState | undefined): void {
		if (!viewState) {
			return;
		}

		this._viewCells.forEach(cell => {
			const isEditing = viewState.editingCells && viewState.editingCells[cell.handle];
			const editorViewState = viewState.editorViewStates && viewState.editorViewStates[cell.handle];

			cell.isEditing = isEditing;
			cell.restoreEditorViewState(editorViewState);
		});
	}

	/**
	 * Editor decorations across cells. For example, find decorations for multiple code cells
	 * The reason that we can't completely delegate this to CodeEditorWidget is most of the time, the editors for cells are not created yet but we already have decorations for them.
	 */
	changeDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null {
		const changeAccessor: IModelDecorationsChangeAccessor = {
			deltaDecorations: (oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]): ICellModelDecorations[] => {
				return this.deltaDecorationsImpl(oldDecorations, newDecorations);
			}
		};

		let result: T | null = null;
		try {
			result = callback(changeAccessor);
		} catch (e) {
			onUnexpectedError(e);
		}

		changeAccessor.deltaDecorations = invalidFunc;

		return result;
	}

	deltaDecorationsImpl(oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]): ICellModelDecorations[] {

		const mapping = new Map<number, { cell: CellViewModel; oldDecorations: string[]; newDecorations: IModelDeltaDecoration[] }>();
		oldDecorations.forEach(oldDecoration => {
			const ownerId = oldDecoration.ownerId;

			if (!mapping.has(ownerId)) {
				const cell = this.viewCells.find(cell => cell.handle === ownerId);
				mapping.set(ownerId, { cell: cell!, oldDecorations: [], newDecorations: [] });
			}

			const data = mapping.get(ownerId)!;
			data.oldDecorations = oldDecoration.decorations;
		});

		newDecorations.forEach(newDecoration => {
			const ownerId = newDecoration.ownerId;

			if (!mapping.has(ownerId)) {
				const cell = this.viewCells.find(cell => cell.handle === ownerId);
				mapping.set(ownerId, { cell: cell!, oldDecorations: [], newDecorations: [] });
			}

			const data = mapping.get(ownerId)!;
			data.newDecorations = newDecoration.decorations;
		});

		const ret: ICellModelDecorations[] = [];
		mapping.forEach((value, ownerId) => {
			const cellRet = value.cell.deltaDecorations(value.oldDecorations, value.newDecorations);
			ret.push({
				ownerId: ownerId,
				decorations: cellRet
			});
		});

		return ret;
	}

	equal(model: NotebookEditorModel) {
		return this._model === model;
	}

	dispose() {
		this._localStore.clear();
		this._viewCells.forEach(cell => {
			cell.save();
			cell.dispose();
		});

		super.dispose();
	}
}
