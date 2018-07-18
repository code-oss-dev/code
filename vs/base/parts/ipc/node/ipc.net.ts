/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Socket, Server as NetServer, createConnection, createServer } from 'net';
import { TPromise } from 'vs/base/common/winjs.base';
import { Event, Emitter, once, mapEvent, fromNodeEventEmitter } from 'vs/base/common/event';
import { IMessagePassingProtocol, ClientConnectionEvent, IPCServer, IPCClient } from 'vs/base/parts/ipc/common/ipc';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateUuid } from 'vs/base/common/uuid';
import { IDisposable } from 'vs/base/common/lifecycle';
import { TimeoutTimer } from 'vs/base/common/async';

export function generateRandomPipeName(): string {
	const randomSuffix = generateUuid();
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\vscode-ipc-${randomSuffix}-sock`;
	} else {
		// Mac/Unix: use socket file
		return join(tmpdir(), `vscode-ipc-${randomSuffix}.sock`);
	}
}

export class Protocol implements IDisposable, IMessagePassingProtocol {

	private static readonly _headerLen = 5;

	private _isDisposed: boolean;
	private _chunks: Buffer[];

	private _firstChunkTimer: TimeoutTimer;
	private _socketDataListener: (data: Buffer) => void;
	private _socketEndListener: () => void;
	private _socketCloseListener: () => void;

	private _onMessage = new Emitter<any>();
	readonly onMessage: Event<any> = this._onMessage.event;

	private _onClose = new Emitter<void>();
	readonly onClose: Event<void> = this._onClose.event;

	constructor(private _socket: Socket, firstDataChunk?: Buffer) {
		this._isDisposed = false;
		this._chunks = [];

		let totalLength = 0;

		const state = {
			readHead: true,
			bodyIsJson: false,
			bodyLen: -1,
		};

		const acceptChunk = (data: Buffer) => {

			this._chunks.push(data);
			totalLength += data.length;

			while (totalLength > 0) {

				if (state.readHead) {
					// expecting header -> read 5bytes for header
					// information: `bodyIsJson` and `bodyLen`
					if (totalLength >= Protocol._headerLen) {
						const all = Buffer.concat(this._chunks);

						state.bodyIsJson = all.readInt8(0) === 1;
						state.bodyLen = all.readInt32BE(1);
						state.readHead = false;

						const rest = all.slice(Protocol._headerLen);
						totalLength = rest.length;
						this._chunks = [rest];

					} else {
						break;
					}
				}

				if (!state.readHead) {
					// expecting body -> read bodyLen-bytes for
					// the actual message or wait for more data
					if (totalLength >= state.bodyLen) {

						const all = Buffer.concat(this._chunks);
						let message = all.toString('utf8', 0, state.bodyLen);
						if (state.bodyIsJson) {
							message = JSON.parse(message);
						}

						// ensure the public getBuffer returns a valid value if invoked from the event listeners
						const rest = all.slice(state.bodyLen);
						totalLength = rest.length;
						this._chunks = [rest];

						state.bodyIsJson = false;
						state.bodyLen = -1;
						state.readHead = true;

						this._onMessage.fire(message);

						if (this._isDisposed) {
							// check if an event listener lead to our disposal
							break;
						}
					} else {
						break;
					}
				}
			}
		};

		const acceptFirstDataChunk = () => {
			if (firstDataChunk && firstDataChunk.length > 0) {
				let tmp = firstDataChunk;
				firstDataChunk = null;
				acceptChunk(tmp);
			}
		};

		// Make sure to always handle the firstDataChunk if no more `data` event comes in
		this._firstChunkTimer = new TimeoutTimer();
		this._firstChunkTimer.setIfNotSet(() => {
			acceptFirstDataChunk();
		}, 0);

		this._socketDataListener = (data: Buffer) => {
			acceptFirstDataChunk();
			acceptChunk(data);
		};
		_socket.on('data', this._socketDataListener);

		this._socketEndListener = () => {
			acceptFirstDataChunk();
		};
		_socket.on('end', this._socketEndListener);

		this._socketCloseListener = () => {
			this._onClose.fire();
		};
		_socket.once('close', this._socketCloseListener);
	}

	public dispose(): void {
		this._isDisposed = true;
		this._firstChunkTimer.dispose();
		this._socket.removeListener('data', this._socketDataListener);
		this._socket.removeListener('end', this._socketEndListener);
		this._socket.removeListener('close', this._socketCloseListener);
	}

	public end(): void {
		this._socket.end();
	}

	public getBuffer(): Buffer {
		return Buffer.concat(this._chunks);
	}

	public send(message: any): void {

		// [bodyIsJson|bodyLen|message]
		// |^header^^^^^^^^^^^|^data^^]

		const header = Buffer.alloc(Protocol._headerLen);

		// ensure string
		if (typeof message !== 'string') {
			message = JSON.stringify(message);
			header.writeInt8(1, 0, true);
		}
		const data = Buffer.from(message);
		header.writeInt32BE(data.length, 1, true);

		this._writeSoon(header, data);
	}

	private _writeBuffer = new class {

		private _data: Buffer[] = [];
		private _totalLength = 0;

		add(head: Buffer, body: Buffer): boolean {
			const wasEmpty = this._totalLength === 0;
			this._data.push(head, body);
			this._totalLength += head.length + body.length;
			return wasEmpty;
		}

		take(): Buffer {
			const ret = Buffer.concat(this._data, this._totalLength);
			this._data.length = 0;
			this._totalLength = 0;
			return ret;
		}
	};

	private _writeSoon(header: Buffer, data: Buffer): void {
		if (this._writeBuffer.add(header, data)) {
			setImmediate(() => {
				// return early if socket has been destroyed in the meantime
				if (this._socket.destroyed) {
					return;
				}
				// we ignore the returned value from `write` because we would have to cached the data
				// anyways and nodejs is already doing that for us:
				// > https://nodejs.org/api/stream.html#stream_writable_write_chunk_encoding_callback
				// > However, the false return value is only advisory and the writable stream will unconditionally
				// > accept and buffer chunk even if it has not not been allowed to drain.
				this._socket.write(this._writeBuffer.take());
			});
		}
	}
}

export class Server extends IPCServer {

	private static toClientConnectionEvent(server: NetServer): Event<ClientConnectionEvent> {
		const onConnection = fromNodeEventEmitter<Socket>(server, 'connection');

		return mapEvent(onConnection, socket => ({
			protocol: new Protocol(socket),
			onDidClientDisconnect: once(fromNodeEventEmitter<void>(socket, 'close'))
		}));
	}

	constructor(private server: NetServer) {
		super(Server.toClientConnectionEvent(server));
	}

	dispose(): void {
		super.dispose();
		this.server.close();
		this.server = null;
	}
}

export class Client extends IPCClient {

	public static fromSocket(socket: Socket, id: string): Client {
		return new Client(new Protocol(socket), id);
	}

	get onClose(): Event<void> { return this.protocol.onClose; }

	constructor(private protocol: Protocol, id: string) {
		super(protocol, id);
	}

	dispose(): void {
		super.dispose();
		this.protocol.end();
	}
}

export function serve(port: number): TPromise<Server>;
export function serve(namedPipe: string): TPromise<Server>;
export function serve(hook: any): TPromise<Server> {
	return new TPromise<Server>((c, e) => {
		const server = createServer();

		server.on('error', e);
		server.listen(hook, () => {
			server.removeListener('error', e);
			c(new Server(server));
		});
	});
}

export function connect(options: { host: string, port: number }, clientId: string): TPromise<Client>;
export function connect(port: number, clientId: string): TPromise<Client>;
export function connect(namedPipe: string, clientId: string): TPromise<Client>;
export function connect(hook: any, clientId: string): TPromise<Client> {
	return new TPromise<Client>((c, e) => {
		const socket = createConnection(hook, () => {
			socket.removeListener('error', e);
			c(Client.fromSocket(socket, clientId));
		});

		socket.once('error', e);
	});
}
