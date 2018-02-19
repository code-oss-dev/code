/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/notificationsToasts';
import { INotificationsModel, NotificationChangeType, INotificationChangeEvent, INotificationViewItem, NotificationViewItemLabelKind } from 'vs/workbench/common/notifications';
import { IDisposable, dispose, toDisposable } from 'vs/base/common/lifecycle';
import { addClass, removeClass, isAncestor } from 'vs/base/browser/dom';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { NotificationsList } from 'vs/workbench/browser/parts/notifications/notificationsList';
import { Dimension } from 'vs/base/browser/builder';
import { once } from 'vs/base/common/event';
import { IPartService, Parts } from 'vs/workbench/services/part/common/partService';
import { Themable } from 'vs/workbench/common/theme';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { NotificationsToastsVisibleContext } from 'vs/workbench/browser/parts/notifications/notificationCommands';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { localize } from 'vs/nls';
import { Severity } from 'vs/platform/notification/common/notification';

interface INotificationToast {
	list: NotificationsList;
	container: HTMLElement;
	disposeables: IDisposable[];
}

export class NotificationsToasts extends Themable {

	private static MAX_DIMENSIONS = new Dimension(450, 300);

	private static PURGE_TIMEOUT: { [severity: number]: number } = (() => {
		const intervals = Object.create(null);
		intervals[Severity.Info] = 8000;
		intervals[Severity.Warning] = 12000;
		intervals[Severity.Error] = 15000;

		return intervals;
	})();

	private notificationsToastsContainer: HTMLElement;
	private workbenchDimensions: Dimension;
	private isNotificationsCenterVisible: boolean;
	private mapNotificationToToast: Map<INotificationViewItem, INotificationToast>;
	private notificationsToastsVisibleContextKey: IContextKey<boolean>;

	constructor(
		private container: HTMLElement,
		private model: INotificationsModel,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IPartService private partService: IPartService,
		@IThemeService themeService: IThemeService,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(themeService);

		this.mapNotificationToToast = new Map<INotificationViewItem, INotificationToast>();
		this.notificationsToastsVisibleContextKey = NotificationsToastsVisibleContext.bindTo(contextKeyService);

		// Show toast for initial notifications if any
		model.notifications.forEach(notification => this.addToast(notification));

		this.registerListeners();
	}

	private registerListeners(): void {
		this.toUnbind.push(this.model.onDidNotificationChange(e => this.onDidNotificationChange(e)));
	}

	private onDidNotificationChange(e: INotificationChangeEvent): void {
		switch (e.kind) {
			case NotificationChangeType.ADD:
				return this.addToast(e.item);
			case NotificationChangeType.REMOVE:
				return this.removeToast(e.item);
		}
	}

	private addToast(item: INotificationViewItem): void {
		if (this.isNotificationsCenterVisible) {
			return; // do not show toasts while notification center is visibles
		}

		// Lazily create toasts containers
		if (!this.notificationsToastsContainer) {
			this.notificationsToastsContainer = document.createElement('div');
			addClass(this.notificationsToastsContainer, 'notifications-toasts');

			this.container.appendChild(this.notificationsToastsContainer);
		}

		// Make Visible
		addClass(this.notificationsToastsContainer, 'visible');

		const itemDisposeables: IDisposable[] = [];

		// Container
		const notificationToastContainer = document.createElement('div');
		addClass(notificationToastContainer, 'notification-toast');
		this.notificationsToastsContainer.appendChild(notificationToastContainer);
		itemDisposeables.push(toDisposable(() => this.notificationsToastsContainer.removeChild(notificationToastContainer)));

		// Create toast with item and show
		const notificationList = this.instantiationService.createInstance(NotificationsList, notificationToastContainer, { ariaLabel: localize('notificationsToast', "Notification Toast") });
		itemDisposeables.push(notificationList);
		this.mapNotificationToToast.set(item, { list: notificationList, container: notificationToastContainer, disposeables: itemDisposeables });

		// Make visible
		notificationList.show();

		// Layout
		this.layout(this.workbenchDimensions);

		// Show notification
		notificationList.updateNotificationsList(0, 0, [item]);

		// Update when item height changes due to expansion
		itemDisposeables.push(item.onDidExpansionChange(() => {
			notificationList.updateNotificationsList(0, 1, [item]);
		}));

		// Update when item height potentially changes due to label changes
		itemDisposeables.push(item.onDidLabelChange(e => {
			if (e.kind === NotificationViewItemLabelKind.ACTIONS || e.kind === NotificationViewItemLabelKind.MESSAGE) {
				notificationList.updateNotificationsList(0, 1, [item]);
			}
		}));

		// Remove when item gets disposed
		once(item.onDidDispose)(() => {
			this.removeToast(item);
		});

		// Automatically hide collapsed notifications
		if (!item.expanded) {
			let timeoutHandle: number;
			const hideAfterTimeout = () => {
				timeoutHandle = setTimeout(() => {
					if (!notificationList.hasFocus() && !item.expanded) {
						this.removeToast(item);
					} else {
						hideAfterTimeout(); // push out disposal if item has focus or is expanded
					}
				}, NotificationsToasts.PURGE_TIMEOUT[item.severity]);
			};

			hideAfterTimeout();

			itemDisposeables.push(toDisposable(() => clearTimeout(timeoutHandle)));
		}

		// Theming
		this.updateStyles();

		// Context Key
		this.notificationsToastsVisibleContextKey.set(true);

		// Animate In
		notificationToastContainer.style.left = `${NotificationsToasts.MAX_DIMENSIONS.width}px`;
		const animationHandle = setTimeout(() => {
			notificationToastContainer.style.left = '0px';
		});
		itemDisposeables.push(toDisposable(() => clearTimeout(animationHandle)));
	}

