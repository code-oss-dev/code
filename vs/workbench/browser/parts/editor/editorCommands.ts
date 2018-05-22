/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as types from 'vs/base/common/types';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { TextCompareEditorVisibleContext, EditorInput, IEditorIdentifier, IEditorCommandsContext, ActiveEditorGroupEmptyContext, MultipleEditorGroupsContext, CloseDirection, IEditor, IEditorInput } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { TextDiffEditor } from 'vs/workbench/browser/parts/editor/textDiffEditor';
import { KeyMod, KeyCode, KeyChord } from 'vs/base/common/keyCodes';
import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { IQuickOpenService } from 'vs/platform/quickOpen/common/quickOpen';
import { IDiffEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IListService } from 'vs/platform/list/browser/listService';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { distinct } from 'vs/base/common/arrays';
import { IEditorGroupsService, IEditorGroup, GroupDirection, GroupLocation, GroupsOrder, preferredGroupDirection } from 'vs/workbench/services/group/common/editorGroupsService';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export const MOVE_ACTIVE_EDITOR_COMMAND_ID = 'moveActiveEditor';
export const CLOSE_SAVED_EDITORS_COMMAND_ID = 'workbench.action.closeUnmodifiedEditors';
export const CLOSE_EDITORS_IN_GROUP_COMMAND_ID = 'workbench.action.closeEditorsInGroup';
export const CLOSE_EDITORS_TO_THE_RIGHT_COMMAND_ID = 'workbench.action.closeEditorsToTheRight';
export const CLOSE_EDITOR_COMMAND_ID = 'workbench.action.closeActiveEditor';
export const CLOSE_EDITOR_GROUP_COMMAND_ID = 'workbench.action.closeEditorGroup';
export const CLOSE_OTHER_EDITORS_IN_GROUP_COMMAND_ID = 'workbench.action.closeOtherEditors';
export const KEEP_EDITOR_COMMAND_ID = 'workbench.action.keepEditor';
export const SHOW_EDITORS_IN_GROUP = 'workbench.action.showEditorsInGroup';
export const TOGGLE_DIFF_INLINE_MODE = 'toggle.diff.editorMode';

export const NAVIGATE_ALL_EDITORS_GROUP_PREFIX = 'edt ';
export const NAVIGATE_IN_ACTIVE_GROUP_PREFIX = 'edt active ';

export interface ActiveEditorMoveArguments {
	to?: 'first' | 'last' | 'left' | 'right' | 'up' | 'down' | 'center' | 'position' | 'previous' | 'next';
	by?: 'tab' | 'group';
	value?: number;
}

const isActiveEditorMoveArg = function (arg: ActiveEditorMoveArguments): boolean {
	if (!types.isObject(arg)) {
		return false;
	}

	if (!types.isString(arg.to)) {
		return false;
	}

	if (!types.isUndefined(arg.by) && !types.isString(arg.by)) {
		return false;
	}

	if (!types.isUndefined(arg.value) && !types.isNumber(arg.value)) {
		return false;
	}

	return true;
};

function registerActiveEditorMoveCommand(): void {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: MOVE_ACTIVE_EDITOR_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: EditorContextKeys.editorTextFocus,
		primary: null,
		handler: (accessor, args: any) => moveActiveEditor(args, accessor),
		description: {
			description: nls.localize('editorCommand.activeEditorMove.description', "Move the active editor by tabs or groups"),
			args: [
				{
					name: nls.localize('editorCommand.activeEditorMove.arg.name', "Active editor move argument"),
					description: nls.localize('editorCommand.activeEditorMove.arg.description', "Argument Properties:\n\t* 'to': String value providing where to move.\n\t* 'by': String value providing the unit for move (by tab or by group).\n\t* 'value': Number value providing how many positions or an absolute position to move."),
					constraint: isActiveEditorMoveArg
				}
			]
		}
	});
}

