/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { isWindows } from 'vs/base/common/platform';
import { ITerminalChildProcess, ITerminalEventListener } from 'vs/platform/terminal/common/terminal';

/**
 * Tracks a terminal process's data stream and responds immediately when a matching string is
 * received. This is done in a low overhead way and is ideally run on the same process as the
 * where the process is handled to minimize latency.
 */
export class TerminalAutoResponder extends Disposable implements ITerminalEventListener {
	private _pointer = 0;
	private _paused = false;

	constructor(
		proc: ITerminalChildProcess,
		matchWord: string,
		response: string
	) {
		super();

		this._register(proc.onProcessData(e => {
			if (this._paused) {
				return;
			}
			console.log('data', e);
			const data = typeof e === 'string' ? e : e.data;
			for (let i = 0; i < data.length; i++) {
				if (data[i] === matchWord[this._pointer]) {
					this._pointer++;
				} else {
					this._reset();
				}
				// Auto reply and reset
				if (this._pointer === matchWord.length) {
					proc.input(response);
					this._reset();
				}
			}
		}));
	}

	private _reset() {
		this._pointer = 0;
	}

	/**
	 * No auto response will happen after a resize on Windows in case the resize is a result of
	 * reprinting the screen.
	 */
	handleResize() {
		if (isWindows) {
			this._paused = true;
		}
	}

	handleInput() {
		this._paused = false;
	}
}
