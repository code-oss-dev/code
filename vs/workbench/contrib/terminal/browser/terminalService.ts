/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { basename } from 'vs/base/common/path';
import { isMacintosh, isWeb, isWindows, OperatingSystem } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { FindReplaceState } from 'vs/editor/contrib/find/findState';
import * as nls from 'vs/nls';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IPickOptions, IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IViewDescriptorService, IViewsService, ViewContainerLocation } from 'vs/workbench/common/views';
import { IRemoteTerminalService, ITerminalExternalLinkProvider, ITerminalInstance, ITerminalService, ITerminalTab, TerminalShellType, WindowsShellType } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { TerminalInstance } from 'vs/workbench/contrib/terminal/browser/terminalInstance';
import { TerminalTab } from 'vs/workbench/contrib/terminal/browser/terminalTab';
import { TerminalViewPane } from 'vs/workbench/contrib/terminal/browser/terminalView';
import { IAvailableShellsRequest, IShellDefinition, IShellLaunchConfig, ISpawnExtHostProcessRequest, IStartExtensionTerminalRequest, ITerminalConfigHelper, ITerminalLaunchError, ITerminalNativeWindowsDelegate, ITerminalProcessExtHostProxy, KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE, KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_IS_OPEN, KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE, LinuxDistro, TERMINAL_VIEW_ID } from 'vs/workbench/contrib/terminal/common/terminal';
import { escapeNonWindowsPath } from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';

interface IExtHostReadyEntry {
	promise: Promise<void>;
	resolve: () => void;
}

export class TerminalService implements ITerminalService {
	public _serviceBrand: undefined;

	private _isShuttingDown: boolean;
	private _terminalFocusContextKey: IContextKey<boolean>;
	private _terminalShellTypeContextKey: IContextKey<string>;
	private _findWidgetVisible: IContextKey<boolean>;
	private _terminalTabs: ITerminalTab[] = [];
	private _backgroundedTerminalInstances: ITerminalInstance[] = [];
	private get _terminalInstances(): ITerminalInstance[] {
		return this._terminalTabs.reduce((p, c) => p.concat(c.terminalInstances), <ITerminalInstance[]>[]);
	}
	private _findState: FindReplaceState;
	private _extHostsReady: { [authority: string]: IExtHostReadyEntry | undefined } = {};
	private _activeTabIndex: number;
	private _linkProviders: Set<ITerminalExternalLinkProvider> = new Set();
	private _linkProviderDisposables: Map<ITerminalExternalLinkProvider, IDisposable[]> = new Map();
	private _processSupportContextKey: IContextKey<boolean>;

	public get activeTabIndex(): number { return this._activeTabIndex; }
	public get terminalInstances(): ITerminalInstance[] { return this._terminalInstances; }
	public get terminalTabs(): ITerminalTab[] { return this._terminalTabs; }
	public get isProcessSupportRegistered(): boolean { return !!this._processSupportContextKey.get(); }

	private _configHelper: TerminalConfigHelper;
	private _terminalContainer: HTMLElement | undefined;
	private _nativeWindowsDelegate: ITerminalNativeWindowsDelegate | undefined;

	public get configHelper(): ITerminalConfigHelper { return this._configHelper; }

