/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { CursorMove, CursorMoveConfiguration, ICursorMoveHelperModel } from 'vs/editor/common/controller/cursorMoveHelper';
import { CursorChangeReason } from 'vs/editor/common/editorCommon';
import { CursorModelState } from 'vs/editor/common/controller/oneCursor';

export class CursorMoveResult {
	_cursorMoveResultBrand: void;

	public readonly lineNumber: number;
	public readonly column: number;
	public readonly leftoverVisibleColumns: number;

	constructor(lineNumber: number, column: number, leftoverVisibleColumns: number) {
		this.lineNumber = lineNumber;
		this.column = column;
		this.leftoverVisibleColumns = leftoverVisibleColumns;
	}
}

export class MoveOperationResult {
	_moveOperationBrand: void;

	readonly inSelectionMode: boolean;
	readonly lineNumber: number;
	readonly column: number;
	readonly leftoverVisibleColumns: number;
	readonly ensureInEditableRange: boolean;
	readonly reason: CursorChangeReason;

	constructor(
		inSelectionMode: boolean,
		lineNumber: number,
		column: number,
		leftoverVisibleColumns: number,
		ensureInEditableRange: boolean,
		reason: CursorChangeReason
	) {
		this.inSelectionMode = inSelectionMode;
		this.lineNumber = lineNumber;
		this.column = column;
		this.leftoverVisibleColumns = leftoverVisibleColumns;
		this.ensureInEditableRange = ensureInEditableRange;
		this.reason = reason;
	}
}

export class MoveOperations {

	public static left(config: CursorMoveConfiguration, model: ICursorMoveHelperModel, lineNumber: number, column: number): CursorMoveResult {

		if (column > model.getLineMinColumn(lineNumber)) {
			if (CursorMove.isLowSurrogate(model, lineNumber, column - 2)) {
				// character before column is a low surrogate
				column = column - 2;
			} else {
				column = column - 1;
			}
		} else if (lineNumber > 1) {
			lineNumber = lineNumber - 1;
			column = model.getLineMaxColumn(lineNumber);
		}

		return new CursorMoveResult(lineNumber, column, 0);
	}

	public static moveLeft(config: CursorMoveConfiguration, model: ICursorMoveHelperModel, cursor: CursorModelState, inSelectionMode: boolean, noOfColumns: number): MoveOperationResult {
		let lineNumber: number,
			column: number;

		if (cursor.hasSelection() && !inSelectionMode) {
			// If we are in selection mode, move left without selection cancels selection and puts cursor at the beginning of the selection
			lineNumber = cursor.selection.startLineNumber;
			column = cursor.selection.startColumn;
		} else {
			let r = this.left(config, model, cursor.position.lineNumber, cursor.position.column - (noOfColumns - 1));
			lineNumber = r.lineNumber;
			column = r.column;
		}

		return new MoveOperationResult(inSelectionMode, lineNumber, column, 0, true, CursorChangeReason.Explicit);
	}

	public static right(config: CursorMoveConfiguration, model: ICursorMoveHelperModel, lineNumber: number, column: number): CursorMoveResult {

		if (column < model.getLineMaxColumn(lineNumber)) {
			if (CursorMove.isHighSurrogate(model, lineNumber, column - 1)) {
				// character after column is a high surrogate
				column = column + 2;
			} else {
				column = column + 1;
			}
		} else if (lineNumber < model.getLineCount()) {
			lineNumber = lineNumber + 1;
			column = model.getLineMinColumn(lineNumber);
		}

		return new CursorMoveResult(lineNumber, column, 0);
	}

	public static moveRight(config: CursorMoveConfiguration, model: ICursorMoveHelperModel, cursor: CursorModelState, inSelectionMode: boolean, noOfColumns: number): MoveOperationResult {
		let lineNumber: number,
			column: number;

		if (cursor.hasSelection() && !inSelectionMode) {
			// If we are in selection mode, move right without selection cancels selection and puts cursor at the end of the selection
			lineNumber = cursor.selection.endLineNumber;
			column = cursor.selection.endColumn;
		} else {
			let r = this.right(config, model, cursor.position.lineNumber, cursor.position.column + (noOfColumns - 1));
			lineNumber = r.lineNumber;
			column = r.column;
		}

		return new MoveOperationResult(inSelectionMode, lineNumber, column, 0, true, CursorChangeReason.Explicit);
	}

