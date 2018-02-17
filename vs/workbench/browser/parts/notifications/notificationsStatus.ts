/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { INotificationsModel, INotificationChangeEvent, NotificationChangeType } from 'vs/workbench/common/notifications';
import { IStatusbarService, StatusbarAlignment } from 'vs/platform/statusbar/common/statusbar';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { HIDE_NOTIFICATIONS_CENTER_COMMAND_ID, SHOW_NOTIFICATIONS_CENTER_COMMAND_ID } from 'vs/workbench/browser/parts/notifications/notificationCommands';
import { localize } from 'vs/nls';

export class NotificationsStatus {
	private statusItem: IDisposable;
	private toDispose: IDisposable[];
	private isNotificationsCenterVisible: boolean;

	constructor(
		private model: INotificationsModel,
		@IStatusbarService private statusbarService: IStatusbarService
	) {
		this.toDispose = [];

		this.registerListeners();
	}

	public update(isCenterVisible: boolean): void {
		if (this.isNotificationsCenterVisible !== isCenterVisible) {
			this.isNotificationsCenterVisible = isCenterVisible;
			this.updateNotificationsStatusItem();
		}
	}

	private registerListeners(): void {
		this.toDispose.push(this.model.onDidNotificationChange(e => this.onDidNotificationChange(e)));
	}

	private onDidNotificationChange(e: INotificationChangeEvent): void {
		if (e.kind === NotificationChangeType.CHANGE) {
			return; // only interested in add or remove
		}

		this.updateNotificationsStatusItem();
	}

	private updateNotificationsStatusItem(): void {

		// Dispose old first
		if (this.statusItem) {
			this.statusItem.dispose();
		}

		// Create new
		const notificationsCount = this.model.notifications.length;
		if (notificationsCount > 0) {
			this.statusItem = this.statusbarService.addEntry({
				text: this.isNotificationsCenterVisible ? '$(megaphone) ' + localize('hideNotifications', "Hide Notifications") : `$(megaphone) ${notificationsCount}`,
				command: this.isNotificationsCenterVisible ? HIDE_NOTIFICATIONS_CENTER_COMMAND_ID : SHOW_NOTIFICATIONS_CENTER_COMMAND_ID,
				tooltip: this.isNotificationsCenterVisible ? localize('hideNotifications', "Hide Notifications") : localize('notifications', "{0} notifications", notificationsCount)
			}, StatusbarAlignment.RIGHT, -1000 /* towards the far end of the right hand side */);
		}
	}

	public dispose() {
		this.toDispose = dispose(this.toDispose);
	}
}