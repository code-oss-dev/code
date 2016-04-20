/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IChannel, eventToCall, eventFromCall } from 'vs/base/parts/ipc/common/ipc';
import Event, { Emitter } from 'vs/base/common/event';

interface IMarcoPoloEvent {
	answer: string;
}

export interface ITestService {
	onMarco: Event<IMarcoPoloEvent>;
	marco(): TPromise<string>;
	pong(ping:string): TPromise<{ incoming:string, outgoing:string }>;
	cancelMe(): TPromise<boolean>;
}

export interface ITestChannel extends IChannel {
	call(command: 'marco'): TPromise<any>;
	call(command: 'pong', ping: string): TPromise<any>;
	call(command: 'cancelMe'): TPromise<any>;
	call(command: string, ...args: any[]): TPromise<any>;
}

export class TestChannel implements ITestService, ITestChannel {

	private _onMarco = new Emitter<IMarcoPoloEvent>();
	onMarco: Event<IMarcoPoloEvent> = this._onMarco.event;

	call(command: string, ...args: any[]): TPromise<any> {
		switch (command) {
			case 'pong': return this.pong(args[0]);
			case 'cancelMe': return this.cancelMe();
			case 'marco': return this.marco();
			case 'event:marco': return eventToCall(this.onMarco);
			default: return TPromise.wrapError(new Error('command not found'));
		}
	}

	marco(): TPromise<string> {
		this._onMarco.fire({ answer: 'polo' });
		return TPromise.as('polo');
	}

	pong(ping:string): TPromise<{ incoming:string, outgoing:string }> {
		return TPromise.as({ incoming: ping, outgoing: 'pong' });
	}

	cancelMe(): TPromise<boolean> {
		return TPromise.timeout(100).then(() => true);
	}
}

export class TestService implements ITestService {

	private _onMarco: Event<IMarcoPoloEvent>;
	get onMarco(): Event<IMarcoPoloEvent> { return this._onMarco; };

	constructor(private channel: ITestChannel) {
		this._onMarco = eventFromCall(channel, 'event:marco');
	}

	marco(): TPromise<string> {
		return this.channel.call('marco');
	}

	pong(ping:string): TPromise<{ incoming:string, outgoing:string }> {
		return this.channel.call('pong', ping);
	}

	cancelMe(): TPromise<boolean> {
		return this.channel.call('cancelMe');
	}
}