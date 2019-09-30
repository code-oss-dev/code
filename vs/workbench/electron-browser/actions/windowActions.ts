/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Action } from 'vs/base/common/actions';
import * as nls from 'vs/nls';
import * as browser from 'vs/base/browser/browser';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { webFrame } from 'electron';
import { FileKind } from 'vs/platform/files/common/files';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IQuickInputService, IQuickInputButton } from 'vs/platform/quickinput/common/quickInput';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { ICommandHandler } from 'vs/platform/commands/common/commands';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IElectronService } from 'vs/platform/electron/node/electron';
import { IElectronEnvironmentService } from 'vs/workbench/services/electron/electron-browser/electronEnvironmentService';

export class CloseCurrentWindowAction extends Action {

	static readonly ID = 'workbench.action.closeWindow';
	static readonly LABEL = nls.localize('closeWindow', "Close Window");

	constructor(
		id: string,
		label: string,
		@IElectronService private readonly electronService: IElectronService
	) {
		super(id, label);
	}

	run(): Promise<boolean> {
		this.electronService.closeWindow();

		return Promise.resolve(true);
	}
}

export abstract class BaseZoomAction extends Action {

	private static readonly SETTING_KEY = 'window.zoomLevel';

	private static readonly MAX_ZOOM_LEVEL = 9;
	private static readonly MIN_ZOOM_LEVEL = -8;

	constructor(
		id: string,
		label: string,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label);
	}

	protected async setConfiguredZoomLevel(level: number): Promise<void> {
		level = Math.round(level); // when reaching smallest zoom, prevent fractional zoom levels

		if (level > BaseZoomAction.MAX_ZOOM_LEVEL || level < BaseZoomAction.MIN_ZOOM_LEVEL) {
			return; // https://github.com/microsoft/vscode/issues/48357
		}

		const applyZoom = () => {
			webFrame.setZoomLevel(level);
			browser.setZoomFactor(webFrame.getZoomFactor());
			// See https://github.com/Microsoft/vscode/issues/26151
			// Cannot be trusted because the webFrame might take some time
			// until it really applies the new zoom level
			browser.setZoomLevel(webFrame.getZoomLevel(), /*isTrusted*/false);
		};

		await this.configurationService.updateValue(BaseZoomAction.SETTING_KEY, level);

		applyZoom();
	}
}

export class ZoomInAction extends BaseZoomAction {

	static readonly ID = 'workbench.action.zoomIn';
	static readonly LABEL = nls.localize('zoomIn', "Zoom In");

	constructor(
		id: string,
		label: string,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(id, label, configurationService);
	}

	run(): Promise<boolean> {
		this.setConfiguredZoomLevel(webFrame.getZoomLevel() + 1);

		return Promise.resolve(true);
	}
}

export class ZoomOutAction extends BaseZoomAction {

	static readonly ID = 'workbench.action.zoomOut';
	static readonly LABEL = nls.localize('zoomOut', "Zoom Out");

	constructor(
		id: string,
		label: string,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(id, label, configurationService);
	}

	run(): Promise<boolean> {
		this.setConfiguredZoomLevel(webFrame.getZoomLevel() - 1);

		return Promise.resolve(true);
	}
}

export class ZoomResetAction extends BaseZoomAction {

	static readonly ID = 'workbench.action.zoomReset';
	static readonly LABEL = nls.localize('zoomReset', "Reset Zoom");

	constructor(
		id: string,
		label: string,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(id, label, configurationService);
	}

	run(): Promise<boolean> {
		this.setConfiguredZoomLevel(0);

		return Promise.resolve(true);
	}
}

export class RestartWithExtensionsDisabledAction extends Action {

	static readonly ID = 'workbench.action.restartWithExtensionsDisabled';
	static LABEL = nls.localize('restartWithExtensionsDisabled', "Restart With Extensions Disabled");

	constructor(
		id: string,
		label: string,
		@IElectronService private readonly electronService: IElectronService
	) {
		super(id, label);
	}

	async run(): Promise<boolean> {
		await this.electronService.relaunch({ addArgs: ['--disable-extensions'] });

		return true;
	}
}

export abstract class BaseSwitchWindow extends Action {

	private closeWindowAction: IQuickInputButton = {
		iconClass: 'action-remove-from-recently-opened',
		tooltip: nls.localize('close', "Close Window")
	};

