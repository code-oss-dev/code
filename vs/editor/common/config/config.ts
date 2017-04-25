/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { IEditorService } from 'vs/platform/editor/common/editor';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { ICommandAndKeybindingRule, KeybindingsRegistry, IKeybindings } from 'vs/platform/keybinding/common/keybindingsRegistry';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { ICodeEditorService, getCodeEditor } from 'vs/editor/common/services/codeEditorService';
import { CommandsRegistry, ICommandHandler, ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import * as types from 'vs/base/common/types';
import H = editorCommon.Handler;

const CORE_WEIGHT = KeybindingsRegistry.WEIGHT.editorCore();

export namespace EditorScroll {

	const isEditorScrollArgs = function (arg): boolean {
		if (!types.isObject(arg)) {
			return false;
		}

		let scrollArg: RawArguments = arg;

		if (!types.isString(scrollArg.to)) {
			return false;
		}

		if (!types.isUndefined(scrollArg.by) && !types.isString(scrollArg.by)) {
			return false;
		}

		if (!types.isUndefined(scrollArg.value) && !types.isNumber(scrollArg.value)) {
			return false;
		}

		if (!types.isUndefined(scrollArg.revealCursor) && !types.isBoolean(scrollArg.revealCursor)) {
			return false;
		}

		return true;
	};

	export const description = <ICommandHandlerDescription>{
		description: 'Scroll editor in the given direction',
		args: [
			{
				name: 'Editor scroll argument object',
				description: `Property-value pairs that can be passed through this argument:
					* 'to': A mandatory direction value.
						\`\`\`
						'up', 'down'
						\`\`\`
					* 'by': Unit to move. Default is computed based on 'to' value.
						\`\`\`
						'line', 'wrappedLine', 'page', 'halfPage'
						\`\`\`
					* 'value': Number of units to move. Default is '1'.
					* 'revealCursor': If 'true' reveals the cursor if it is outside view port.
				`,
				constraint: isEditorScrollArgs
			}
		]
	};

	/**
	 * Directions in the view for editor scroll command.
	 */
	export const RawDirection = {
		Up: 'up',
		Down: 'down',
	};

	/**
	 * Units for editor scroll 'by' argument
	 */
	export const RawUnit = {
		Line: 'line',
		WrappedLine: 'wrappedLine',
		Page: 'page',
		HalfPage: 'halfPage'
	};

	/**
	 * Arguments for editor scroll command
	 */
	export interface RawArguments {
		to: string;
		by?: string;
		value?: number;
		revealCursor?: boolean;
	};

	export function parse(args: RawArguments): ParsedArguments {
		let direction: Direction;
		switch (args.to) {
			case RawDirection.Up:
				direction = Direction.Up;
				break;
			case RawDirection.Down:
				direction = Direction.Down;
				break;
			default:
				// Illegal arguments
				return null;
		}

		let unit: Unit;
		switch (args.by) {
			case RawUnit.Line:
				unit = Unit.Line;
				break;
			case RawUnit.WrappedLine:
				unit = Unit.WrappedLine;
				break;
			case RawUnit.Page:
				unit = Unit.Page;
				break;
			case RawUnit.HalfPage:
				unit = Unit.HalfPage;
				break;
			default:
				unit = Unit.WrappedLine;
		}

		const value = Math.floor(args.value || 1);
		const revealCursor = !!args.revealCursor;

		return {
			direction: direction,
			unit: unit,
			value: value,
			revealCursor: revealCursor
		};
	}

	export interface ParsedArguments {
		direction: Direction;
		unit: Unit;
		value: number;
		revealCursor: boolean;
	}

	export const enum Direction {
		Up = 1,
		Down = 2
	}

	export const enum Unit {
		Line = 1,
		WrappedLine = 2,
		Page = 3,
		HalfPage = 4
	}
}

export namespace RevealLine {

	const isRevealLineArgs = function (arg): boolean {
		if (!types.isObject(arg)) {
			return false;
		}

		let reveaLineArg: RawArguments = arg;

		if (!types.isNumber(reveaLineArg.lineNumber)) {
			return false;
		}

		if (!types.isUndefined(reveaLineArg.at) && !types.isString(reveaLineArg.at)) {
			return false;
		}

		return true;
	};

	export const description = <ICommandHandlerDescription>{
		description: 'Reveal the given line at the given logical position',
		args: [
			{
				name: 'Reveal line argument object',
				description: `Property-value pairs that can be passed through this argument:
					* 'lineNumber': A mandatory line number value.
					* 'at': Logical position at which line has to be revealed .
						\`\`\`
						'top', 'center', 'bottom'
						\`\`\`
				`,
				constraint: isRevealLineArgs
			}
		]
	};

	/**
	 * Arguments for reveal line command
	 */
	export interface RawArguments {
		lineNumber?: number;
		at?: string;
	};

	/**
	 * Values for reveal line 'at' argument
	 */
	export const RawAtArgument = {
		Top: 'top',
		Center: 'center',
		Bottom: 'bottom'
	};
}

export interface ICommandKeybindingsOptions extends IKeybindings {
	kbExpr?: ContextKeyExpr;
	weight?: number;
}

export interface ICommandOptions {
	id: string;
	precondition: ContextKeyExpr;
	kbOpts?: ICommandKeybindingsOptions;
	description?: ICommandHandlerDescription;
}

export abstract class Command {
	public id: string;
	public precondition: ContextKeyExpr;
	private kbOpts: ICommandKeybindingsOptions;
	private description: ICommandHandlerDescription;

	constructor(opts: ICommandOptions) {
		this.id = opts.id;
		this.precondition = opts.precondition;
		this.kbOpts = opts.kbOpts;
		this.description = opts.description;
	}

	public abstract runCommand(accessor: ServicesAccessor, args: any): void | TPromise<void>;

	public toCommandAndKeybindingRule(defaultWeight: number): ICommandAndKeybindingRule {
		const kbOpts = this.kbOpts || { primary: 0 };

		let kbWhen = kbOpts.kbExpr;
		if (this.precondition) {
			if (kbWhen) {
				kbWhen = ContextKeyExpr.and(kbWhen, this.precondition);
			} else {
				kbWhen = this.precondition;
			}
		}

		return {
			id: this.id,
			handler: (accessor, args) => this.runCommand(accessor, args),
			weight: kbOpts.weight || defaultWeight,
			when: kbWhen,
			primary: kbOpts.primary,
			secondary: kbOpts.secondary,
			win: kbOpts.win,
			linux: kbOpts.linux,
			mac: kbOpts.mac,
			description: this.description
		};
	}
}

export interface EditorControllerCommand<T extends editorCommon.IEditorContribution> {
	new (opts: IContributionCommandOptions<T>): EditorCommand;
}

export interface IContributionCommandOptions<T> extends ICommandOptions {
	handler: (controller: T) => void;
}

export abstract class EditorCommand extends Command {

	public static bindToContribution<T extends editorCommon.IEditorContribution>(controllerGetter: (editor: editorCommon.ICommonCodeEditor) => T): EditorControllerCommand<T> {

		return class EditorControllerCommandImpl extends EditorCommand {
			private _callback: (controller: T) => void;

			constructor(opts: IContributionCommandOptions<T>) {
				super(opts);

				this._callback = opts.handler;
			}

			public runEditorCommand(accessor: ServicesAccessor, editor: editorCommon.ICommonCodeEditor, args: any): void {
				let controller = controllerGetter(editor);
				if (controller) {
					this._callback(controllerGetter(editor));
				}
			}
		};
	}

	constructor(opts: ICommandOptions) {
		super(opts);
	}

	public runCommand(accessor: ServicesAccessor, args: any): void | TPromise<void> {
		let editor = findFocusedEditor(this.id, accessor, false);
		if (!editor) {
			editor = getActiveEditorWidget(accessor);
		}
		if (!editor) {
			// well, at least we tried...
			return;
		}
		return editor.invokeWithinContext((editorAccessor) => {
			const kbService = editorAccessor.get(IContextKeyService);
			if (!kbService.contextMatchesRules(this.precondition)) {
				// precondition does not hold
				return;
			}

			return this.runEditorCommand(editorAccessor, editor, args);
		});
	}

	public abstract runEditorCommand(accessor: ServicesAccessor, editor: editorCommon.ICommonCodeEditor, args: any): void | TPromise<void>;
}

export function findFocusedEditor(commandId: string, accessor: ServicesAccessor, complain: boolean): editorCommon.ICommonCodeEditor {
	let editor = accessor.get(ICodeEditorService).getFocusedCodeEditor();
	if (!editor) {
		if (complain) {
			console.warn('Cannot execute ' + commandId + ' because no code editor is focused.');
		}
		return null;
	}
	return editor;
}

function withCodeEditorFromCommandHandler(commandId: string, accessor: ServicesAccessor, callback: (editor: editorCommon.ICommonCodeEditor) => void): void {
	let editor = findFocusedEditor(commandId, accessor, true);
	if (editor) {
		callback(editor);
	}
}

function getActiveEditorWidget(accessor: ServicesAccessor): editorCommon.ICommonCodeEditor {
	const editorService = accessor.get(IEditorService);
	let activeEditor = (<any>editorService).getActiveEditor && (<any>editorService).getActiveEditor();
	return getCodeEditor(activeEditor);
}

function triggerEditorHandler(handlerId: string, accessor: ServicesAccessor, args: any): void {
	withCodeEditorFromCommandHandler(handlerId, accessor, (editor) => {
		editor.trigger('keyboard', handlerId, args);
	});
}

class CoreCommand extends Command {
	public runCommand(accessor: ServicesAccessor, args: any): void {
		triggerEditorHandler(this.id, accessor, args);
	}
}

class UnboundCoreCommand extends CoreCommand {
	constructor(handlerId: string, precondition: ContextKeyExpr = null) {
		super({
			id: handlerId,
			precondition: precondition
		});
	}
}

function registerCommand(command: Command) {
	KeybindingsRegistry.registerCommandAndKeybindingRule(command.toCommandAndKeybindingRule(CORE_WEIGHT));
}

function registerCoreAPICommand(handlerId: string, description: ICommandHandlerDescription): void {
	CommandsRegistry.registerCommand(handlerId, {
		handler: triggerEditorHandler.bind(null, handlerId),
		description: description
	});
}

function registerOverwritableCommand(handlerId: string, handler: ICommandHandler): void {
	CommandsRegistry.registerCommand(handlerId, handler);
	CommandsRegistry.registerCommand('default:' + handlerId, handler);
}

function registerCoreDispatchCommand(handlerId: string): void {
	registerOverwritableCommand(handlerId, triggerEditorHandler.bind(null, handlerId));
}
registerCoreDispatchCommand(H.Type);
registerCoreDispatchCommand(H.ReplacePreviousChar);
registerCoreDispatchCommand(H.CompositionStart);
registerCoreDispatchCommand(H.CompositionEnd);
registerCoreDispatchCommand(H.Paste);
registerCoreDispatchCommand(H.Cut);


// https://support.apple.com/en-gb/HT201236
// [ADDED] Control-H					Delete the character to the left of the insertion point. Or use Delete.
// [ADDED] Control-D					Delete the character to the right of the insertion point. Or use Fn-Delete.
// [ADDED] Control-K					Delete the text between the insertion point and the end of the line or paragraph.
// [ADDED] Command–Up Arrow				Move the insertion point to the beginning of the document.
// [ADDED] Command–Down Arrow			Move the insertion point to the end of the document.
// [ADDED] Command–Left Arrow			Move the insertion point to the beginning of the current line.
// [ADDED] Command–Right Arrow			Move the insertion point to the end of the current line.
// [ADDED] Option–Left Arrow			Move the insertion point to the beginning of the previous word.
// [ADDED] Option–Right Arrow			Move the insertion point to the end of the next word.
// [ADDED] Command–Shift–Up Arrow		Select the text between the insertion point and the beginning of the document.
// [ADDED] Command–Shift–Down Arrow		Select the text between the insertion point and the end of the document.
// [ADDED] Command–Shift–Left Arrow		Select the text between the insertion point and the beginning of the current line.
// [ADDED] Command–Shift–Right Arrow	Select the text between the insertion point and the end of the current line.
// [USED BY DUPLICATE LINES] Shift–Option–Up Arrow		Extend text selection to the beginning of the current paragraph, then to the beginning of the following paragraph if pressed again.
// [USED BY DUPLICATE LINES] Shift–Option–Down Arrow	Extend text selection to the end of the current paragraph, then to the end of the following paragraph if pressed again.
// [ADDED] Shift–Option–Left Arrow		Extend text selection to the beginning of the current word, then to the beginning of the following word if pressed again.
// [ADDED] Shift–Option–Right Arrow		Extend text selection to the end of the current word, then to the end of the following word if pressed again.
// [ADDED] Control-A					Move to the beginning of the line or paragraph.
// [ADDED] Control-E					Move to the end of a line or paragraph.
// [ADDED] Control-F					Move one character forward.
// [ADDED] Control-B					Move one character backward.
//Control-L								Center the cursor or selection in the visible area.
// [ADDED] Control-P					Move up one line.
// [ADDED] Control-N					Move down one line.
// [ADDED] Control-O					Insert a new line after the insertion point.
//Control-T								Swap the character behind the insertion point with the character in front of the insertion point.
// Unconfirmed????
//	Config.addKeyBinding(editorCommon.Handler.CursorPageDown,		KeyMod.WinCtrl | KeyCode.KEY_V);

// OS X built in commands
// Control+y => yank
// [ADDED] Command+backspace => Delete to Hard BOL
// [ADDED] Command+delete => Delete to Hard EOL
// [ADDED] Control+k => Delete to Hard EOL
// Control+l => show_at_center
// Control+Command+d => noop
// Control+Command+shift+d => noop

// Register cursor commands

registerCommand(new CoreCommand({
	id: H.ExpandLineSelection,
	precondition: null,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyMod.CtrlCmd | KeyCode.KEY_I
	}
}));

