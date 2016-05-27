/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import {Range} from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import {EditStack} from 'vs/editor/common/model/editStack';
import {ILineEdit, ILineMarker, ModelLine} from 'vs/editor/common/model/modelLine';
import {DeferredEventsBuilder, TextModelWithDecorations} from 'vs/editor/common/model/textModelWithDecorations';
import {IMode} from 'vs/editor/common/modes';
import * as strings from 'vs/base/common/strings';
import {Selection} from 'vs/editor/common/core/selection';
import {IDisposable} from 'vs/base/common/lifecycle';

export interface IValidatedEditOperation {
	sortIndex: number;
	identifier: editorCommon.ISingleEditOperationIdentifier;
	range: Range;
	rangeLength: number;
	lines: string[];
	forceMoveMarkers: boolean;
	isAutoWhitespaceEdit: boolean;
}

interface IIdentifiedLineEdit extends ILineEdit{
	lineNumber: number;
}

export class EditableTextModel extends TextModelWithDecorations implements editorCommon.IEditableTextModel {

	public onDidChangeRawContent(listener: (e:editorCommon.IModelContentChangedEvent)=>void): IDisposable {
		return this.addListener2(editorCommon.EventType.ModelRawContentChanged, listener);
	}
	public onDidChangeContent(listener: (e:editorCommon.IModelContentChangedEvent2)=>void): IDisposable {
		return this.addListener2(editorCommon.EventType.ModelContentChanged2, listener);
	}

	private _commandManager:EditStack;

	// for extra details about change events:
	private _isUndoing:boolean;
	private _isRedoing:boolean;

	// editable range
	private _hasEditableRange:boolean;
	private _editableRangeId:string;

	private _trimAutoWhitespaceLines: number[];

	constructor(allowedEventTypes:string[], rawText:editorCommon.IRawText, modeOrPromise:IMode|TPromise<IMode>) {
		allowedEventTypes.push(editorCommon.EventType.ModelRawContentChanged);
		allowedEventTypes.push(editorCommon.EventType.ModelContentChanged2);
		super(allowedEventTypes, rawText, modeOrPromise);

		this._commandManager = new EditStack(this);

		this._isUndoing = false;
		this._isRedoing = false;

		this._hasEditableRange = false;
		this._editableRangeId = null;
		this._trimAutoWhitespaceLines = null;
	}

	public dispose(): void {
		this._commandManager = null;
		super.dispose();
	}

	_resetValue(e:editorCommon.IModelContentChangedFlushEvent, newValue:editorCommon.IRawText): void {
		super._resetValue(e, newValue);

		// Destroy my edit history and settings
		this._commandManager = new EditStack(this);
		this._hasEditableRange = false;
		this._editableRangeId = null;
		this._trimAutoWhitespaceLines = null;
	}

	public pushStackElement(): void {
		this._commandManager.pushStackElement();
	}

