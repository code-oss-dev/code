/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { generateUuid } from 'vs/base/common/uuid';
import { ipcMessagePort, ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';

interface IMessageChannelResult {
	nonce: string;
	port: MessagePort;
	source: unknown;
}

export async function acquirePort(requestChannel: string, responseChannel: string): Promise<MessagePort> {

	// Ask to create message channel inside the window
	// and send over a UUID to correlate the response
	const nonce = generateUuid();
	ipcMessagePort.acquire(responseChannel, nonce);
	ipcRenderer.send(requestChannel, nonce);

	// Wait until the main side has returned the `MessagePort`
	// We need to filter by the `nonce` to ensure we listen
	// to the right response.
	const onMessageChannelResult = Event.fromDOMEventEmitter<IMessageChannelResult>(window, 'message', (e: MessageEvent) => ({ nonce: e.data, port: e.ports[0], source: e.source }));
	const { port } = await Event.toPromise(Event.once(Event.filter(onMessageChannelResult, e => e.nonce === nonce && e.source === window)));

	return port;
}
