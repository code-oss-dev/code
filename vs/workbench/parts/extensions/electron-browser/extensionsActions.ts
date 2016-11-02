/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import { Action } from 'vs/base/common/actions';
import severity from 'vs/base/common/severity';
import paths = require('vs/base/common/paths');
import { ReloadWindowAction } from 'vs/workbench/electron-browser/actions';
import { IExtensionsWorkbenchService } from 'vs/workbench/parts/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMessageService } from 'vs/platform/message/common/message';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { remote } from 'electron';
import { IWindowIPCService } from 'vs/workbench/services/window/electron-browser/windowService';

const dialog = remote.dialog;

export class OpenExtensionsFolderAction extends Action {

	static ID = 'workbench.extensions.action.openExtensionsFolder';
	static LABEL = localize('openExtensionsFolder', "Open Extensions Folder");

	constructor(
		id: string,
		label: string,
		@IWindowIPCService private windowService: IWindowIPCService,
		@IEnvironmentService private environmentService: IEnvironmentService
	) {
		super(id, label, null, true);
	}

	run(): TPromise<any> {
		const extensionsHome = this.environmentService.extensionsPath;
		this.windowService.getWindow().showItemInFolder(paths.normalize(extensionsHome, true));

		return TPromise.as(true);
	}

	protected isEnabled(): boolean {
		return true;
	}
}

export class InstallVSIXAction extends Action {

	static ID = 'workbench.extensions.action.installVSIX';
	static LABEL = localize('installVSIX', "Install from VSIX...");

	constructor(
		id = InstallVSIXAction.ID,
		label = InstallVSIXAction.LABEL,
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IMessageService private messageService: IMessageService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super(id, label, 'extension-action install-vsix', true);
	}

	run(): TPromise<any> {
		const result = dialog.showOpenDialog(remote.getCurrentWindow(), {
			filters: [{ name: 'VSIX Extensions', extensions: ['vsix'] }],
			properties: ['openFile']
		});

		if (!result) {
			return TPromise.as(null);
		}

		return TPromise.join(result.map(vsix => this.extensionsWorkbenchService.install(vsix))).then(() => {
			this.messageService.show(
				severity.Info,
				{
					message: localize('InstallVSIXAction.success', "Successfully installed the extension. Restart to enable it."),
					actions: [this.instantiationService.createInstance(ReloadWindowAction, ReloadWindowAction.ID, localize('InstallVSIXAction.reloadNow', "Reload Now"))]
				}
			);
		});
	}
}