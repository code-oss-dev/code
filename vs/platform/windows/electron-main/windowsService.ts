/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { assign } from 'vs/base/common/objects';
import URI from 'vs/base/common/uri';
import { IWindowsService, OpenContext } from 'vs/platform/windows/common/windows';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { shell, crashReporter, app } from 'electron';
import Event, { chain } from 'vs/base/common/event';
import { fromEventEmitter } from 'vs/base/node/event';
import { IURLService } from 'vs/platform/url/common/url';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { ILifecycleService } from "vs/platform/lifecycle/electron-main/lifecycleMain";
import { IWindowsMainService, ISharedProcess } from "vs/platform/windows/electron-main/windows";
import { IHistoryMainService, IRecentlyOpenedFile, IRecentlyOpened } from "vs/platform/history/common/history";
import { findExtensionDevelopmentWindow } from "vs/code/node/windowsFinder";
import { IWorkspaceIdentifier } from "vs/platform/workspaces/common/workspaces";

export class WindowsService implements IWindowsService, IDisposable {

	_serviceBrand: any;

	private disposables: IDisposable[] = [];

	onWindowOpen: Event<number> = fromEventEmitter(app, 'browser-window-created', (_, w: Electron.BrowserWindow) => w.id);
	onWindowFocus: Event<number> = fromEventEmitter(app, 'browser-window-focus', (_, w: Electron.BrowserWindow) => w.id);

	constructor(
		private sharedProcess: ISharedProcess,
		@IWindowsMainService private windowsMainService: IWindowsMainService,
		@IEnvironmentService private environmentService: IEnvironmentService,
		@IURLService urlService: IURLService,
		@ILifecycleService private lifecycleService: ILifecycleService,
		@IHistoryMainService private historyService: IHistoryMainService
	) {
		// Catch file URLs
		chain(urlService.onOpenURL)
			.filter(uri => uri.authority === 'file' && !!uri.path)
			.map(uri => URI.file(uri.fsPath))
			.on(this.openFileForURI, this, this.disposables);

		// Catch extension URLs when there are no windows open
		chain(urlService.onOpenURL)
			.filter(uri => /^extension/.test(uri.path))
			.filter(() => this.windowsMainService.getWindowCount() === 0)
			.on(this.openExtensionForURI, this, this.disposables);
	}

	pickFileFolderAndOpen(windowId: number, forceNewWindow?: boolean, data?: ITelemetryData): TPromise<void> {
		this.windowsMainService.pickFileFolderAndOpen(forceNewWindow, data);
		return TPromise.as(null);
	}

	pickFileAndOpen(windowId: number, forceNewWindow?: boolean, path?: string, data?: ITelemetryData): TPromise<void> {
		this.windowsMainService.pickFileAndOpen(forceNewWindow, path, undefined, data);
		return TPromise.as(null);
	}

