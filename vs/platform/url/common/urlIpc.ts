/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel, IServerChannel, IClientRouter, IConnectionHub, Client } from 'vs/base/parts/ipc/common/ipc';
import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { IURLHandler } from 'vs/platform/url/common/url';
import { CancellationToken } from 'vs/base/common/cancellation';
import { first } from 'vs/base/common/arrays';

export class URLHandlerChannel implements IServerChannel {

	constructor(private handler: IURLHandler) { }

	listen<T>(_: unknown, event: string): Event<T> {
		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'handleURL': return this.handler.handleURL(URI.revive(arg));
		}

		throw new Error(`Call not found: ${command}`);
	}
}

export class URLHandlerChannelClient implements IURLHandler {

	constructor(private channel: IChannel) { }

	handleURL(uri: URI): Promise<boolean> {
		return this.channel.call('handleURL', uri.toJSON());
	}
}

export class URLHandlerRouter implements IClientRouter<string> {

	constructor(private next: IClientRouter<string>) { }

	async routeCall(hub: IConnectionHub<string>, command: string, arg?: any, cancellationToken?: CancellationToken): Promise<Client<string>> {
		if (command !== 'handleURL') {
			throw new Error(`Call not found: ${command}`);
		}

		if (arg) {
			const uri = URI.revive(arg);

			if (uri && uri.query) {
				const match = /\bwindowId=([^&]+)/.exec(uri.query);

				if (match) {
					const windowId = match[1];
					const connection = first(hub.connections, c => c.ctx === windowId);

					if (connection) {
						return connection;
					}
				}
			}
		}

		return this.next.routeCall(hub, command, arg, cancellationToken);
	}

	routeEvent(_: IConnectionHub<string>, event: string): Promise<Client<string>> {
		throw new Error(`Event not found: ${event}`);
	}
}
