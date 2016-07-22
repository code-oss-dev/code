/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as types from 'vs/base/common/types';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorGroupService } from 'vs/workbench/services/group/common/groupService';
import { IWorkbenchEditorConfiguration, ActiveEditorMoveArguments, ActiveEditorMovePositioning, ActiveEditorMovePositioningBy, EditorCommands } from 'vs/workbench/common/editor';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { KbExpr } from 'vs/platform/keybinding/common/keybinding';
import { IEditor, Position, POSITIONS } from 'vs/platform/editor/common/editor';

export function registerEditorComamnds() {
	_registerActiveEditorMoveCommand();
}

let isActiveEditorMoveArg= function(arg): boolean  {
	if (!types.isObject(arg)) {
		return false;
	}

	let activeEditorMoveArg: ActiveEditorMoveArguments = arg;

	if (!types.isString(activeEditorMoveArg.to)) {
		return false;
	}

	if (!types.isUndefined(activeEditorMoveArg.by) && !types.isString(activeEditorMoveArg.by)) {
		return false;
	}

	if (!types.isUndefined(activeEditorMoveArg.amount) && !types.isNumber(activeEditorMoveArg.amount)) {
		return false;
	}

	return true;
};


function _registerActiveEditorMoveCommand() {
	KeybindingsRegistry.registerCommandDesc({
		id: EditorCommands.ActiveEditorMove,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: KbExpr.has(editorCommon.KEYBINDING_CONTEXT_EDITOR_TEXT_FOCUS),
		primary: null,
		handler: (accessor, args: any) => _moveActiveEditor(args, accessor),
		description: {
			description: nls.localize('editorCommand.activeEditorMove.description', "Command to move active editor"),
			args: [
				{
					name: nls.localize('editorCommand.activeEditorMove.arg.name', "Active editor move argument"),
					constraint: isActiveEditorMoveArg
				}
			]
		}
	});
}

function _moveActiveEditor(args: ActiveEditorMoveArguments = {}, accessor: ServicesAccessor) {
	let tabsShown = !!(<IWorkbenchEditorConfiguration>accessor.get(IConfigurationService).getConfiguration()).workbench.editor.showTabs;
	args.by = tabsShown ? args.by || ActiveEditorMovePositioningBy.TAB : ActiveEditorMovePositioningBy.GROUP;
	args.to = args.to || ActiveEditorMovePositioning.RIGHT;
	args.amount = args.amount || 1;

	let activeEditor = accessor.get(IWorkbenchEditorService).getActiveEditor();

	switch (args.by) {
		case ActiveEditorMovePositioningBy.TAB:
			return _moveActiveTab(args, activeEditor, accessor);
		case ActiveEditorMovePositioningBy.GROUP:
			return _moveActiveEditorToGroup(args, activeEditor, accessor);
	}
}

function _moveActiveTab(args: ActiveEditorMoveArguments, activeEditor: IEditor, accessor: ServicesAccessor) {
	let editorGroupsService: IEditorGroupService = accessor.get(IEditorGroupService);
	let editorGroup = editorGroupsService.getStacksModel().getGroup(activeEditor.position);
	let index= editorGroup.indexOf(activeEditor.input);
	switch (args.to) {
		case ActiveEditorMovePositioning.FIRST:
			index = 0;
			break;
		case ActiveEditorMovePositioning.LAST:
			index = editorGroup.count - 1;
			break;
		case ActiveEditorMovePositioning.LEFT:
			index = index - args.amount;
			break;
		case ActiveEditorMovePositioning.RIGHT:
			index = index + args.amount;
			break;
		case ActiveEditorMovePositioning.CENTER:
			index = Math.round(editorGroup.count / 2);
			break;
		case ActiveEditorMovePositioning.POSITION:
			index = args.amount;
			break;
	}
	index = index < 0 ? 0 : index >= editorGroup.count ? editorGroup.count - 1 : index;
	editorGroupsService.moveEditor(activeEditor.input, editorGroup, editorGroup, index);
}

function _moveActiveEditorToGroup(args: ActiveEditorMoveArguments, activeEditor: IEditor, accessor: ServicesAccessor) {
	let newPosition= activeEditor.position;
	switch (args.to) {
		case ActiveEditorMovePositioning.FIRST:
		case ActiveEditorMovePositioning.LEFT:
			newPosition = Position.LEFT;
			break;
		case ActiveEditorMovePositioning.LAST:
		case ActiveEditorMovePositioning.RIGHT:
			newPosition = Position.RIGHT;
			break;
		case ActiveEditorMovePositioning.CENTER:
			newPosition = Position.CENTER;
			break;
		case ActiveEditorMovePositioning.POSITION:
			newPosition = args.amount;
			break;
	}
	newPosition = POSITIONS.indexOf(newPosition) !== -1 ? newPosition : activeEditor.position;
	accessor.get(IEditorGroupService).moveEditor(activeEditor.input, activeEditor.position, newPosition);
}