	pickFolderAndOpen(windowId: number, forceNewWindow?: boolean, data?: ITelemetryData): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);
		this.windowsMainService.pickFolderAndOpen(forceNewWindow, codeWindow, data);

		return TPromise.as(null);
	}

	pickFolder(windowId: number, options?: { buttonLabel: string; title: string; }): TPromise<string[]> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		return this.windowsMainService.pickFolder(codeWindow, options);
	}

	reloadWindow(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			this.windowsMainService.reload(codeWindow);
		}

		return TPromise.as(null);
	}

	openDevTools(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.win.webContents.openDevTools();
		}

		return TPromise.as(null);
	}

	toggleDevTools(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			const contents = codeWindow.win.webContents;
			if (codeWindow.hasHiddenTitleBarStyle() && !codeWindow.win.isFullScreen() && !contents.isDevToolsOpened()) {
				contents.openDevTools({ mode: 'undocked' }); // due to https://github.com/electron/electron/issues/3647
			} else {
				contents.toggleDevTools();
			}
		}

		return TPromise.as(null);
	}

	closeFolder(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			this.windowsMainService.open({ context: OpenContext.API, cli: this.environmentService.args, forceEmpty: true, windowToUse: codeWindow, forceReuseWindow: true });
		}

		return TPromise.as(null);
	}

	toggleFullScreen(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.toggleFullScreen();
		}

		return TPromise.as(null);
	}

	setRepresentedFilename(windowId: number, fileName: string): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.setRepresentedFilename(fileName);
		}

		return TPromise.as(null);
	}

	addToRecentlyOpened(recent: (IWorkspaceIdentifier | IRecentlyOpenedFile)[]): TPromise<void> {
		this.historyService.addToRecentlyOpened(recent);

		return TPromise.as(null);
	}

	removeFromRecentlyOpened(toRemove: (IWorkspaceIdentifier | string)[]): TPromise<void> {
		this.historyService.removeFromRecentlyOpened(toRemove);

		return TPromise.as(null);
	}

	clearRecentlyOpened(): TPromise<void> {
		this.historyService.clearRecentlyOpened();

		return TPromise.as(null);
	}

	getRecentlyOpened(windowId: number): TPromise<IRecentlyOpened> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			const recentlyOpened = this.historyService.getRecentlyOpened(codeWindow.config.workspace, codeWindow.config.folderPath, codeWindow.config.filesToOpen);

			return TPromise.as(recentlyOpened);
		}

		return TPromise.as(<IRecentlyOpened>{ workspaces: [], files: [], folders: [] });
	}

	focusWindow(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.win.focus();
		}

		return TPromise.as(null);
	}

	closeWindow(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.win.close();
		}

		return TPromise.as(null);
	}

	isFocused(windowId: number): TPromise<boolean> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			return TPromise.as(codeWindow.win.isFocused());
		}

		return TPromise.as(null);
	}

	isMaximized(windowId: number): TPromise<boolean> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			return TPromise.as(codeWindow.win.isMaximized());
		}

		return TPromise.as(null);
	}

	maximizeWindow(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.win.maximize();
		}

		return TPromise.as(null);
	}

	unmaximizeWindow(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.win.unmaximize();
		}

		return TPromise.as(null);
	}

	onWindowTitleDoubleClick(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.onWindowTitleDoubleClick();
		}

		return TPromise.as(null);
	}

	setDocumentEdited(windowId: number, flag: boolean): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow && codeWindow.win.isDocumentEdited() !== flag) {
			codeWindow.win.setDocumentEdited(flag);
		}

		return TPromise.as(null);
	}

	openWindow(paths: string[], options?: { forceNewWindow?: boolean, forceReuseWindow?: boolean }): TPromise<void> {
		if (!paths || !paths.length) {
			return TPromise.as(null);
		}

		this.windowsMainService.open({ context: OpenContext.API, cli: this.environmentService.args, pathsToOpen: paths, forceNewWindow: options && options.forceNewWindow, forceReuseWindow: options && options.forceReuseWindow });
		return TPromise.as(null);
	}

	openNewWindow(): TPromise<void> {
		this.windowsMainService.openNewWindow(OpenContext.API);
		return TPromise.as(null);
	}

	showWindow(windowId: number): TPromise<void> {
		const codeWindow = this.windowsMainService.getWindowById(windowId);

		if (codeWindow) {
			codeWindow.win.show();
		}

		return TPromise.as(null);
	}

	getWindows(): TPromise<{ id: number; path: string; title: string; }[]> {
		const windows = this.windowsMainService.getWindows();
		const result = windows.map(w => ({ path: w.openedFolderPath, title: w.win.getTitle(), id: w.id, filename: w.getRepresentedFilename() }));

		return TPromise.as(result);
	}

	getWindowCount(): TPromise<number> {
		return TPromise.as(this.windowsMainService.getWindows().length);
	}

	log(severity: string, ...messages: string[]): TPromise<void> {
		console[severity].apply(console, ...messages);
		return TPromise.as(null);
	}

	closeExtensionHostWindow(extensionDevelopmentPaths: string[]): TPromise<void> {
		extensionDevelopmentPaths.map(extensionDevelopmentPath => findExtensionDevelopmentWindow(this.windowsMainService.getWindows(), extensionDevelopmentPath)).forEach(extensionDevelopmentWindow => {
			if (extensionDevelopmentWindow) {
				extensionDevelopmentWindow.win.close();
			}
		});

		return TPromise.as(null);
	}

	showItemInFolder(path: string): TPromise<void> {
		shell.showItemInFolder(path);
		return TPromise.as(null);
	}

	openExternal(url: string): TPromise<boolean> {
		return TPromise.as(shell.openExternal(url));
	}

	startCrashReporter(config: Electron.CrashReporterStartOptions): TPromise<void> {
		crashReporter.start(config);
		return TPromise.as(null);
	}

	quit(): TPromise<void> {
		this.windowsMainService.quit();
		return TPromise.as(null);
	}

	relaunch(options: { addArgs?: string[], removeArgs?: string[] }): TPromise<void> {
		this.lifecycleService.relaunch(options);

		return TPromise.as(null);
	}

	whenSharedProcessReady(): TPromise<void> {
		return this.sharedProcess.whenReady();
	}

	toggleSharedProcess(): TPromise<void> {
		this.sharedProcess.toggle();
		return TPromise.as(null);
	}

	private openFileForURI(uri: URI): TPromise<void> {
		const cli = assign(Object.create(null), this.environmentService.args, { goto: true });
		const pathsToOpen = [uri.fsPath];

		this.windowsMainService.open({ context: OpenContext.API, cli, pathsToOpen });
		return TPromise.as(null);
	}

	/**
	 * This should only fire whenever an extension URL is open
	 * and there are no windows to handle it.
	 */
	private openExtensionForURI(uri: URI): TPromise<void> {
		const cli = assign(Object.create(null), this.environmentService.args);
		this.windowsMainService.open({ context: OpenContext.API, cli });
		return TPromise.as(null);
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}