/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import {NullThreadService} from 'vs/platform/test/common/nullThreadService';
import {create} from 'vs/base/common/types';
import {SyncDescriptor0} from 'vs/platform/instantiation/common/descriptors';
import {TPromise} from 'vs/base/common/winjs.base';

export class TestThreadService extends NullThreadService {

	private _callCountValue: number = 0;
	private _idle: TPromise<any>;
	private _completeIdle: Function;

	private get _callCount(): number {
		return this._callCountValue;
	}

	private set _callCount(value:number) {
		this._callCountValue = value;
		if (this._callCountValue === 0) {
			this._completeIdle();
			this._idle = undefined;
		}
	}

	sync(): TPromise<any> {
		if (this._callCount === 0) {
			return TPromise.as(undefined);
		}
		if (!this._idle) {
			this._idle = new TPromise<any>((c, e) => {
				this._completeIdle = c;
			}, function() {
				// no cancel
			});
		}
		return this._idle;
	}

	protected _registerAndInstantiateMainProcessActor<T>(id: string, descriptor: SyncDescriptor0<T>): T {

		let instance: any;

		return this._getOrCreateProxyInstance({
			callOnRemote: (proxyId: string, path: string, args: any[]): TPromise<any> => {

				this._callCount++;

				return TPromise.timeout(0).then(() => {
					if (!instance) {
						instance = create(descriptor.ctor, this);
					}
					let p: TPromise<any>;
					try {
						let result = (<Function>instance[path]).apply(instance, args);
						p = TPromise.is(result) ? result : TPromise.as(result);
					} catch (err) {
						p = TPromise.wrapError(err);
					}

					return p.then(result => {
						this._callCount--;
						return result;
					}, err => {
						this._callCount--;
						return TPromise.wrapError(err);
					});
				});
			}
		}, id, descriptor)
	}

	protected _registerAndInstantiatePluginHostActor<T>(id: string, descriptor: SyncDescriptor0<T>): T {
		return this._getOrCreateLocalInstance(id, descriptor);
	}
}

const Instance = new TestThreadService();
export default Instance;