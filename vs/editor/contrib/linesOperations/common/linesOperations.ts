/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import { KeyCode, KeyMod, KeyChord } from 'vs/base/common/keyCodes';
import { TPromise } from 'vs/base/common/winjs.base';
import { isFalsyOrEmpty } from 'vs/base/common/arrays';
import { SortLinesCommand } from 'vs/editor/contrib/linesOperations/common/sortLinesCommand';
import { getDocumentRangeFormattingEdits } from 'vs/editor/contrib/format/common/format';
import { EditOperationsCommand } from 'vs/editor/contrib/format/common//formatCommand';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { TrimTrailingWhitespaceCommand } from 'vs/editor/common/commands/trimTrailingWhitespaceCommand';
import { EditorContextKeys, Handler, ICommand, ICommonCodeEditor, IIdentifiedSingleEditOperation, CodeEditorStateFlag } from 'vs/editor/common/editorCommon';
import { ReplaceCommand, ReplaceCommandThatPreservesSelection, ReplaceCommandWithOffsetCursorState } from 'vs/editor/common/commands/replaceCommand';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { editorAction, ServicesAccessor, IActionOptions, EditorAction, HandlerEditorAction } from 'vs/editor/common/editorCommonExtensions';
import { CopyLinesCommand } from './copyLinesCommand';
import { DeleteLinesCommand } from './deleteLinesCommand';
import { MoveLinesCommand } from './moveLinesCommand';

// copy lines

abstract class AbstractCopyLinesAction extends EditorAction {

	private down: boolean;

	constructor(down: boolean, opts: IActionOptions) {
		super(opts);
		this.down = down;
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {

		var commands: ICommand[] = [];
		var selections = editor.getSelections();

		for (var i = 0; i < selections.length; i++) {
			commands.push(new CopyLinesCommand(selections[i], this.down));
		}

		editor.executeCommands(this.id, commands);
	}
}

@editorAction
class CopyLinesUpAction extends AbstractCopyLinesAction {
	constructor() {
		super(false, {
			id: 'editor.action.copyLinesUpAction',
			label: nls.localize('lines.copyUp', "Copy Line Up"),
			alias: 'Copy Line Up',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.UpArrow,
				linux: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.UpArrow }
			}
		});
	}
}

@editorAction
class CopyLinesDownAction extends AbstractCopyLinesAction {
	constructor() {
		super(true, {
			id: 'editor.action.copyLinesDownAction',
			label: nls.localize('lines.copyDown', "Copy Line Down"),
			alias: 'Copy Line Down',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.DownArrow,
				linux: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.DownArrow }
			}
		});
	}
}

// move lines

abstract class AbstractMoveLinesAction extends EditorAction {

	private down: boolean;

	constructor(down: boolean, opts: IActionOptions) {
		super(opts);
		this.down = down;
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {

		var commands: ICommand[] = [];
		var selections = editor.getSelections();

		for (var i = 0; i < selections.length; i++) {
			commands.push(new MoveLinesCommand(selections[i], this.down));
		}

		editor.executeCommands(this.id, commands);
	}
}

@editorAction
class MoveLinesUpAction extends AbstractMoveLinesAction {
	constructor() {
		super(false, {
			id: 'editor.action.moveLinesUpAction',
			label: nls.localize('lines.moveUp', "Move Line Up"),
			alias: 'Move Line Up',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.Alt | KeyCode.UpArrow,
				linux: { primary: KeyMod.Alt | KeyCode.UpArrow }
			}
		});
	}
}

@editorAction
class MoveLinesDownAction extends AbstractMoveLinesAction {
	constructor() {
		super(true, {
			id: 'editor.action.moveLinesDownAction',
			label: nls.localize('lines.moveDown', "Move Line Down"),
			alias: 'Move Line Down',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.Alt | KeyCode.DownArrow,
				linux: { primary: KeyMod.Alt | KeyCode.DownArrow }
			}
		});
	}
}

