/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { IIntegrityService, IntegrityTestResult, ChecksumPair } from 'vs/platform/integrity/common/integrity';
import product from 'vs/platform/node/product';
import { URI } from 'vs/base/common/uri';
import Severity from 'vs/base/common/severity';
import { INextStorage2Service, StorageScope } from 'vs/platform/storage2/common/storage2';
import { ILifecycleService, LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { INotificationService } from 'vs/platform/notification/common/notification';

interface IStorageData {
	dontShowPrompt: boolean;
	commit: string;
}

class IntegrityStorage {
	private static readonly KEY = 'integrityService';

	private _nextStorage2Service: INextStorage2Service;
	private _value: IStorageData;

	constructor(nextStorage2Service: INextStorage2Service) {
		this._nextStorage2Service = nextStorage2Service;
		this._value = this._read();
	}

	private _read(): IStorageData {
		let jsonValue = this._nextStorage2Service.get(IntegrityStorage.KEY, StorageScope.GLOBAL);
		if (!jsonValue) {
			return null;
		}
		try {
			return JSON.parse(jsonValue);
		} catch (err) {
			return null;
		}
	}

	public get(): IStorageData {
		return this._value;
	}

	public set(data: IStorageData): void {
		this._value = data;
		this._nextStorage2Service.set(IntegrityStorage.KEY, JSON.stringify(this._value), StorageScope.GLOBAL);
	}
}

export class IntegrityServiceImpl implements IIntegrityService {

	public _serviceBrand: any;

	private _storage: IntegrityStorage;
	private _isPurePromise: Thenable<IntegrityTestResult>;

	constructor(
		@INotificationService private notificationService: INotificationService,
		@INextStorage2Service nextStorage2Service: INextStorage2Service,
		@ILifecycleService private lifecycleService: ILifecycleService
	) {
		this._storage = new IntegrityStorage(nextStorage2Service);

		this._isPurePromise = this._isPure();

		this.isPure().then(r => {
			if (r.isPure) {
				// all is good
				return;
			}
			this._prompt();
		});
	}

	private _prompt(): void {
		const storedData = this._storage.get();
		if (storedData && storedData.dontShowPrompt && storedData.commit === product.commit) {
			return; // Do not prompt
		}

		this.notificationService.prompt(
			Severity.Warning,
			nls.localize('integrity.prompt', "Your {0} installation appears to be corrupt. Please reinstall.", product.nameShort),
			[
				{
					label: nls.localize('integrity.moreInformation', "More Information"),
					run: () => window.open(URI.parse(product.checksumFailMoreInfoUrl).toString(true))
				},
				{
					label: nls.localize('integrity.dontShowAgain', "Don't Show Again"),
					isSecondary: true,
					run: () => this._storage.set({ dontShowPrompt: true, commit: product.commit })
				}
			],
			{ sticky: true }
		);
	}

	public isPure(): Thenable<IntegrityTestResult> {
		return this._isPurePromise;
	}

	private _isPure(): Thenable<IntegrityTestResult> {
		const expectedChecksums = product.checksums || {};

		return this.lifecycleService.when(LifecyclePhase.Eventually).then(() => {
			let asyncResults: Promise<ChecksumPair>[] = Object.keys(expectedChecksums).map((filename) => {
				return this._resolve(filename, expectedChecksums[filename]);
			});

			return Promise.all(asyncResults).then<IntegrityTestResult>((allResults) => {
				let isPure = true;
				for (let i = 0, len = allResults.length; isPure && i < len; i++) {
					if (!allResults[i].isPure) {
						isPure = false;
						break;
					}
				}

				return {
					isPure: isPure,
					proof: allResults
				};
			});
		});
	}

	private _resolve(filename: string, expected: string): Promise<ChecksumPair> {
		let fileUri = URI.parse(require.toUrl(filename));
		return new Promise<ChecksumPair>((resolve, reject) => {
			fs.readFile(fileUri.fsPath, (err, buff) => {
				if (err) {
					return reject(err);
				}
				resolve(IntegrityServiceImpl._createChecksumPair(fileUri, this._computeChecksum(buff), expected));
			});
		});
	}

	private _computeChecksum(buff: Buffer): string {
		let hash = crypto
			.createHash('md5')
			.update(buff)
			.digest('base64')
			.replace(/=+$/, '');

		return hash;
	}

	private static _createChecksumPair(uri: URI, actual: string, expected: string): ChecksumPair {
		return {
			uri: uri,
			actual: actual,
			expected: expected,
			isPure: (actual === expected)
		};
	}
}