	public pushEditOperations(beforeCursorState:Selection[], editOperations:editorCommon.IIdentifiedSingleEditOperation[], cursorStateComputer:editorCommon.ICursorStateComputer): Selection[] {
		return this.deferredEmit(() => {
			if (this._options.trimAutoWhitespace && this._trimAutoWhitespaceLines) {
				// Go through each saved line number and insert a trim whitespace edit
				// if it is safe to do so (no conflicts with other edits).

				let incomingEdits = editOperations.map((op) => {
					return {
						range: this.validateRange(op.range),
						text: op.text
					};
				});

				// Sometimes, auto-formatters change ranges automatically which can cause undesired auto whitespace trimming near the cursor
				// We'll use the following heuristic: if the edits occur near the cursor, then it's ok to trim auto whitespace
				let editsAreNearCursors = true;
				for (let i = 0, len = beforeCursorState.length; i < len; i++) {
					let sel = beforeCursorState[i];
					let foundEditNearSel = false;
					for (let j = 0, lenJ = incomingEdits.length; j < lenJ; j++) {
						let editRange = incomingEdits[j].range;
						let selIsAbove = editRange.startLineNumber > sel.endLineNumber;
						let selIsBelow = sel.startLineNumber > editRange.endLineNumber;
						if (!selIsAbove && !selIsBelow) {
							foundEditNearSel = true;
							break;
						}
					}
					if (!foundEditNearSel) {
						editsAreNearCursors = false;
						break;
					}
				}

				if (editsAreNearCursors) {
					for (let i = 0, len = this._trimAutoWhitespaceLines.length; i < len; i++) {
						let trimLineNumber = this._trimAutoWhitespaceLines[i];
						let maxLineColumn = this.getLineMaxColumn(trimLineNumber);

						let allowTrimLine = true;
						for (let j = 0, lenJ = incomingEdits.length; j < lenJ; j++) {
							let editRange = incomingEdits[j].range;
							let editText = incomingEdits[j].text;

							if (trimLineNumber < editRange.startLineNumber || trimLineNumber > editRange.endLineNumber) {
								// `trimLine` is completely outside this edit
								continue;
							}

							// At this point:
							//   editRange.startLineNumber <= trimLine <= editRange.endLineNumber

							if (
								trimLineNumber === editRange.startLineNumber && editRange.startColumn === maxLineColumn
								&& editRange.isEmpty() && editText && editText.length > 0 && editText.charAt(0) === '\n'
							) {
								// This edit inserts a new line (and maybe other text) after `trimLine`
								continue;
							}

							// Looks like we can't trim this line as it would interfere with an incoming edit
							allowTrimLine = false;
							break;
						}

						if (allowTrimLine) {
							editOperations.push({
								identifier: null,
								range: new Range(trimLineNumber, 1, trimLineNumber, maxLineColumn),
								text: null,
								forceMoveMarkers: false,
								isAutoWhitespaceEdit: false
							});
						}

					}
				}

				this._trimAutoWhitespaceLines = null;
			}
			return this._commandManager.pushEditOperation(beforeCursorState, editOperations, cursorStateComputer);
		});
	}

	/**
	 * Transform operations such that they represent the same logic edit,
	 * but that they also do not cause OOM crashes.
	 */
	private _reduceOperations(operations:IValidatedEditOperation[]): IValidatedEditOperation[] {
		if (operations.length < 1000) {
			// We know from empirical testing that a thousand edits work fine regardless of their shape.
			return operations;
		}

		// At one point, due to how events are emitted and how each operation is handled,
		// some operations can trigger a high ammount of temporary string allocations,
		// that will immediately get edited again.
		// e.g. a formatter inserting ridiculous ammounts of \n on a model with a single line
		// Therefore, the strategy is to collapse all the operations into a huge single edit operation
		return [this._toSingleEditOperation(operations)];
	}

	_toSingleEditOperation(operations:IValidatedEditOperation[]): IValidatedEditOperation {
		let forceMoveMarkers = false,
			firstEditRange = operations[0].range,
			lastEditRange = operations[operations.length-1].range,
			entireEditRange = new Range(firstEditRange.startLineNumber, firstEditRange.startColumn, lastEditRange.endLineNumber, lastEditRange.endColumn),
			lastEndLineNumber = firstEditRange.startLineNumber,
			lastEndColumn = firstEditRange.startColumn,
			result: string[] = [];

		for (let i = 0, len = operations.length; i < len; i++) {
			let operation = operations[i],
				range = operation.range;

			forceMoveMarkers = forceMoveMarkers || operation.forceMoveMarkers;

			// (1) -- Push old text
			for (let lineNumber = lastEndLineNumber; lineNumber < range.startLineNumber; lineNumber++) {
				if (lineNumber === lastEndLineNumber) {
					result.push(this._lines[lineNumber - 1].text.substring(lastEndColumn - 1));
				} else {
					result.push('\n');
					result.push(this._lines[lineNumber - 1].text);
				}
			}

			if (range.startLineNumber === lastEndLineNumber) {
				result.push(this._lines[range.startLineNumber - 1].text.substring(lastEndColumn - 1, range.startColumn - 1));
			} else {
				result.push('\n');
				result.push(this._lines[range.startLineNumber - 1].text.substring(0, range.startColumn - 1));
			}

			// (2) -- Push new text
			if (operation.lines) {
				for (let j = 0, lenJ = operation.lines.length; j < lenJ; j++) {
					if (j !== 0) {
						result.push('\n');
					}
					result.push(operation.lines[j]);
				}
			}

			lastEndLineNumber = operation.range.endLineNumber;
			lastEndColumn = operation.range.endColumn;
		}

		return {
			sortIndex: 0,
			identifier: operations[0].identifier,
			range: entireEditRange,
			rangeLength: this.getValueLengthInRange(entireEditRange),
			lines: result.join('').split('\n'),
			forceMoveMarkers: forceMoveMarkers,
			isAutoWhitespaceEdit: false
		};
	}