function moveActiveEditor(args: ActiveEditorMoveArguments = Object.create(null), accessor: ServicesAccessor): void {
	args.to = args.to || 'right';
	args.by = args.by || 'tab';
	args.value = typeof args.value === 'number' ? args.value : 1;

	const activeControl = accessor.get(IEditorService).activeControl;
	if (activeControl) {
		switch (args.by) {
			case 'tab':
				return moveActiveTab(args, activeControl, accessor);
			case 'group':
				return moveActiveEditorToGroup(args, activeControl, accessor);
		}
	}
}

function moveActiveTab(args: ActiveEditorMoveArguments, control: IEditor, accessor: ServicesAccessor): void {
	const group = control.group;
	let index = group.getIndexOfEditor(control.input);
	switch (args.to) {
		case 'first':
			index = 0;
			break;
		case 'last':
			index = group.count - 1;
			break;
		case 'left':
			index = index - args.value;
			break;
		case 'right':
			index = index + args.value;
			break;
		case 'center':
			index = Math.round(group.count / 2) - 1;
			break;
		case 'position':
			index = args.value - 1;
			break;
	}

	index = index < 0 ? 0 : index >= group.count ? group.count - 1 : index;
	group.moveEditor(control.input, group, { index });
}

function moveActiveEditorToGroup(args: ActiveEditorMoveArguments, control: IEditor, accessor: ServicesAccessor): void {
	const editorGroupService = accessor.get(IEditorGroupsService);

	const groups = editorGroupService.groups;
	const sourceGroup = control.group;
	let targetGroup: IEditorGroup;

	switch (args.to) {
		case 'left':
			targetGroup = editorGroupService.findGroup({ direction: GroupDirection.LEFT }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, GroupDirection.LEFT);
			}
			break;
		case 'right':
			targetGroup = editorGroupService.findGroup({ direction: GroupDirection.RIGHT }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, GroupDirection.RIGHT);
			}
			break;
		case 'up':
			targetGroup = editorGroupService.findGroup({ direction: GroupDirection.UP }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, GroupDirection.UP);
			}
			break;
		case 'down':
			targetGroup = editorGroupService.findGroup({ direction: GroupDirection.DOWN }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, GroupDirection.DOWN);
			}
			break;
		case 'first':
			targetGroup = editorGroupService.findGroup({ location: GroupLocation.FIRST }, sourceGroup);
			break;
		case 'last':
			targetGroup = editorGroupService.findGroup({ location: GroupLocation.LAST }, sourceGroup);
			break;
		case 'previous':
			targetGroup = editorGroupService.findGroup({ location: GroupLocation.PREVIOUS }, sourceGroup);
			break;
		case 'next':
			targetGroup = editorGroupService.findGroup({ location: GroupLocation.NEXT }, sourceGroup);
			break;
		case 'center':
			targetGroup = groups[(groups.length / 2) - 1];
			break;
		case 'position':
			targetGroup = groups[args.value - 1];
			break;
	}

	if (targetGroup) {
		sourceGroup.moveEditor(control.input, targetGroup);
		targetGroup.focus();
	}
}

function registerDiffEditorCommands(): void {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'workbench.action.compareEditor.nextChange',
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: TextCompareEditorVisibleContext,
		primary: null,
		handler: accessor => navigateInDiffEditor(accessor, true)
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'workbench.action.compareEditor.previousChange',
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: TextCompareEditorVisibleContext,
		primary: null,
		handler: accessor => navigateInDiffEditor(accessor, false)
	});

	function navigateInDiffEditor(accessor: ServicesAccessor, next: boolean): void {
		const editorService = accessor.get(IEditorService);
		const candidates = [editorService.activeControl, ...editorService.visibleControls].filter(e => e instanceof TextDiffEditor);

		if (candidates.length > 0) {
			next ? (<TextDiffEditor>candidates[0]).getDiffNavigator().next() : (<TextDiffEditor>candidates[0]).getDiffNavigator().previous();
		}
	}

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: TOGGLE_DIFF_INLINE_MODE,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: void 0,
		primary: void 0,
		handler: (accessor, resource, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			const { control } = resolveCommandsContext(editorGroupService, context);
			if (control instanceof TextDiffEditor) {
				const widget = control.getControl();
				const isInlineMode = !widget.renderSideBySide;
				widget.updateOptions(<IDiffEditorOptions>{
					renderSideBySide: isInlineMode
				});
			}
		}
	});
}

