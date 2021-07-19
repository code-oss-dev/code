/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// #######################################################################
// ###                                                                 ###
// ###      electron.d.ts types we expose from electron-sandbox        ###
// ###                    (copied from Electron 11.x)                  ###
// ###                                                                 ###
// #######################################################################

export interface IpcRendererEvent extends Event {

	// Docs: https://electronjs.org/docs/api/structures/ipc-renderer-event

	// Note: API with `Transferable` intentionally commented out because you
	// cannot transfer these when `contextIsolation: true`.
	// /**
	//  * A list of MessagePorts that were transferred with this message
	//  */
	// ports: MessagePort[];
	/**
	 * The `IpcRenderer` instance that emitted the event originally
	 */
	sender: IpcRenderer;
	/**
	 * The `webContents.id` that sent the message, you can call
	 * `event.sender.sendTo(event.senderId, ...)` to reply to the message, see
	 * ipcRenderer.sendTo for more information. This only applies to messages sent from
	 * a different renderer. Messages sent directly from the main process set
	 * `event.senderId` to `0`.
	 */
	senderId: number;
}

export interface IpcRenderer {

	// Docs: https://electronjs.org/docs/api/ipc-renderer

	/**
	 * Listens to `channel`, when a new message arrives `listener` would be called with
	 * `listener(event, args...)`.
	 */
	on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): this;
	/**
	 * Adds a one time `listener` function for the event. This `listener` is invoked
	 * only the next time a message is sent to `channel`, after which it is removed.
	 */
	once(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): this;
	/**
	 * Removes the specified `listener` from the listener array for the specified
	 * `channel`.
	 */
	removeListener(channel: string, listener: (...args: any[]) => void): this;
	/**
	 * Send an asynchronous message to the main process via `channel`, along with
	 * arguments. Arguments will be serialized with the Structured Clone Algorithm,
	 * just like `window.postMessage`, so prototype chains will not be included.
	 * Sending Functions, Promises, Symbols, WeakMaps, or WeakSets will throw an
	 * exception.
	 *
	 * > **NOTE:** Sending non-standard JavaScript types such as DOM objects or special
	 * Electron objects will throw an exception.
	 *
	 * Since the main process does not have support for DOM objects such as
	 * `ImageBitmap`, `File`, `DOMMatrix` and so on, such objects cannot be sent over
	 * Electron's IPC to the main process, as the main process would have no way to
	 * decode them. Attempting to send such objects over IPC will result in an error.
	 *
	 * The main process handles it by listening for `channel` with the `ipcMain`
	 * module.
	 *
	 * If you need to transfer a `MessagePort` to the main process, use
	 * `ipcRenderer.postMessage`.
	 *
	 * If you want to receive a single response from the main process, like the result
	 * of a method call, consider using `ipcRenderer.invoke`.
	 */
	send(channel: string, ...args: any[]): void;
	/**
	 * Resolves with the response from the main process.
	 *
	 * Send a message to the main process via `channel` and expect a result
	 * asynchronously. Arguments will be serialized with the Structured Clone
	 * Algorithm, just like `window.postMessage`, so prototype chains will not be
	 * included. Sending Functions, Promises, Symbols, WeakMaps, or WeakSets will throw
	 * an exception.
	 *
	 * > **NOTE:** Sending non-standard JavaScript types such as DOM objects or special
	 * Electron objects will throw an exception.
	 *
	 * Since the main process does not have support for DOM objects such as
	 * `ImageBitmap`, `File`, `DOMMatrix` and so on, such objects cannot be sent over
	 * Electron's IPC to the main process, as the main process would have no way to
	 * decode them. Attempting to send such objects over IPC will result in an error.
	 *
	 * The main process should listen for `channel` with `ipcMain.handle()`.
	 *
	 * For example:
	 *
	 * If you need to transfer a `MessagePort` to the main process, use
	 * `ipcRenderer.postMessage`.
	 *
	 * If you do not need a response to the message, consider using `ipcRenderer.send`.
	 */
	invoke(channel: string, ...args: any[]): Promise<any>;

	// Note: API with `Transferable` intentionally commented out because you
	// cannot transfer these when `contextIsolation: true`.
	// /**
	//  * Send a message to the main process, optionally transferring ownership of zero or
	//  * more `MessagePort` objects.
	//  *
	//  * The transferred `MessagePort` objects will be available in the main process as
	//  * `MessagePortMain` objects by accessing the `ports` property of the emitted
	//  * event.
	//  *
	//  * For example:
	//  *
	//  * For more information on using `MessagePort` and `MessageChannel`, see the MDN
	//  * documentation.
	//  */
	// postMessage(channel: string, message: any, transfer?: MessagePort[]): void;
}

