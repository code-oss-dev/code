/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as types from 'vs/workbench/api/common/extHostTypes';
import * as vscode from 'vscode';
import { Event, Emitter } from 'vs/base/common/event';
import { ExtHostNotebookDocument, ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';
import { ExtHostDocumentData } from 'vs/workbench/api/common/extHostDocumentData';
import { Range } from 'vs/workbench/api/common/extHostTypeConverters';
import { DisposableStore } from 'vs/base/common/lifecycle';


//todo@jrieken ConcatDiagnosticsCollection...

export class ExtHostNotebookConcatDocument {

	private _disposables = new DisposableStore();

	private readonly _onDidChange = new Emitter<this>();
	readonly onDidChange: Event<this> = this._onDidChange.event;

	private _delegate!: ExtHostDocumentData;
	private _cellStarts!: PrefixSumComputer;
	private _versionId = 0;

	constructor(
		private readonly _notebook: ExtHostNotebookDocument,
		extHostNotebooks: ExtHostNotebookController,
		extHostDocuments: ExtHostDocuments,
	) {
		this._init();

		extHostDocuments.onDidChangeDocument(e => {
			const cellIdx = this._notebook.cells.findIndex(candidate => candidate.uri.toString() === e.document.uri.toString());
			if (cellIdx < 0) {
				return;
			}
			// todo@jrieken reuse raw event!
			this._versionId += 1;
			this._delegate.onEvents({
				versionId: this._versionId,
				eol: '\n',
				changes: e.contentChanges.map(change => {
					return {
						range: Range.from(change.range),
						rangeOffset: change.rangeOffset,
						rangeLength: change.rangeLength,
						text: change.text,
					};
				})
			});
			this._cellStarts.changeValue(cellIdx, e.document.getText().length + 1);

			this._onDidChange.fire(this);

		}, undefined, this._disposables);

		extHostNotebooks.onDidChangeNotebookDocument(e => {
			if (e.document !== this._notebook) {
				return;
			}
			//todo@jrieken update instead of flushing...
			this._versionId += 1;
			this._init();
			this._onDidChange.fire(this);
		}, undefined, this._disposables);
	}

	dispose(): void {
		this._disposables.dispose();
		this._delegate.dispose();
	}

	private _init() {
		const lines: string[] = [];
		const values = new Uint32Array(this._notebook.cells.length);
		for (let i = 0; i < this._notebook.cells.length; i++) {

			const cell = this._notebook.cells[i];

			// update prefix sum
			values[i] = cell.document.getText().length + 1; // 1 is newline

			//todo@jrieken reuse lines!
			for (let line = 0; line < cell.document.lineCount; line++) {
				lines.push(cell.document.lineAt(line).text);
			}
		}

		this._cellStarts = new PrefixSumComputer(values);
		this._delegate = new ExtHostDocumentData(
			null!,
			this._notebook.uri.with({ scheme: 'vscode-concatdoc' }),
			lines, '\n',
			this._notebook.languages[0],
			0, false
		);
	}

	get versionId() {
		return this._versionId;
	}

	getText() {
		return this._delegate.getText();
	}


	locationAt(positionOrRange: vscode.Position | vscode.Range): vscode.Location {

		if (!types.Range.isRange(positionOrRange)) {
			positionOrRange = new types.Range(<types.Position>positionOrRange, <types.Position>positionOrRange);
		}

		const start = this._delegate.document.offsetAt(positionOrRange.start);
		const startIndex = this._cellStarts.getIndexOf(start);
		const startCell = this._notebook.cells[startIndex.index];
		if (!startCell) {
			// do better?
			// return undefined;
			return new types.Location(this._notebook.uri, new types.Position(0, 0));
		}

		let endCell = startCell;
		let endIndex = startIndex;
		if (!positionOrRange.isEmpty) {
			const end = this._delegate.document.offsetAt(positionOrRange.end);
			endIndex = this._cellStarts.getIndexOf(end);
			endCell = this._notebook.cells[endIndex.index];
		}

		const startPos = startCell.document.positionAt(startIndex.remainder);
		let endPos = startPos;
		if (endCell && endCell.handle === startCell.handle) {
			endPos = endCell.document.positionAt(endIndex.remainder);
		}

		return new types.Location(startCell.uri, new types.Range(startPos.line, startPos.character, endPos.line, endPos.character));
	}

	positionAt(offset: number): vscode.Position;
	positionAt(location: vscode.Location): vscode.Position;
	positionAt(offsetOrLocation: number | vscode.Location): vscode.Position {
		if (typeof offsetOrLocation === 'number') {
			return this._delegate.document.positionAt(offsetOrLocation);
		}
		const idx = this._notebook.cells.findIndex(candidate => candidate.uri.toString() === offsetOrLocation.uri.toString());
		if (idx < 0) {
			// do better?
			// return undefined;
			return new types.Position(0, 0);
		}
		const docOffset = this._notebook.cells[idx].document.offsetAt(offsetOrLocation.range.start);
		const cellOffset = this._cellStarts.getAccumulatedValue(idx - 1);
		return this._delegate.document.positionAt(docOffset + cellOffset);
	}

	offsetAt(position: vscode.Position): number {
		return this._delegate.document.offsetAt(position);
	}
}
