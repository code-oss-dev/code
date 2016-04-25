/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import events = require('events');
import path = require('path');
import os = require('os');
import cp = require('child_process');
import pfs = require('vs/base/node/pfs');
import { mkdirp } from 'vs/base/node/extfs';
import { isString } from 'vs/base/common/types';
import { Promise, TPromise } from 'vs/base/common/winjs.base';
import { download, json } from 'vs/base/node/request';
import { getProxyAgent } from 'vs/base/node/proxy';
import { ISettingsService  } from 'vs/workbench/electron-main/settings';
import { ILifecycleService } from 'vs/workbench/electron-main/lifecycle';
import { IEnvironmentService } from './env';

export interface IUpdate {
	url: string;
	name: string;
	releaseNotes?: string;
	version?: string;
}

export class Win32AutoUpdaterImpl extends events.EventEmitter {

	private url: string;
	private currentRequest: Promise;

	constructor(
		@ILifecycleService private lifecycleService: ILifecycleService,
		@IEnvironmentService private envService: IEnvironmentService,
		@ISettingsService private settingsManager: ISettingsService
	) {
		super();

		this.url = null;
		this.currentRequest = null;
	}

	public get cachePath(): TPromise<string> {
		let result = path.join(os.tmpdir(), 'vscode-update');
		return new TPromise<string>((c, e) => mkdirp(result, null, err => err ? e(err) : c(result)));
	}

	public setFeedURL(url: string): void {
		this.url = url;
	}

	public checkForUpdates(): void {
		if (!this.url) {
			throw new Error('No feed url set.');
		}

		if (this.currentRequest) {
			return;
		}

		this.emit('checking-for-update');

		const proxyUrl = this.settingsManager.getValue('http.proxy');
		const strictSSL = this.settingsManager.getValue('http.proxyStrictSSL', true);
		const agent = getProxyAgent(this.url, { proxyUrl, strictSSL });

		this.currentRequest = json<IUpdate>({ url: this.url, agent })
			.then(update => {
				if (!update || !update.url || !update.version) {
					this.emit('update-not-available');
					return this.cleanup();
				}

				this.emit('update-available');

				return this.cleanup(update.version).then(() => {
					return this.getUpdatePackagePath(update.version).then(updatePackagePath => {
						return pfs.exists(updatePackagePath).then(exists => {
							if (exists) {
								return TPromise.as(updatePackagePath);
							}

							const url = update.url;
							const downloadPath = `${updatePackagePath}.tmp`;
							const agent = getProxyAgent(url, { proxyUrl, strictSSL });

							return download(downloadPath, { url, agent, strictSSL })
								.then(() => pfs.rename(downloadPath, updatePackagePath))
								.then(() => updatePackagePath);
						});
					}).then(updatePackagePath => {
						this.emit('update-downloaded',
							{},
							update.releaseNotes,
							update.version,
							new Date(),
							this.url,
							() => this.quitAndUpdate(updatePackagePath)
						);
					});
				});
			})
			.then(null, e => {
				if (isString(e) && /^Server returned/.test(e)) {
					return;
				}

				this.emit('update-not-available');
				this.emit('error', e);
			})
			.then(() => this.currentRequest = null);
	}

	private getUpdatePackagePath(version: string): TPromise<string> {
		return this.cachePath.then(cachePath => path.join(cachePath, `CodeSetup-${ this.envService.quality }-${ version }.exe`));
	}

	private quitAndUpdate(updatePackagePath: string): void {
		this.lifecycleService.quit().done(vetod => {
			if (vetod) {
				return;
			}

			cp.spawn(updatePackagePath, ['/silent', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore']
			});
		});
	}

	private cleanup(exceptVersion: string = null): Promise {
		const filter = exceptVersion ? one => !(new RegExp(`${ this.envService.quality }-${ exceptVersion }\\.exe$`).test(one)) : () => true;

		return this.cachePath
			.then(cachePath => pfs.readdir(cachePath)
				.then(all => Promise.join(all
					.filter(filter)
					.map(one => pfs.unlink(path.join(cachePath, one)).then(null, () => null))
				))
			);
	}
}
