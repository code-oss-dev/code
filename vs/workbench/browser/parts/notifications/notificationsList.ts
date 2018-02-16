/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/notificationsList';
import { addClass, isAncestor } from 'vs/base/browser/dom';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IListOptions } from 'vs/base/browser/ui/list/listWidget';
import { localize } from 'vs/nls';
import { Themable, NOTIFICATIONS_BORDER, NOTIFICATIONS_LINKS, NOTIFICATIONS_BACKGROUND, NOTIFICATIONS_FOREGROUND } from 'vs/workbench/common/theme';
import { IThemeService, registerThemingParticipant, ITheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { contrastBorder, widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { INotificationViewItem } from 'vs/workbench/common/notifications';
import { NotificationsListDelegate, NotificationRenderer } from 'vs/workbench/browser/parts/notifications/notificationsViewer';
import { NotificationActionRunner } from 'vs/workbench/browser/parts/notifications/notificationsActions';
import { NotificationFocusedContext } from 'vs/workbench/browser/parts/notifications/notificationCommands';

export class NotificationsList extends Themable {
	private listContainer: HTMLElement;
	private list: WorkbenchList<INotificationViewItem>;
	private viewModel: INotificationViewItem[];
	private maxHeight: number;
	private isVisible: boolean;

	constructor(
		private container: HTMLElement,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService
	) {
		super(themeService);

		this.viewModel = [];
	}

	public show(): void {
		if (this.isVisible) {
			this.list.domFocus();

			return; // already visible
		}

		// Lazily create if showing for the first time
		if (!this.list) {
			this.createNotificationsList();
		}

		// Make visible
		this.isVisible = true;

		// Focus
		this.list.domFocus();
	}

	private createNotificationsList(): void {

		// List Container
		this.listContainer = document.createElement('div');
		addClass(this.listContainer, 'notifications-list-container');

		// Notification Renderer
		const renderer = this.instantiationService.createInstance(NotificationRenderer, this.instantiationService.createInstance(NotificationActionRunner));
		this.toUnbind.push(renderer);

		// List
		this.list = this.instantiationService.createInstance(
			WorkbenchList,
			this.listContainer,
			new NotificationsListDelegate(this.listContainer),
			[renderer],
			{
				ariaLabel: localize('notificationsList', "Notifications List")
			} as IListOptions<INotificationViewItem>
		);
		this.toUnbind.push(this.list);

		// Toggle on double click
		this.toUnbind.push(this.list.onMouseDblClick(event => (event.element as INotificationViewItem).toggle()));

		// Context key
		NotificationFocusedContext.bindTo(this.list.contextKeyService);

		// Only allow for focus in notifications, as the
		// selection is too strong over the contents of
		// the notification
		this.toUnbind.push(this.list.onSelectionChange(e => {
			if (e.indexes.length > 0) {
				this.list.setSelection([]);
			}
		}));

		this.container.appendChild(this.listContainer);

		this.updateStyles();
	}

	public updateNotificationsList(start: number, deleteCount: number, items: INotificationViewItem[] = []) {
		const listHasDOMFocus = isAncestor(document.activeElement, this.listContainer);

		// Remember focus
		const focusedIndex = this.list.getFocus()[0];
		const focusedItem = this.viewModel[focusedIndex];

		// Update view model
		this.viewModel.splice(start, deleteCount, ...items);

		// Update list
		this.list.splice(start, deleteCount, items);
		this.list.layout();

		// Hide if no more notifications to show
		if (this.viewModel.length === 0) {
			this.hide();
		}

		// Otherwise restore focus if we had
		else if (typeof focusedIndex === 'number') {
			let indexToFocus = 0;
			if (focusedItem) {
				let indexToFocusCandidate = this.viewModel.indexOf(focusedItem);
				if (indexToFocusCandidate === -1) {
					indexToFocusCandidate = focusedIndex - 1; // item could have been removed
				}

				if (indexToFocusCandidate < this.viewModel.length && indexToFocusCandidate >= 0) {
					indexToFocus = indexToFocusCandidate;
				}
			}

			this.list.setFocus([indexToFocus]);
		}

		// Restore DOM focus if we had focus before
		if (listHasDOMFocus) {
			this.list.domFocus();
		}
	}

	public hide(): void {
		if (!this.isVisible || !this.list) {
			return; // already hidden
		}

		// Hide
		this.isVisible = false;

		// Clear list
		this.list.splice(0, this.viewModel.length);

		// Clear view model
		this.viewModel = [];
	}

	protected updateStyles(): void {
		if (this.listContainer) {
			const foreground = this.getColor(NOTIFICATIONS_FOREGROUND);
			this.listContainer.style.color = foreground ? foreground.toString() : null;

			const background = this.getColor(NOTIFICATIONS_BACKGROUND);
			this.listContainer.style.background = background ? background.toString() : null;

			const outlineColor = this.getColor(contrastBorder);
			this.listContainer.style.outlineColor = outlineColor ? outlineColor.toString() : null;

			const widgetShadowColor = this.getColor(widgetShadow);
			this.listContainer.style.boxShadow = widgetShadowColor ? `0 5px 8px ${widgetShadowColor}` : null;
		}
	}

	public layout(maxHeight: number): void {
		this.maxHeight = maxHeight;

		this.layoutList();
	}

	private layoutList(): void {
		if (this.list) {
			this.list.getHTMLElement().style.maxHeight = `${this.maxHeight}px`;
			this.list.layout();
		}
	}

	public dispose(): void {
		this.hide();

		super.dispose();
	}
}

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {
	const linkColor = theme.getColor(NOTIFICATIONS_LINKS);
	if (linkColor) {
		collector.addRule(`.monaco-workbench .notifications-list-container .notification-list-item .notification-list-item-message a { color: ${linkColor}; }`);
	}

	const notificationBorderColor = theme.getColor(NOTIFICATIONS_BORDER);
	if (notificationBorderColor) {
		collector.addRule(`.monaco-workbench .notifications-list-container .notification-list-item { border-bottom: 1px solid ${notificationBorderColor}; }`);
	}
});