	private readonly _onActiveTabChanged = new Emitter<void>();
	public get onActiveTabChanged(): Event<void> { return this._onActiveTabChanged.event; }
	private readonly _onInstanceCreated = new Emitter<ITerminalInstance>();
	public get onInstanceCreated(): Event<ITerminalInstance> { return this._onInstanceCreated.event; }
	private readonly _onInstanceDisposed = new Emitter<ITerminalInstance>();
	public get onInstanceDisposed(): Event<ITerminalInstance> { return this._onInstanceDisposed.event; }
	private readonly _onInstanceProcessIdReady = new Emitter<ITerminalInstance>();
	public get onInstanceProcessIdReady(): Event<ITerminalInstance> { return this._onInstanceProcessIdReady.event; }
	private readonly _onInstanceLinksReady = new Emitter<ITerminalInstance>();
	public get onInstanceLinksReady(): Event<ITerminalInstance> { return this._onInstanceLinksReady.event; }
	private readonly _onInstanceRequestSpawnExtHostProcess = new Emitter<ISpawnExtHostProcessRequest>();
	public get onInstanceRequestSpawnExtHostProcess(): Event<ISpawnExtHostProcessRequest> { return this._onInstanceRequestSpawnExtHostProcess.event; }
	private readonly _onInstanceRequestStartExtensionTerminal = new Emitter<IStartExtensionTerminalRequest>();
	public get onInstanceRequestStartExtensionTerminal(): Event<IStartExtensionTerminalRequest> { return this._onInstanceRequestStartExtensionTerminal.event; }
	private readonly _onInstanceDimensionsChanged = new Emitter<ITerminalInstance>();
	public get onInstanceDimensionsChanged(): Event<ITerminalInstance> { return this._onInstanceDimensionsChanged.event; }
	private readonly _onInstanceMaximumDimensionsChanged = new Emitter<ITerminalInstance>();
	public get onInstanceMaximumDimensionsChanged(): Event<ITerminalInstance> { return this._onInstanceMaximumDimensionsChanged.event; }
	private readonly _onInstancesChanged = new Emitter<void>();
	public get onInstancesChanged(): Event<void> { return this._onInstancesChanged.event; }
	private readonly _onInstanceTitleChanged = new Emitter<ITerminalInstance | undefined>();
	public get onInstanceTitleChanged(): Event<ITerminalInstance | undefined> { return this._onInstanceTitleChanged.event; }
	private readonly _onActiveInstanceChanged = new Emitter<ITerminalInstance | undefined>();
	public get onActiveInstanceChanged(): Event<ITerminalInstance | undefined> { return this._onActiveInstanceChanged.event; }
	private readonly _onTabDisposed = new Emitter<ITerminalTab>();
	public get onTabDisposed(): Event<ITerminalTab> { return this._onTabDisposed.event; }
	private readonly _onRequestAvailableShells = new Emitter<IAvailableShellsRequest>();
	public get onRequestAvailableShells(): Event<IAvailableShellsRequest> { return this._onRequestAvailableShells.event; }
	private readonly _onDidRegisterProcessSupport = new Emitter<void>();
	public get onDidRegisterProcessSupport(): Event<void> { return this._onDidRegisterProcessSupport.event; }

	constructor(
		@IContextKeyService private _contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService private _layoutService: IWorkbenchLayoutService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IDialogService private _dialogService: IDialogService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@IExtensionService private _extensionService: IExtensionService,
		@IRemoteAgentService private _remoteAgentService: IRemoteAgentService,
		@IQuickInputService private _quickInputService: IQuickInputService,
		@IConfigurationService private _configurationService: IConfigurationService,
		@IViewsService private _viewsService: IViewsService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IConfigurationService private readonly _workspaceConfigurationService: IConfigurationService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IRemoteTerminalService private readonly _remoteTerminalService: IRemoteTerminalService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService
	) {
		this._activeTabIndex = 0;
		this._isShuttingDown = false;
		this._findState = new FindReplaceState();
		lifecycleService.onBeforeShutdown(async event => event.veto(this._onBeforeShutdown()));
		lifecycleService.onShutdown(() => this._onShutdown());
		this._terminalFocusContextKey = KEYBINDING_CONTEXT_TERMINAL_FOCUS.bindTo(this._contextKeyService);
		this._terminalShellTypeContextKey = KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE.bindTo(this._contextKeyService);
		this._findWidgetVisible = KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE.bindTo(this._contextKeyService);
		this._configHelper = this._instantiationService.createInstance(TerminalConfigHelper);
		this.onTabDisposed(tab => this._removeTab(tab));
		this.onActiveTabChanged(() => {
			const instance = this.getActiveInstance();
			this._onActiveInstanceChanged.fire(instance ? instance : undefined);
		});
		this.onInstanceLinksReady(instance => this._setInstanceLinkProviders(instance));

		this._handleInstanceContextKeys();
		this._processSupportContextKey = KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED.bindTo(this._contextKeyService);
		this._processSupportContextKey.set(!isWeb || this._remoteAgentService.getConnection() !== null);
	}

