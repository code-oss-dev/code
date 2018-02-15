/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { RawContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { INotificationViewItem, isNotificationViewItem } from 'vs/workbench/common/notifications';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export const SHOW_NOTFICATIONS_CENTER_COMMAND_ID = 'notifications.show';
export const HIDE_NOTFICATIONS_CENTER_COMMAND_ID = 'notifications.hide';
export const TOGGLE_NOTFICATIONS_CENTER_COMMAND_ID = 'notifications.toggle';
export const COLLAPSE_NOTIFICATION = 'notification.collapse';
export const EXPAND_NOTIFICATION = 'notification.expand';
export const TOGGLE_NOTIFICATION = 'notification.toggle';
export const CLEAR_NOTFICATION = 'notification.clear';
export const CLEAR_ALL_NOTFICATIONS = 'notifications.clearAll';

const notificationsCenterFocusedId = 'notificationsCenterFocus';
export const NotificationsCenterFocusedContext = new RawContextKey<boolean>(notificationsCenterFocusedId, true);

const notificationsCenterVisibleId = 'notificationsCenterVisible';
export const NotificationsCenterVisibleContext = new RawContextKey<boolean>(notificationsCenterVisibleId, false);

export const InNotificationsCenterContext = ContextKeyExpr.and(ContextKeyExpr.has(notificationsCenterFocusedId), ContextKeyExpr.has(notificationsCenterVisibleId));

export interface INotificationsCenterController {
	readonly isVisible: boolean;
	readonly selected: INotificationViewItem;

	show(): void;
	hide(): void;

	clearAll(): void;
}

export function registerNotificationCommands(center: INotificationsCenterController): void {

	function showCenter(): void {
		center.show();
	}

	function hideCenter(accessor: ServicesAccessor): void {

		// Hide center
		center.hide();

		// Restore focus if we got an editor
		const editor = accessor.get(IWorkbenchEditorService).getActiveEditor();
		if (editor) {
			editor.focus();
		}
	}

	// Show Notifications Cneter
	CommandsRegistry.registerCommand(SHOW_NOTFICATIONS_CENTER_COMMAND_ID, () => showCenter());

	// Hide Notifications Center
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: HIDE_NOTFICATIONS_CENTER_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: InNotificationsCenterContext,
		primary: KeyCode.Escape,
		handler: accessor => hideCenter(accessor)
	});

	// Toggle Notifications Center
	CommandsRegistry.registerCommand(TOGGLE_NOTFICATIONS_CENTER_COMMAND_ID, accessor => center.isVisible ? hideCenter(accessor) : showCenter());

	// Clear Notification
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLEAR_NOTFICATION,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: InNotificationsCenterContext,
		primary: KeyCode.Delete,
		mac: {
			primary: KeyMod.CtrlCmd | KeyCode.Backspace
		},
		handler: (accessor, args?: any) => {
			let notification: INotificationViewItem;
			if (isNotificationViewItem(args)) {
				notification = args;
			} else {
				notification = center.selected;
			}

			if (notification) {
				notification.dispose();
			}
		}
	});

	// Expand Notification
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: EXPAND_NOTIFICATION,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: InNotificationsCenterContext,
		primary: KeyCode.RightArrow,
		handler: (accessor, args?: any) => {
			let notification: INotificationViewItem;
			if (isNotificationViewItem(args)) {
				notification = args;
			} else {
				notification = center.selected;
			}

			if (notification) {
				notification.expand();
			}
		}
	});

	// Collapse Notification
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: COLLAPSE_NOTIFICATION,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: InNotificationsCenterContext,
		primary: KeyCode.LeftArrow,
		handler: (accessor, args?: any) => {
			let notification: INotificationViewItem;
			if (isNotificationViewItem(args)) {
				notification = args;
			} else {
				notification = center.selected;
			}

			if (notification) {
				notification.collapse();
			}
		}
	});

	// Toggle Notification
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: TOGGLE_NOTIFICATION,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: InNotificationsCenterContext,
		primary: KeyCode.Space,
		handler: accessor => {
			const notification = center.selected;
			if (notification) {
				if (notification.expanded) {
					notification.collapse();
				} else {
					notification.expand();
				}
			}
		}
	});

	/// Clear All Notifications
	CommandsRegistry.registerCommand(CLEAR_ALL_NOTFICATIONS, () => center.clearAll());

	// Commands for Command Palette
	const category = localize('notifications', "Notifications");
	MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: SHOW_NOTFICATIONS_CENTER_COMMAND_ID, title: localize('showNotifications', "Show Notifications"), category }, when: NotificationsCenterVisibleContext.toNegated() });
	MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: HIDE_NOTFICATIONS_CENTER_COMMAND_ID, title: localize('hideNotifications', "Hide Notifications"), category }, when: NotificationsCenterVisibleContext });
	MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: CLEAR_ALL_NOTFICATIONS, title: localize('clearAllNotifications', "Clear All Notifications"), category } });




	// TODO@Notification remove me
	CommandsRegistry.registerCommand('notifications.showInfo', accessor => {
		accessor.get(INotificationService).info('This is an information message!');
	});

	CommandsRegistry.registerCommand('notifications.showWarning', accessor => {
		accessor.get(INotificationService).warn('This is a warning message!');
	});

	CommandsRegistry.registerCommand('notifications.showError', accessor => {
		accessor.get(INotificationService).error('This is an error message!');
	});
}