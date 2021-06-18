/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Orientation } from 'vs/base/browser/ui/sash/sash';
import { AutoOpenBarrier, timeout } from 'vs/base/common/async';
import { Codicon, iconRegistry } from 'vs/base/common/codicons';
import { debounce, throttle } from 'vs/base/common/decorators';
import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { equals } from 'vs/base/common/objects';
import { isMacintosh, isWeb, isWindows, OperatingSystem, OS } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { FindReplaceState } from 'vs/editor/contrib/find/findState';
import * as nls from 'vs/nls';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService, optional } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IKeyMods, IPickOptions, IQuickInputButton, IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ILocalTerminalService, IOffProcessTerminalService, IShellLaunchConfig, ITerminalLaunchError, ITerminalProfile, ITerminalProfileObject, ITerminalsLayoutInfo, ITerminalsLayoutInfoById, TerminalSettingId, TerminalSettingPrefix } from 'vs/platform/terminal/common/terminal';
import { registerTerminalDefaultProfileConfiguration } from 'vs/platform/terminal/common/terminalPlatformConfiguration';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { VirtualWorkspaceContext } from 'vs/workbench/browser/contextkeys';
import { IEditableData, IViewDescriptorService, IViewsService, ViewContainerLocation } from 'vs/workbench/common/views';
import { ICreateTerminalOptions, IRemoteTerminalService, ITerminalEditorService, ITerminalExternalLinkProvider, ITerminalGroup, ITerminalGroupService, ITerminalInstance, ITerminalProfileProvider, ITerminalService, TerminalConnectionState } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { TerminalEditor } from 'vs/workbench/contrib/terminal/browser/terminalEditor';
import { configureTerminalProfileIcon } from 'vs/workbench/contrib/terminal/browser/terminalIcons';
import { TerminalInstance } from 'vs/workbench/contrib/terminal/browser/terminalInstance';
import { TerminalViewPane } from 'vs/workbench/contrib/terminal/browser/terminalView';
import { IRemoteTerminalAttachTarget, IStartExtensionTerminalRequest, ITerminalConfigHelper, ITerminalProcessExtHostProxy, ITerminalProfileContribution, KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE, KEYBINDING_CONTEXT_TERMINAL_COUNT, KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_GROUP_COUNT, KEYBINDING_CONTEXT_TERMINAL_IS_OPEN, KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE, KEYBINDING_CONTEXT_TERMINAL_TABS_MOUSE, TerminalLocation, TERMINAL_VIEW_ID } from 'vs/workbench/contrib/terminal/common/terminal';
import { ITerminalContributionService } from 'vs/workbench/contrib/terminal/common/terminalExtensionPoints';
import { formatMessageForTerminal, terminalStrings } from 'vs/workbench/contrib/terminal/common/terminalStrings';
import { IEditorOverrideService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorOverrideService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ILifecycleService, ShutdownReason, WillShutdownEvent } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';

export class TerminalService implements ITerminalService {
	declare _serviceBrand: undefined;

	private get _terminalGroups(): readonly ITerminalGroup[] { return this._terminalGroupService.groups; }

	private _isShuttingDown: boolean;
	private _terminalFocusContextKey: IContextKey<boolean>;
	private _terminalCountContextKey: IContextKey<number>;
	private _terminalGroupCountContextKey: IContextKey<number>;
	private _terminalShellTypeContextKey: IContextKey<string>;
	private _terminalAltBufferActiveContextKey: IContextKey<boolean>;
	private _backgroundedTerminalInstances: ITerminalInstance[] = [];
	private _findState: FindReplaceState;
	private readonly _profileProviders: Map</*ext id*/string, Map</*provider id*/string, ITerminalProfileProvider>> = new Map();
	private _linkProviders: Set<ITerminalExternalLinkProvider> = new Set();
	private _linkProviderDisposables: Map<ITerminalExternalLinkProvider, IDisposable[]> = new Map();
	private _processSupportContextKey: IContextKey<boolean>;
	private readonly _localTerminalService?: ILocalTerminalService;
	private readonly _primaryOffProcessTerminalService?: IOffProcessTerminalService;
	private _profilesReadyBarrier: AutoOpenBarrier;
	private _availableProfiles: ITerminalProfile[] | undefined;
	private _configHelper: TerminalConfigHelper;
	private _remoteTerminalsInitPromise: Promise<void> | undefined;
	private _localTerminalsInitPromise: Promise<void> | undefined;
	private _connectionState: TerminalConnectionState;

	private _editable: { instance: ITerminalInstance, data: IEditableData } | undefined;

	get terminalGroups(): readonly ITerminalGroup[] { return this._terminalGroups; }
	get isProcessSupportRegistered(): boolean { return !!this._processSupportContextKey.get(); }
	get connectionState(): TerminalConnectionState { return this._connectionState; }
	get profilesReady(): Promise<void> { return this._profilesReadyBarrier.wait().then(() => { }); }
	get availableProfiles(): ITerminalProfile[] {
		this._refreshAvailableProfiles();
		return this._availableProfiles || [];
	}
	get configHelper(): ITerminalConfigHelper { return this._configHelper; }
	private get _terminalInstances(): ITerminalInstance[] {
		return this._terminalGroups.reduce((p, c) => p.concat(c.terminalInstances), <ITerminalInstance[]>[]);
	}
	get instances(): ITerminalInstance[] { return this._terminalInstances; }

