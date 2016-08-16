/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import {ITerminalService} from 'vs/workbench/parts/terminal/electron-browser/terminal';
import {MainThreadTerminalServiceShape} from './extHost.protocol';

export class MainThreadTerminalService extends MainThreadTerminalServiceShape {

	private _terminalService: ITerminalService;

	constructor(
		@ITerminalService terminalService: ITerminalService
	) {
		super();
		this._terminalService = terminalService;
	}

	public $createTerminal(name?: string): TPromise<number> {
		// TODO: Use name here
		return this._terminalService.createNew();
	}

	public $show(terminalId: number, preserveFocus: boolean): void {
		this._terminalService.show(!preserveFocus, terminalId);
	}
}
