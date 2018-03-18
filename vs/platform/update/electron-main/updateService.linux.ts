/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import product from 'vs/platform/node/product';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILifecycleService } from 'vs/platform/lifecycle/electron-main/lifecycleMain';
import { IRequestService } from 'vs/platform/request/node/request';
import { State, IUpdate, AvailableForDownload } from 'vs/platform/update/common/update';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ILogService } from 'vs/platform/log/common/log';
import { createUpdateURL, AbstractUpdateService } from 'vs/platform/update/electron-main/abstractUpdateService';
import { asJson } from 'vs/base/node/request';
import { TPromise } from 'vs/base/common/winjs.base';
import { shell } from 'electron';
import { realpath } from 'vs/base/node/pfs';
import * as path from 'path';
import { spawn } from 'child_process';

export class LinuxUpdateService extends AbstractUpdateService {

	_serviceBrand: any;

	private url: string | undefined;

	constructor(
		@ILifecycleService lifecycleService: ILifecycleService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IRequestService private requestService: IRequestService,
		@ILogService logService: ILogService
	) {
		super(lifecycleService, configurationService, environmentService, logService);
	}

	protected setUpdateFeedUrl(quality: string): boolean {
		this.url = createUpdateURL(`linux-${process.arch}`, quality);
		return true;
	}

	protected doCheckForUpdates(context: any): void {
		if (!this.url) {
			return;
		}

		this.setState(State.CheckingForUpdates(context));

		if (process.env.SNAP && process.env.SNAP_REVISION) {
			this.checkForSnapUpdate();
		} else {
			this.requestService.request({ url: this.url })
				.then<IUpdate>(asJson)
				.then(update => {
					if (!update || !update.url || !update.version || !update.productVersion) {
						/* __GDPR__
								"update:notAvailable" : {
									"explicit" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
								}
							*/
						this.telemetryService.publicLog('update:notAvailable', { explicit: !!context });

						this.setState(State.Idle);
					} else {
						this.setState(State.AvailableForDownload(update));
					}
				})
				.then(null, err => {
					this.logService.error(err);

					/* __GDPR__
							"update:notAvailable" : {
								"explicit" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
							}
						*/
					this.telemetryService.publicLog('update:notAvailable', { explicit: !!context });

					this.setState(State.Idle);
				});
		}
	}

	private checkForSnapUpdate() {
		// If the application was installed as a snap, updates happen in the
		// background automatically, we just need to check to see if an update
		// has already happened.
		realpath(`/snap/${product.applicationName}/current`).then(resolvedCurrentSnapPath => {
			const currentRevision = path.basename(resolvedCurrentSnapPath);
			if (process.env.SNAP_REVISION !== currentRevision) {
				this.setState(State.Ready(null));
			} else {
				this.setState(State.Idle);
			}
		});
	}

	protected doDownloadUpdate(state: AvailableForDownload): TPromise<void> {
		// Use the download URL if available as we don't currently detect the package type that was
		// installed and the website download page is more useful than the tarball generally.
		if (product.downloadUrl && product.downloadUrl.length > 0) {
			shell.openExternal(product.downloadUrl);
		} else {
			shell.openExternal(state.update.url);
		}
		this.setState(State.Idle);

		return TPromise.as(null);
	}

	protected doQuitAndInstall(): void {
		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');

		// Allow 3 seconds for VS Code to close
		spawn('bash', ['-c', path.join(process.env.SNAP, `usr/share/${product.applicationName}/snapUpdate.sh`)], {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore']
		});
	}
}
