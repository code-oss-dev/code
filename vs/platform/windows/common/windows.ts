/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IWindowsService = createDecorator<IWindowsService>('windowsService');

export interface IWindowsService {

	_serviceBrand: any;

	openFileFolderPicker(windowId: number, forceNewWindow?: boolean): TPromise<void>;
	openFilePicker(windowId: number, forceNewWindow?: boolean, path?: string): TPromise<void>;
	openFolderPicker(windowId: number, forceNewWindow?: boolean): TPromise<void>;
	reloadWindow(windowId: number): TPromise<void>;
	openDevTools(windowId: number): TPromise<void>;
	toggleDevTools(windowId: number): TPromise<void>;
	// TODO@joao: rename, shouldn't this be closeWindow?
	closeFolder(windowId: number): TPromise<void>;
	toggleFullScreen(windowId: number): TPromise<void>;
	setRepresentedFilename(windowId: number, fileName: string): TPromise<void>;
	getRecentlyOpen(windowId: number): TPromise<{ files: string[]; folders: string[]; }>;

	// Global methods
	// TODO@joao: rename, shouldn't this be openWindow?
	windowOpen(paths: string[], forceNewWindow?: boolean): TPromise<void>;
	openNewWindow(): TPromise<void>;
}

export const IWindowService = createDecorator<IWindowService>('windowService');

export interface IWindowService {

	_serviceBrand: any;

	openFileFolderPicker(forceNewWindow?: boolean): TPromise<void>;
	openFilePicker(forceNewWindow?: boolean, path?: string): TPromise<void>;
	openFolderPicker(forceNewWindow?: boolean): TPromise<void>;
	reloadWindow(): TPromise<void>;
	openDevTools(): TPromise<void>;
	toggleDevTools(): TPromise<void>;
	closeFolder(): TPromise<void>;
	toggleFullScreen(): TPromise<void>;
	setRepresentedFilename(fileName: string): TPromise<void>;
	getRecentlyOpen(): TPromise<{ files: string[]; folders: string[]; }>;
}