registerCoreAPICommand(H.EditorScroll, EditorScroll.description);

registerCommand(new CoreCommand({
	id: H.ScrollLineUp,
	precondition: null,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyMod.CtrlCmd | KeyCode.UpArrow,
		mac: { primary: KeyMod.WinCtrl | KeyCode.PageUp }
	}
}));
registerCommand(new CoreCommand({
	id: H.ScrollLineDown,
	precondition: null,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyMod.CtrlCmd | KeyCode.DownArrow,
		mac: { primary: KeyMod.WinCtrl | KeyCode.PageDown }
	}
}));

registerCommand(new CoreCommand({
	id: H.ScrollPageUp,
	precondition: null,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyMod.CtrlCmd | KeyCode.PageUp,
		win: { primary: KeyMod.Alt | KeyCode.PageUp },
		linux: { primary: KeyMod.Alt | KeyCode.PageUp }
	}
}));
registerCommand(new CoreCommand({
	id: H.ScrollPageDown,
	precondition: null,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyMod.CtrlCmd | KeyCode.PageDown,
		win: { primary: KeyMod.Alt | KeyCode.PageDown },
		linux: { primary: KeyMod.Alt | KeyCode.PageDown }
	}
}));

registerCoreAPICommand(H.RevealLine, RevealLine.description);