	public setNativeWindowsDelegate(delegate: ITerminalNativeWindowsDelegate): void {
		this._nativeWindowsDelegate = delegate;
	}

	public setLinuxDistro(linuxDistro: LinuxDistro): void {
		this._configHelper.setLinuxDistro(linuxDistro);
	}

	private _handleInstanceContextKeys(): void {
		const terminalIsOpenContext = KEYBINDING_CONTEXT_TERMINAL_IS_OPEN.bindTo(this._contextKeyService);
		const updateTerminalContextKeys = () => {
			terminalIsOpenContext.set(this.terminalInstances.length > 0);
		};
		this.onInstancesChanged(() => updateTerminalContextKeys());
	}

	public getActiveOrCreateInstance(): ITerminalInstance {
		const activeInstance = this.getActiveInstance();
		return activeInstance ? activeInstance : this.createTerminal(undefined);
	}

	public async requestSpawnExtHostProcess(proxy: ITerminalProcessExtHostProxy, shellLaunchConfig: IShellLaunchConfig, activeWorkspaceRootUri: URI | undefined, cols: number, rows: number, isWorkspaceShellAllowed: boolean): Promise<ITerminalLaunchError | undefined> {
		await this._extensionService.whenInstalledExtensionsRegistered();
		// Wait for the remoteAuthority to be ready (and listening for events) before firing
		// the event to spawn the ext host process
		const conn = this._remoteAgentService.getConnection();
		const remoteAuthority = conn ? conn.remoteAuthority : 'null';
		await this._whenExtHostReady(remoteAuthority);
		return new Promise<ITerminalLaunchError | undefined>(callback => {
			this._onInstanceRequestSpawnExtHostProcess.fire({ proxy, shellLaunchConfig, activeWorkspaceRootUri, cols, rows, isWorkspaceShellAllowed, callback });
		});
	}

	public requestStartExtensionTerminal(proxy: ITerminalProcessExtHostProxy, cols: number, rows: number): Promise<ITerminalLaunchError | undefined> {
		// The initial request came from the extension host, no need to wait for it
		return new Promise<ITerminalLaunchError | undefined>(callback => {
			this._onInstanceRequestStartExtensionTerminal.fire({ proxy, cols, rows, callback });
		});
	}

	public async extHostReady(remoteAuthority: string): Promise<void> {
		this._createExtHostReadyEntry(remoteAuthority);
		this._extHostsReady[remoteAuthority]!.resolve();
	}

	private async _whenExtHostReady(remoteAuthority: string): Promise<void> {
		this._createExtHostReadyEntry(remoteAuthority);
		return this._extHostsReady[remoteAuthority]!.promise;
	}

	private _createExtHostReadyEntry(remoteAuthority: string): void {
		if (this._extHostsReady[remoteAuthority]) {
			return;
		}

		let resolve!: () => void;
		const promise = new Promise<void>(r => resolve = r);
		this._extHostsReady[remoteAuthority] = { promise, resolve };
	}

	private _onBeforeShutdown(): boolean | Promise<boolean> {
		if (this.terminalInstances.length === 0) {
			// No terminal instances, don't veto
			return false;
		}

		if (this.configHelper.config.confirmOnExit) {
			return this._onBeforeShutdownAsync();
		}

		this._isShuttingDown = true;

		return false;
	}

	private async _onBeforeShutdownAsync(): Promise<boolean> {
		// veto if configured to show confirmation and the user choosed not to exit
		const veto = await this._showTerminalCloseConfirmation();
		if (!veto) {
			this._isShuttingDown = true;
		}
		return veto;
	}