abstract class AbstractSortLinesAction extends EditorAction {
	private descending: boolean;

	constructor(descending: boolean, opts: IActionOptions) {
		super(opts);
		this.descending = descending;
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {

		if (!SortLinesCommand.canRun(editor.getModel(), editor.getSelection(), this.descending)) {
			return;
		}

		var command = new SortLinesCommand(editor.getSelection(), this.descending);

		editor.executeCommands(this.id, [command]);
	}
}

@editorAction
class SortLinesAscendingAction extends AbstractSortLinesAction {
	constructor() {
		super(false, {
			id: 'editor.action.sortLinesAscending',
			label: nls.localize('lines.sortAscending', "Sort Lines Ascending"),
			alias: 'Sort Lines Ascending',
			precondition: EditorContextKeys.Writable
		});
	}
}

@editorAction
class SortLinesDescendingAction extends AbstractSortLinesAction {
	constructor() {
		super(true, {
			id: 'editor.action.sortLinesDescending',
			label: nls.localize('lines.sortDescending', "Sort Lines Descending"),
			alias: 'Sort Lines Descending',
			precondition: EditorContextKeys.Writable
		});
	}
}

@editorAction
export class TrimTrailingWhitespaceAction extends EditorAction {

	public static ID = 'editor.action.trimTrailingWhitespace';

