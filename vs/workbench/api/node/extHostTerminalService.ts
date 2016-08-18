/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import {IThreadService} from 'vs/workbench/services/thread/common/threadService';
import vscode = require('vscode');
import {MainContext, MainThreadTerminalServiceShape} from './extHost.protocol';

export class ExtHostTerminal implements vscode.Terminal {

	private _id: number;
	private _proxy: MainThreadTerminalServiceShape;
	private _disposed: boolean;

	constructor(proxy: MainThreadTerminalServiceShape, id: number) {
		this._id = id;
		this._proxy = proxy;
	}

	public sendText(text: string, addNewLine: boolean = true): void {
		this._proxy.$sendText(this._id, text, addNewLine);
	}

	public show(preserveFocus: boolean): void {
		this._proxy.$show(this._id, preserveFocus);
	}

	public hide(): void {
		this._proxy.$hide(this._id);
	}

	public dispose(): void {
		if (!this._disposed) {
			this._disposed = true;
			this._proxy.$dispose(this._id);
		}
	}
}

export class ExtHostTerminalService {

	private _proxy: MainThreadTerminalServiceShape;

	constructor(threadService: IThreadService) {
		this._proxy = threadService.get(MainContext.MainThreadTerminalService);
	}

	public createTerminal(name?: string): TPromise<vscode.Terminal> {
		return this._proxy.$createTerminal(name).then((terminalId) => {
			return new ExtHostTerminal(this._proxy, terminalId);
		});
	}
}