	private removeToast(item: INotificationViewItem): void {
		const notificationToast = this.mapNotificationToToast.get(item);
		let focusEditor = false;
		if (notificationToast) {
			const toastHasDOMFocus = isAncestor(document.activeElement, notificationToast.container);
			if (toastHasDOMFocus) {
				focusEditor = !(this.focusNext() || this.focusPrevious()); // focus next if any, otherwise focus editor
			}

			// Listeners
			dispose(notificationToast.disposeables);

			// Remove from Map
			this.mapNotificationToToast.delete(item);
		}

		// Layout if we still have toasts
		if (this.mapNotificationToToast.size > 0) {
			this.layout(this.workbenchDimensions);
		}

		// Otherwise hide if no more toasts to show
		else {
			this.doHide();

			// Move focus to editor as needed
			if (focusEditor) {
				this.focusEditor();
			}
		}
	}

	private focusEditor(): void {
		const editor = this.editorService.getActiveEditor();
		if (editor) {
			editor.focus();
		}
	}

	private removeToasts(): void {
		this.mapNotificationToToast.forEach(toast => dispose(toast.disposeables));
		this.mapNotificationToToast.clear();

		this.doHide();
	}

	private doHide(): void {
		removeClass(this.notificationsToastsContainer, 'visible');

		// Context Key
		this.notificationsToastsVisibleContextKey.set(false);
	}

	public hide(): void {
		const focusEditor = isAncestor(document.activeElement, this.notificationsToastsContainer);

		this.removeToasts();

		if (focusEditor) {
			this.focusEditor();
		}
	}

	public focus(): boolean {
		const toasts = this.getVisibleToasts();
		if (toasts.length > 0) {
			toasts[0].list.focusFirst();

			return true;
		}

		return false;
	}

	public focusNext(): boolean {
		const toasts = this.getVisibleToasts();
		for (let i = 0; i < toasts.length; i++) {
			const toast = toasts[i];
			if (toast.list.hasFocus()) {
				const nextToast = toasts[i + 1];
				if (nextToast) {
					nextToast.list.focusFirst();

					return true;
				}

				break;
			}
		}

		return false;
	}

	public focusPrevious(): boolean {
		const toasts = this.getVisibleToasts();
		for (let i = 0; i < toasts.length; i++) {
			const toast = toasts[i];
			if (toast.list.hasFocus()) {
				const previousToast = toasts[i - 1];
				if (previousToast) {
					previousToast.list.focusFirst();

					return true;
				}

				break;
			}
		}

		return false;
	}

	public update(isCenterVisible: boolean): void {
		if (this.isNotificationsCenterVisible !== isCenterVisible) {
			this.isNotificationsCenterVisible = isCenterVisible;

			// Hide all toasts when the notificationcenter gets visible
			if (this.isNotificationsCenterVisible) {
				this.removeToasts();
			}
		}
	}

	protected updateStyles(): void {
		this.mapNotificationToToast.forEach(toast => {
			const widgetShadowColor = this.getColor(widgetShadow);
			toast.container.style.boxShadow = widgetShadowColor ? `0 2px 8px ${widgetShadowColor}` : null;
		});
	}

	private getVisibleToasts(): INotificationToast[] {
		let notificationToasts: INotificationToast[] = [];
		this.mapNotificationToToast.forEach(toast => notificationToasts.push(toast));
		notificationToasts = notificationToasts.reverse(); // from newest to oldest

		return notificationToasts;
	}

	public layout(dimension: Dimension): void {
		this.workbenchDimensions = dimension;

		let maxWidth = NotificationsToasts.MAX_DIMENSIONS.width;
		let maxHeight = NotificationsToasts.MAX_DIMENSIONS.height;

		let availableWidth = maxWidth;
		let availableHeight = maxHeight;

		if (this.workbenchDimensions) {

			// Make sure notifications are not exceding available width
			availableWidth = this.workbenchDimensions.width;
			availableWidth -= (2 * 8); // adjust for paddings left and right

			// Make sure notifications are not exceeding available height
			availableHeight = this.workbenchDimensions.height;
			if (this.partService.isVisible(Parts.STATUSBAR_PART)) {
				availableHeight -= 22; // adjust for status bar
			}

			if (this.partService.isVisible(Parts.TITLEBAR_PART)) {
				availableHeight -= 22; // adjust for title bar
			}

			availableHeight -= (2 * 12); // adjust for paddings top and bottom
		}

		// Apply width to all toasts
		this.mapNotificationToToast.forEach(toast => toast.list.layout(Math.min(maxWidth, availableWidth)));

		// Hide toasts that exceed height
		let heightToGive = Math.min(maxHeight, availableHeight);
		this.getVisibleToasts().forEach(toast => {

			// In order to measure the client height, the element cannot have display: none
			toast.container.style.opacity = '0';
			toast.container.style.display = 'block';

			heightToGive -= toast.container.clientHeight;

			// Hide or show toast based on available height
			toast.container.style.display = heightToGive >= 0 ? 'block' : 'none';
			toast.container.style.opacity = null;
		});
	}
}