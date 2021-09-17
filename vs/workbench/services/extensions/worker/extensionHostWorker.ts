/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMessagePassingProtocol } from 'vs/base/parts/ipc/common/ipc';
import { VSBuffer } from 'vs/base/common/buffer';
import { Emitter } from 'vs/base/common/event';
import { isMessageOfType, MessageType, createMessageOfType } from 'vs/workbench/services/extensions/common/extensionHostProtocol';
import { IInitData } from 'vs/workbench/api/common/extHost.protocol';
import { ExtensionHostMain } from 'vs/workbench/services/extensions/common/extensionHostMain';
import { IHostUtils } from 'vs/workbench/api/common/extHostExtensionService';
import { NestedWorker } from 'vs/workbench/services/extensions/worker/polyfillNestedWorker';
import * as path from 'vs/base/common/path';
import * as performance from 'vs/base/common/performance';

import 'vs/workbench/api/common/extHost.common.services';
import 'vs/workbench/api/worker/extHost.worker.services';
import { FileAccess } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';

//#region --- Define, capture, and override some globals

declare function postMessage(data: any, transferables?: Transferable[]): void;

declare type _Fetch = typeof fetch;

declare namespace self {
	let close: any;
	let postMessage: any;
	let addEventListener: any;
	let removeEventListener: any;
	let dispatchEvent: any;
	let indexedDB: { open: any, [k: string]: any };
	let caches: { open: any, [k: string]: any };
	let importScripts: any;
	let fetch: _Fetch;
	let XMLHttpRequest: any;
	let trustedTypes: any;
}

const nativeClose = self.close.bind(self);
self.close = () => console.trace(`'close' has been blocked`);

const nativePostMessage = postMessage.bind(self);
self.postMessage = () => console.trace(`'postMessage' has been blocked`);

const nativeFetch = fetch.bind(self);
self.fetch = function (input, init) {
	if (input instanceof Request) {
		// Request object - massage not supported
		return nativeFetch(input, init);
	}
	if (/^file:/i.test(String(input))) {
		input = FileAccess.asBrowserUri(URI.parse(String(input))).toString(true);
	}
	return nativeFetch(input, init);
};

self.XMLHttpRequest = class extends XMLHttpRequest {
	override open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null): void {
		if (/^file:/i.test(url.toString())) {
			url = FileAccess.asBrowserUri(URI.parse(url.toString())).toString(true);
		}
		return super.open(method, url, async ?? true, username, password);
	}
};

self.importScripts = () => { throw new Error(`'importScripts' has been blocked`); };

// const nativeAddEventListener = addEventListener.bind(self);
self.addEventListener = () => console.trace(`'addEventListener' has been blocked`);

(<any>self)['AMDLoader'] = undefined;
(<any>self)['NLSLoaderPlugin'] = undefined;
(<any>self)['define'] = undefined;
(<any>self)['require'] = undefined;
(<any>self)['webkitRequestFileSystem'] = undefined;
(<any>self)['webkitRequestFileSystemSync'] = undefined;
(<any>self)['webkitResolveLocalFileSystemSyncURL'] = undefined;
(<any>self)['webkitResolveLocalFileSystemURL'] = undefined;