	private static _sortOpsAscending(a:IValidatedEditOperation, b:IValidatedEditOperation): number {
		let r = Range.compareRangesUsingEnds(a.range, b.range);
		if (r === 0) {
			return a.sortIndex - b.sortIndex;
		}
		return r;
	}

	private static _sortOpsDescending(a:IValidatedEditOperation, b:IValidatedEditOperation): number {
		let r = Range.compareRangesUsingEnds(a.range, b.range);
		if (r === 0) {
			return b.sortIndex - a.sortIndex;
		}
		return -r;
	}

	public applyEdits(rawOperations:editorCommon.IIdentifiedSingleEditOperation[]): editorCommon.IIdentifiedSingleEditOperation[] {
		if (rawOperations.length === 0) {
			return [];
		}

		let operations:IValidatedEditOperation[] = [];
		for (let i = 0; i < rawOperations.length; i++) {
			let op = rawOperations[i];
			let validatedRange = this.validateRange(op.range);
			operations[i] = {
				sortIndex: i,
				identifier: op.identifier,
				range: validatedRange,
				rangeLength: this.getValueLengthInRange(validatedRange),
				lines: op.text ? op.text.split(/\r\n|\r|\n/) : null,
				forceMoveMarkers: op.forceMoveMarkers,
				isAutoWhitespaceEdit: op.isAutoWhitespaceEdit || false
			};
		}

		// Sort operations ascending
		operations.sort(EditableTextModel._sortOpsAscending);

		for (let i = 0, count = operations.length - 1; i < count; i++) {
			let rangeEnd = operations[i].range.getEndPosition();
			let nextRangeStart = operations[i + 1].range.getStartPosition();

			if (nextRangeStart.isBefore(rangeEnd)) {
				// overlapping ranges
				throw new Error('Overlapping ranges are not allowed!');
			}
		}

		operations = this._reduceOperations(operations);

		let editableRange = this.getEditableRange();
		let editableRangeStart = editableRange.getStartPosition();
		let editableRangeEnd = editableRange.getEndPosition();
		for (let i = 0; i < operations.length; i++) {
			let operationRange = operations[i].range;
			if (!editableRangeStart.isBeforeOrEqual(operationRange.getStartPosition()) || !operationRange.getEndPosition().isBeforeOrEqual(editableRangeEnd)) {
				throw new Error('Editing outside of editable range not allowed!');
			}
		}

		// Delta encode operations
		let reverseRanges = EditableTextModel._getInverseEditRanges(operations);
		let reverseOperations: editorCommon.IIdentifiedSingleEditOperation[] = [];

		let newTrimAutoWhitespaceCandidates: { lineNumber:number,oldContent:string }[] = [];

		for (let i = 0; i < operations.length; i++) {
			let op = operations[i];
			let reverseRange = reverseRanges[i];

			reverseOperations[i] = {
				identifier: op.identifier,
				range: reverseRange,
				text: this.getValueInRange(op.range),
				forceMoveMarkers: op.forceMoveMarkers
			};

			if (this._options.trimAutoWhitespace && op.isAutoWhitespaceEdit && op.range.isEmpty()) {
				// Record already the future line numbers that might be auto whitespace removal candidates on next edit
				for (let lineNumber = reverseRange.startLineNumber; lineNumber <= reverseRange.endLineNumber; lineNumber++) {
					let currentLineContent = '';
					if (lineNumber === reverseRange.startLineNumber) {
						currentLineContent = this.getLineContent(op.range.startLineNumber);
						if (strings.firstNonWhitespaceIndex(currentLineContent) !== -1) {
							continue;
						}
					}
					newTrimAutoWhitespaceCandidates.push({ lineNumber:lineNumber, oldContent:currentLineContent });
				}
			}
		}

		this._applyEdits(operations);

		this._trimAutoWhitespaceLines = null;
		if (this._options.trimAutoWhitespace && newTrimAutoWhitespaceCandidates.length > 0) {
			// sort line numbers auto whitespace removal candidates for next edit descending
			newTrimAutoWhitespaceCandidates.sort((a,b) => b.lineNumber - a.lineNumber);

			this._trimAutoWhitespaceLines = [];
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

				this._trimAutoWhitespaceLines.push(lineNumber);
			}
		}