function registerOpenEditorAtIndexCommands(): void {

	// Keybindings to focus a specific index in the tab folder if tabs are enabled
	for (let i = 0; i < 9; i++) {
		const editorIndex = i;
		const visibleIndex = i + 1;

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: 'workbench.action.openEditorAtIndex' + visibleIndex,
			weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
			when: void 0,
			primary: KeyMod.Alt | toKeyCode(visibleIndex),
			mac: { primary: KeyMod.WinCtrl | toKeyCode(visibleIndex) },
			handler: accessor => {
				const editorService = accessor.get(IEditorService);

				const activeControl = editorService.activeControl;
				if (activeControl) {
					const editor = activeControl.group.getEditor(editorIndex);
					if (editor) {
						return editorService.openEditor(editor).then(() => void 0);
					}
				}

				return void 0;
			}
		});
	}

	function toKeyCode(index: number): KeyCode {
		switch (index) {
			case 0: return KeyCode.KEY_0;
			case 1: return KeyCode.KEY_1;
			case 2: return KeyCode.KEY_2;
			case 3: return KeyCode.KEY_3;
			case 4: return KeyCode.KEY_4;
			case 5: return KeyCode.KEY_5;
			case 6: return KeyCode.KEY_6;
			case 7: return KeyCode.KEY_7;
			case 8: return KeyCode.KEY_8;
			case 9: return KeyCode.KEY_9;
		}

		return void 0;
	}
}

function registerFocusEditorGroupAtIndexCommands(): void {

	// Keybindings to focus a specific group (2-8) in the editor area
	for (let i = 1; i < 8; i++) {
		const groupIndex = i;

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: toCommandId(groupIndex),
			weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
			when: void 0,
			primary: KeyMod.CtrlCmd | toKeyCode(groupIndex),
			handler: accessor => {
				const editorGroupService = accessor.get(IEditorGroupsService);
				const configurationService = accessor.get(IConfigurationService);

				// To keep backwards compatibility (pre-grid), allow to focus a group
				// that does not exist as long as it is the next group after the last
				// opened group. Otherwise we return.
				if (groupIndex > editorGroupService.count) {
					return;
				}

				// Group exists: just focus
				const groups = editorGroupService.getGroups(GroupsOrder.CREATION_TIME);
				if (groups[groupIndex]) {
					return groups[groupIndex].focus();
				}

				// Group does not exist: create new by splitting the active one of the last group
				const direction = preferredGroupDirection(configurationService);
				const lastGroup = editorGroupService.findGroup({ location: GroupLocation.LAST });
				const newGroup = editorGroupService.addGroup(lastGroup, direction);

				// To keep backwards compatibility (pre-grid) we automatically copy the active editor
				// of the last group over to the new group as long as it supports to be split.
				if (lastGroup.activeEditor && (lastGroup.activeEditor as EditorInput).supportsSplitEditor()) {
					lastGroup.copyEditor(lastGroup.activeEditor, newGroup);
				}

				// Focus
				newGroup.focus();
			}
		});
	}

	function toCommandId(index: number): string {
		switch (index) {
			case 1: return 'workbench.action.focusSecondEditorGroup';
			case 2: return 'workbench.action.focusThirdEditorGroup';
			case 3: return 'workbench.action.focusFourthEditorGroup';
			case 4: return 'workbench.action.focusFifthEditorGroup';
			case 5: return 'workbench.action.focusSixthEditorGroup';
			case 6: return 'workbench.action.focusSeventhEditorGroup';
			case 7: return 'workbench.action.focusEighthEditorGroup';
		}

		return void 0;
	}

	function toKeyCode(index: number): KeyCode {
		switch (index) {
			case 1: return KeyCode.KEY_2;
			case 2: return KeyCode.KEY_3;
			case 3: return KeyCode.KEY_4;
			case 4: return KeyCode.KEY_5;
			case 5: return KeyCode.KEY_6;
			case 6: return KeyCode.KEY_7;
			case 7: return KeyCode.KEY_8;
		}

		return void 0;
	}
}