	private _onShutdown(): void {
		// Dispose of all instances
		this.terminalInstances.forEach(instance => instance.dispose(true));
	}

	public getTabLabels(): string[] {
		return this._terminalTabs.map((tab, index) => `${index + 1}: ${tab.title ? tab.title : ''}`);
	}

	public getFindState(): FindReplaceState {
		return this._findState;
	}

	private _removeTab(tab: ITerminalTab): void {
		// Get the index of the tab and remove it from the list
		const index = this._terminalTabs.indexOf(tab);
		const activeTab = this.getActiveTab();
		const activeTabIndex = activeTab ? this._terminalTabs.indexOf(activeTab) : -1;
		const wasActiveTab = tab === activeTab;
		if (index !== -1) {
			this._terminalTabs.splice(index, 1);
		}

		// Adjust focus if the tab was active
		if (wasActiveTab && this._terminalTabs.length > 0) {
			// TODO: Only focus the new tab if the removed tab had focus?
			// const hasFocusOnExit = tab.activeInstance.hadFocusOnExit;
			const newIndex = index < this._terminalTabs.length ? index : this._terminalTabs.length - 1;
			this.setActiveTabByIndex(newIndex);
			const activeInstance = this.getActiveInstance();
			if (activeInstance) {
				activeInstance.focus(true);
			}
		} else if (activeTabIndex >= this._terminalTabs.length) {
			const newIndex = this._terminalTabs.length - 1;
			this.setActiveTabByIndex(newIndex);
		}

		// Hide the panel if there are no more instances, provided that VS Code is not shutting
		// down. When shutting down the panel is locked in place so that it is restored upon next
		// launch.
		if (this._terminalTabs.length === 0 && !this._isShuttingDown) {
			this.hidePanel();
			this._onActiveInstanceChanged.fire(undefined);
		}

		// Fire events
		this._onInstancesChanged.fire();
		if (wasActiveTab) {
			this._onActiveTabChanged.fire();
		}
	}

	public refreshActiveTab(): void {
		// Fire active instances changed
		this._onActiveTabChanged.fire();
	}

	public getActiveTab(): ITerminalTab | null {
		if (this._activeTabIndex < 0 || this._activeTabIndex >= this._terminalTabs.length) {
			return null;
		}
		return this._terminalTabs[this._activeTabIndex];
	}

	public getActiveInstance(): ITerminalInstance | null {
		const tab = this.getActiveTab();
		if (!tab) {
			return null;
		}
		return tab.activeInstance;
	}

	public doWithActiveInstance<T>(callback: (terminal: ITerminalInstance) => T): T | void {
		const instance = this.getActiveInstance();
		if (instance) {
			return callback(instance);
		}
	}

	public getInstanceFromId(terminalId: number): ITerminalInstance | undefined {
		let bgIndex = -1;
		this._backgroundedTerminalInstances.forEach((terminalInstance, i) => {
			if (terminalInstance.id === terminalId) {
				bgIndex = i;
			}
		});
		if (bgIndex !== -1) {
			return this._backgroundedTerminalInstances[bgIndex];
		}
		try {
			return this.terminalInstances[this._getIndexFromId(terminalId)];
		} catch {
			return undefined;
		}
	}

	public getInstanceFromIndex(terminalIndex: number): ITerminalInstance {
		return this.terminalInstances[terminalIndex];
	}

	public setActiveInstance(terminalInstance: ITerminalInstance): void {
		// If this was a hideFromUser terminal created by the API this was triggered by show,
		// in which case we need to create the terminal tab
		if (terminalInstance.shellLaunchConfig.hideFromUser) {
			this._showBackgroundTerminal(terminalInstance);
		}
		this.setActiveInstanceByIndex(this._getIndexFromId(terminalInstance.id));
	}

