/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUserDataSyncService, IUserDataSyncLogService, IUserDataSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { Event } from 'vs/base/common/event';
import { UserDataAutoSyncService as BaseUserDataAutoSyncService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IUserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { UserDataSyncTrigger } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncTrigger';
import { IProductService } from 'vs/platform/product/common/productService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export class UserDataAutoSyncService extends BaseUserDataAutoSyncService {

	constructor(
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@IUserDataSyncService userDataSyncService: IUserDataSyncService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IUserDataSyncAccountService authTokenService: IUserDataSyncAccountService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IHostService hostService: IHostService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(userDataSyncEnablementService, userDataSyncService, logService, authTokenService, telemetryService, productService, configurationService);

		this._register(Event.debounce<string, string[]>(Event.any<string>(
			Event.map(hostService.onDidChangeFocus, () => 'windowFocus'),
			instantiationService.createInstance(UserDataSyncTrigger).onDidTriggerSync,
			userDataSyncService.onDidChangeLocal,
		), (last, source) => last ? [...last, source] : [source], 1000)(sources => this.triggerAutoSync(sources)));
	}

}
