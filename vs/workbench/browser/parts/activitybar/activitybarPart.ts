/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/activitybarpart';
import nls = require('vs/nls');
import { TPromise } from 'vs/base/common/winjs.base';
import Event, { Emitter } from 'vs/base/common/event';
import { Builder, $ } from 'vs/base/browser/builder';
import { Action } from 'vs/base/common/actions';
import errors = require('vs/base/common/errors');
import { ActionsOrientation, ActionBar, IActionItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { Registry } from 'vs/platform/platform';
import { IComposite } from 'vs/workbench/common/composite';
import { ViewletDescriptor, ViewletRegistry, Extensions as ViewletExtensions } from 'vs/workbench/browser/viewlet';
import { Part } from 'vs/workbench/browser/part';
import { ActivityAction, ActivityActionItem } from 'vs/workbench/browser/parts/activitybar/activityAction';
import { IViewletService } from 'vs/workbench/services/viewlet/common/viewletService';
import { IActivityService, IBadge } from 'vs/workbench/services/activity/common/activityService';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IStorageService } from 'vs/platform/storage/common/storage';

export class ActivitybarPart extends Part implements IActivityService {
	public _serviceBrand: any;
	private viewletSwitcherBar: ActionBar;
	private activityActionItems: { [actionId: string]: IActionItem; };
	private compositeIdToActions: { [compositeId: string]: ActivityAction; };

	private viewletsToggleStatus: { [viewletId: string]: boolean; };
	private registeredViewlets: string[];

	private externalViewletIdToOpen: string;

	private VIEWLETS_TOGGLE_STATUS = 'workbench.activityBar.viewletsToggleStatus';

	constructor(
		id: string,
		@IViewletService private viewletService: IViewletService,
		@IKeybindingService private keybindingService: IKeybindingService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IPartService private partService: IPartService,
		@IStorageService private storageService: IStorageService
	) {
		super(id);

		this.activityActionItems = {};
		this.compositeIdToActions = {};

		const viewletsToggleStatusJson = this.storageService.get(this.VIEWLETS_TOGGLE_STATUS);
		this.viewletsToggleStatus = viewletsToggleStatusJson ? JSON.parse(viewletsToggleStatusJson) : {};

		this.registeredViewlets = [];

		this.registerListeners();
	}

	private registerListeners(): void {

		// Activate viewlet action on opening of a viewlet
		this.toUnbind.push(this.viewletService.onDidViewletOpen(viewlet => this.onActiveCompositeChanged(viewlet)));

		// Deactivate viewlet action on close
		this.toUnbind.push(this.viewletService.onDidViewletClose(viewlet => this.onCompositeClosed(viewlet)));

		// Update activity bar on registering an external viewlet
		this.toUnbind.push(
			(<ViewletRegistry>Registry.as(ViewletExtensions.Viewlets))
				.onDidRegisterExternalViewlets(descriptors => this.onDidRegisterExternalViewlets(descriptors))
		);
	}

	private onDidRegisterExternalViewlets(descriptors: ViewletDescriptor[]) {
		descriptors.forEach(descriptor => {
			this.registeredViewlets.push(descriptor.id);
			if (this.viewletsToggleStatus[descriptor.id]) {
				this.viewletSwitcherBar.push(this.toAction(descriptor), { label: true, icon: true });
			}
		});
	}

	private onActiveCompositeChanged(composite: IComposite): void {
		if (this.compositeIdToActions[composite.getId()]) {
			this.compositeIdToActions[composite.getId()].activate();
		}
	}

	private onCompositeClosed(composite: IComposite): void {
		if (this.compositeIdToActions[composite.getId()]) {
			this.compositeIdToActions[composite.getId()].deactivate();
		}
	}

	getRegisteredViewletsToggleStatus(): { [viewletId: string]: boolean } {
		const result = {};
		this.registeredViewlets.forEach(viewletId => {
			result[viewletId] = this.viewletsToggleStatus[viewletId];
		});
		return result;
	}

	toggleViewlet(viewletId: string): void {
		this.viewletsToggleStatus[viewletId] = !this.viewletsToggleStatus[viewletId];
		this.setViewletsToggleStatus();
		this.refreshViewletSwitcher();
	}

	private setViewletsToggleStatus(): void {
		this.storageService.store(this.VIEWLETS_TOGGLE_STATUS, JSON.stringify(this.viewletsToggleStatus));
	}