	public setActiveTabByIndex(tabIndex: number): void {
		if (tabIndex >= this._terminalTabs.length) {
			return;
		}

		const didTabChange = this._activeTabIndex !== tabIndex;
		this._activeTabIndex = tabIndex;

		this._terminalTabs.forEach((t, i) => t.setVisible(i === this._activeTabIndex));
		if (didTabChange) {
			this._onActiveTabChanged.fire();
		}
	}

	public async initializeTerminals(): Promise<void> {
		const enableRemoteAgentTerminals = this._workspaceConfigurationService.getValue<boolean | undefined>('terminal.integrated.serverSpawn');
		if (!!this._environmentService.remoteAuthority && enableRemoteAgentTerminals !== false) {
			const emptyTab = this._instantiationService.createInstance(TerminalTab, this._terminalContainer, undefined);
			this._terminalTabs.push(emptyTab);
			this._onInstanceTitleChanged.fire(undefined);
			const remoteTerms = await this._remoteTerminalService.listTerminals();

			/* __GDPR__
				"terminalReconnect" : {
					"count" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
				}
			 */
			const data = {
				count: remoteTerms.length
			};
			this._telemetryService.publicLog('terminalReconnection', data);
			if (remoteTerms.length > 0) {
				// Reattach to all remote terms
				this.createTerminal({ remoteAttach: remoteTerms[0] }, emptyTab);
				for (let term of remoteTerms.slice(1)) {
					this.createTerminal({ remoteAttach: term });
				}
			} else if (this.terminalInstances.length === 0) {
				// Remote, no terminals to attach to
				this.createTerminal(undefined, emptyTab);
			}
		} else if (this.terminalInstances.length === 0) {
			// Local, just create a terminal
			this.createTerminal();
		}
	}

	private _getInstanceFromGlobalInstanceIndex(index: number): { tab: ITerminalTab, tabIndex: number, instance: ITerminalInstance, localInstanceIndex: number } | null {
		let currentTabIndex = 0;
		while (index >= 0 && currentTabIndex < this._terminalTabs.length) {
			const tab = this._terminalTabs[currentTabIndex];
			const count = tab.terminalInstances.length;
			if (index < count) {
				return {
					tab,
					tabIndex: currentTabIndex,
					instance: tab.terminalInstances[index],
					localInstanceIndex: index
				};
			}
			index -= count;
			currentTabIndex++;
		}
		return null;
	}

	public setActiveInstanceByIndex(terminalIndex: number): void {
		const query = this._getInstanceFromGlobalInstanceIndex(terminalIndex);
		if (!query) {
			return;
		}

		query.tab.setActiveInstanceByIndex(query.localInstanceIndex);
		const didTabChange = this._activeTabIndex !== query.tabIndex;
		this._activeTabIndex = query.tabIndex;
		this._terminalTabs.forEach((t, i) => t.setVisible(i === query.tabIndex));

		// Only fire the event if there was a change
		if (didTabChange) {
			this._onActiveTabChanged.fire();
		}
	}

	public setActiveTabToNext(): void {
		if (this._terminalTabs.length <= 1) {
			return;
		}
		let newIndex = this._activeTabIndex + 1;
		if (newIndex >= this._terminalTabs.length) {
			newIndex = 0;
		}
		this.setActiveTabByIndex(newIndex);
	}

	public setActiveTabToPrevious(): void {
		if (this._terminalTabs.length <= 1) {
			return;
		}
		let newIndex = this._activeTabIndex - 1;
		if (newIndex < 0) {
			newIndex = this._terminalTabs.length - 1;
		}
		this.setActiveTabByIndex(newIndex);
	}

	public splitInstance(instanceToSplit: ITerminalInstance, shellLaunchConfig: IShellLaunchConfig = {}): ITerminalInstance | null {
		const tab = this._getTabForInstance(instanceToSplit);
		if (!tab) {
			return null;
		}

		const instance = tab.split(shellLaunchConfig);
		this._initInstanceListeners(instance);
		this._onInstancesChanged.fire();

		this._terminalTabs.forEach((t, i) => t.setVisible(i === this._activeTabIndex));
		return instance;
	}

