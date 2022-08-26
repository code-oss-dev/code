/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from 'vs/base/common/resources';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { EditorActivation } from 'vs/platform/editor/common/editor';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { EditorResourceAccessor, EditorInputWithOptions, isEditorInputWithOptions, IUntypedEditorInput, isEditorInput, EditorInputCapabilities, isResourceDiffEditorInput } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { IEditorGroup, GroupsOrder, preferredSideBySideGroupDirection, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { PreferredGroup, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';

/**
 * Finds the target `IEditorGroup` given the instructions provided
 * that is best for the editor and matches the preferred group if
 * possible.
 */
export function findGroup(accessor: ServicesAccessor, editor: IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): [IEditorGroup, EditorActivation | undefined];
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions, preferredGroup: PreferredGroup | undefined): [IEditorGroup, EditorActivation | undefined];
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): [IEditorGroup, EditorActivation | undefined];
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): [IEditorGroup, EditorActivation | undefined] {
	const editorGroupService = accessor.get(IEditorGroupsService);
	const configurationService = accessor.get(IConfigurationService);

	const group = doFindGroup(editor, preferredGroup, editorGroupService, configurationService);

	// Resolve editor activation strategy
	let activation: EditorActivation | undefined = undefined;
	if (
		editorGroupService.activeGroup !== group && 	// only if target group is not already active
		editor.options && !editor.options.inactive &&		// never for inactive editors
		editor.options.preserveFocus &&						// only if preserveFocus
		typeof editor.options.activation !== 'number' &&	// only if activation is not already defined (either true or false)
		preferredGroup !== SIDE_GROUP						// never for the SIDE_GROUP
	) {
		// If the resolved group is not the active one, we typically
		// want the group to become active. There are a few cases
		// where we stay away from encorcing this, e.g. if the caller
		// is already providing `activation`.
		//
		// Specifically for historic reasons we do not activate a
		// group is it is opened as `SIDE_GROUP` with `preserveFocus:true`.
		// repeated Alt-clicking of files in the explorer always open
		// into the same side group and not cause a group to be created each time.
		activation = EditorActivation.ACTIVATE;
	}

	return [group, activation];
}

function doFindGroup(input: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined, editorGroupService: IEditorGroupsService, configurationService: IConfigurationService): IEditorGroup {
	let group: IEditorGroup | undefined;
	const editor = isEditorInputWithOptions(input) ? input.editor : input;
	const options = input.options;

	// Group: Instance of Group
	if (preferredGroup && typeof preferredGroup !== 'number') {
		group = preferredGroup;
	}

	// Group: Specific Group
	else if (typeof preferredGroup === 'number' && preferredGroup >= 0) {
		group = editorGroupService.getGroup(preferredGroup);
	}

	// Group: Side by Side
	else if (preferredGroup === SIDE_GROUP) {
		const direction = preferredSideBySideGroupDirection(configurationService);

		let candidateGroup = editorGroupService.findGroup({ direction });
		if (!candidateGroup || isGroupLockedForEditor(candidateGroup, editor)) {
			// Create new group either when the candidate group
			// is locked or was not found in the direction
			candidateGroup = editorGroupService.addGroup(editorGroupService.activeGroup, direction);
		}

		group = candidateGroup;
	}

	// Group: Unspecified without a specific index to open
	else if (!options || typeof options.index !== 'number') {
		const groupsByLastActive = editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);

		// Respect option to reveal an editor if it is already visible in any group
		if (options?.revealIfVisible) {
			for (const lastActiveGroup of groupsByLastActive) {
				if (isActive(lastActiveGroup, editor)) {
					group = lastActiveGroup;
					break;
				}
			}
		}

		// Respect option to reveal an editor if it is open (not necessarily visible)
		// Still prefer to reveal an editor in a group where the editor is active though.
		// We also try to reveal an editor if it has the `Singleton` capability which
		// indicates that the same editor cannot be opened across groups.
		if (!group) {
			if (options?.revealIfOpened || configurationService.getValue<boolean>('workbench.editor.revealIfOpen') || (isEditorInput(editor) && editor.hasCapability(EditorInputCapabilities.Singleton))) {
				let groupWithInputActive: IEditorGroup | undefined = undefined;
				let groupWithInputOpened: IEditorGroup | undefined = undefined;

				for (const group of groupsByLastActive) {
					if (isOpened(group, editor)) {
						if (!groupWithInputOpened) {
							groupWithInputOpened = group;
						}

						if (!groupWithInputActive && group.isActive(editor)) {
							groupWithInputActive = group;
						}
					}

					if (groupWithInputOpened && groupWithInputActive) {
						break; // we found all groups we wanted
					}
				}

				// Prefer a target group where the input is visible
				group = groupWithInputActive || groupWithInputOpened;
			}
		}
	}

	// Fallback to active group if target not valid but avoid
	// locked editor groups unless editor is already opened there
	if (!group) {
		let candidateGroup = editorGroupService.activeGroup;

		// Locked group: find the next non-locked group
		// going up the neigbours of the group or create
		// a new group otherwise
		if (isGroupLockedForEditor(candidateGroup, editor)) {
			for (const group of editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
				if (isGroupLockedForEditor(group, editor)) {
					continue;
				}

				candidateGroup = group;
				break;
			}

			if (isGroupLockedForEditor(candidateGroup, editor)) {
				// Group is still locked, so we have to create a new
				// group to the side of the candidate group
				group = editorGroupService.addGroup(candidateGroup, preferredSideBySideGroupDirection(configurationService));
			} else {
				group = candidateGroup;
			}
		}

		// Non-locked group: take as is
		else {
			group = candidateGroup;
		}
	}

	return group;
}

function isGroupLockedForEditor(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	if (!group.isLocked) {
		// only relevant for locked editor groups
		return false;
	}

	if (isOpened(group, editor)) {
		// special case: the locked group contains
		// the provided editor. in that case we do not want
		// to open the editor in any different group.
		return false;
	}

	// group is locked for this editor
	return true;
}

function isActive(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	if (!group.activeEditor) {
		return false;
	}

	return matchesEditor(group.activeEditor, editor);
}

function isOpened(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	for (const typedEditor of group.editors) {
		if (matchesEditor(typedEditor, editor)) {
			return true;
		}
	}

	return false;
}

function matchesEditor(typedEditor: EditorInput, editor: EditorInput | IUntypedEditorInput): boolean {
	if (typedEditor.matches(editor)) {
		return true;
	}

	// Note: intentionally doing a "weak" check on the resource
	// because `EditorInput.matches` will not work for untyped
	// editors that have no `override` defined.
	//
	// TODO@lramos15 https://github.com/microsoft/vscode/issues/131619
	if (typedEditor instanceof DiffEditorInput && isResourceDiffEditorInput(editor)) {
		return matchesEditor(typedEditor.primary, editor.modified) && matchesEditor(typedEditor.secondary, editor.original);
	}
	if (typedEditor.resource) {
		return isEqual(typedEditor.resource, EditorResourceAccessor.getCanonicalUri(editor));
	}

	return false;
}