		return reverseOperations;
	}

	/**
	 * Assumes `operations` are validated and sorted ascending
	 */
	public static _getInverseEditRanges(operations:IValidatedEditOperation[]): Range[] {
		let result:Range[] = [];

		let prevOpEndLineNumber: number;
		let prevOpEndColumn: number;
		let prevOp:IValidatedEditOperation = null;
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

	private _applyEdits(operations:IValidatedEditOperation[]): void {

		// Sort operations descending
		operations.sort(EditableTextModel._sortOpsDescending);


		this._withDeferredEvents((deferredEventsBuilder:DeferredEventsBuilder) => {
			let contentChangedEvents: editorCommon.IModelContentChangedEvent[] = [];
			let contentChanged2Events: editorCommon.IModelContentChangedEvent2[] = [];
			let lineEditsQueue: IIdentifiedLineEdit[] = [];

			let queueLineEdit = (lineEdit:IIdentifiedLineEdit) => {
				if (lineEdit.startColumn === lineEdit.endColumn && lineEdit.text.length === 0) {
					// empty edit => ignore it
					return;
				}
				lineEditsQueue.push(lineEdit);
			};

			let flushLineEdits = () => {
				if (lineEditsQueue.length === 0) {
					return;
				}

				lineEditsQueue.reverse();

				// `lineEditsQueue` now contains edits from smaller (line number,column) to larger (line number,column)
				let currentLineNumber = lineEditsQueue[0].lineNumber;
				let currentLineNumberStart = 0;

				for (let i = 1, len = lineEditsQueue.length; i < len; i++) {
					let lineNumber = lineEditsQueue[i].lineNumber;

					if (lineNumber === currentLineNumber) {
						continue;
					}

					this._invalidateLine(currentLineNumber - 1);
					this._lines[currentLineNumber - 1].applyEdits(deferredEventsBuilder.changedMarkers, lineEditsQueue.slice(currentLineNumberStart, i));
					contentChangedEvents.push(this._createLineChangedEvent(currentLineNumber));

					currentLineNumber = lineNumber;
					currentLineNumberStart = i;
				}

				this._invalidateLine(currentLineNumber - 1);
				this._lines[currentLineNumber - 1].applyEdits(deferredEventsBuilder.changedMarkers, lineEditsQueue.slice(currentLineNumberStart, lineEditsQueue.length));
				contentChangedEvents.push(this._createLineChangedEvent(currentLineNumber));

				lineEditsQueue = [];
			};

			let minTouchedLineNumber = operations[operations.length - 1].range.startLineNumber;
			let maxTouchedLineNumber = operations[0].range.endLineNumber + 1;
			let totalLinesCountDelta = 0;

			for (let i = 0, len = operations.length; i < len; i++) {
				let op = operations[i];

				// console.log();
				// console.log('-------------------');
				// console.log('OPERATION #' + (i));
				// console.log('op: ', op);
				// console.log('<<<\n' + this._lines.map(l => l.text).join('\n') + '\n>>>');

				let startLineNumber = op.range.startLineNumber;
				let startColumn = op.range.startColumn;
				let endLineNumber = op.range.endLineNumber;
				let endColumn = op.range.endColumn;

				if (startLineNumber === endLineNumber && startColumn === endColumn && (!op.lines || op.lines.length === 0)) {
					// no-op
					continue;
				}

				let deletingLinesCnt = endLineNumber - startLineNumber;
				let insertingLinesCnt = (op.lines ? op.lines.length - 1 : 0);
				let editingLinesCnt = Math.min(deletingLinesCnt, insertingLinesCnt);

				totalLinesCountDelta += (insertingLinesCnt - deletingLinesCnt);

				// Iterating descending to overlap with previous op
				// in case there are common lines being edited in both
				for (let j = editingLinesCnt; j >= 0; j--) {
					let editLineNumber = startLineNumber + j;

					queueLineEdit({
						lineNumber: editLineNumber,
						startColumn: (editLineNumber === startLineNumber ? startColumn : 1),
						endColumn: (editLineNumber === endLineNumber ? endColumn : this.getLineMaxColumn(editLineNumber)),
						text: (op.lines ? op.lines[j] : ''),
						forceMoveMarkers: op.forceMoveMarkers
					});
				}

				if (editingLinesCnt < deletingLinesCnt) {
					// Must delete some lines

					// Flush any pending line edits
					flushLineEdits();

					let spliceStartLineNumber = startLineNumber + editingLinesCnt;
					let spliceStartColumn = this.getLineMaxColumn(spliceStartLineNumber);

					let endLineRemains = this._lines[endLineNumber - 1].split(deferredEventsBuilder.changedMarkers, endColumn, false);
					this._invalidateLine(spliceStartLineNumber - 1);

					let spliceCnt = endLineNumber - spliceStartLineNumber;

					// Collect all these markers
					let markersOnDeletedLines: ILineMarker[] = [];
					for (let j = 0; j < spliceCnt; j++) {
						let deleteLineIndex = spliceStartLineNumber + j;
						markersOnDeletedLines = markersOnDeletedLines.concat(this._lines[deleteLineIndex].deleteLine(deferredEventsBuilder.changedMarkers, spliceStartColumn, deleteLineIndex + 1));
					}

					this._lines.splice(spliceStartLineNumber, spliceCnt);

					// Reconstruct first line
					this._lines[spliceStartLineNumber - 1].append(deferredEventsBuilder.changedMarkers, endLineRemains);
					this._lines[spliceStartLineNumber - 1].addMarkers(markersOnDeletedLines);
					contentChangedEvents.push(this._createLineChangedEvent(spliceStartLineNumber));

					contentChangedEvents.push(this._createLinesDeletedEvent(spliceStartLineNumber + 1, spliceStartLineNumber + spliceCnt));
				}

				if (editingLinesCnt < insertingLinesCnt) {
					// Must insert some lines

					// Flush any pending line edits
					flushLineEdits();

					let spliceLineNumber = startLineNumber + editingLinesCnt;
					let spliceColumn = (spliceLineNumber === startLineNumber ? startColumn : 1);
					if (op.lines) {
						spliceColumn += op.lines[editingLinesCnt].length;
					}

					// Split last line
					let leftoverLine = this._lines[spliceLineNumber - 1].split(deferredEventsBuilder.changedMarkers, spliceColumn, op.forceMoveMarkers);
					contentChangedEvents.push(this._createLineChangedEvent(spliceLineNumber));
					this._invalidateLine(spliceLineNumber - 1);

					// Lines in the middle
					let newLinesContent:string[] = [];
					for (let j = editingLinesCnt + 1; j <= insertingLinesCnt; j++) {
						let newLineNumber = startLineNumber + j;
						this._lines.splice(newLineNumber - 1, 0, new ModelLine(newLineNumber, op.lines[j]));
						newLinesContent.push(op.lines[j]);
					}
					newLinesContent[newLinesContent.length - 1] += leftoverLine.text;

					// Last line
					this._lines[startLineNumber + insertingLinesCnt - 1].append(deferredEventsBuilder.changedMarkers, leftoverLine);
					contentChangedEvents.push(this._createLinesInsertedEvent(spliceLineNumber + 1, startLineNumber + insertingLinesCnt, newLinesContent.join('\n')));
				}

				contentChanged2Events.push({
					range: new Range(startLineNumber, startColumn, endLineNumber, endColumn),
					rangeLength: op.rangeLength,
					text: op.lines ? op.lines.join(this.getEOL()) : '',
					eol: this._EOL,
					versionId: -1,
					isUndoing: this._isUndoing,
					isRedoing: this._isRedoing
				});

				// console.log('AFTER:');
				// console.log('<<<\n' + this._lines.map(l => l.text).join('\n') + '\n>>>');
			}

			flushLineEdits();

			maxTouchedLineNumber = Math.max(1, Math.min(this.getLineCount(), maxTouchedLineNumber + totalLinesCountDelta));
			if (totalLinesCountDelta !== 0) {
				// must update line numbers all the way to the bottom
				maxTouchedLineNumber = this.getLineCount();
			}

			for (let lineNumber = minTouchedLineNumber; lineNumber <= maxTouchedLineNumber; lineNumber++) {
				this._lines[lineNumber - 1].updateLineNumber(deferredEventsBuilder.changedMarkers, lineNumber);
			}

			if (contentChangedEvents.length !== 0 || contentChanged2Events.length !== 0) {
				if (contentChangedEvents.length === 0) {
					// Fabricate a fake line changed event to get an event out
					// This most likely occurs when there edit operations are no-ops
					contentChangedEvents.push(this._createLineChangedEvent(minTouchedLineNumber));
				}

				let versionBumps = Math.max(contentChangedEvents.length, contentChanged2Events.length);
				let finalVersionId = this.getVersionId() + versionBumps;
				this._setVersionId(finalVersionId);

				for (let i = contentChangedEvents.length - 1, versionId = finalVersionId; i >= 0; i--, versionId--) {
					contentChangedEvents[i].versionId = versionId;
				}
				for (let i = contentChanged2Events.length - 1, versionId = finalVersionId; i >= 0; i--, versionId--) {
					contentChanged2Events[i].versionId = versionId;
				}

				for (let i = 0, len = contentChangedEvents.length; i < len; i++) {
					this.emit(editorCommon.EventType.ModelRawContentChanged, contentChangedEvents[i]);
				}
				for (let i = 0, len = contentChanged2Events.length; i < len; i++) {
					this.emit(editorCommon.EventType.ModelContentChanged2, contentChanged2Events[i]);
				}
			}

			// this._assertLineNumbersOK();
		});
	}

	public _assertLineNumbersOK(): void {
		let foundMarkersCnt = 0;
		for (let i = 0, len = this._lines.length; i < len; i++) {
			let line = this._lines[i];
			let lineNumber = i + 1;

			if (line.lineNumber !== lineNumber) {
				throw new Error('Invalid lineNumber at line: ' + lineNumber + '; text is: ' + this.getValue());
			}

			let markers = line.getMarkers();
			for (let j = 0, lenJ = markers.length; j < lenJ; j++) {
				foundMarkersCnt++;
				let markerId = markers[j].id;
				let marker = this._markerIdToMarker[markerId];
				if (marker.line !== line) {
					throw new Error('Misplaced marker with id ' + markerId);
				}
			}
		}

		let totalMarkersCnt = Object.keys(this._markerIdToMarker).length;
		if (totalMarkersCnt !== foundMarkersCnt) {
			throw new Error('There are misplaced markers!');
		}
	}

	public undo(): Selection[] {
		return this._withDeferredEvents(() => {
			this._isUndoing = true;
			let r = this._commandManager.undo();
			this._isUndoing = false;

			if (!r) {
				return null;
			}

			this._overwriteAlternativeVersionId(r.recordedVersionId);

			return r.selections;
		});
	}

	public redo(): Selection[] {
		return this._withDeferredEvents(() => {
			this._isRedoing = true;
			let r = this._commandManager.redo();
			this._isRedoing = false;

			if (!r) {
				return null;
			}

			this._overwriteAlternativeVersionId(r.recordedVersionId);

			return r.selections;
		});
	}

	public setEditableRange(range:editorCommon.IRange): void {
		this._commandManager.clear();
		if (this._hasEditableRange) {
			this.removeTrackedRange(this._editableRangeId);
			this._editableRangeId = null;
			this._hasEditableRange = false;
		}

		if (range) {
			this._hasEditableRange = true;
			this._editableRangeId = this.addTrackedRange(range, editorCommon.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges);
		}
	}

	public hasEditableRange(): boolean {
		return this._hasEditableRange;
	}

	public getEditableRange(): Range {
		if (this._hasEditableRange) {
			return this.getTrackedRange(this._editableRangeId);
		} else {
			return this.getFullModelRange();
		}
	}

	private _createLineChangedEvent(lineNumber: number): editorCommon.IModelContentChangedLineChangedEvent {
		return {
			changeType: editorCommon.EventType.ModelRawContentChangedLineChanged,
			lineNumber: lineNumber,
			detail: this._lines[lineNumber - 1].text,
			versionId: -1,
			isUndoing: this._isUndoing,
			isRedoing: this._isRedoing
		};
	}

	private _createLinesDeletedEvent(fromLineNumber: number, toLineNumber: number): editorCommon.IModelContentChangedLinesDeletedEvent {
		return {
			changeType: editorCommon.EventType.ModelRawContentChangedLinesDeleted,
			fromLineNumber: fromLineNumber,
			toLineNumber: toLineNumber,
			versionId: -1,
			isUndoing: this._isUndoing,
			isRedoing: this._isRedoing
		};
	}

	private _createLinesInsertedEvent(fromLineNumber: number, toLineNumber: number, newLinesContent: string): editorCommon.IModelContentChangedLinesInsertedEvent {
		return {
			changeType: editorCommon.EventType.ModelRawContentChangedLinesInserted,
			fromLineNumber: fromLineNumber,
			toLineNumber: toLineNumber,
			detail: newLinesContent,
			versionId: -1,
			isUndoing: this._isUndoing,
			isRedoing: this._isRedoing
		};
	}
}