	constructor(
		id: string,
		label: string,
		private electronEnvironmentService: IElectronEnvironmentService,
		private quickInputService: IQuickInputService,
		private keybindingService: IKeybindingService,
		private modelService: IModelService,
		private modeService: IModeService,
		private electronService: IElectronService
	) {
		super(id, label);
	}

	protected abstract isQuickNavigate(): boolean;

	async run(): Promise<void> {
		const currentWindowId = this.electronEnvironmentService.windowId;

		const windows = await this.electronService.getWindows();
		const placeHolder = nls.localize('switchWindowPlaceHolder', "Select a window to switch to");
		const picks = windows.map(win => {
			const resource = win.filename ? URI.file(win.filename) : win.folderUri ? win.folderUri : win.workspace ? win.workspace.configPath : undefined;
			const fileKind = win.filename ? FileKind.FILE : win.workspace ? FileKind.ROOT_FOLDER : win.folderUri ? FileKind.FOLDER : FileKind.FILE;
			return {
				payload: win.id,
				label: win.title,
				iconClasses: getIconClasses(this.modelService, this.modeService, resource, fileKind),
				description: (currentWindowId === win.id) ? nls.localize('current', "Current Window") : undefined,
				buttons: (!this.isQuickNavigate() && currentWindowId !== win.id) ? [this.closeWindowAction] : undefined
			};
		});
		const autoFocusIndex = (picks.indexOf(picks.filter(pick => pick.payload === currentWindowId)[0]) + 1) % picks.length;

		const pick = await this.quickInputService.pick(picks, {
			contextKey: 'inWindowsPicker',
			activeItem: picks[autoFocusIndex],
			placeHolder,
			quickNavigate: this.isQuickNavigate() ? { keybindings: this.keybindingService.lookupKeybindings(this.id) } : undefined,
			onDidTriggerItemButton: async context => {
				await this.electronService.closeWindow();
				context.removeItem();
			}
		});

		if (pick) {
			this.electronService.focusWindow({ windowId: pick.payload });
		}
	}
}

export class SwitchWindow extends BaseSwitchWindow {

	static readonly ID = 'workbench.action.switchWindow';
	static LABEL = nls.localize('switchWindow', "Switch Window...");

	constructor(
		id: string,
		label: string,
		@IElectronEnvironmentService electronEnvironmentService: IElectronEnvironmentService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService,
		@IElectronService electronService: IElectronService
	) {
		super(id, label, electronEnvironmentService, quickInputService, keybindingService, modelService, modeService, electronService);
	}

	protected isQuickNavigate(): boolean {
		return false;
	}
}

export class QuickSwitchWindow extends BaseSwitchWindow {

	static readonly ID = 'workbench.action.quickSwitchWindow';
	static LABEL = nls.localize('quickSwitchWindow', "Quick Switch Window...");

	constructor(
		id: string,
		label: string,
		@IElectronEnvironmentService electronEnvironmentService: IElectronEnvironmentService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService,
		@IElectronService electronService: IElectronService
	) {
		super(id, label, electronEnvironmentService, quickInputService, keybindingService, modelService, modeService, electronService);
	}

	protected isQuickNavigate(): boolean {
		return true;
	}
}

export const NewWindowTabHandler: ICommandHandler = function (accessor: ServicesAccessor) {
	return accessor.get(IElectronService).newWindowTab();
};

export const ShowPreviousWindowTabHandler: ICommandHandler = function (accessor: ServicesAccessor) {
	return accessor.get(IElectronService).showPreviousWindowTab();
};

export const ShowNextWindowTabHandler: ICommandHandler = function (accessor: ServicesAccessor) {
	return accessor.get(IElectronService).showNextWindowTab();
};

export const MoveWindowTabToNewWindowHandler: ICommandHandler = function (accessor: ServicesAccessor) {
	return accessor.get(IElectronService).moveWindowTabToNewWindow();
};

export const MergeWindowTabsHandlerHandler: ICommandHandler = function (accessor: ServicesAccessor) {
	return accessor.get(IElectronService).mergeAllWindowTabs();
};

export const ToggleWindowTabsBarHandler: ICommandHandler = function (accessor: ServicesAccessor) {
	return accessor.get(IElectronService).toggleWindowTabsBar();
};