	protected _initInstanceListeners(instance: ITerminalInstance): void {
		instance.addDisposable(instance.onDisposed(this._onInstanceDisposed.fire, this._onInstanceDisposed));
		instance.addDisposable(instance.onTitleChanged(this._onInstanceTitleChanged.fire, this._onInstanceTitleChanged));
		instance.addDisposable(instance.onProcessIdReady(this._onInstanceProcessIdReady.fire, this._onInstanceProcessIdReady));
		instance.addDisposable(instance.onLinksReady(this._onInstanceLinksReady.fire, this._onInstanceLinksReady));
		instance.addDisposable(instance.onDimensionsChanged(() => this._onInstanceDimensionsChanged.fire(instance)));
		instance.addDisposable(instance.onMaximumDimensionsChanged(() => this._onInstanceMaximumDimensionsChanged.fire(instance)));
		instance.addDisposable(instance.onFocus(this._onActiveInstanceChanged.fire, this._onActiveInstanceChanged));
	}

	public registerProcessSupport(isSupported: boolean): void {
		if (!isSupported) {
			return;
		}
		this._processSupportContextKey.set(isSupported);
		this._onDidRegisterProcessSupport.fire();
	}

	public registerLinkProvider(linkProvider: ITerminalExternalLinkProvider): IDisposable {
		const disposables: IDisposable[] = [];
		this._linkProviders.add(linkProvider);
		for (const instance of this.terminalInstances) {
			if (instance.areLinksReady) {
				disposables.push(instance.registerLinkProvider(linkProvider));
			}
		}
		this._linkProviderDisposables.set(linkProvider, disposables);
		return {
			dispose: () => {
				const disposables = this._linkProviderDisposables.get(linkProvider) || [];
				for (const disposable of disposables) {
					disposable.dispose();
				}
				this._linkProviders.delete(linkProvider);
			}
		};
	}

	private _setInstanceLinkProviders(instance: ITerminalInstance): void {
		for (const linkProvider of this._linkProviders) {
			const disposables = this._linkProviderDisposables.get(linkProvider);
			const provider = instance.registerLinkProvider(linkProvider);
			disposables?.push(provider);
		}
	}

	private _getTabForInstance(instance: ITerminalInstance): ITerminalTab | undefined {
		return this._terminalTabs.find(tab => tab.terminalInstances.indexOf(instance) !== -1);
	}