function registerEditorCommands() {

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_SAVED_EDITORS_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: void 0,
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_U),
		handler: (accessor, resource: URI | object, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);
			const contexts = getMultiSelectedEditorContexts(context, accessor.get(IListService), editorGroupService);
			if (contexts.length === 0 && editorGroupService.activeGroup) {
				contexts.push({ groupId: editorGroupService.activeGroup.id }); // If command is triggered from the command palette use the active group
			}

			return TPromise.join(distinct(contexts.map(c => c.groupId)).map(groupId =>
				editorGroupService.getGroup(groupId).closeEditors({ savedOnly: true })
			));
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_EDITORS_IN_GROUP_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: void 0,
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_W),
		handler: (accessor, resource: URI | object, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);
			const contexts = getMultiSelectedEditorContexts(context, accessor.get(IListService), editorGroupService);
			const distinctGroupIds = distinct(contexts.map(c => c.groupId));

			if (distinctGroupIds.length === 0) {
				distinctGroupIds.push(editorGroupService.activeGroup.id);
			}

			return TPromise.join(distinctGroupIds.map(groupId =>
				editorGroupService.getGroup(groupId).closeAllEditors()
			));
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_EDITOR_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: void 0,
		primary: KeyMod.CtrlCmd | KeyCode.KEY_W,
		win: { primary: KeyMod.CtrlCmd | KeyCode.F4, secondary: [KeyMod.CtrlCmd | KeyCode.KEY_W] },
		handler: (accessor, resource: URI | object, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);
			const contexts = getMultiSelectedEditorContexts(context, accessor.get(IListService), editorGroupService);
			const activeGroup = editorGroupService.activeGroup;
			if (contexts.length === 0 && activeGroup && activeGroup.activeEditor) {
				contexts.push({ groupId: activeGroup.id, editorIndex: activeGroup.getIndexOfEditor(activeGroup.activeEditor) });
			}

			const groupIds = distinct(contexts.map(context => context.groupId));
			return TPromise.join(groupIds.map(groupId => {
				const group = editorGroupService.getGroup(groupId);
				const editors = contexts.filter(c => c.groupId === groupId).map(c => group.getEditor(c.editorIndex));
				return group.closeEditors(editors);
			}));
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_EDITOR_GROUP_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: ContextKeyExpr.and(ActiveEditorGroupEmptyContext, MultipleEditorGroupsContext),
		primary: KeyMod.CtrlCmd | KeyCode.KEY_W,
		win: { primary: KeyMod.CtrlCmd | KeyCode.F4, secondary: [KeyMod.CtrlCmd | KeyCode.KEY_W] },
		handler: (accessor, resource: URI | object, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			let group: IEditorGroup;
			if (context && typeof context.groupId === 'number') {
				group = editorGroupService.getGroup(context.groupId);
			} else {
				group = editorGroupService.activeGroup;
			}

			editorGroupService.removeGroup(group);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_OTHER_EDITORS_IN_GROUP_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: void 0,
		primary: void 0,
		mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_T },
		handler: (accessor, resource: URI | object, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);
			const contexts = getMultiSelectedEditorContexts(context, accessor.get(IListService), editorGroupService);

			if (contexts.length === 0) {
				// Cover the case when run from command palette
				const activeGroup = editorGroupService.activeGroup;
				if (activeGroup && activeGroup.activeEditor) {
					contexts.push({ groupId: activeGroup.id, editorIndex: activeGroup.getIndexOfEditor(activeGroup.activeEditor) });
				}
			}

			const groupIds = distinct(contexts.map(context => context.groupId));

			return TPromise.join(groupIds.map(groupId => {
				const group = editorGroupService.getGroup(groupId);
				const editors = contexts.filter(c => c.groupId === groupId).map(c => group.getEditor(c.editorIndex));
				const editorsToClose = group.editors.filter(e => editors.indexOf(e) === -1);

				return group.closeEditors(editorsToClose);
			}));
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_EDITORS_TO_THE_RIGHT_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: void 0,
		primary: void 0,
		handler: (accessor, resource: URI, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			const { group, editor } = resolveCommandsContext(editorGroupService, context);
			if (group && editor) {
				return group.closeEditors({ direction: CloseDirection.RIGHT, except: editor });
			}

			return TPromise.as(false);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: KEEP_EDITOR_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: void 0,
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.Enter),
		handler: (accessor, resource: URI, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			const { group, editor } = resolveCommandsContext(editorGroupService, context);
			if (group && editor) {
				return group.pinEditor(editor);
			}

			return TPromise.as(false);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: SHOW_EDITORS_IN_GROUP,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: void 0,
		primary: void 0,
		handler: (accessor, resource: URI, context: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);
			const quickOpenService = accessor.get(IQuickOpenService);

			if (editorGroupService.count <= 1) {
				return quickOpenService.show(NAVIGATE_ALL_EDITORS_GROUP_PREFIX);
			}

			if (context && typeof context.groupId === 'number') {
				editorGroupService.activateGroup(editorGroupService.getGroup(context.groupId)); // we need the group to be active
			}

			return quickOpenService.show(NAVIGATE_IN_ACTIVE_GROUP_PREFIX);
		}
	});
}

