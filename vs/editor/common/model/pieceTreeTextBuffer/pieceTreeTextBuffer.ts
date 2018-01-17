/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Range } from 'vs/editor/common/core/range';
import { Position } from 'vs/editor/common/core/position';
import * as strings from 'vs/base/common/strings';
import { IValidatedEditOperation } from 'vs/editor/common/model/linesTextBuffer/linesTextBuffer';
import { PieceTreeBase, StringBuffer } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase';
import { IIdentifiedSingleEditOperation, EndOfLinePreference, ITextBuffer, ApplyEditsResult, IInternalModelContentChange } from 'vs/editor/common/model';

export class PieceTreeTextBuffer implements ITextBuffer {
	private _pieceTree: PieceTreeBase;
	private _BOM: string;
	private _EOL: string;
	private _mightContainRTL: boolean;
	private _mightContainNonBasicASCII: boolean;

	constructor(chunks: StringBuffer[], BOM: string, eol: '\r\n' | '\n', containsRTL: boolean, isBasicASCII: boolean) {
		this._BOM = BOM;
		this._EOL = eol;
		this._mightContainNonBasicASCII = !isBasicASCII;
		this._mightContainRTL = containsRTL;
		this._pieceTree = new PieceTreeBase(chunks);
	}

	// #region TextBuffer
	public equals(other: ITextBuffer): boolean {
		if (!(other instanceof PieceTreeTextBuffer)) {
			return false;
		}
		if (this._BOM !== other._BOM) {
			return false;
		}
		if (this._EOL !== other._EOL) {
			return false;
		}
		if (this.getLength() !== other.getLength()) {
			return false;
		}
		if (this.getLineCount() !== other.getLineCount()) {
			return false;
		}
		return this._pieceTree.equal(other._pieceTree);
	}
	public mightContainRTL(): boolean {
		return this._mightContainRTL;
	}
	public mightContainNonBasicASCII(): boolean {
		return this._mightContainNonBasicASCII;
	}
	public getBOM(): string {
		return this._BOM;
	}
	public getEOL(): string {
		return this._EOL;
	}

	public getOffsetAt(lineNumber: number, column: number): number {
		return this._pieceTree.getOffsetAt(lineNumber, column);
	}

	public getPositionAt(offset: number): Position {
		return this._pieceTree.getPositionAt(offset);
	}

