/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUserDataAutoSyncService } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataAutoSyncService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export class WebUserDataAutoSyncService extends UserDataAutoSyncService implements IUserDataAutoSyncService {

	private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService = <IWorkbenchEnvironmentService>this.environmentService;
	private enabled: boolean | undefined = undefined;

	isEnabled(): boolean {
		if (this.enabled === undefined) {
			this.enabled = this.workbenchEnvironmentService.options?.enableSettingsSync;
		}
		if (this.enabled === undefined) {
			this.enabled = super.isEnabled(this.workbenchEnvironmentService.options?.enableSyncByDefault);
		}
		return this.enabled;
	}

	protected setEnablement(enabled: boolean) {
		if (this.enabled !== enabled) {
			this.enabled = enabled;
			if (this.workbenchEnvironmentService.options?.settingsSyncEnablementHandler) {
				this.workbenchEnvironmentService.options.settingsSyncEnablementHandler(this.enabled);
			}
		}
	}

}