	constructor() {
		super({
			id: TrimTrailingWhitespaceAction.ID,
			label: nls.localize('lines.trimTrailingWhitespace', "Trim Trailing Whitespace"),
			alias: 'Trim Trailing Whitespace',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_X)
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {

		var command = new TrimTrailingWhitespaceCommand(editor.getSelection());

		editor.executeCommands(this.id, [command]);
	}
}

// delete lines

interface IDeleteLinesOperation {
	startLineNumber: number;
	endLineNumber: number;
	positionColumn: number;
}

abstract class AbstractRemoveLinesAction extends EditorAction {
	_getLinesToRemove(editor: ICommonCodeEditor): IDeleteLinesOperation[] {
		// Construct delete operations
		var operations: IDeleteLinesOperation[] = editor.getSelections().map((s) => {

			var endLineNumber = s.endLineNumber;
			if (s.startLineNumber < s.endLineNumber && s.endColumn === 1) {
				endLineNumber -= 1;
			}

			return {
				startLineNumber: s.startLineNumber,
				endLineNumber: endLineNumber,
				positionColumn: s.positionColumn
			};
		});

		// Sort delete operations
		operations.sort((a, b) => {
			return a.startLineNumber - b.startLineNumber;
		});

		// Merge delete operations on consecutive lines
		var mergedOperations: IDeleteLinesOperation[] = [];
		var previousOperation = operations[0];
		for (var i = 1; i < operations.length; i++) {
			if (previousOperation.endLineNumber + 1 === operations[i].startLineNumber) {
				// Merge current operations into the previous one
				previousOperation.endLineNumber = operations[i].endLineNumber;
			} else {
				// Push previous operation
				mergedOperations.push(previousOperation);
				previousOperation = operations[i];
			}
		}
		// Push the last operation
		mergedOperations.push(previousOperation);

		return mergedOperations;
	}
}

@editorAction
class DeleteLinesAction extends AbstractRemoveLinesAction {

	constructor() {
		super({
			id: 'editor.action.deleteLines',
			label: nls.localize('lines.delete', "Delete Line"),
			alias: 'Delete Line',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_K
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {

		var ops = this._getLinesToRemove(editor);

		// Finally, construct the delete lines commands
		var commands: ICommand[] = ops.map((op) => {
			return new DeleteLinesCommand(op.startLineNumber, op.endLineNumber, op.positionColumn);
		});

		editor.executeCommands(this.id, commands);
	}
}

@editorAction
class IndentLinesAction extends HandlerEditorAction {
	constructor() {
		super({
			id: 'editor.action.indentLines',
			label: nls.localize('lines.indent', "Indent Line"),
			alias: 'Indent Line',
			precondition: EditorContextKeys.Writable,
			handlerId: Handler.Indent,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.US_CLOSE_SQUARE_BRACKET
			}
		});
	}
}

@editorAction
class OutdentLinesAction extends HandlerEditorAction {
	constructor() {
		super({
			id: 'editor.action.outdentLines',
			label: nls.localize('lines.outdent', "Outdent Line"),
			alias: 'Outdent Line',
			precondition: EditorContextKeys.Writable,
			handlerId: Handler.Outdent,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.US_OPEN_SQUARE_BRACKET
			}
		});
	}
}

@editorAction
class InsertLineBeforeAction extends HandlerEditorAction {
	constructor() {
		super({
			id: 'editor.action.insertLineBefore',
			label: nls.localize('lines.insertBefore', "Insert Line Above"),
			alias: 'Insert Line Above',
			precondition: EditorContextKeys.Writable,
			handlerId: Handler.LineInsertBefore,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
			}
		});
	}
}

@editorAction
class InsertLineAfterAction extends HandlerEditorAction {
	constructor() {
		super({
			id: 'editor.action.insertLineAfter',
			label: nls.localize('lines.insertAfter', "Insert Line Below"),
			alias: 'Insert Line Below',
			precondition: EditorContextKeys.Writable,
			handlerId: Handler.LineInsertAfter,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.Enter
			}
		});
	}
}

@editorAction
export class DeleteAllLeftAction extends EditorAction {
	constructor() {
		super({
			id: 'deleteAllLeft',
			label: nls.localize('lines.deleteAllLeft', "Delete All Left"),
			alias: 'Delete All Left',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: null,
				mac: { primary: KeyMod.CtrlCmd | KeyCode.Backspace }
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {
		let selections: Range[] = editor.getSelections();

		selections.sort(Range.compareRangesUsingStarts);
		selections = selections.map(selection => {
			if (selection.isEmpty()) {
				return new Selection(selection.startLineNumber, 1, selection.startLineNumber, selection.startColumn);
			} else {
				return selection;
			}
		});

		// merge overlapping selections
		let effectiveRanges: Range[] = [];

		for (let i = 0, count = selections.length - 1; i < count; i++) {
			let range = selections[i];
			let nextRange = selections[i + 1];

			if (Range.intersectRanges(range, nextRange) === null) {
				effectiveRanges.push(range);
			} else {
				selections[i + 1] = Range.plusRange(range, nextRange);
			}
		}

		effectiveRanges.push(selections[selections.length - 1]);

		let edits: IIdentifiedSingleEditOperation[] = effectiveRanges.map(range => {
			return EditOperation.replace(range, '');
		});

		editor.executeEdits(this.id, edits);
	}
}

@editorAction
export class JoinLinesAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.joinLines',
			label: nls.localize('lines.joinLines', "Join Lines"),
			alias: 'Join Lines',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.WinCtrl | KeyCode.KEY_J
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {
		let selection = editor.getSelection();
		let model = editor.getModel();
		let startLineNumber = selection.startLineNumber;
		let startColumn = 1;
		let endLineNumber: number,
			endColumn: number,
			columnDeltaOffset: number;

		let selectionEndPositionOffset = model.getLineContent(selection.endLineNumber).length - selection.endColumn;

		if (selection.isEmpty() || selection.startLineNumber === selection.endLineNumber) {
			let position = selection.getStartPosition();
			if (position.lineNumber < model.getLineCount()) {
				endLineNumber = startLineNumber + 1;
				endColumn = model.getLineMaxColumn(endLineNumber);
			} else {
				endLineNumber = position.lineNumber;
				endColumn = model.getLineMaxColumn(position.lineNumber);
			}
		} else {
			endLineNumber = selection.endLineNumber;
			endColumn = model.getLineMaxColumn(endLineNumber);
		}

		let trimmedLinesContent = model.getLineContent(startLineNumber);

		for (let i = startLineNumber + 1; i <= endLineNumber; i++) {
			let lineText = model.getLineContent(i);
			let firstNonWhitespaceIdx = model.getLineFirstNonWhitespaceColumn(i);

			if (firstNonWhitespaceIdx >= 1) {
				let insertSpace = true;
				if (trimmedLinesContent === '') {
					insertSpace = false;
				}

				if (trimmedLinesContent.charAt(trimmedLinesContent.length - 1) === ' ' ||
					trimmedLinesContent.charAt(trimmedLinesContent.length - 1) === '\t') {
					insertSpace = false;
					trimmedLinesContent = trimmedLinesContent.replace(/[\s\uFEFF\xA0]+$/g, ' ');
				}

				let lineTextWithoutIndent = lineText.substr(firstNonWhitespaceIdx - 1);

				if (lineTextWithoutIndent.charAt(0) === ')') {
					insertSpace = false;
				}

				trimmedLinesContent += (insertSpace ? ' ' : '') + lineTextWithoutIndent;

				if (insertSpace) {
					columnDeltaOffset = lineTextWithoutIndent.length + 1;
				} else {
					columnDeltaOffset = lineTextWithoutIndent.length;
				}
			} else {
				columnDeltaOffset = 0;
			}
		}

		let deleteSelection = new Range(
			startLineNumber,
			startColumn,
			endLineNumber,
			endColumn
		);

		if (!deleteSelection.isEmpty()) {
			if (selection.isEmpty()) {
				editor.executeCommand(this.id,
					new ReplaceCommandWithOffsetCursorState(deleteSelection, trimmedLinesContent, 0, -columnDeltaOffset)
				);
			} else {
				if (selection.startLineNumber === selection.endLineNumber) {
					editor.executeCommand(this.id,
						new ReplaceCommandThatPreservesSelection(deleteSelection, trimmedLinesContent, selection)
					);
				} else {
					editor.executeCommand(this.id, new ReplaceCommand(deleteSelection, trimmedLinesContent));
					editor.setSelection(new Selection(selection.startLineNumber, selection.startColumn,
						selection.startLineNumber, trimmedLinesContent.length - selectionEndPositionOffset));
				}
			}
		}
	}
}

@editorAction
export class TransposeAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.transpose',
			label: nls.localize('editor.transpose', "Transpose characters around the cursor"),
			alias: 'Transpose characters around the cursor',
			precondition: EditorContextKeys.Writable
		});
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {
		let selections = editor.getSelections();
		let model = editor.getModel();
		let commands: ICommand[] = [];

		for (let i = 0, len = selections.length; i < len; i++) {
			let selection = selections[i];
			if (selection.isEmpty()) {
				let cursor = selection.getStartPosition();
				if (cursor.column > model.getLineContent(cursor.lineNumber).length) {
					return;
				}

				let deleteSelection = new Range(cursor.lineNumber, Math.max(1, cursor.column - 1), cursor.lineNumber, cursor.column + 1);
				let chars = model.getValueInRange(deleteSelection).split('').reverse().join('');
				commands.push(new ReplaceCommandThatPreservesSelection(deleteSelection, chars,
					new Selection(cursor.lineNumber, cursor.column + 1, cursor.lineNumber, cursor.column + 1)));
			}
		}

		editor.executeCommands(this.id, commands);
	}
}

@editorAction
class PasteAndFormatAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.pasteAndFormat',
			label: nls.localize('editor.pasteAndFormat', "Paste and format"),
			alias: 'Paste and format',
			precondition: EditorContextKeys.Writable
		});
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): TPromise<void> {
		const originalCursorPosition = editor.getSelection().getStartPosition();

		// 1. paste
		editor.focus();
		document.execCommand('paste');

		const currentCursorPosition = editor.getSelection().getStartPosition();
		const pastedContentRange = new Selection(currentCursorPosition.lineNumber, currentCursorPosition.column, originalCursorPosition.lineNumber, originalCursorPosition.column);

		// 2. format
		const model = editor.getModel();
		const { tabSize, insertSpaces } = model.getOptions();
		const workerService = accessor.get(IEditorWorkerService);
		const formattingPromise = getDocumentRangeFormattingEdits(model, pastedContentRange, { tabSize, insertSpaces });

		if (!formattingPromise) {
			return TPromise.as(void 0);
		}

		const state = editor.captureState(CodeEditorStateFlag.Value, CodeEditorStateFlag.Position);

		return formattingPromise.then(edits => workerService.computeMoreMinimalEdits(editor.getModel().uri, edits, editor.getSelections())).then(edits => {
			if (!state.validate(editor) || isFalsyOrEmpty(edits)) {
				return;
			}

			const command = new EditOperationsCommand(edits, editor.getSelection());
			editor.executeCommand(this.id, command);
			editor.focus();

			// 3. update cursor positions
			let selection = editor.getSelection();
			selection = new Selection(selection.endLineNumber, selection.endColumn, selection.endLineNumber, selection.endColumn);
			editor.setSelection(selection);
		});
	}
}