	getExternalViewletIdToOpen(): string {
		return this.externalViewletIdToOpen;
	}

	public showActivity(compositeId: string, badge: IBadge, clazz?: string): void {
		const action = this.compositeIdToActions[compositeId];
		if (action) {
			action.setBadge(badge);
			if (clazz) {
				action.class = clazz;
			}
		}
	}

	public clearActivity(compositeId: string): void {
		this.showActivity(compositeId, null);
	}

	public createContentArea(parent: Builder): Builder {
		const $el = $(parent);
		const $result = $('.content').appendTo($el);

		// Top Actionbar with action items for each viewlet action
		this.createViewletSwitcher($result.clone().addClass('position-top'));

		return $result;
	}

	private createViewletSwitcher(div: Builder): void {
		this.viewletSwitcherBar = new ActionBar(div, {
			actionItemProvider: (action: Action) => this.activityActionItems[action.id],
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: nls.localize('activityBarAriaLabel', "Active View Switcher")
		});

		// Load stock viewlets
		const allViewlets = (<ViewletRegistry>Registry.as(ViewletExtensions.Viewlets)).getViewlets().filter(v => !v.isExternal);
		this.fillViewletSwitcher(allViewlets);
	}

	private refreshViewletSwitcher(): void {
		this.viewletSwitcherBar.clear();

		// Load stock viewlets + enabled external viewlets
		const allEnabledViewlets = (<ViewletRegistry>Registry.as(ViewletExtensions.Viewlets)).getViewlets().filter(descriptor => {
			if (!descriptor.isExternal) {
				return true;
			} else {
				return this.viewletsToggleStatus[descriptor.id];
			}
		});
		this.fillViewletSwitcher(allEnabledViewlets);
	}

	private fillViewletSwitcher(viewlets: ViewletDescriptor[]) {
		// Build Viewlet Actions in correct order
		const viewletActions = viewlets.sort((v1, v2) => v1.order - v2.order).map(v => this.toAction(v));
		this.viewletSwitcherBar.push(viewletActions, { label: true, icon: true });
	}

	private toAction(composite: ViewletDescriptor): ActivityAction {
		const action = this.instantiationService.createInstance(ViewletActivityAction, composite.id + '.activity-bar-action', composite);
		action.onOpenViewlet((viewletId) => {
			this.externalViewletIdToOpen = viewletId;
		});

		this.activityActionItems[action.id] = new ActivityActionItem(action, composite.name, this.getKeybindingLabel(composite.id));
		this.compositeIdToActions[composite.id] = action;

		return action;
	};

	private getKeybindingLabel(id: string): string {
		const keys = this.keybindingService.lookupKeybindings(id).map(k => this.keybindingService.getLabelFor(k));
		if (keys && keys.length) {
			return keys[0];
		}

		return null;
	}

	public dispose(): void {
		if (this.viewletSwitcherBar) {
			this.viewletSwitcherBar.dispose();
			this.viewletSwitcherBar = null;
		}

		super.dispose();
	}
}

class ViewletActivityAction extends ActivityAction {
	private static preventDoubleClickDelay = 300;
	private lastRun: number = 0;

	private _onOpenViewlet = new Emitter<string>();
	get onOpenViewlet(): Event<string> { return this._onOpenViewlet.event; };

	constructor(
		id: string,
		private viewlet: ViewletDescriptor,
		@IViewletService private viewletService: IViewletService,
		@IPartService private partService: IPartService
	) {
		super(id, viewlet.name, viewlet.cssClass);
	}

	public run(): TPromise<any> {

		// prevent accident trigger on a doubleclick (to help nervous people)
		const now = Date.now();
		if (now - this.lastRun < ViewletActivityAction.preventDoubleClickDelay) {
			return TPromise.as(true);
		}
		this.lastRun = now;

		const sideBarHidden = this.partService.isSideBarHidden();
		const activeViewlet = this.viewletService.getActiveViewlet();

		// Hide sidebar if selected viewlet already visible
		if (!sideBarHidden && activeViewlet && activeViewlet.getId() === this.viewlet.id) {
			this.partService.setSideBarHidden(true);
		} else {
			this._onOpenViewlet.fire(this.viewlet.id);
			this.viewletService.openViewlet(this.viewlet.id, true).done(null, errors.onUnexpectedError);
			this.activate();
		}

		return TPromise.as(true);
	}
}