	public static down(config: CursorMoveConfiguration, model: ICursorMoveHelperModel, lineNumber: number, column: number, leftoverVisibleColumns: number, count: number, allowMoveOnLastLine: boolean): CursorMoveResult {
		const currentVisibleColumn = CursorMove.visibleColumnFromColumn(model.getLineContent(lineNumber), column, config.tabSize) + leftoverVisibleColumns;

		lineNumber = lineNumber + count;
		var lineCount = model.getLineCount();
		if (lineNumber > lineCount) {
			lineNumber = lineCount;
			if (allowMoveOnLastLine) {
				column = model.getLineMaxColumn(lineNumber);
			} else {
				column = Math.min(model.getLineMaxColumn(lineNumber), column);
				if (CursorMove.isInsideSurrogatePair(model, lineNumber, column)) {
					column = column - 1;
				}
			}
		} else {
			column = CursorMove.columnFromVisibleColumn(config, model, lineNumber, currentVisibleColumn);
			if (CursorMove.isInsideSurrogatePair(model, lineNumber, column)) {
				column = column - 1;
			}
		}

		leftoverVisibleColumns = currentVisibleColumn - CursorMove.visibleColumnFromColumn(model.getLineContent(lineNumber), column, config.tabSize);

		return new CursorMoveResult(lineNumber, column, leftoverVisibleColumns);
	}

	public static moveDown(config: CursorMoveConfiguration, model: ICursorMoveHelperModel, cursor: CursorModelState, inSelectionMode: boolean, linesCount: number): MoveOperationResult {
		let lineNumber: number,
			column: number;

		if (cursor.hasSelection() && !inSelectionMode) {
			// If we are in selection mode, move down acts relative to the end of selection
			lineNumber = cursor.selection.endLineNumber;
			column = cursor.selection.endColumn;
		} else {
			lineNumber = cursor.position.lineNumber;
			column = cursor.position.column;
		}

		let r = this.down(config, model, lineNumber, column, cursor.leftoverVisibleColumns, linesCount, true);

		return new MoveOperationResult(inSelectionMode, r.lineNumber, r.column, r.leftoverVisibleColumns, true, CursorChangeReason.Explicit);
	}

	public static up(config: CursorMoveConfiguration, model: ICursorMoveHelperModel, lineNumber: number, column: number, leftoverVisibleColumns: number, count: number, allowMoveOnFirstLine: boolean): CursorMoveResult {
		const currentVisibleColumn = CursorMove.visibleColumnFromColumn(model.getLineContent(lineNumber), column, config.tabSize) + leftoverVisibleColumns;

		lineNumber = lineNumber - count;
		if (lineNumber < 1) {
			lineNumber = 1;
			if (allowMoveOnFirstLine) {
				column = model.getLineMinColumn(lineNumber);
			} else {
				column = Math.min(model.getLineMaxColumn(lineNumber), column);
				if (CursorMove.isInsideSurrogatePair(model, lineNumber, column)) {
					column = column - 1;
				}
			}
		} else {
			column = CursorMove.columnFromVisibleColumn(config, model, lineNumber, currentVisibleColumn);
			if (CursorMove.isInsideSurrogatePair(model, lineNumber, column)) {
				column = column - 1;
			}
		}

		leftoverVisibleColumns = currentVisibleColumn - CursorMove.visibleColumnFromColumn(model.getLineContent(lineNumber), column, config.tabSize);

		return new CursorMoveResult(lineNumber, column, leftoverVisibleColumns);
	}

	public static moveUp(config: CursorMoveConfiguration, model: ICursorMoveHelperModel, cursor: CursorModelState, inSelectionMode: boolean, linesCount: number): MoveOperationResult {
		let lineNumber: number,
			column: number;

		if (cursor.hasSelection() && !inSelectionMode) {
			// If we are in selection mode, move up acts relative to the beginning of selection
			lineNumber = cursor.selection.startLineNumber;
			column = cursor.selection.startColumn;
		} else {
			lineNumber = cursor.position.lineNumber;
			column = cursor.position.column;
		}

		let r = this.up(config, model, lineNumber, column, cursor.leftoverVisibleColumns, linesCount, true);

		return new MoveOperationResult(inSelectionMode, r.lineNumber, r.column, r.leftoverVisibleColumns, true, CursorChangeReason.Explicit);
	}
}