	private readonly _onActiveGroupChanged = new Emitter<void>();
	get onActiveGroupChanged(): Event<void> { return this._onActiveGroupChanged.event; }
	private readonly _onInstanceCreated = new Emitter<ITerminalInstance>();
	get onInstanceCreated(): Event<ITerminalInstance> { return this._onInstanceCreated.event; }
	private readonly _onDidDisposeInstance = new Emitter<ITerminalInstance>();
	get onDidDisposeInstance(): Event<ITerminalInstance> { return this._onDidDisposeInstance.event; }
	private readonly _onInstanceProcessIdReady = new Emitter<ITerminalInstance>();
	get onInstanceProcessIdReady(): Event<ITerminalInstance> { return this._onInstanceProcessIdReady.event; }
	private readonly _onInstanceLinksReady = new Emitter<ITerminalInstance>();
	get onInstanceLinksReady(): Event<ITerminalInstance> { return this._onInstanceLinksReady.event; }
	private readonly _onInstanceRequestStartExtensionTerminal = new Emitter<IStartExtensionTerminalRequest>();
	get onInstanceRequestStartExtensionTerminal(): Event<IStartExtensionTerminalRequest> { return this._onInstanceRequestStartExtensionTerminal.event; }
	private readonly _onInstanceDimensionsChanged = new Emitter<ITerminalInstance>();
	get onInstanceDimensionsChanged(): Event<ITerminalInstance> { return this._onInstanceDimensionsChanged.event; }
	private readonly _onInstanceMaximumDimensionsChanged = new Emitter<ITerminalInstance>();
	get onInstanceMaximumDimensionsChanged(): Event<ITerminalInstance> { return this._onInstanceMaximumDimensionsChanged.event; }
	private readonly _onDidChangeInstances = new Emitter<void>();
	get onDidChangeInstances(): Event<void> { return this._onDidChangeInstances.event; }
	private readonly _onInstanceTitleChanged = new Emitter<ITerminalInstance | undefined>();
	get onInstanceTitleChanged(): Event<ITerminalInstance | undefined> { return this._onInstanceTitleChanged.event; }
	private readonly _onInstanceIconChanged = new Emitter<ITerminalInstance | undefined>();
	get onInstanceIconChanged(): Event<ITerminalInstance | undefined> { return this._onInstanceIconChanged.event; }
	private readonly _onInstanceColorChanged = new Emitter<ITerminalInstance | undefined>();
	get onInstanceColorChanged(): Event<ITerminalInstance | undefined> { return this._onInstanceColorChanged.event; }
	private readonly _onDidChangeActiveInstance = new Emitter<ITerminalInstance | undefined>();
	get onDidChangeActiveInstance(): Event<ITerminalInstance | undefined> { return this._onDidChangeActiveInstance.event; }
	private readonly _onInstancePrimaryStatusChanged = new Emitter<ITerminalInstance>();
	get onInstancePrimaryStatusChanged(): Event<ITerminalInstance> { return this._onInstancePrimaryStatusChanged.event; }
	private readonly _onGroupDisposed = new Emitter<ITerminalGroup>();
	get onGroupDisposed(): Event<ITerminalGroup> { return this._onGroupDisposed.event; }
	private readonly _onGroupsChanged = new Emitter<void>();
	get onGroupsChanged(): Event<void> { return this._onGroupsChanged.event; }
	private readonly _onDidRegisterProcessSupport = new Emitter<void>();
	get onDidRegisterProcessSupport(): Event<void> { return this._onDidRegisterProcessSupport.event; }
	private readonly _onDidChangeConnectionState = new Emitter<void>();
	get onDidChangeConnectionState(): Event<void> { return this._onDidChangeConnectionState.event; }
	private readonly _onDidChangeAvailableProfiles = new Emitter<ITerminalProfile[]>();
	get onDidChangeAvailableProfiles(): Event<ITerminalProfile[]> { return this._onDidChangeAvailableProfiles.event; }
	private readonly _onPanelOrientationChanged = new Emitter<Orientation>();
	get onPanelOrientationChanged(): Event<Orientation> { return this._onPanelOrientationChanged.event; }

