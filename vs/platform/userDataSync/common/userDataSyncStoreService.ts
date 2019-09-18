/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, } from 'vs/base/common/lifecycle';
import { IUserData, IUserDataSyncStoreService } from 'vs/platform/userDataSync/common/userDataSync';
import { IProductService } from 'vs/platform/product/common/productService';
import { Emitter, Event } from 'vs/base/common/event';
import { IRequestService, asJson, asText } from 'vs/platform/request/common/request';
import { URI } from 'vs/base/common/uri';
import { joinPath } from 'vs/base/common/resources';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IHeaders } from 'vs/base/parts/request/common/request';

export class UserDataSyncStoreService extends Disposable implements IUserDataSyncStoreService {

	_serviceBrand: any;

	get enabled(): boolean { return !!this.productService.settingsSyncStoreUrl; }

	private _loggedIn: boolean = false;
	get loggedIn(): boolean { return this._loggedIn; }
	private readonly _onDidChangeLoggedIn: Emitter<boolean> = this._register(new Emitter<boolean>());
	readonly onDidChangeLoggedIn: Event<boolean> = this._onDidChangeLoggedIn.event;

	constructor(
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
	) {
		super();
	}

	async login(): Promise<void> {
	}

	async logout(): Promise<void> {
	}

	async read(key: string, oldValue: IUserData | null): Promise<IUserData | null> {
		if (!this.enabled) {
			return Promise.reject(new Error('No settings sync store url configured.'));
		}
		const url = joinPath(URI.parse(this.productService.settingsSyncStoreUrl!), key).toString();
		const headers: IHeaders = {};
		if (oldValue) {
			headers['If-None-Match'] = oldValue.ref;
		}
		const context = await this.requestService.request({ type: 'GET', url, headers }, CancellationToken.None);
		return asJson<IUserData>(context);
	}

	async write(key: string, content: string, ref: string | null): Promise<string> {
		if (!this.enabled) {
			return Promise.reject(new Error('No settings sync store url configured.'));
		}
		const url = joinPath(URI.parse(this.productService.settingsSyncStoreUrl!), key).toString();
		const data = JSON.stringify({ content, ref });
		const headers: IHeaders = { 'Content-Type': 'application/json' };
		if (ref) {
			headers['If-Match'] = ref;
		}
		const context = await this.requestService.request({ type: 'POST', url, data, headers }, CancellationToken.None);
		const newRef = await asText(context);
		if (!newRef) {
			throw new Error('Server did not return the ref');
		}
		return newRef;
	}

}