registerCommand(new CoreCommand({
	id: H.Tab,
	precondition: EditorContextKeys.writable,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: ContextKeyExpr.and(
			EditorContextKeys.textFocus,
			EditorContextKeys.tabDoesNotMoveFocus
		),
		primary: KeyCode.Tab
	}
}));
registerCommand(new CoreCommand({
	id: H.Outdent,
	precondition: EditorContextKeys.writable,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: ContextKeyExpr.and(
			EditorContextKeys.textFocus,
			EditorContextKeys.tabDoesNotMoveFocus
		),
		primary: KeyMod.Shift | KeyCode.Tab
	}
}));

registerCommand(new CoreCommand({
	id: H.DeleteLeft,
	precondition: EditorContextKeys.writable,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyCode.Backspace,
		secondary: [KeyMod.Shift | KeyCode.Backspace],
		mac: { primary: KeyCode.Backspace, secondary: [KeyMod.Shift | KeyCode.Backspace, KeyMod.WinCtrl | KeyCode.KEY_H, KeyMod.WinCtrl | KeyCode.Backspace] }
	}
}));
registerCommand(new CoreCommand({
	id: H.DeleteRight,
	precondition: EditorContextKeys.writable,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyCode.Delete,
		mac: { primary: KeyCode.Delete, secondary: [KeyMod.WinCtrl | KeyCode.KEY_D, KeyMod.WinCtrl | KeyCode.Delete] }
	}
}));

