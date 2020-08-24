/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ISequence, LcsDiff } from 'vs/base/common/diff/diff';
import { hash } from 'vs/base/common/hash';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IRequestHandler } from 'vs/base/common/worker/simpleWorker';
import * as model from 'vs/editor/common/model';
import { PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { CellKind, ICellDto2, IMainCellDto, INotebookDiffResult, IProcessedOutput, NotebookCellMetadata, NotebookDataDto, NotebookDocumentMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Range } from 'vs/editor/common/core/range';
import { DiffComputer } from 'vs/editor/common/diff/diffComputer';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { EditorWorkerHost } from 'vs/workbench/contrib/notebook/common/services/notebookWorkerServiceImpl';

class MirrorCell {
	private _textBuffer!: model.IReadonlyTextBuffer;

	get textBuffer() {
		if (this._textBuffer) {
			return this._textBuffer;
		}

		const builder = new PieceTreeTextBufferBuilder();
		builder.acceptChunk(Array.isArray(this._source) ? this._source.join('\n') : this._source);
		const bufferFactory = builder.finish(true);
		this._textBuffer = bufferFactory.create(model.DefaultEndOfLine.LF);

		return this._textBuffer;
	}

	private _hash: number | null = null;


	constructor(
		readonly handle: number,
		private _source: string | string[],
		readonly language: string,
		readonly cellKind: CellKind,
		readonly outputs: IProcessedOutput[],
		readonly metadata?: NotebookCellMetadata

	) { }

	getFullModelRange() {
		const lineCount = this.textBuffer.getLineCount();
		return new Range(1, 1, lineCount, this.textBuffer.getLineLength(lineCount) + 1);
	}

	getValue(): string {
		const fullRange = this.getFullModelRange();
		const eol = this.textBuffer.getEOL();
		if (eol === '\n') {
			return this.textBuffer.getValueInRange(fullRange, model.EndOfLinePreference.LF);
		} else {
			return this.textBuffer.getValueInRange(fullRange, model.EndOfLinePreference.CRLF);
		}
	}

	getHashValue(): number {
		if (this._hash !== null) {
			return this._hash;
		}

		this._hash = hash([hash(this.getValue()), this.metadata]);
		// this._hash = hash(this.getValue());
		return this._hash;
	}
}

class MirrorNotebookDocument {
	constructor(
		readonly uri: URI,
		readonly cells: MirrorCell[],
		readonly languages: string[],
		readonly metadata: NotebookDocumentMetadata,
	) {
	}
}

export class CellSequence implements ISequence {

	constructor(readonly textModel: MirrorNotebookDocument) {
	}

	getElements(): string[] | number[] | Int32Array {
		const hashValue = new Int32Array(this.textModel.cells.length);
		for (let i = 0; i < this.textModel.cells.length; i++) {
			hashValue[i] = this.textModel.cells[i].getHashValue();
		}

		return hashValue;
	}

	getCellHash(cell: ICellDto2) {
		const source = Array.isArray(cell.source) ? cell.source.join('\n') : cell.source;
		const hashVal = hash([hash(source), cell.metadata]);
		return hashVal;
	}
}

export class NotebookEditorSimpleWorker implements IRequestHandler, IDisposable {
	_requestHandlerBrand: any;

	private _models: { [uri: string]: MirrorNotebookDocument; };

	constructor() {
		this._models = Object.create(null);
	}
	dispose(): void {
	}

	public acceptNewModel(uri: string, data: NotebookDataDto): void {
		this._models[uri] = new MirrorNotebookDocument(URI.parse(uri), data.cells.map(dto => new MirrorCell(
			(dto as unknown as IMainCellDto).handle,
			dto.source,
			dto.language,
			dto.cellKind,
			dto.outputs,
			dto.metadata
		)), data.languages, data.metadata);
	}

	public acceptRemovedModel(strURL: string): void {
		if (!this._models[strURL]) {
			return;
		}
		delete this._models[strURL];
	}

	computeDiff(originalUrl: string, modifiedUrl: string): INotebookDiffResult {
		const original = this._getModel(originalUrl);
		const modified = this._getModel(modifiedUrl);

		const diff = new LcsDiff(new CellSequence(original), new CellSequence(modified));
		const diffResult = diff.ComputeDiff(false);

		let cellLineChanges: { originalCellhandle: number, modifiedCellhandle: number, lineChanges: editorCommon.ILineChange[] }[] = [];

		diffResult.changes.forEach(change => {
			if (change.modifiedLength === 0) {
				// deletion ...
				return;
			}

			if (change.originalLength === 0) {
				// insertion
				return;
			}

			for (let i = 0, len = Math.min(change.modifiedLength, change.originalLength); i < len; i++) {
				let originalIndex = change.originalStart + i;
				let modifiedIndex = change.modifiedStart + i;

				const originalCell = original.cells[originalIndex];
				const modifiedCell = modified.cells[modifiedIndex];

				if (originalCell.getValue() !== modifiedCell.getValue()) {
					// console.log(`original cell ${originalIndex} content change`);
					const originalLines = originalCell.textBuffer.getLinesContent();
					const modifiedLines = modifiedCell.textBuffer.getLinesContent();
					const diffComputer = new DiffComputer(originalLines, modifiedLines, {
						shouldComputeCharChanges: true,
						shouldPostProcessCharChanges: true,
						shouldIgnoreTrimWhitespace: false,
						shouldMakePrettyDiff: true,
						maxComputationTime: 5000
					});

					const lineChanges = diffComputer.computeDiff().changes;

					cellLineChanges.push({
						originalCellhandle: originalCell.handle,
						modifiedCellhandle: modifiedCell.handle,
						lineChanges
					});

					// console.log(lineDecorations);

				} else {
					// console.log(`original cell ${originalIndex} metadata change`);
				}

			}
		});

		return {
			cellsDiff: diffResult,
			linesDiff: cellLineChanges
		};
	}

	protected _getModel(uri: string): MirrorNotebookDocument {
		return this._models[uri];
	}
}

/**
 * Called on the worker side
 * @internal
 */
export function create(host: EditorWorkerHost): IRequestHandler {
	return new NotebookEditorSimpleWorker();
}