@editorAction
export class UpperCaseAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.transformToUppercase',
			label: nls.localize('editor.transformToUppercase', "Transform to Uppercase"),
			alias: 'Transform to Uppercase',
			precondition: EditorContextKeys.Writable
		});
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {
		let selections = editor.getSelections();
		let model = editor.getModel();
		let commands: ICommand[] = [];

		for (let i = 0, len = selections.length; i < len; i++) {
			let selection = selections[i];
			if (selection.isEmpty()) {
				let cursor = selection.getStartPosition();
				let word = model.getWordAtPosition(cursor);
				let wordRange = new Range(cursor.lineNumber, word.startColumn, cursor.lineNumber, word.endColumn);

				if (wordRange !== undefined) {
					let text = model.getValueInRange(wordRange);
					commands.push(new ReplaceCommandThatPreservesSelection(wordRange, text.toLocaleUpperCase(),
						new Selection(cursor.lineNumber, cursor.column, cursor.lineNumber, cursor.column)));
				}
			} else {
				let text = model.getValueInRange(selection);
				commands.push(new ReplaceCommandThatPreservesSelection(selection, text.toLocaleUpperCase(), selection));
			}
		}

		editor.executeCommands(this.id, commands);
	}
}

@editorAction
export class LowerCaseAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.transformToLowercase',
			label: nls.localize('editor.transformToLowercase', "Transform to Lowercase"),
			alias: 'Transform to Lowercase',
			precondition: EditorContextKeys.Writable
		});
	}

	public run(accessor: ServicesAccessor, editor: ICommonCodeEditor): void {
		let selections = editor.getSelections();
		let model = editor.getModel();
		let commands: ICommand[] = [];

		for (let i = 0, len = selections.length; i < len; i++) {
			let selection = selections[i];
			if (selection.isEmpty()) {
				let cursor = selection.getStartPosition();
				let word = model.getWordAtPosition(cursor);
				let wordRange = new Range(cursor.lineNumber, word.startColumn, cursor.lineNumber, word.endColumn);

				if (wordRange !== undefined) {
					let text = model.getValueInRange(wordRange);
					commands.push(new ReplaceCommandThatPreservesSelection(wordRange, text.toLocaleLowerCase(),
						new Selection(cursor.lineNumber, cursor.column, cursor.lineNumber, cursor.column)));
				}
			} else {
				let text = model.getValueInRange(selection);
				commands.push(new ReplaceCommandThatPreservesSelection(selection, text.toLocaleLowerCase(), selection));
			}
		}

		editor.executeCommands(this.id, commands);
	}
}