export interface WebFrame {
	/**
	 * Changes the zoom level to the specified level. The original size is 0 and each
	 * increment above or below represents zooming 20% larger or smaller to default
	 * limits of 300% and 50% of original size, respectively.
	 *
	 * > **NOTE**: The zoom policy at the Chromium level is same-origin, meaning that
	 * the zoom level for a specific domain propagates across all instances of windows
	 * with the same domain. Differentiating the window URLs will make zoom work
	 * per-window.
	 */
	setZoomLevel(level: number): void;
}

export interface ProcessMemoryInfo {

	// Docs: https://electronjs.org/docs/api/structures/process-memory-info

	/**
	 * The amount of memory not shared by other processes, such as JS heap or HTML
	 * content in Kilobytes.
	 */
	private: number;
	/**
	 * The amount of memory currently pinned to actual physical RAM in Kilobytes.
	 *
	 * @platform linux,win32
	 */
	residentSet: number;
	/**
	 * The amount of memory shared between processes, typically memory consumed by the
	 * Electron code itself in Kilobytes.
	 */
	shared: number;
}

export interface CrashReporterStartOptions {
	/**
	 * URL that crash reports will be sent to as POST.
	 */
	submitURL: string;
	/**
	 * Defaults to `app.name`.
	 */
	productName?: string;
	/**
	 * Deprecated alias for `{ globalExtra: { _companyName: ... } }`.
	 *
	 * @deprecated
	 */
	companyName?: string;
	/**
	 * Whether crash reports should be sent to the server. If false, crash reports will
	 * be collected and stored in the crashes directory, but not uploaded. Default is
	 * `true`.
	 */
	uploadToServer?: boolean;
	/**
	 * If true, crashes generated in the main process will not be forwarded to the
	 * system crash handler. Default is `false`.
	 */
	ignoreSystemCrashHandler?: boolean;
	/**
	 * If true, limit the number of crashes uploaded to 1/hour. Default is `false`.
	 *
	 * @platform darwin,win32
	 */
	rateLimit?: boolean;
	/**
	 * If true, crash reports will be compressed and uploaded with `Content-Encoding:
	 * gzip`. Default is `true`.
	 */
	compress?: boolean;
	/**
	 * Extra string key/value annotations that will be sent along with crash reports
	 * that are generated in the main process. Only string values are supported.
	 * Crashes generated in child processes will not contain these extra parameters to
	 * crash reports generated from child processes, call `addExtraParameter` from the
	 * child process.
	 */
	extra?: Record<string, string>;
	/**
	 * Extra string key/value annotations that will be sent along with any crash
	 * reports generated in any process. These annotations cannot be changed once the
	 * crash reporter has been started. If a key is present in both the global extra
	 * parameters and the process-specific extra parameters, then the global one will
	 * take precedence. By default, `productName` and the app version are included, as
	 * well as the Electron version.
	 */
	globalExtra?: Record<string, string>;
}

/**
 * Additional information around a `app.on('login')` event.
 */
export interface AuthInfo {
	isProxy: boolean;
	scheme: string;
	host: string;
	port: number;
	realm: string;
}
