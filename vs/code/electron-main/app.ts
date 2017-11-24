/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { app, ipcMain as ipc, BrowserWindow, dialog } from 'electron';
import * as platform from 'vs/base/common/platform';
import { WindowsManager } from 'vs/code/electron-main/windows';
import { IWindowsService, OpenContext } from 'vs/platform/windows/common/windows';
import { WindowsChannel } from 'vs/platform/windows/common/windowsIpc';
import { WindowsService } from 'vs/platform/windows/electron-main/windowsService';
import { ILifecycleService } from 'vs/platform/lifecycle/electron-main/lifecycleMain';
import { CodeMenu } from 'vs/code/electron-main/menus';
import { getShellEnvironment } from 'vs/code/node/shellEnv';
import { IUpdateService } from 'vs/platform/update/common/update';
import { UpdateChannel } from 'vs/platform/update/common/updateIpc';
import { UpdateService } from 'vs/platform/update/electron-main/updateService';
import { Server as ElectronIPCServer } from 'vs/base/parts/ipc/electron-main/ipc.electron-main';
import { Server, connect, Client } from 'vs/base/parts/ipc/node/ipc.net';
import { SharedProcess } from 'vs/code/electron-main/sharedProcess';
import { Mutex } from 'windows-mutex';
import { LaunchService, LaunchChannel, ILaunchService } from './launch';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ILogService } from 'vs/platform/log/common/log';
import { IStateService } from 'vs/platform/state/common/state';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IURLService } from 'vs/platform/url/common/url';
import { URLChannel } from 'vs/platform/url/common/urlIpc';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { ITelemetryAppenderChannel, TelemetryAppenderClient } from 'vs/platform/telemetry/common/telemetryIpc';
import { TelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { resolveCommonProperties } from 'vs/platform/telemetry/node/commonProperties';
import { getDelayedChannel } from 'vs/base/parts/ipc/common/ipc';
import product from 'vs/platform/node/product';
import pkg from 'vs/platform/node/package';
import { ProxyAuthHandler } from './auth';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { ConfigurationService } from 'vs/platform/configuration/node/configurationService';
import { TPromise } from 'vs/base/common/winjs.base';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';
import { IHistoryMainService } from 'vs/platform/history/common/history';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { CodeWindow } from 'vs/code/electron-main/window';
import { KeyboardLayoutMonitor } from 'vs/code/electron-main/keyboard';
import URI from 'vs/base/common/uri';
import { WorkspacesChannel } from 'vs/platform/workspaces/common/workspacesIpc';
import { IWorkspacesMainService } from 'vs/platform/workspaces/common/workspaces';
import { dirname, join } from 'path';
import { touch } from 'vs/base/node/pfs';
import { getMachineId } from 'vs/base/node/id';

export class CodeApplication {

	private static readonly APP_ICON_REFRESH_KEY = 'macOSAppIconRefresh3';
	private static readonly MACHINE_ID_KEY = 'telemetry.machineId';

	private toDispose: IDisposable[];
	private windowsMainService: IWindowsMainService;

	private electronIpcServer: ElectronIPCServer;

	private sharedProcess: SharedProcess;
	private sharedProcessClient: TPromise<Client>;

	constructor(
		private mainIpcServer: Server,
		private userEnv: platform.IProcessEnvironment,
		@IInstantiationService private instantiationService: IInstantiationService,
		@ILogService private logService: ILogService,
		@IEnvironmentService private environmentService: IEnvironmentService,
		@ILifecycleService private lifecycleService: ILifecycleService,
		@IConfigurationService configurationService: ConfigurationService,
		@IStateService private stateService: IStateService,
		@IHistoryMainService private historyMainService: IHistoryMainService
	) {
		this.toDispose = [mainIpcServer, configurationService];

		this.registerListeners();
	}

	private registerListeners(): void {

		// We handle uncaught exceptions here to prevent electron from opening a dialog to the user
		process.on('uncaughtException', (err: any) => {
			if (err) {

				// take only the message and stack property
				const friendlyError = {
					message: err.message,
					stack: err.stack
				};

				// handle on client side
				if (this.windowsMainService) {
					this.windowsMainService.sendToFocused('vscode:reportError', JSON.stringify(friendlyError));
				}
			}

			this.logService.error(`[uncaught exception in main]: ${err}`);
			if (err.stack) {
				this.logService.error(err.stack);
			}
		});

		app.on('will-quit', () => {
			this.logService.log('App#will-quit: disposing resources');

			this.dispose();
		});

		app.on('accessibility-support-changed', (event: Event, accessibilitySupportEnabled: boolean) => {
			if (this.windowsMainService) {
				this.windowsMainService.sendToAll('vscode:accessibilitySupportChanged', accessibilitySupportEnabled);
			}
		});

		app.on('activate', (event: Event, hasVisibleWindows: boolean) => {
			this.logService.log('App#activate');

			// Mac only event: open new window when we get activated
			if (!hasVisibleWindows && this.windowsMainService) {
				this.windowsMainService.openNewWindow(OpenContext.DOCK);
			}
		});

		const isValidWebviewSource = (source: string) =>
			!source || (URI.parse(source.toLowerCase()).toString() as any).startsWith(URI.file(this.environmentService.appRoot.toLowerCase()).toString());

		app.on('web-contents-created', (_event: any, contents) => {
			contents.on('will-attach-webview', (event: Electron.Event, webPreferences, params) => {
				delete webPreferences.preload;
				webPreferences.nodeIntegration = false;

				// Verify URLs being loaded
				if (isValidWebviewSource(params.src) && isValidWebviewSource(webPreferences.preloadURL)) {
					return;
				}

				// Otherwise prevent loading
				this.logService.error('webContents#web-contents-created: Prevented webview attach');
				event.preventDefault();
			});

			contents.on('will-navigate', event => {
				this.logService.error('webContents#will-navigate: Prevented webcontent navigation');
				event.preventDefault();
			});
		});

		let macOpenFiles: string[] = [];
		let runningTimeout: number = null;
		app.on('open-file', (event: Event, path: string) => {
			this.logService.log('App#open-file: ', path);
			event.preventDefault();

			// Keep in array because more might come!
			macOpenFiles.push(path);

			// Clear previous handler if any
			if (runningTimeout !== null) {
				clearTimeout(runningTimeout);
				runningTimeout = null;
			}

			// Handle paths delayed in case more are coming!
			runningTimeout = setTimeout(() => {
				if (this.windowsMainService) {
					this.windowsMainService.open({
						context: OpenContext.DOCK /* can also be opening from finder while app is running */,
						cli: this.environmentService.args,
						pathsToOpen: macOpenFiles,
						preferNewWindow: true /* dropping on the dock or opening from finder prefers to open in a new window */
					});
					macOpenFiles = [];
					runningTimeout = null;
				}
			}, 100);
		});

		app.on('new-window-for-tab', () => {
			this.windowsMainService.openNewWindow(OpenContext.DESKTOP); //macOS native tab "+" button
		});

		ipc.on('vscode:exit', (_event: any, code: number) => {
			this.logService.log('IPC#vscode:exit', code);

			this.dispose();
			this.lifecycleService.kill(code);
		});

		ipc.on('vscode:fetchShellEnv', (_event: any, windowId: number) => {
			const { webContents } = BrowserWindow.fromId(windowId);
			getShellEnvironment().then(shellEnv => {
				if (!webContents.isDestroyed()) {
					webContents.send('vscode:acceptShellEnv', shellEnv);
				}
			}, err => {
				if (!webContents.isDestroyed()) {
					webContents.send('vscode:acceptShellEnv', {});
				}

				this.logService.error('Error fetching shell env', err);
			});
		});

		ipc.on('vscode:broadcast', (_event: any, windowId: number, broadcast: { channel: string; payload: any; }) => {
			if (this.windowsMainService && broadcast.channel && !isUndefinedOrNull(broadcast.payload)) {
				this.logService.log('IPC#vscode:broadcast', broadcast.channel, broadcast.payload);

				// Handle specific events on main side
				this.onBroadcast(broadcast.channel, broadcast.payload);

				// Send to all windows (except sender window)
				this.windowsMainService.sendToAll('vscode:broadcast', broadcast, [windowId]);
			}
		});

		// Keyboard layout changes
		KeyboardLayoutMonitor.INSTANCE.onDidChangeKeyboardLayout(() => {
			if (this.windowsMainService) {
				this.windowsMainService.sendToAll('vscode:keyboardLayoutChanged', false);
			}
		});
	}

	private onBroadcast(event: string, payload: any): void {

		// Theme changes
		if (event === 'vscode:changeColorTheme' && typeof payload === 'string') {
			let data = JSON.parse(payload);

			this.stateService.setItem(CodeWindow.themeStorageKey, data.id);
			this.stateService.setItem(CodeWindow.themeBackgroundStorageKey, data.background);
		}
	}

	public startup(): TPromise<void> {
		this.logService.log('Starting VS Code in verbose mode');
		this.logService.log(`from: ${this.environmentService.appRoot}`);
		this.logService.log('args:', this.environmentService.args);

		// Make sure we associate the program with the app user model id
		// This will help Windows to associate the running program with
		// any shortcut that is pinned to the taskbar and prevent showing
		// two icons in the taskbar for the same app.
		if (platform.isWindows && product.win32AppUserModelId) {
			app.setAppUserModelId(product.win32AppUserModelId);
		}

		// Create Electron IPC Server
		this.electronIpcServer = new ElectronIPCServer();

		// Resolve unique machine ID
		this.logService.log('Resolving machine identifier...');
		return this.resolveMachineId().then(machineId => {
			this.logService.log(`Resolved machine identifier: ${machineId}`);

			// Spawn shared process
			this.sharedProcess = new SharedProcess(this.environmentService, machineId, this.userEnv);
			this.toDispose.push(this.sharedProcess);
			this.sharedProcessClient = this.sharedProcess.whenReady().then(() => connect(this.environmentService.sharedIPCHandle, 'main'));

			// Services
			const appInstantiationService = this.initServices(machineId);

			// Setup Auth Handler
			const authHandler = appInstantiationService.createInstance(ProxyAuthHandler);
			this.toDispose.push(authHandler);

			// Open Windows
			appInstantiationService.invokeFunction(accessor => this.openFirstWindow(accessor));

			// Post Open Windows Tasks
			appInstantiationService.invokeFunction(accessor => this.afterWindowOpen(accessor));
		});
	}

	private resolveMachineId(): TPromise<string> {
		const machineId = this.stateService.getItem<string>(CodeApplication.MACHINE_ID_KEY);
		if (machineId) {
			return TPromise.wrap(machineId);
		}

		return getMachineId().then(machineId => {

			// Remember in global storage
			this.stateService.setItem(CodeApplication.MACHINE_ID_KEY, machineId);

			return machineId;
		});
	}

	private initServices(machineId: string): IInstantiationService {
		const services = new ServiceCollection();

		services.set(IUpdateService, new SyncDescriptor(UpdateService));
		services.set(IWindowsMainService, new SyncDescriptor(WindowsManager, machineId));
		services.set(IWindowsService, new SyncDescriptor(WindowsService, this.sharedProcess));
		services.set(ILaunchService, new SyncDescriptor(LaunchService));

		// Telemtry
		if (this.environmentService.isBuilt && !this.environmentService.isExtensionDevelopment && !this.environmentService.args['disable-telemetry'] && !!product.enableTelemetry) {
			const channel = getDelayedChannel<ITelemetryAppenderChannel>(this.sharedProcessClient.then(c => c.getChannel('telemetryAppender')));
			const appender = new TelemetryAppenderClient(channel);
			const commonProperties = resolveCommonProperties(product.commit, pkg.version, machineId, this.environmentService.installSourcePath);
			const piiPaths = [this.environmentService.appRoot, this.environmentService.extensionsPath];
			const config: ITelemetryServiceConfig = { appender, commonProperties, piiPaths };

			services.set(ITelemetryService, new SyncDescriptor(TelemetryService, config));
		} else {
			services.set(ITelemetryService, NullTelemetryService);
		}

		return this.instantiationService.createChild(services);
	}

	private openFirstWindow(accessor: ServicesAccessor): void {
		const appInstantiationService = accessor.get(IInstantiationService);

		// TODO@Joao: unfold this
		this.windowsMainService = accessor.get(IWindowsMainService);

		// TODO@Joao: so ugly...
		this.windowsMainService.onWindowsCountChanged(e => {
			if (!platform.isMacintosh && e.newCount === 0) {
				this.sharedProcess.dispose();
			}
		});

		// Register more Main IPC services
		const launchService = accessor.get(ILaunchService);
		const launchChannel = new LaunchChannel(launchService);
		this.mainIpcServer.registerChannel('launch', launchChannel);

		// Register more Electron IPC services
		const updateService = accessor.get(IUpdateService);
		const updateChannel = new UpdateChannel(updateService);
		this.electronIpcServer.registerChannel('update', updateChannel);

		const urlService = accessor.get(IURLService);
		const urlChannel = appInstantiationService.createInstance(URLChannel, urlService);
		this.electronIpcServer.registerChannel('url', urlChannel);

		const workspacesService = accessor.get(IWorkspacesMainService);
		const workspacesChannel = appInstantiationService.createInstance(WorkspacesChannel, workspacesService);
		this.electronIpcServer.registerChannel('workspaces', workspacesChannel);

		const windowsService = accessor.get(IWindowsService);
		const windowsChannel = new WindowsChannel(windowsService);
		this.electronIpcServer.registerChannel('windows', windowsChannel);
		this.sharedProcessClient.done(client => client.registerChannel('windows', windowsChannel));

		// Lifecycle
		this.lifecycleService.ready();

		// Propagate to clients
		this.windowsMainService.ready(this.userEnv);

		// Open our first window
		const args = this.environmentService.args;
		const context = !!process.env['VSCODE_CLI'] ? OpenContext.CLI : OpenContext.DESKTOP;
		if (args['new-window'] && args._.length === 0) {
			this.windowsMainService.open({ context, cli: args, forceNewWindow: true, forceEmpty: true, initialStartup: true }); // new window if "-n" was used without paths
		} else if (global.macOpenFiles && global.macOpenFiles.length && (!args._ || !args._.length)) {
			this.windowsMainService.open({ context: OpenContext.DOCK, cli: args, pathsToOpen: global.macOpenFiles, initialStartup: true }); // mac: open-file event received on startup
		} else {
			this.windowsMainService.open({ context, cli: args, forceNewWindow: args['new-window'] || (!args._.length && args['unity-launch']), diffMode: args.diff, initialStartup: true }); // default: read paths from cli
		}
	}

	private afterWindowOpen(accessor: ServicesAccessor): void {
		const appInstantiationService = accessor.get(IInstantiationService);

		let windowsMutex: Mutex = null;
		if (platform.isWindows) {

			// Setup Windows mutex
			try {
				const Mutex = (require.__$__nodeRequire('windows-mutex') as any).Mutex;
				windowsMutex = new Mutex(product.win32MutexName);
				this.toDispose.push({ dispose: () => windowsMutex.release() });
			} catch (e) {
				if (!this.environmentService.isBuilt) {
					dialog.showMessageBox({
						title: product.nameLong,
						type: 'warning',
						message: 'Failed to load windows-mutex!',
						detail: e.toString(),
						noLink: true
					});
				}
			}

			// Ensure Windows foreground love module
			try {
				// tslint:disable-next-line:no-unused-expression
				<any>require.__$__nodeRequire('windows-foreground-love');
			} catch (e) {
				if (!this.environmentService.isBuilt) {
					dialog.showMessageBox({
						title: product.nameLong,
						type: 'warning',
						message: 'Failed to load windows-foreground-love!',
						detail: e.toString(),
						noLink: true
					});
				}
			}
		}

		// Install Menu
		appInstantiationService.createInstance(CodeMenu);

		// Jump List
		this.historyMainService.updateWindowsJumpList();
		this.historyMainService.onRecentlyOpenedChange(() => this.historyMainService.updateWindowsJumpList());

		// Start shared process here
		this.sharedProcess.spawn();

		// Helps application icon refresh after an update with new icon is installed (macOS)
		// TODO@Ben remove after a couple of releases
		if (platform.isMacintosh) {
			if (!this.stateService.getItem(CodeApplication.APP_ICON_REFRESH_KEY)) {
				this.stateService.setItem(CodeApplication.APP_ICON_REFRESH_KEY, true);

				// 'exe' => /Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron
				const appPath = dirname(dirname(dirname(app.getPath('exe'))));
				const infoPlistPath = join(appPath, 'Contents', 'Info.plist');
				touch(appPath).done(null, error => { /* ignore */ });
				touch(infoPlistPath).done(null, error => { /* ignore */ });
			}
		}
	}

	private dispose(): void {
		this.toDispose = dispose(this.toDispose);
	}
}