	public getRangeAt(start: number, length: number): Range {
		let end = start + length;
		const startPosition = this.getPositionAt(start);
		const endPosition = this.getPositionAt(end);
		return new Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column);
	}

	public getValueInRange(range: Range, eol: EndOfLinePreference = EndOfLinePreference.TextDefined): string {
		if (range.isEmpty()) {
			return '';
		}

		const lineEnding = this._getEndOfLine(eol);
		const text = this._pieceTree.getValueInRange(range, eol);
		return text.replace(/\r\n|\r|\n/g, lineEnding);
	}

	public getValueLengthInRange(range: Range, eol: EndOfLinePreference = EndOfLinePreference.TextDefined): number {
		if (range.isEmpty()) {
			return 0;
		}

		if (range.startLineNumber === range.endLineNumber) {
			return (range.endColumn - range.startColumn);
		}

		let startOffset = this.getOffsetAt(range.startLineNumber, range.startColumn);
		let endOffset = this.getOffsetAt(range.endLineNumber, range.endColumn);
		return endOffset - startOffset;
	}

	public getLength(): number {
		return this._pieceTree.getLength();
	}

	public getLineCount(): number {
		return this._pieceTree.getLineCount();
	}

	public getLinesContent(): string[] {
		return this._pieceTree.getLinesContent();
	}

	public getLineContent(lineNumber: number): string {
		return this._pieceTree.getLineContent(lineNumber);
	}

	public getLineCharCode(lineNumber: number, index: number): number {
		return this._pieceTree.getLineCharCode(lineNumber, index);
	}

	public getLineLength(lineNumber: number): number {
		return this._pieceTree.getLineLength(lineNumber);
	}

	public getLineMinColumn(lineNumber: number): number {
		return this._pieceTree.getLineMinColumn(lineNumber);
	}

	public getLineMaxColumn(lineNumber: number): number {
		return this._pieceTree.getLineMaxColumn(lineNumber);
	}

	public getLineFirstNonWhitespaceColumn(lineNumber: number): number {
		return this._pieceTree.getLineFirstNonWhitespaceColumn(lineNumber);
	}

	public getLineLastNonWhitespaceColumn(lineNumber: number): number {
		return this._pieceTree.getLineLastNonWhitespaceColumn(lineNumber);
	}

	private _getEndOfLine(eol: EndOfLinePreference): string {
		switch (eol) {
			case EndOfLinePreference.LF:
				return '\n';
			case EndOfLinePreference.CRLF:
				return '\r\n';
			case EndOfLinePreference.TextDefined:
				return this.getEOL();
		}
		throw new Error('Unknown EOL preference');
	}

	public setEOL(newEOL: '\r\n' | '\n'): void {
		this._EOL = newEOL;
		this._pieceTree.normalizeEOL(newEOL);
	}

	public applyEdits(rawOperations: IIdentifiedSingleEditOperation[], recordTrimAutoWhitespace: boolean): ApplyEditsResult {
		let mightContainRTL = this._mightContainRTL;
		let mightContainNonBasicASCII = this._mightContainNonBasicASCII;
		let canReduceOperations = true;

		let operations: IValidatedEditOperation[] = [];
		for (let i = 0; i < rawOperations.length; i++) {
			let op = rawOperations[i];
			if (canReduceOperations && op._isTracked) {
				canReduceOperations = false;
			}
			let validatedRange = op.range;
			if (!mightContainRTL && op.text) {
				// check if the new inserted text contains RTL
				mightContainRTL = strings.containsRTL(op.text);
			}
			if (!mightContainNonBasicASCII && op.text) {
				mightContainNonBasicASCII = !strings.isBasicASCII(op.text);
			}
			operations[i] = {
				sortIndex: i,
				identifier: op.identifier,
				range: validatedRange,
				rangeOffset: this.getOffsetAt(validatedRange.startLineNumber, validatedRange.startColumn),
				rangeLength: this.getValueLengthInRange(validatedRange),
				lines: op.text ? op.text.split(/\r\n|\r|\n/) : null,
				forceMoveMarkers: op.forceMoveMarkers,
				isAutoWhitespaceEdit: op.isAutoWhitespaceEdit || false
			};
		}

		// Sort operations ascending
		operations.sort(PieceTreeTextBuffer._sortOpsAscending);

		for (let i = 0, count = operations.length - 1; i < count; i++) {
			let rangeEnd = operations[i].range.getEndPosition();
			let nextRangeStart = operations[i + 1].range.getStartPosition();

			if (nextRangeStart.isBefore(rangeEnd)) {
				// overlapping ranges
				throw new Error('Overlapping ranges are not allowed!');
			}
		}

		if (canReduceOperations) {
			// operations = this._reduceOperations(operations);
		}

		// Delta encode operations
		let reverseRanges = PieceTreeTextBuffer._getInverseEditRanges(operations);
		let newTrimAutoWhitespaceCandidates: { lineNumber: number, oldContent: string }[] = [];

		for (let i = 0; i < operations.length; i++) {
			let op = operations[i];
			let reverseRange = reverseRanges[i];

			if (recordTrimAutoWhitespace && op.isAutoWhitespaceEdit && op.range.isEmpty()) {
				// Record already the future line numbers that might be auto whitespace removal candidates on next edit
				for (let lineNumber = reverseRange.startLineNumber; lineNumber <= reverseRange.endLineNumber; lineNumber++) {
					let currentLineContent = '';
					if (lineNumber === reverseRange.startLineNumber) {
						currentLineContent = this.getLineContent(op.range.startLineNumber);
						if (strings.firstNonWhitespaceIndex(currentLineContent) !== -1) {
							continue;
						}
					}
					newTrimAutoWhitespaceCandidates.push({ lineNumber: lineNumber, oldContent: currentLineContent });
				}
			}
		}

		let reverseOperations: IIdentifiedSingleEditOperation[] = [];
		for (let i = 0; i < operations.length; i++) {
			let op = operations[i];
			let reverseRange = reverseRanges[i];

			reverseOperations[i] = {
				identifier: op.identifier,
				range: reverseRange,
				text: this.getValueInRange(op.range),
				forceMoveMarkers: op.forceMoveMarkers
			};
		}

		this._mightContainRTL = mightContainRTL;
		this._mightContainNonBasicASCII = mightContainNonBasicASCII;

		const contentChanges = this._doApplyEdits(operations);

		let trimAutoWhitespaceLineNumbers: number[] = null;
		if (recordTrimAutoWhitespace && newTrimAutoWhitespaceCandidates.length > 0) {
			// sort line numbers auto whitespace removal candidates for next edit descending
			newTrimAutoWhitespaceCandidates.sort((a, b) => b.lineNumber - a.lineNumber);

			trimAutoWhitespaceLineNumbers = [];
			for (let i = 0, len = newTrimAutoWhitespaceCandidates.length; i < len; i++) {
				let lineNumber = newTrimAutoWhitespaceCandidates[i].lineNumber;
				if (i > 0 && newTrimAutoWhitespaceCandidates[i - 1].lineNumber === lineNumber) {
					// Do not have the same line number twice
					continue;
				}

				let prevContent = newTrimAutoWhitespaceCandidates[i].oldContent;
				let lineContent = this.getLineContent(lineNumber);

				if (lineContent.length === 0 || lineContent === prevContent || strings.firstNonWhitespaceIndex(lineContent) !== -1) {
					continue;
				}

				trimAutoWhitespaceLineNumbers.push(lineNumber);
			}
		}

		return new ApplyEditsResult(
			reverseOperations,
			contentChanges,
			trimAutoWhitespaceLineNumbers
		);
	}

	private _doApplyEdits(operations: IValidatedEditOperation[]): IInternalModelContentChange[] {
		operations.sort(PieceTreeTextBuffer._sortOpsDescending);

		let contentChanges: IInternalModelContentChange[] = [];

		// operations are from bottom to top
		for (let i = 0; i < operations.length; i++) {
			let op = operations[i];

			const startLineNumber = op.range.startLineNumber;
			const startColumn = op.range.startColumn;
			const endLineNumber = op.range.endLineNumber;
			const endColumn = op.range.endColumn;

			if (startLineNumber === endLineNumber && startColumn === endColumn && (!op.lines || op.lines.length === 0)) {
				// no-op
				continue;
			}

			const deletingLinesCnt = endLineNumber - startLineNumber;
			const insertingLinesCnt = (op.lines ? op.lines.length - 1 : 0);
			const editingLinesCnt = Math.min(deletingLinesCnt, insertingLinesCnt);

			const text = (op.lines ? op.lines.join(this.getEOL()) : '');

			if (text) {
				// replacement
				this._pieceTree.delete(op.rangeOffset, op.rangeLength);
				this._pieceTree.insert(op.rangeOffset, text);

			} else {
				// deletion
				this._pieceTree.delete(op.rangeOffset, op.rangeLength);
			}

			if (editingLinesCnt < insertingLinesCnt) {
				let newLinesContent: string[] = [];
				for (let j = editingLinesCnt + 1; j <= insertingLinesCnt; j++) {
					newLinesContent.push(op.lines[j]);
				}

				newLinesContent[newLinesContent.length - 1] = this.getLineContent(startLineNumber + insertingLinesCnt - 1);
			}

			const contentChangeRange = new Range(startLineNumber, startColumn, endLineNumber, endColumn);
			contentChanges.push({
				range: contentChangeRange,
				rangeLength: op.rangeLength,
				text: text,
				lines: op.lines,
				rangeOffset: op.rangeOffset,
				forceMoveMarkers: op.forceMoveMarkers
			});
		}
		return contentChanges;
	}

	// #endregion

	// #region helper
	// testing purpose.
	public getPieceTree(): PieceTreeBase {
		return this._pieceTree;
	}
	/**
	 * Assumes `operations` are validated and sorted ascending
	 */
	public static _getInverseEditRanges(operations: IValidatedEditOperation[]): Range[] {
		let result: Range[] = [];

		let prevOpEndLineNumber: number;
		let prevOpEndColumn: number;
		let prevOp: IValidatedEditOperation = null;
		for (let i = 0, len = operations.length; i < len; i++) {
			let op = operations[i];

			let startLineNumber: number;
			let startColumn: number;

			if (prevOp) {
				if (prevOp.range.endLineNumber === op.range.startLineNumber) {
					startLineNumber = prevOpEndLineNumber;
					startColumn = prevOpEndColumn + (op.range.startColumn - prevOp.range.endColumn);
				} else {
					startLineNumber = prevOpEndLineNumber + (op.range.startLineNumber - prevOp.range.endLineNumber);
					startColumn = op.range.startColumn;
				}
			} else {
				startLineNumber = op.range.startLineNumber;
				startColumn = op.range.startColumn;
			}

			let resultRange: Range;

			if (op.lines && op.lines.length > 0) {
				// the operation inserts something
				let lineCount = op.lines.length;
				let firstLine = op.lines[0];
				let lastLine = op.lines[lineCount - 1];

				if (lineCount === 1) {
					// single line insert
					resultRange = new Range(startLineNumber, startColumn, startLineNumber, startColumn + firstLine.length);
				} else {
					// multi line insert
					resultRange = new Range(startLineNumber, startColumn, startLineNumber + lineCount - 1, lastLine.length + 1);
				}
			} else {
				// There is nothing to insert
				resultRange = new Range(startLineNumber, startColumn, startLineNumber, startColumn);
			}

			prevOpEndLineNumber = resultRange.endLineNumber;
			prevOpEndColumn = resultRange.endColumn;

			result.push(resultRange);
			prevOp = op;
		}

		return result;
	}

	private static _sortOpsAscending(a: IValidatedEditOperation, b: IValidatedEditOperation): number {
		let r = Range.compareRangesUsingEnds(a.range, b.range);
		if (r === 0) {
			return a.sortIndex - b.sortIndex;
		}
		return r;
	}

	private static _sortOpsDescending(a: IValidatedEditOperation, b: IValidatedEditOperation): number {
		let r = Range.compareRangesUsingEnds(a.range, b.range);
		if (r === 0) {
			return b.sortIndex - a.sortIndex;
		}
		return -r;
	}
	// #endregion
}