if ((<any>self).Worker) {
	const ttPolicy = (<any>self).trustedTypes?.createPolicy('extensionHostWorker', { createScriptURL: (value: string) => value });

	// make sure new Worker(...) always uses blob: (to maintain current origin)
	const _Worker = (<any>self).Worker;
	Worker = <any>function (stringUrl: string | URL, options?: WorkerOptions) {
		if (/^file:/i.test(stringUrl.toString())) {
			stringUrl = FileAccess.asBrowserUri(URI.parse(stringUrl.toString())).toString(true);
		}

		// IMPORTANT: bootstrapFn is stringified and injected as worker blob-url. Because of that it CANNOT
		// have dependencies on other functions or variables. Only constant values are supported. Due to
		// that logic of FileAccess.asBrowserUri had to be copied, see `asWorkerBrowserUrl` (below).
		const bootstrapFnSource = (function bootstrapFn(workerUrl: string) {
			function asWorkerBrowserUrl(url: string | URL | TrustedScriptURL): any {
				if (typeof url === 'string' || url instanceof URL) {
					return String(url).replace(/^file:\/\//i, 'vscode-file://vscode-app');
				}
				return url;
			}

			const nativeFetch = fetch.bind(self);
			self.fetch = function (input, init) {
				if (input instanceof Request) {
					// Request object - massage not supported
					return nativeFetch(input, init);
				}
				return nativeFetch(asWorkerBrowserUrl(input), init);
			};
			self.XMLHttpRequest = class extends XMLHttpRequest {
				override open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null): void {
					return super.open(method, asWorkerBrowserUrl(url), async ?? true, username, password);
				}
			};
			const nativeImportScripts = importScripts.bind(self);
			self.importScripts = (...urls: string[]) => {
				nativeImportScripts(...urls.map(asWorkerBrowserUrl));
			};

			const ttPolicy = self.trustedTypes ? self.trustedTypes.createPolicy('extensionHostWorker', { createScriptURL: (value: string) => value }) : undefined;
			nativeImportScripts(ttPolicy ? ttPolicy.createScriptURL(workerUrl) : workerUrl);
		}).toString();

		const js = `(${bootstrapFnSource}('${stringUrl}'))`;
		options = options || {};
		options.name = options.name || path.basename(stringUrl.toString());
		const blob = new Blob([js], { type: 'application/javascript' });
		const blobUrl = URL.createObjectURL(blob);
		return new _Worker(ttPolicy ? ttPolicy.createScriptURL(blobUrl) : blobUrl, options);
	};

} else {
	(<any>self).Worker = class extends NestedWorker {
		constructor(stringOrUrl: string | URL, options?: WorkerOptions) {
			super(nativePostMessage, stringOrUrl, { name: path.basename(stringOrUrl.toString()), ...options });
		}
	};
}

//#endregion ---

const hostUtil = new class implements IHostUtils {
	declare readonly _serviceBrand: undefined;
	exit(_code?: number | undefined): void {
		nativeClose();
	}
	async exists(_path: string): Promise<boolean> {
		return true;
	}
	async realpath(path: string): Promise<string> {
		return path;
	}
};


class ExtensionWorker {

	// protocol
	readonly protocol: IMessagePassingProtocol;

	constructor() {

		const channel = new MessageChannel();
		const emitter = new Emitter<VSBuffer>();
		let terminating = false;

		// send over port2, keep port1
		nativePostMessage(channel.port2, [channel.port2]);

		channel.port1.onmessage = event => {
			const { data } = event;
			if (!(data instanceof ArrayBuffer)) {
				console.warn('UNKNOWN data received', data);
				return;
			}

			const msg = VSBuffer.wrap(new Uint8Array(data, 0, data.byteLength));
			if (isMessageOfType(msg, MessageType.Terminate)) {
				// handle terminate-message right here
				terminating = true;
				onTerminate('received terminate message from renderer');
				return;
			}

			// emit non-terminate messages to the outside
			emitter.fire(msg);
		};

		this.protocol = {
			onMessage: emitter.event,
			send: vsbuf => {
				if (!terminating) {
					const data = vsbuf.buffer.buffer.slice(vsbuf.buffer.byteOffset, vsbuf.buffer.byteOffset + vsbuf.buffer.byteLength);
					channel.port1.postMessage(data, [data]);
				}
			}
		};
	}
}

interface IRendererConnection {
	protocol: IMessagePassingProtocol;
	initData: IInitData;
}
function connectToRenderer(protocol: IMessagePassingProtocol): Promise<IRendererConnection> {
	return new Promise<IRendererConnection>(resolve => {
		const once = protocol.onMessage(raw => {
			once.dispose();
			const initData = <IInitData>JSON.parse(raw.toString());
			protocol.send(createMessageOfType(MessageType.Initialized));
			resolve({ protocol, initData });
		});
		protocol.send(createMessageOfType(MessageType.Ready));
	});
}

let onTerminate = (reason: string) => nativeClose();

export function create(): void {
	const res = new ExtensionWorker();
	performance.mark(`code/extHost/willConnectToRenderer`);
	connectToRenderer(res.protocol).then(data => {
		performance.mark(`code/extHost/didWaitForInitData`);
		const extHostMain = new ExtensionHostMain(
			data.protocol,
			data.initData,
			hostUtil,
			null,
		);

		onTerminate = (reason: string) => extHostMain.terminate(reason);
	});
}