function resolveCommandsContext(editorGroupService: IEditorGroupsService, context?: IEditorCommandsContext): { group: IEditorGroup, editor: IEditorInput, control: IEditor } {

	// Resolve from context
	let group = context && typeof context.groupId === 'number' ? editorGroupService.getGroup(context.groupId) : undefined;
	let editor = group && typeof context.editorIndex === 'number' ? group.getEditor(context.editorIndex) : undefined;
	let control = group ? group.activeControl : undefined;

	// Fallback to active group as needed
	if (!group) {
		group = editorGroupService.activeGroup;
		editor = <EditorInput>group.activeEditor;
		control = group.activeControl;
	}

	return { group, editor, control };
}

export function getMultiSelectedEditorContexts(editorContext: IEditorCommandsContext, listService: IListService, editorGroupService: IEditorGroupsService): IEditorCommandsContext[] {

	// First check for a focused list to return the selected items from
	const list = listService.lastFocusedList;
	if (list instanceof List && list.isDOMFocused()) {
		const elementToContext = (element: IEditorIdentifier | IEditorGroup) => {
			if (isEditorGroup(element)) {
				return { groupId: element.id, editorIndex: void 0 };
			}

			return { groupId: element.groupId, editorIndex: editorGroupService.getGroup(element.groupId).getIndexOfEditor(element.editor) };
		};

		const onlyEditorGroupAndEditor = (e: IEditorIdentifier | IEditorGroup) => isEditorGroup(e) || isEditorIdentifier(e);

		const focusedElements: (IEditorIdentifier | IEditorGroup)[] = list.getFocusedElements().filter(onlyEditorGroupAndEditor);
		const focus = editorContext ? editorContext : focusedElements.length ? focusedElements.map(elementToContext)[0] : void 0; // need to take into account when editor context is { group: group }

		if (focus) {
			const selection: (IEditorIdentifier | IEditorGroup)[] = list.getSelectedElements().filter(onlyEditorGroupAndEditor);

			// Only respect selection if it contains focused element
			if (selection && selection.some(s => isEditorGroup(s) ? s.id === focus.groupId : s.groupId === focus.groupId && editorGroupService.getGroup(s.groupId).getIndexOfEditor(s.editor) === focus.editorIndex)) {
				return selection.map(elementToContext);
			}

			return [focus];
		}
	}

	// Otherwise go with passed in context
	return !!editorContext ? [editorContext] : [];
}

function isEditorGroup(thing: any): thing is IEditorGroup {
	const group = thing as IEditorGroup;

	return group && typeof group.id === 'number' && Array.isArray(group.editors);
}

function isEditorIdentifier(thing: any): thing is IEditorIdentifier {
	const identifier = thing as IEditorIdentifier;

	return identifier && typeof identifier.groupId === 'number';
}

export function setup(): void {
	registerActiveEditorMoveCommand();
	registerDiffEditorCommands();
	registerOpenEditorAtIndexCommands();
	registerEditorCommands();
	registerFocusEditorGroupAtIndexCommands();
}