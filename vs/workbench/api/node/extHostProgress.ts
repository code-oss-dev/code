/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Progress, CancellationToken } from 'vscode';
import { MainThreadProgressShape } from './extHost.protocol';

export class ExtHostProgress {

	private _proxy: MainThreadProgressShape;
	private _handles: number = 0;

	constructor(proxy: MainThreadProgressShape) {
		this._proxy = proxy;
	}

	withWindowProgress<R>(task: (progress: Progress<string>, token: CancellationToken) => Thenable<R>): Thenable<R> {
		return this._withProgress('window', task);
	}

	withScmViewletProgress<R>(task: (progress: Progress<number>) => Thenable<R>): Thenable<R> {
		return this._withProgress('scm', task);
	}

	private _withProgress<R>(type: string, task: (progress: Progress<any>, token: CancellationToken) => Thenable<R>): Thenable<R> {
		const handle = this._handles++;

		this._proxy.$progressStart(handle, type);
		const progress = {
			report: (message: string) => {
				this._proxy.$progressReport(handle, message);
			}
		};

		let p: Thenable<R>;

		try {
			p = task(progress, null);
		} catch (err) {
			this._proxy.$progressEnd(handle);
			throw err;
		}

		return p.then(result => {
			this._proxy.$progressEnd(handle);
			return result;
		}, err => {
			this._proxy.$progressEnd(handle, err);
			throw err;
		});
	}
}