	constructor(
		@IContextKeyService private _contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService private _layoutService: IWorkbenchLayoutService,
		@ILabelService labelService: ILabelService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IDialogService private _dialogService: IDialogService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@IRemoteAgentService private _remoteAgentService: IRemoteAgentService,
		@IQuickInputService private _quickInputService: IQuickInputService,
		@IConfigurationService private _configurationService: IConfigurationService,
		@IViewsService private _viewsService: IViewsService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IRemoteTerminalService private readonly _remoteTerminalService: IRemoteTerminalService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ITerminalContributionService private readonly _terminalContributionService: ITerminalContributionService,
		@ITerminalEditorService private readonly _terminalEditorService: ITerminalEditorService,
		@ITerminalGroupService private readonly _terminalGroupService: ITerminalGroupService,
		@IEditorOverrideService editorOverrideService: IEditorOverrideService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@INotificationService private readonly _notificationService: INotificationService,
		@optional(ILocalTerminalService) localTerminalService: ILocalTerminalService
	) {
		this._localTerminalService = localTerminalService;
		this._isShuttingDown = false;
		this._findState = new FindReplaceState();
		this._terminalFocusContextKey = KEYBINDING_CONTEXT_TERMINAL_FOCUS.bindTo(this._contextKeyService);
		this._terminalCountContextKey = KEYBINDING_CONTEXT_TERMINAL_COUNT.bindTo(this._contextKeyService);
		this._terminalGroupCountContextKey = KEYBINDING_CONTEXT_TERMINAL_GROUP_COUNT.bindTo(this._contextKeyService);
		this._terminalShellTypeContextKey = KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE.bindTo(this._contextKeyService);
		this._terminalAltBufferActiveContextKey = KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE.bindTo(this._contextKeyService);
		this._configHelper = _instantiationService.createInstance(TerminalConfigHelper);

		editorOverrideService.registerEditor(
			`${Schemas.vscodeTerminal}:/**`,
			{
				id: TerminalEditor.ID,
				label: terminalStrings.terminal,
				priority: RegisteredEditorPriority.exclusive
			},
			{
				canHandleDiff: false,
				canSupportResource: uri => uri.scheme === Schemas.vscodeTerminal,
				singlePerResource: true
			},
			(resource, options, group) => {
				const instanceId = TerminalInstance.getInstanceIdFromUri(resource);
				let instance = instanceId === undefined ? undefined : this.getInstanceFromId(instanceId);
				if (instance) {
					const sourceGroup = this.getGroupForInstance(instance);
					if (sourceGroup) {
						sourceGroup.removeInstance(instance);
					}
				} else {
					instance = this.createInstance({});
				}
				this._terminalEditorService.terminalEditorInstances.push(instance);
				return {
					editor: this._terminalEditorService.createEditorInput(instance),
					options: {
						...options,
						pinned: true,
						forceReload: true
					}
				};
			}
		);

		// the below avoids having to poll routinely.
		// we update detected profiles when an instance is created so that,
		// for example, we detect if you've installed a pwsh
		this.onInstanceCreated(() => this._refreshAvailableProfiles());
		this.onDidChangeInstances(() => this._terminalCountContextKey.set(this._terminalInstances.length));
		this.onGroupsChanged(() => this._terminalGroupCountContextKey.set(this._terminalGroups.length));
		this.onInstanceLinksReady(instance => this._setInstanceLinkProviders(instance));

		// Hide the panel if there are no more instances, provided that VS Code is not shutting
		// down. When shutting down the panel is locked in place so that it is restored upon next
		// launch.
		this._terminalGroupService.onDidChangeActiveInstance(instance => {
			if (!instance && !this._isShuttingDown) {
				this.hidePanel();
			}
		});
		this._terminalGroupService.onDidDisposeInstance(this._onDidDisposeInstance.fire, this._onDidDisposeInstance);
		this._terminalGroupService.onDidChangeInstances(this._onDidChangeInstances.fire, this._onDidChangeInstances);

		this._handleInstanceContextKeys();
		this._processSupportContextKey = KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED.bindTo(this._contextKeyService);
		this._processSupportContextKey.set(!isWeb || this._remoteAgentService.getConnection() !== null);

		lifecycleService.onBeforeShutdown(async e => e.veto(this._onBeforeShutdown(e.reason), 'veto.terminal'));
		lifecycleService.onWillShutdown(e => this._onWillShutdown(e));

		this._configurationService.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration(TerminalSettingPrefix.DefaultProfile + this._getPlatformKey()) ||
				e.affectsConfiguration(TerminalSettingPrefix.Profiles + this._getPlatformKey()) ||
				e.affectsConfiguration(TerminalSettingId.UseWslProfiles)) {
				this._refreshAvailableProfiles();
			}
		});

		// Register a resource formatter for terminal URIs
		labelService.registerFormatter({
			scheme: Schemas.vscodeTerminal,
			formatting: {
				label: '${path}',
				separator: ''
			}
		});

		const enableTerminalReconnection = this.configHelper.config.enablePersistentSessions;

		// Connect to the extension host if it's there, set the connection state to connected when
		// it's done. This should happen even when there is no extension host.
		this._connectionState = TerminalConnectionState.Connecting;

		const isPersistentRemote = !!this._environmentService.remoteAuthority && enableTerminalReconnection;
		let initPromise: Promise<any> = isPersistentRemote
			? this._remoteTerminalsInitPromise = this._reconnectToRemoteTerminals()
			: enableTerminalReconnection
				? this._localTerminalsInitPromise = this._reconnectToLocalTerminals()
				: Promise.resolve();
		this._primaryOffProcessTerminalService = !!this._environmentService.remoteAuthority ? this._remoteTerminalService : this._localTerminalService;
		initPromise.then(() => this._setConnected());

		// Wait up to 5 seconds for profiles to be ready so it's assured that we know the actual
		// default terminal before launching the first terminal. This isn't expected to ever take
		// this long.
		this._profilesReadyBarrier = new AutoOpenBarrier(5000);
		this._refreshAvailableProfiles();
	}

	async safeDisposeTerminal(instance: ITerminalInstance): Promise<void> {
		if (this.configHelper.config.confirmOnExit) {
			const notConfirmed = await this._showTerminalCloseConfirmation(true);
			if (notConfirmed) {
				return;
			}
		}
		instance.dispose();
	}

	private _setConnected() {
		this._connectionState = TerminalConnectionState.Connected;
		this._onDidChangeConnectionState.fire();
	}

	private async _reconnectToRemoteTerminals(): Promise<void> {
		const layoutInfo = await this._remoteTerminalService.getTerminalLayoutInfo();
		this._remoteTerminalService.reduceConnectionGraceTime();
		const reconnectCounter = this._recreateTerminalGroups(layoutInfo);
		/* __GDPR__
			"terminalReconnection" : {
				"count" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		 */
		const data = {
			count: reconnectCounter
		};
		this._telemetryService.publicLog('terminalReconnection', data);
		// now that terminals have been restored,
		// attach listeners to update remote when terminals are changed
		this._attachProcessLayoutListeners();
	}

	private async _reconnectToLocalTerminals(): Promise<void> {
		if (!this._localTerminalService) {
			return;
		}
		const layoutInfo = await this._localTerminalService.getTerminalLayoutInfo();
		if (layoutInfo && layoutInfo.tabs.length > 0) {
			this._recreateTerminalGroups(layoutInfo);
		}
		// now that terminals have been restored,
		// attach listeners to update local state when terminals are changed
		this._attachProcessLayoutListeners();
	}

	private _recreateTerminalGroups(layoutInfo?: ITerminalsLayoutInfo): number {
		let reconnectCounter = 0;
		let activeGroup: ITerminalGroup | undefined;
		if (layoutInfo) {
			layoutInfo.tabs.forEach(groupLayout => {
				const terminalLayouts = groupLayout.terminals.filter(t => t.terminal && t.terminal.isOrphan);
				if (terminalLayouts.length) {
					reconnectCounter += terminalLayouts.length;
					let terminalInstance: ITerminalInstance | undefined;
					let group: ITerminalGroup | undefined;
					terminalLayouts.forEach((terminalLayout) => {
						if (!terminalInstance) {
							// create group and terminal
							const config = { attachPersistentProcess: terminalLayout.terminal! } as IShellLaunchConfig;
							terminalInstance = this.createTerminal(config);
							group = this.getGroupForInstance(terminalInstance);
							if (groupLayout.isActive) {
								activeGroup = group;
							}
						} else {
							// add split terminals to this group
							this.splitInstance(terminalInstance, { attachPersistentProcess: terminalLayout.terminal! });
						}
					});
					const activeInstance = this.instances.find(t => {
						return t.shellLaunchConfig.attachPersistentProcess?.id === groupLayout.activePersistentProcessId;
					});
					if (activeInstance) {
						this.setActiveInstance(activeInstance);
					}
					group?.resizePanes(groupLayout.terminals.map(terminal => terminal.relativeSize));
				}
			});
			if (layoutInfo.tabs.length) {
				this._terminalGroupService.setActiveGroupByIndex(activeGroup ? this.terminalGroups.indexOf(activeGroup) : 0);
			}
		}
		return reconnectCounter;
	}

	private _attachProcessLayoutListeners(): void {
		this.onActiveGroupChanged(() => this._saveState());
		this.onDidChangeActiveInstance(() => this._saveState());
		this.onDidChangeInstances(() => this._saveState());
		// The state must be updated when the terminal is relaunched, otherwise the persistent
		// terminal ID will be stale and the process will be leaked.
		this.onInstanceProcessIdReady(() => this._saveState());
		this.onInstanceTitleChanged(instance => this._updateTitle(instance));
		this.onInstanceIconChanged(instance => this._updateIcon(instance));
	}

	private _handleInstanceContextKeys(): void {
		const terminalIsOpenContext = KEYBINDING_CONTEXT_TERMINAL_IS_OPEN.bindTo(this._contextKeyService);
		const updateTerminalContextKeys = () => {
			terminalIsOpenContext.set(this.instances.length > 0);
		};
		this.onDidChangeInstances(() => updateTerminalContextKeys());
	}

	getActiveOrCreateInstance(): ITerminalInstance {
		return this.activeInstance || this.createTerminal();
	}

	async setEditable(instance: ITerminalInstance, data?: IEditableData | null): Promise<void> {
		if (!data) {
			this._editable = undefined;
		} else {
			this._editable = { instance: instance, data };
		}
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		const isEditing = this._isEditable(instance);
		pane?.terminalTabbedView?.setEditable(isEditing);
	}

	private _isEditable(instance: ITerminalInstance | undefined): boolean {
		return !!this._editable && (this._editable.instance === instance || !instance);
	}

	getEditableData(instance: ITerminalInstance): IEditableData | undefined {
		return this._editable && this._editable.instance === instance ? this._editable.data : undefined;
	}

	requestStartExtensionTerminal(proxy: ITerminalProcessExtHostProxy, cols: number, rows: number): Promise<ITerminalLaunchError | undefined> {
		// The initial request came from the extension host, no need to wait for it
		return new Promise<ITerminalLaunchError | undefined>(callback => {
			this._onInstanceRequestStartExtensionTerminal.fire({ proxy, cols, rows, callback });
		});
	}

	@throttle(2000)
	private async _refreshAvailableProfiles(): Promise<void> {
		const result = await this._detectProfiles();
		const profilesChanged = !equals(result, this._availableProfiles);
		if (profilesChanged) {
			this._availableProfiles = result;
			this._onDidChangeAvailableProfiles.fire(this._availableProfiles);
			this._profilesReadyBarrier.open();
			await this._refreshPlatformConfig();
		}
	}

	private async _refreshPlatformConfig() {
		const env = await this._remoteAgentService.getEnvironment();
		registerTerminalDefaultProfileConfiguration({
			os: env?.os || OS,
			profiles: this._availableProfiles!
		});
	}

	private async _detectProfiles(includeDetectedProfiles?: boolean): Promise<ITerminalProfile[]> {
		if (!this._primaryOffProcessTerminalService) {
			return this._availableProfiles || [];
		}
		const platform = await this._getPlatformKey();
		return this._primaryOffProcessTerminalService?.getProfiles(this._configurationService.getValue(`${TerminalSettingPrefix.Profiles}${platform}`), this._configurationService.getValue(`${TerminalSettingPrefix.DefaultProfile}${platform}`), includeDetectedProfiles);
	}

	private _onBeforeShutdown(reason: ShutdownReason): boolean | Promise<boolean> {
		if (this.instances.length === 0) {
			// No terminal instances, don't veto
			return false;
		}

		const shouldPersistTerminals = this._configHelper.config.enablePersistentSessions && reason === ShutdownReason.RELOAD;
		if (this.configHelper.config.confirmOnExit && !shouldPersistTerminals) {
			return this._onBeforeShutdownAsync();
		}

		this._isShuttingDown = true;

		return false;
	}

	private async _onBeforeShutdownAsync(): Promise<boolean> {
		// veto if configured to show confirmation and the user chose not to exit
		const veto = await this._showTerminalCloseConfirmation();
		if (!veto) {
			this._isShuttingDown = true;
		}
		return veto;
	}

	private _onWillShutdown(e: WillShutdownEvent): void {
		// Don't touch processes if the shutdown was a result of reload as they will be reattached
		const shouldPersistTerminals = this._configHelper.config.enablePersistentSessions && e.reason === ShutdownReason.RELOAD;
		if (shouldPersistTerminals) {
			this.instances.forEach(instance => instance.detachFromProcess());
			return;
		}

		// Force dispose of all terminal instances
		this.instances.forEach(instance => instance.dispose(true));

		this._localTerminalService?.setTerminalLayoutInfo(undefined);
	}

	getGroupLabels(): string[] {
		return this._terminalGroups.filter(group => group.terminalInstances.length > 0).map((group, index) => {
			return `${index + 1}: ${group.title ? group.title : ''}`;
		});
	}

	getFindState(): FindReplaceState {
		return this._findState;
	}

	@debounce(500)
	private _saveState(): void {
		if (!this.configHelper.config.enablePersistentSessions) {
			return;
		}
		const state: ITerminalsLayoutInfoById = {
			tabs: this.terminalGroups.map(g => g.getLayoutInfo(g === this._terminalGroupService.activeGroup))
		};
		this._primaryOffProcessTerminalService?.setTerminalLayoutInfo(state);
	}

	@debounce(500)
	private _updateTitle(instance?: ITerminalInstance): void {
		if (!this.configHelper.config.enablePersistentSessions || !instance || !instance.persistentProcessId || !instance.title) {
			return;
		}
		this._primaryOffProcessTerminalService?.updateTitle(instance.persistentProcessId, instance.title, instance.titleSource);
	}

	@debounce(500)
	private _updateIcon(instance?: ITerminalInstance): void {
		if (!this.configHelper.config.enablePersistentSessions || !instance || !instance.persistentProcessId || !instance.icon) {
			return;
		}
		this._primaryOffProcessTerminalService?.updateIcon(instance.persistentProcessId, instance.icon, instance.color);
	}

	refreshActiveGroup(): void {
		this._onActiveGroupChanged.fire();
	}

	get activeInstance(): ITerminalInstance | undefined {
		// TODO: Get the active instance from the latest activated group or editor
		return this._terminalGroupService.activeInstance;
	}

	doWithActiveInstance<T>(callback: (terminal: ITerminalInstance) => T): T | void {
		const instance = this.activeInstance;
		if (instance) {
			return callback(instance);
		}
	}

	getInstanceFromId(terminalId: number): ITerminalInstance | undefined {
		let bgIndex = -1;
		this._backgroundedTerminalInstances.forEach((terminalInstance, i) => {
			if (terminalInstance.instanceId === terminalId) {
				bgIndex = i;
			}
		});
		if (bgIndex !== -1) {
			return this._backgroundedTerminalInstances[bgIndex];
		}
		try {
			return this.instances[this._getIndexFromId(terminalId)];
		} catch {
			return undefined;
		}
	}

	getInstanceFromIndex(terminalIndex: number): ITerminalInstance {
		return this.instances[terminalIndex];
	}

	setActiveInstance(terminalInstance: ITerminalInstance): void {
		if (this.configHelper.config.creationTarget === TerminalLocation.Editor) {
			return;
		}
		// If this was a hideFromUser terminal created by the API this was triggered by show,
		// in which case we need to create the terminal group
		if (terminalInstance.shellLaunchConfig.hideFromUser) {
			this._showBackgroundTerminal(terminalInstance);
		}
		// TODO: Handle editor terminals too
		this._terminalGroupService.setActiveInstanceByIndex(this._getIndexFromId(terminalInstance.instanceId));
	}

	isAttachedToTerminal(remoteTerm: IRemoteTerminalAttachTarget): boolean {
		return this.instances.some(term => term.processId === remoteTerm.pid);
	}

	async initializeTerminals(): Promise<void> {
		if (this._remoteTerminalsInitPromise) {
			await this._remoteTerminalsInitPromise;
		} else if (this._localTerminalsInitPromise) {
			await this._localTerminalsInitPromise;
		}
		if (this.terminalGroups.length === 0 && this.isProcessSupportRegistered) {
			this.createTerminal();
		}
	}

	splitInstance(instanceToSplit: ITerminalInstance, shellLaunchConfig?: IShellLaunchConfig): ITerminalInstance | null;
	splitInstance(instanceToSplit: ITerminalInstance, profile: ITerminalProfile, cwd?: string | URI): ITerminalInstance | null
	splitInstance(instanceToSplit: ITerminalInstance, shellLaunchConfigOrProfile: IShellLaunchConfig | ITerminalProfile = {}, cwd?: string | URI): ITerminalInstance | null {
		const group = this.getGroupForInstance(instanceToSplit);
		if (!group) {
			return null;
		}
		const shellLaunchConfig = this._convertProfileToShellLaunchConfig(shellLaunchConfigOrProfile, cwd);
		const instance = group.split(shellLaunchConfig);

		this._initInstanceListeners(instance);

		// TODO: Move into group service?
		this._terminalGroups.forEach((g, i) => g.setVisible(i === this._terminalGroupService.activeGroupIndex));
		return instance;
	}

	// TODO: Move to group service
	unsplitInstance(instance: ITerminalInstance): void {
		const oldGroup = this.getGroupForInstance(instance);
		if (!oldGroup || oldGroup.terminalInstances.length < 2) {
			return;
		}

		oldGroup.removeInstance(instance);
		this._terminalGroupService.createGroup(instance);
	}

	// TODO: Move to group service
	joinInstances(instances: ITerminalInstance[]): void {
		// Find the group of the first instance that is the only instance in the group, if one exists
		let candidateInstance: ITerminalInstance | undefined = undefined;
		let candidateGroup: ITerminalGroup | undefined = undefined;
		for (const instance of instances) {
			const group = this.getGroupForInstance(instance);
			if (group?.terminalInstances.length === 1) {
				candidateInstance = instance;
				candidateGroup = group;
				break;
			}
		}

		// Create a new group if needed
		if (!candidateGroup) {
			candidateGroup = this._terminalGroupService.createGroup();
		}

		const wasActiveGroup = this._terminalGroupService.activeGroup === candidateGroup;

		// Unsplit all other instances and add them to the new group
		for (const instance of instances) {
			if (instance === candidateInstance) {
				continue;
			}

			const oldGroup = this.getGroupForInstance(instance);
			if (!oldGroup) {
				// Something went wrong, don't join this one
				continue;
			}
			oldGroup.removeInstance(instance);
			candidateGroup.addInstance(instance);
		}

		// Set the active terminal
		this.setActiveInstance(instances[0]);

		// Fire events
		this._onDidChangeInstances.fire();
		if (!wasActiveGroup) {
			this._onActiveGroupChanged.fire();
		}
	}

	moveInstance(source: ITerminalInstance, target: ITerminalInstance, side: 'before' | 'after'): void {
		const sourceGroup = this.getGroupForInstance(source);
		const targetGroup = this.getGroupForInstance(target);
		if (!sourceGroup || !targetGroup) {
			return;
		}

		// Move from the source group to the target group
		if (sourceGroup !== targetGroup) {
			// Move groups
			sourceGroup.removeInstance(source);
			targetGroup.addInstance(source);
		}

		// Rearrange within the target group
		const index = targetGroup.terminalInstances.indexOf(target) + (side === 'after' ? 1 : 0);
		targetGroup.moveInstance(source, index);
	}

	moveToEditor(source: ITerminalInstance): void {
		if (source.target === TerminalLocation.Editor) {
			return;
		}
		const sourceGroup = this.getGroupForInstance(source);
		if (!sourceGroup) {
			return;
		}
		sourceGroup.removeInstance(source);
		this._terminalEditorService.createEditor(source);
	}

	async moveToTerminalView(source?: ITerminalInstance, target?: ITerminalInstance, side?: 'before' | 'after'): Promise<void> {
		if (source) {
			this._terminalEditorService.detachInstance(source);
		} else {
			source = this._terminalEditorService.detachActiveEditorInstance();
			if (!source) {
				return;
			}
		}

		if (source.target !== TerminalLocation.Editor) {
			return;
		}
		source.target = TerminalLocation.TerminalView;

		let group: ITerminalGroup | undefined;
		if (target) {
			group = this.getGroupForInstance(target);
		}

		if (!group) {
			group = this._terminalGroupService.createGroup();
		}

		group.addInstance(source);
		this.setActiveInstance(source);
		await this.showPanel(true);
		// TODO: Shouldn't this happen automatically?
		source.setVisible(true);

		if (target && side) {
			const index = group.terminalInstances.indexOf(target) + (side === 'after' ? 1 : 0);
			group.moveInstance(source, index);
		}

		// Fire events
		this._onDidChangeInstances.fire();
		// this._onGroupsChanged.fire();
		this._onActiveGroupChanged.fire();
	}

	protected _initInstanceListeners(instance: ITerminalInstance): void {
		// instance.addDisposable(instance.onDisposed(this._onInstanceDisposed.fire, this._onInstanceDisposed));
		instance.addDisposable(instance.onTitleChanged(this._onInstanceTitleChanged.fire, this._onInstanceTitleChanged));
		instance.addDisposable(instance.onIconChanged(this._onInstanceIconChanged.fire, this._onInstanceIconChanged));
		instance.addDisposable(instance.onIconChanged(this._onInstanceColorChanged.fire, this._onInstanceColorChanged));
		instance.addDisposable(instance.onProcessIdReady(this._onInstanceProcessIdReady.fire, this._onInstanceProcessIdReady));
		instance.addDisposable(instance.statusList.onDidChangePrimaryStatus(() => this._onInstancePrimaryStatusChanged.fire(instance)));
		instance.addDisposable(instance.onLinksReady(this._onInstanceLinksReady.fire, this._onInstanceLinksReady));
		instance.addDisposable(instance.onDimensionsChanged(() => {
			this._onInstanceDimensionsChanged.fire(instance);
			if (this.configHelper.config.enablePersistentSessions && this.isProcessSupportRegistered) {
				this._saveState();
			}
		}));
		instance.addDisposable(instance.onMaximumDimensionsChanged(() => this._onInstanceMaximumDimensionsChanged.fire(instance)));
		instance.addDisposable(instance.onFocus(this._onDidChangeActiveInstance.fire, this._onDidChangeActiveInstance));
		instance.addDisposable(instance.onRequestAddInstanceToGroup(e => {
			const instanceId = TerminalInstance.getInstanceIdFromUri(e.uri);
			if (instanceId === undefined) {
				return;
			}

			// View terminals
			let sourceInstance = this.getInstanceFromId(instanceId);
			if (sourceInstance) {
				this.moveInstance(sourceInstance, instance, e.side);
			}

			// Terminal editors
			sourceInstance = this._terminalEditorService.terminalEditorInstances.find(instance => instance.resource.path === e.uri.path);
			if (sourceInstance) {
				this.moveToTerminalView(sourceInstance, instance, e.side);
			}
		}));
	}

	registerProcessSupport(isSupported: boolean): void {
		if (!isSupported) {
			return;
		}
		this._processSupportContextKey.set(isSupported);
		this._onDidRegisterProcessSupport.fire();
	}

	registerLinkProvider(linkProvider: ITerminalExternalLinkProvider): IDisposable {
		const disposables: IDisposable[] = [];
		this._linkProviders.add(linkProvider);
		for (const instance of this.instances) {
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

	registerTerminalProfileProvider(extensionIdenfifier: string, id: string, profileProvider: ITerminalProfileProvider): IDisposable {
		let extMap = this._profileProviders.get(extensionIdenfifier);
		if (!extMap) {
			extMap = new Map();
			this._profileProviders.set(extensionIdenfifier, extMap);
		}
		extMap.set(id, profileProvider);
		return toDisposable(() => this._profileProviders.delete(id));
	}

	private _setInstanceLinkProviders(instance: ITerminalInstance): void {
		for (const linkProvider of this._linkProviders) {
			const disposables = this._linkProviderDisposables.get(linkProvider);
			const provider = instance.registerLinkProvider(linkProvider);
			disposables?.push(provider);
		}
	}

	instanceIsSplit(instance: ITerminalInstance): boolean {
		const group = this.getGroupForInstance(instance);
		if (!group) {
			return false;
		}
		return group.terminalInstances.length > 1;
	}

	getGroupForInstance(instance: ITerminalInstance): ITerminalGroup | undefined {
		return this._terminalGroups.find(group => group.terminalInstances.indexOf(instance) !== -1);
	}

	async showPanel(focus?: boolean): Promise<void> {
		if (this.configHelper.config.creationTarget === TerminalLocation.Editor) {
			return;
		}
		const pane = this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID)
			?? await this._viewsService.openView(TERMINAL_VIEW_ID, focus);
		pane?.setExpanded(true);

		if (focus) {
			// Do the focus call asynchronously as going through the
			// command palette will force editor focus
			await timeout(0);
			const instance = this.activeInstance;
			if (instance) {
				await instance.focusWhenReady(true);
			}
		}
	}

	async focusTabs(): Promise<void> {
		if (this._terminalInstances.length === 0) {
			return;
		}
		await this.showPanel(true);
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		pane?.terminalTabbedView?.focusTabs();
	}

	showTabs() {
		this._configurationService.updateValue(TerminalSettingId.TabsEnabled, true);
	}

	private _getIndexFromId(terminalId: number): number {
		let terminalIndex = -1;
		this.instances.forEach((terminalInstance, i) => {
			if (terminalInstance.instanceId === terminalId) {
				terminalIndex = i;
			}
		});
		if (terminalIndex === -1) {
			throw new Error(`Terminal with ID ${terminalId} does not exist (has it already been disposed?)`);
		}
		return terminalIndex;
	}

	protected async _showTerminalCloseConfirmation(singleTerminal?: boolean): Promise<boolean> {
		let message: string;
		if (this.instances.length === 1 || singleTerminal) {
			message = nls.localize('terminalService.terminalCloseConfirmationSingular', "There is an active terminal session, do you want to kill it?");
		} else {
			message = nls.localize('terminalService.terminalCloseConfirmationPlural', "There are {0} active terminal sessions, do you want to kill them?", this.instances.length);
		}
		const res = await this._dialogService.confirm({
			message,
			type: 'warning',
		});
		return !res.confirmed;
	}

	private async _getPlatformKey(): Promise<string> {
		const env = await this._remoteAgentService.getEnvironment();
		if (env) {
			return env.os === OperatingSystem.Windows ? 'windows' : (env.os === OperatingSystem.Macintosh ? 'osx' : 'linux');
		}
		return isWindows ? 'windows' : (isMacintosh ? 'osx' : 'linux');
	}

	async showProfileQuickPick(type: 'setDefault' | 'createInstance', cwd?: string | URI): Promise<ITerminalInstance | undefined> {
		let keyMods: IKeyMods | undefined;
		const profiles = await this._detectProfiles(true);
		const platformKey = await this._getPlatformKey();

		const options: IPickOptions<IProfileQuickPickItem> = {
			placeHolder: type === 'createInstance' ? nls.localize('terminal.integrated.selectProfileToCreate', "Select the terminal profile to create") : nls.localize('terminal.integrated.chooseDefaultProfile', "Select your default terminal profile"),
			onDidTriggerItemButton: async (context) => {
				if ('command' in context.item.profile) {
					return;
				}
				if ('id' in context.item.profile) {
					return;
				}
				const configKey = `terminal.integrated.profiles.${platformKey}`;
				const configProfiles = this._configurationService.getValue<{ [key: string]: ITerminalProfileObject }>(configKey);
				const existingProfiles = configProfiles ? Object.keys(configProfiles) : [];
				const name = await this._quickInputService.input({
					prompt: nls.localize('enterTerminalProfileName', "Enter terminal profile name"),
					value: context.item.profile.profileName,
					validateInput: async input => {
						if (existingProfiles.includes(input)) {
							return nls.localize('terminalProfileAlreadyExists', "A terminal profile already exists with that name");
						}
						return undefined;
					}
				});
				if (!name) {
					return;
				}
				const newConfigValue: { [key: string]: ITerminalProfileObject } = { ...configProfiles } ?? {};
				newConfigValue[name] = {
					path: context.item.profile.path,
					args: context.item.profile.args
				};
				await this._configurationService.updateValue(configKey, newConfigValue, ConfigurationTarget.USER);
			},
			onKeyMods: mods => keyMods = mods
		};

		// Build quick pick items
		const quickPickItems: (IProfileQuickPickItem | IQuickPickSeparator)[] = [];
		const configProfiles = profiles.filter(e => !e.isAutoDetected);
		const autoDetectedProfiles = profiles.filter(e => e.isAutoDetected);
		if (configProfiles.length > 0) {
			quickPickItems.push({ type: 'separator', label: nls.localize('terminalProfiles', "profiles") });
			quickPickItems.push(...configProfiles.map(e => this._createProfileQuickPickItem(e)));
		}

		// Add contributed profiles
		if (type === 'createInstance') {
			for (const contributed of this._terminalContributionService.terminalProfiles) {
				const icon = contributed.icon ? (iconRegistry.get(contributed.icon) || Codicon.terminal) : Codicon.terminal;
				quickPickItems.push({
					label: `$(${icon.id}) ${contributed.title}`,
					profile: contributed
				});
			}
		}

		if (autoDetectedProfiles.length > 0) {
			quickPickItems.push({ type: 'separator', label: nls.localize('terminalProfiles.detected', "detected") });
			quickPickItems.push(...autoDetectedProfiles.map(e => this._createProfileQuickPickItem(e)));
		}

		const value = await this._quickInputService.pick(quickPickItems, options);
		if (!value) {
			return;
		}
		if (type === 'createInstance') {
			const activeInstance = this.activeInstance;
			let instance;

			if ('id' in value.profile) {
				await this.createContributedTerminalProfile(value.profile.extensionIdentifier, value.profile.id, !!(keyMods?.alt && activeInstance));
				return;
			} else {
				if (keyMods?.alt && activeInstance) {
					// create split, only valid if there's an active instance
					instance = this.splitInstance(activeInstance, value.profile, cwd);
				} else {
					instance = this.createTerminal({ target: this.configHelper.config.creationTarget, config: value.profile, cwd });
				}
			}

			if (instance && this.configHelper.config.creationTarget === TerminalLocation.TerminalView) {
				this.showPanel(true);
				this.setActiveInstance(instance);
				return instance;
			}
		} else { // setDefault
			if ('command' in value.profile || 'id' in value.profile) {
				return; // Should never happen
			}

			// Add the profile to settings if necessary
			if (value.profile.isAutoDetected) {
				const profilesConfig = await this._configurationService.getValue(`terminal.integrated.profiles.${platformKey}`);
				if (typeof profilesConfig === 'object') {
					const newProfile: ITerminalProfileObject = {
						path: value.profile.path
					};
					if (value.profile.args) {
						newProfile.args = value.profile.args;
					}
					(profilesConfig as { [key: string]: ITerminalProfileObject })[value.profile.profileName] = newProfile;
				}
				await this._configurationService.updateValue(`terminal.integrated.profiles.${platformKey}`, profilesConfig, ConfigurationTarget.USER);
			}
			// Set the default profile
			await this._configurationService.updateValue(`terminal.integrated.defaultProfile.${platformKey}`, value.profile.profileName, ConfigurationTarget.USER);
		}
		return undefined;
	}

	async createContributedTerminalProfile(extensionIdentifier: string, id: string, isSplitTerminal: boolean): Promise<void> {
		await this._extensionService.activateByEvent(`onTerminalProfile:${id}`);
		const extMap = this._profileProviders.get(extensionIdentifier);
		const profileProvider = extMap?.get(id);
		if (!profileProvider) {
			this._notificationService.error(`No terminal profile provider registered for id "${id}"`);
			return;
		}
		try {
			await profileProvider.createContributedTerminalProfile(isSplitTerminal);
			this._terminalGroupService.setActiveInstanceByIndex(this._terminalInstances.length - 1);
			await this.activeInstance?.focusWhenReady();
		} catch (e) {
			this._notificationService.error(e.message);
		}
	}

	private _createProfileQuickPickItem(profile: ITerminalProfile): IProfileQuickPickItem {
		const buttons: IQuickInputButton[] = [{
			iconClass: ThemeIcon.asClassName(configureTerminalProfileIcon),
			tooltip: nls.localize('createQuickLaunchProfile', "Configure Terminal Profile")
		}];
		const icon = (profile.icon && ThemeIcon.isThemeIcon(profile.icon)) ? profile.icon : Codicon.terminal;
		const label = `$(${icon.id}) ${profile.profileName}`;
		if (profile.args) {
			if (typeof profile.args === 'string') {
				return { label, description: `${profile.path} ${profile.args}`, profile, buttons };
			}
			const argsString = profile.args.map(e => {
				if (e.includes(' ')) {
					return `"${e.replace('/"/g', '\\"')}"`;
				}
				return e;
			}).join(' ');
			return { label, description: `${profile.path} ${argsString}`, profile, buttons };
		}
		return { label, description: profile.path, profile, buttons };
	}

	createInstance(shellLaunchConfig: IShellLaunchConfig): ITerminalInstance {
		const instance = this._instantiationService.createInstance(TerminalInstance,
			this._terminalFocusContextKey,
			this._terminalShellTypeContextKey,
			this._terminalAltBufferActiveContextKey,
			this._configHelper,
			shellLaunchConfig
		);
		this._onInstanceCreated.fire(instance);
		return instance;
	}

	private _convertProfileToShellLaunchConfig(shellLaunchConfigOrProfile?: IShellLaunchConfig | ITerminalProfile, cwd?: string | URI): IShellLaunchConfig {
		// Profile was provided
		if (shellLaunchConfigOrProfile && 'profileName' in shellLaunchConfigOrProfile) {
			const profile = shellLaunchConfigOrProfile;
			return {
				executable: profile.path,
				args: profile.args,
				env: profile.env,
				icon: profile.icon,
				color: profile.color,
				name: profile.overrideName ? profile.profileName : undefined,
				cwd
			};
		}

		// Shell launch config was provided
		if (shellLaunchConfigOrProfile) {
			if (cwd) {
				shellLaunchConfigOrProfile.cwd = cwd;
			}
			return shellLaunchConfigOrProfile;
		}

		// Return empty shell launch config
		return {};
	}

	createTerminal(options?: ICreateTerminalOptions): ITerminalInstance {
		const shellLaunchConfig = this._convertProfileToShellLaunchConfig(options?.config);

		if (options?.cwd) {
			shellLaunchConfig.cwd = options.cwd;
		}

		if (!shellLaunchConfig.customPtyImplementation && !this.isProcessSupportRegistered) {
			throw new Error('Could not create terminal when process support is not registered');
		}
		if (shellLaunchConfig.hideFromUser) {
			const instance = this.createInstance(shellLaunchConfig);
			this._backgroundedTerminalInstances.push(instance);
			this._initInstanceListeners(instance);
			return instance;
		}

		// Add welcome message and title annotation for local terminals launched within remote or
		// virtual workspaces
		if (typeof shellLaunchConfig.cwd !== 'string' && shellLaunchConfig.cwd?.scheme === Schemas.file) {
			if (VirtualWorkspaceContext.getValue(this._contextKeyService)) {
				shellLaunchConfig.initialText = formatMessageForTerminal(nls.localize('localTerminalVirtualWorkspace', "⚠ : This shell is open to a {0}local{1} folder, NOT to the virtual folder", '\x1b[3m', '\x1b[23m'), true);
				shellLaunchConfig.description = nls.localize('localTerminalDescription', "Local");
			} else if (this._remoteAgentService.getConnection()) {
				shellLaunchConfig.initialText = formatMessageForTerminal(nls.localize('localTerminalRemote', "⚠ : This shell is running on your {0}local{1} machine, NOT on the connected remote machine", '\x1b[3m', '\x1b[23m'), true);
				shellLaunchConfig.description = nls.localize('localTerminalDescription', "Local");
			}
		}

		let instance: ITerminalInstance;
		if (options?.target === TerminalLocation.Editor || this.configHelper.config.creationTarget === TerminalLocation.Editor) {
			instance = this.createInstance(shellLaunchConfig);
			this._terminalEditorService.createEditor(instance);
			this._initInstanceListeners(instance);
			this._onDidChangeInstances.fire();
		} else {
			const group = this._terminalGroupService.createGroup(shellLaunchConfig);
			// const terminalGroup = this._instantiationService.createInstance(TerminalGroup, this._terminalContainer, shellLaunchConfig);
			// this._terminalGroups.push(terminalGroup);
			// terminalGroup.onPanelOrientationChanged((orientation) => this._onPanelOrientationChanged.fire(orientation));

			instance = group.terminalInstances[0];

			// terminalGroup.addDisposable(terminalGroup.onDisposed(this._onGroupDisposed.fire, this._onGroupDisposed));
			// terminalGroup.addDisposable(terminalGroup.onInstancesChanged(this._onInstancesChanged.fire, this._onInstancesChanged));
			this._initInstanceListeners(instance);
			this._onDidChangeInstances.fire();
			// this._onGroupsChanged.fire();
		}

		if (this.instances.length === 1) {
			// It's the first instance so it should be made active automatically, this must fire
			// after onInstancesChanged so consumers can react to the instance being added first
			this._terminalGroupService.setActiveInstanceByIndex(0);
		}
		return instance;
	}

	protected _showBackgroundTerminal(instance: ITerminalInstance): void {
		this._backgroundedTerminalInstances.splice(this._backgroundedTerminalInstances.indexOf(instance), 1);
		instance.shellLaunchConfig.hideFromUser = false;
		this._terminalGroupService.createGroup(instance);

		// Make active automatically if it's the first instance
		if (this.instances.length === 1) {
			this._terminalGroupService.setActiveInstanceByIndex(0);
		}

		this._onDidChangeInstances.fire();
		this._onGroupsChanged.fire();
	}

	async focusFindWidget(): Promise<void> {
		await this.showPanel(false);
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		pane?.terminalTabbedView?.focusFindWidget();
	}

	hideFindWidget(): void {
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		pane?.terminalTabbedView?.hideFindWidget();
	}

	findNext(): void {
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		if (pane?.terminalTabbedView) {
			pane.terminalTabbedView.showFindWidget();
			pane.terminalTabbedView.getFindWidget().find(false);
		}
	}

	findPrevious(): void {
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		if (pane?.terminalTabbedView) {
			pane.terminalTabbedView.showFindWidget();
			pane.terminalTabbedView.getFindWidget().find(true);
		}
	}

	async setContainers(panelContainer: HTMLElement, terminalContainer: HTMLElement): Promise<void> {
		this._configHelper.panelContainer = panelContainer;
		this._terminalGroupService.setContainer(terminalContainer);
	}

	hidePanel(): void {
		// Hide the panel if the terminal is in the panel and it has no sibling views
		const location = this._viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID);
		if (location === ViewContainerLocation.Panel) {
			const panel = this._viewDescriptorService.getViewContainerByViewId(TERMINAL_VIEW_ID);
			if (panel && this._viewDescriptorService.getViewContainerModel(panel).activeViewDescriptors.length === 1) {
				this._layoutService.setPanelHidden(true);
				KEYBINDING_CONTEXT_TERMINAL_TABS_MOUSE.bindTo(this._contextKeyService).set(false);
			}
		}
	}
}

interface IProfileQuickPickItem extends IQuickPickItem {
	profile: ITerminalProfile | (ITerminalProfileContribution & { extensionIdentifier: string });
}