registerCommand(new CoreCommand({
	id: H.CancelSelection,
	precondition: EditorContextKeys.hasNonEmptySelection,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));
registerCommand(new CoreCommand({
	id: H.RemoveSecondaryCursors,
	precondition: EditorContextKeys.hasMultipleSelections,
	kbOpts: {
		weight: CORE_WEIGHT + 1,
		kbExpr: EditorContextKeys.textFocus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));

registerCommand(new CoreCommand({
	id: H.LineBreakInsert,
	precondition: EditorContextKeys.writable,
	kbOpts: {
		weight: CORE_WEIGHT,
		kbExpr: EditorContextKeys.textFocus,
		primary: null,
		mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_O }
	}
}));

abstract class BaseTextInputAwareCommand extends Command {

	public runCommand(accessor: ServicesAccessor, args: any): void {
		let HANDLER = this.getEditorHandler();

		let focusedEditor = findFocusedEditor(HANDLER, accessor, false);
		// Only if editor text focus (i.e. not if editor has widget focus).
		if (focusedEditor && focusedEditor.isFocused()) {
			focusedEditor.trigger('keyboard', HANDLER, args);
			return;
		}

		// Ignore this action when user is focussed on an element that allows for entering text
		let activeElement = <HTMLElement>document.activeElement;
		if (activeElement && ['input', 'textarea'].indexOf(activeElement.tagName.toLowerCase()) >= 0) {
			document.execCommand(this.getInputHandler());
			return;
		}

		// Redirecting to last active editor
		let activeEditor = getActiveEditorWidget(accessor);
		if (activeEditor) {
			activeEditor.focus();
			activeEditor.trigger('keyboard', HANDLER, args);
			return;
		}
	}

	protected abstract getEditorHandler(): string;

	protected abstract getInputHandler(): string;
}

class SelectAllCommand extends BaseTextInputAwareCommand {

	constructor() {
		super({
			id: 'editor.action.selectAll',
			precondition: null,
			kbOpts: {
				weight: CORE_WEIGHT,
				kbExpr: null,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_A
			}
		});
	}

	protected getEditorHandler(): string {
		return editorCommon.Handler.SelectAll;
	}

	protected getInputHandler(): string {
		return 'selectAll';
	}
}
registerCommand(new SelectAllCommand());

class UndoCommand extends BaseTextInputAwareCommand {

	constructor() {
		super({
			id: H.Undo,
			precondition: EditorContextKeys.writable,
			kbOpts: {
				weight: CORE_WEIGHT,
				kbExpr: EditorContextKeys.textFocus,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_Z
			}
		});
	}

	protected getEditorHandler(): string {
		return H.Undo;
	}

	protected getInputHandler(): string {
		return 'undo';
	}
}
registerCommand(new UndoCommand());

class RedoCommand extends BaseTextInputAwareCommand {

	constructor() {
		super({
			id: H.Redo,
			precondition: EditorContextKeys.writable,
			kbOpts: {
				weight: CORE_WEIGHT,
				kbExpr: EditorContextKeys.textFocus,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_Y,
				secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z],
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z }
			}
		});
	}

	protected getEditorHandler(): string {
		return H.Redo;
	}

	protected getInputHandler(): string {
		return 'redo';
	}
}
registerCommand(new RedoCommand());