	public async showPanel(focus?: boolean): Promise<void> {
		const pane = this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID) as TerminalViewPane;
		if (!pane) {
			await this._viewsService.openView(TERMINAL_VIEW_ID, focus);
		}
		if (focus) {
			// Do the focus call asynchronously as going through the
			// command palette will force editor focus
			await timeout(0);
			const instance = this.getActiveInstance();
			if (instance) {
				await instance.focusWhenReady(true);
			}
		}
	}

	private _getIndexFromId(terminalId: number): number {
		let terminalIndex = -1;
		this.terminalInstances.forEach((terminalInstance, i) => {
			if (terminalInstance.id === terminalId) {
				terminalIndex = i;
			}
		});
		if (terminalIndex === -1) {
			throw new Error(`Terminal with ID ${terminalId} does not exist (has it already been disposed?)`);
		}
		return terminalIndex;
	}

	public async manageWorkspaceShellPermissions(): Promise<void> {
		const allowItem: IQuickPickItem = { label: nls.localize('workbench.action.terminal.allowWorkspaceShell', "Allow Workspace Shell Configuration") };
		const disallowItem: IQuickPickItem = { label: nls.localize('workbench.action.terminal.disallowWorkspaceShell', "Disallow Workspace Shell Configuration") };
		const value = await this._quickInputService.pick([allowItem, disallowItem], { canPickMany: false });
		if (!value) {
			return;
		}
		this.configHelper.setWorkspaceShellAllowed(value === allowItem);
	}

	protected async _showTerminalCloseConfirmation(): Promise<boolean> {
		let message: string;
		if (this.terminalInstances.length === 1) {
			message = nls.localize('terminalService.terminalCloseConfirmationSingular', "There is an active terminal session, do you want to kill it?");
		} else {
			message = nls.localize('terminalService.terminalCloseConfirmationPlural', "There are {0} active terminal sessions, do you want to kill them?", this.terminalInstances.length);
		}
		const res = await this._dialogService.confirm({
			message,
			type: 'warning',
		});
		return !res.confirmed;
	}

	public preparePathForTerminalAsync(originalPath: string, executable: string, title: string, shellType: TerminalShellType): Promise<string> {
		return new Promise<string>(c => {
			if (!executable) {
				c(originalPath);
				return;
			}

			const hasSpace = originalPath.indexOf(' ') !== -1;

			const pathBasename = basename(executable, '.exe');
			const isPowerShell = pathBasename === 'pwsh' ||
				title === 'pwsh' ||
				pathBasename === 'powershell' ||
				title === 'powershell';

			if (isPowerShell && (hasSpace || originalPath.indexOf('\'') !== -1)) {
				c(`& '${originalPath.replace(/'/g, '\'\'')}'`);
				return;
			}

			if (isWindows) {
				// 17063 is the build number where wsl path was introduced.
				// Update Windows uriPath to be executed in WSL.
				if (shellType !== undefined) {
					if (shellType === WindowsShellType.GitBash) {
						c(originalPath.replace(/\\/g, '/'));
						return;
					}
					else if (shellType === WindowsShellType.Wsl) {
						if (this._nativeWindowsDelegate && this._nativeWindowsDelegate.getWindowsBuildNumber() >= 17063) {
							c(this._nativeWindowsDelegate.getWslPath(originalPath));
						} else {
							c(originalPath.replace(/\\/g, '/'));
						}
						return;
					}

					if (hasSpace) {
						c('"' + originalPath + '"');
					} else {
						c(originalPath);
					}
				} else {
					const lowerExecutable = executable.toLowerCase();
					if (this._nativeWindowsDelegate && this._nativeWindowsDelegate.getWindowsBuildNumber() >= 17063 &&
						(lowerExecutable.indexOf('wsl') !== -1 || (lowerExecutable.indexOf('bash.exe') !== -1 && lowerExecutable.toLowerCase().indexOf('git') === -1))) {
						c(this._nativeWindowsDelegate.getWslPath(originalPath));
						return;
					} else if (hasSpace) {
						c('"' + originalPath + '"');
					} else {
						c(originalPath);
					}
				}

				return;
			}

			c(escapeNonWindowsPath(originalPath));
		});
	}

	public async selectDefaultShell(): Promise<void> {
		const shells = await this._detectShells();
		const options: IPickOptions<IQuickPickItem> = {
			placeHolder: nls.localize('terminal.integrated.chooseWindowsShell', "Select your preferred terminal shell, you can change this later in your settings")
		};
		const quickPickItems = shells.map((s): IQuickPickItem => {
			return { label: s.label, description: s.path };
		});
		const value = await this._quickInputService.pick(quickPickItems, options);
		if (!value) {
			return undefined;
		}
		const shell = value.description;
		const env = await this._remoteAgentService.getEnvironment();
		let platformKey: string;
		if (env) {
			platformKey = env.os === OperatingSystem.Windows ? 'windows' : (env.os === OperatingSystem.Macintosh ? 'osx' : 'linux');
		} else {
			platformKey = isWindows ? 'windows' : (isMacintosh ? 'osx' : 'linux');
		}
		await this._configurationService.updateValue(`terminal.integrated.shell.${platformKey}`, shell, ConfigurationTarget.USER);
	}

	private _detectShells(): Promise<IShellDefinition[]> {
		return new Promise(r => this._onRequestAvailableShells.fire({ callback: r }));
	}


	public createInstance(container: HTMLElement | undefined, shellLaunchConfig: IShellLaunchConfig): ITerminalInstance {
		const instance = this._instantiationService.createInstance(TerminalInstance, this._terminalFocusContextKey, this._terminalShellTypeContextKey, this._configHelper, container, shellLaunchConfig);
		this._onInstanceCreated.fire(instance);
		return instance;
	}

	public createTerminal(shell: IShellLaunchConfig = {}, terminalTab?: TerminalTab): ITerminalInstance {
		if (!this.isProcessSupportRegistered) {
			throw new Error('Could not create terminal when process support is not registered');
		}
		if (shell.hideFromUser) {
			const instance = this.createInstance(undefined, shell);
			this._backgroundedTerminalInstances.push(instance);
			this._initInstanceListeners(instance);
			return instance;
		}

		if (terminalTab) {
			terminalTab.addInstance(shell);
		} else {
			terminalTab = this._instantiationService.createInstance(TerminalTab, this._terminalContainer, shell);
			this._terminalTabs.push(terminalTab);
		}

		const instance = terminalTab.terminalInstances[0];
		terminalTab.addDisposable(terminalTab.onDisposed(this._onTabDisposed.fire, this._onTabDisposed));
		terminalTab.addDisposable(terminalTab.onInstancesChanged(this._onInstancesChanged.fire, this._onInstancesChanged));
		this._initInstanceListeners(instance);
		if (this.terminalInstances.length === 1) {
			// It's the first instance so it should be made active automatically
			this.setActiveInstanceByIndex(0);
		}
		this._onInstancesChanged.fire();
		return instance;
	}

	protected _showBackgroundTerminal(instance: ITerminalInstance): void {
		this._backgroundedTerminalInstances.splice(this._backgroundedTerminalInstances.indexOf(instance), 1);
		instance.shellLaunchConfig.hideFromUser = false;
		const terminalTab = this._instantiationService.createInstance(TerminalTab, this._terminalContainer, instance);
		this._terminalTabs.push(terminalTab);
		terminalTab.addDisposable(terminalTab.onDisposed(this._onTabDisposed.fire, this._onTabDisposed));
		terminalTab.addDisposable(terminalTab.onInstancesChanged(this._onInstancesChanged.fire, this._onInstancesChanged));
		if (this.terminalInstances.length === 1) {
			// It's the first instance so it should be made active automatically
			this.setActiveInstanceByIndex(0);
		}
		this._onInstancesChanged.fire();
	}

	public async focusFindWidget(): Promise<void> {
		await this.showPanel(false);
		const pane = this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID) as TerminalViewPane;
		pane.focusFindWidget();
		this._findWidgetVisible.set(true);
	}

	public hideFindWidget(): void {
		const pane = this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID) as TerminalViewPane;
		if (pane) {
			pane.hideFindWidget();
			this._findWidgetVisible.reset();
			pane.focus();
		}
	}

	public findNext(): void {
		const pane = this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID) as TerminalViewPane;
		if (pane) {
			pane.showFindWidget();
			pane.getFindWidget().find(false);
		}
	}

	public findPrevious(): void {
		const pane = this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID) as TerminalViewPane;
		if (pane) {
			pane.showFindWidget();
			pane.getFindWidget().find(true);
		}
	}

	public setContainers(panelContainer: HTMLElement, terminalContainer: HTMLElement): void {
		this._configHelper.panelContainer = panelContainer;
		this._terminalContainer = terminalContainer;
		this._terminalTabs.forEach(tab => tab.attachToElement(terminalContainer));
	}

	public hidePanel(): void {
		// Hide the panel if the terminal is in the panel and it has no sibling views
		const location = this._viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID);
		if (location === ViewContainerLocation.Panel) {
			const panel = this._viewDescriptorService.getViewContainerByViewId(TERMINAL_VIEW_ID);
			if (panel && this._viewDescriptorService.getViewContainerModel(panel).activeViewDescriptors.length === 1) {
				this._layoutService.setPanelHidden(true);
			}
		}
	}
}
