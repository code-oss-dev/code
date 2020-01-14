/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IUserDataSyncService, SyncStatus, SyncSource, CONTEXT_SYNC_STATE, IUserDataSyncStore, registerConfiguration, getUserDataSyncStore, ISyncConfiguration, IUserDataAuthTokenService } from 'vs/platform/userDataSync/common/userDataSync';
import { localize } from 'vs/nls';
import { Disposable, MutableDisposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { MenuRegistry, MenuId, IMenuItem } from 'vs/platform/actions/common/actions';
import { IContextKeyService, IContextKey, ContextKeyExpr, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IActivityService, IBadge, NumberBadge, ProgressBadge } from 'vs/workbench/services/activity/common/activity';
import { GLOBAL_ACTIVITY_ID } from 'vs/workbench/common/activity';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { URI } from 'vs/base/common/uri';
import { registerAndGetAmdImageURL } from 'vs/base/common/amd';
import { ResourceContextKey } from 'vs/workbench/common/resources';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { Event } from 'vs/base/common/event';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { isEqual } from 'vs/base/common/resources';
import { IEditorInput } from 'vs/workbench/common/editor';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { isWeb } from 'vs/base/common/platform';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { UserDataAutoSync } from 'vs/workbench/contrib/userDataSync/browser/userDataAutoSync';
import { UserDataSyncTrigger } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncTrigger';
import { timeout } from 'vs/base/common/async';
import { IOutputService } from 'vs/workbench/contrib/output/common/output';
import * as Constants from 'vs/workbench/contrib/logs/common/logConstants';
import { IAuthenticationService, ChangeAccountEventData } from 'vs/workbench/services/authentication/browser/authenticationService';
import { Account } from 'vs/editor/common/modes';

const enum MSAAuthStatus {
	Initializing = 'Initializing',
	SignedIn = 'SignedIn',
	SignedOut = 'SignedOut'
}
const CONTEXT_AUTH_TOKEN_STATE = new RawContextKey<string>('authTokenStatus', MSAAuthStatus.Initializing);
const SYNC_PUSH_LIGHT_ICON_URI = URI.parse(registerAndGetAmdImageURL(`vs/workbench/contrib/userDataSync/browser/media/check-light.svg`));
const SYNC_PUSH_DARK_ICON_URI = URI.parse(registerAndGetAmdImageURL(`vs/workbench/contrib/userDataSync/browser/media/check-dark.svg`));

const MSA = 'MSA';

export class UserDataSyncWorkbenchContribution extends Disposable implements IWorkbenchContribution {

	private static readonly ENABLEMENT_SETTING = 'sync.enable';

	private readonly userDataSyncStore: IUserDataSyncStore | undefined;
	private readonly syncStatusContext: IContextKey<string>;
	private readonly authenticationState: IContextKey<string>;
	private readonly badgeDisposable = this._register(new MutableDisposable());
	private readonly conflictsWarningDisposable = this._register(new MutableDisposable());
	private readonly signInNotificationDisposable = this._register(new MutableDisposable());
	private _activeAccount: Account | undefined;

	constructor(
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IActivityService private readonly activityService: IActivityService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IHistoryService private readonly historyService: IHistoryService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOutputService private readonly outputService: IOutputService,
		@IUserDataAuthTokenService private readonly userDataAuthTokenService: IUserDataAuthTokenService,
	) {
		super();
		this.userDataSyncStore = getUserDataSyncStore(configurationService);
		this.syncStatusContext = CONTEXT_SYNC_STATE.bindTo(contextKeyService);
		this.authenticationState = CONTEXT_AUTH_TOKEN_STATE.bindTo(contextKeyService);
		if (this.userDataSyncStore) {
			registerConfiguration();
			this.onDidChangeSyncStatus(this.userDataSyncService.status);
			this._register(Event.debounce(userDataSyncService.onDidChangeStatus, () => undefined, 500)(() => this.onDidChangeSyncStatus(this.userDataSyncService.status)));
			this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration(UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING))(() => this.onDidChangeEnablement()));
			this._register(this.authenticationService.onDidRegisterAuthenticationProvider(e => this.onDidRegisterAuthenticationProvider(e)));
			this._register(this.authenticationService.onDidUnregisterAuthenticationProvider(e => this.onDidUnregisterAuthenticationProvider(e)));
			this._register(this.authenticationService.onDidChangeAccounts(e => this.onDidChangeAccounts(e)));
			this.registerActions();
			this.initializeActiveAccount().then(_ => {
				if (isWeb) {
					this._register(instantiationService.createInstance(UserDataAutoSync));
				} else {
					this._register(instantiationService.createInstance(UserDataSyncTrigger).onDidTriggerSync(() => this.triggerSync()));
				}
			});
		}
	}

	private triggerSync(): void {
		if (this.configurationService.getValue<boolean>('sync.enable')
			&& this.userDataSyncService.status !== SyncStatus.Uninitialized
			&& this.authenticationState.get() === MSAAuthStatus.SignedIn) {
			this.userDataSyncService.sync();
		}
	}

	private async initializeActiveAccount(): Promise<void> {
		const accounts = await this.authenticationService.getAccounts(MSA);
		// MSA provider has not yet been registered
		if (!accounts) {
			return;
		}

		if (accounts.length === 0) {
			this.activeAccount = undefined;
			return;
		}

		if (accounts.length === 1) {
			this.activeAccount = accounts[0];
			return;
		}

		const selectedAccount = await this.quickInputService.pick(accounts.map(account => {
			return {
				id: account.id,
				label: account.displayName
			};
		}), { canPickMany: false });

		if (selectedAccount) {
			this.activeAccount = accounts.filter(account => selectedAccount.id === account.id)[0];
		}
	}

	get activeAccount(): Account | undefined {
		return this._activeAccount;
	}

	set activeAccount(account: Account | undefined) {
		this._activeAccount = account;

		if (account) {
			this.userDataAuthTokenService.setToken(account.accessToken);
			this.authenticationState.set(MSAAuthStatus.SignedIn);
		} else {
			this.userDataAuthTokenService.setToken(undefined);
			this.authenticationState.set(MSAAuthStatus.SignedOut);
		}

		this.updateBadge();
	}

	private onDidChangeAccounts(event: ChangeAccountEventData): void {
		if (event.providerId === MSA) {
			if (this.activeAccount) {
				// Try to update existing account, case where access token has been refreshed
				const matchingAccount = event.accounts.filter(a => a.id === this.activeAccount?.id)[0];
				this.activeAccount = matchingAccount;
			} else {
				this.initializeActiveAccount();
			}
		}
	}

	private async onDidRegisterAuthenticationProvider(providerId: string) {
		if (providerId === MSA) {
			await this.initializeActiveAccount();
		}
	}

	private onDidUnregisterAuthenticationProvider(providerId: string) {
		if (providerId === MSA) {
			this.activeAccount = undefined;
			this.authenticationState.reset();
		}
	}

	private onDidChangeSyncStatus(status: SyncStatus) {
		this.syncStatusContext.set(status);

		if (status === SyncStatus.Syncing) {
			// Show syncing progress if takes more than 1s.
			timeout(1000).then(() => this.updateBadge());
		} else {
			this.updateBadge();
		}

		if (this.userDataSyncService.status === SyncStatus.HasConflicts) {
			if (!this.conflictsWarningDisposable.value) {
				const handle = this.notificationService.prompt(Severity.Warning, localize('conflicts detected', "Unable to sync due to conflicts. Please resolve them to continue."),
					[
						{
							label: localize('resolve', "Resolve Conflicts"),
							run: () => this.handleConflicts()
						}
					]);
				this.conflictsWarningDisposable.value = toDisposable(() => handle.close());
				handle.onDidClose(() => this.conflictsWarningDisposable.clear());
			}
		} else {
			const previewEditorInput = this.getPreviewEditorInput();
			if (previewEditorInput) {
				previewEditorInput.dispose();
			}
			this.conflictsWarningDisposable.clear();
		}
	}

	private onDidChangeEnablement() {
		this.updateBadge();
		const enabled = this.configurationService.getValue<boolean>(UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING);
		if (enabled) {
			if (this.authenticationState.get() === MSAAuthStatus.SignedOut) {
				const handle = this.notificationService.prompt(Severity.Info, this.getSignInAndTurnOnDetailString(),
					[
						{
							label: localize('Sign in', "Sign in"),
							run: () => this.signIn()
						}
					]);
				this.signInNotificationDisposable.value = toDisposable(() => handle.close());
				handle.onDidClose(() => this.signInNotificationDisposable.clear());
			}
		} else {
			this.signInNotificationDisposable.clear();
		}
	}

	private async updateBadge(): Promise<void> {
		this.badgeDisposable.clear();

		let badge: IBadge | undefined = undefined;
		let clazz: string | undefined;
		let priority: number | undefined = undefined;

		if (this.userDataSyncService.status !== SyncStatus.Uninitialized && this.configurationService.getValue<boolean>(UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING) && this.authenticationState.get() === MSAAuthStatus.SignedOut) {
			badge = new NumberBadge(1, () => localize('sign in to sync', "Sign in to Sync"));
		} else if (this.userDataSyncService.status === SyncStatus.HasConflicts) {
			badge = new NumberBadge(1, () => localize('resolve conflicts', "Resolve Conflicts"));
		} else if (this.userDataSyncService.status === SyncStatus.Syncing) {
			badge = new ProgressBadge(() => localize('syncing', "Synchronizing User Configuration..."));
			clazz = 'progress-badge';
			priority = 1;
		}

		if (badge) {
			this.badgeDisposable.value = this.activityService.showActivity(GLOBAL_ACTIVITY_ID, badge, clazz, priority);
		}
	}

	private getTurnOnDetailString(): string {
		const { enableSettings, enableKeybindings, enableExtensions, enableUIState } = this.configurationService.getValue<{ enableSettings: boolean, enableKeybindings: boolean, enableExtensions: boolean, enableUIState: boolean }>('sync');
		if (enableSettings && enableKeybindings && enableExtensions && enableUIState) {
			return localize('turn on sync detail 1', "This will synchronize your settings, keybindings, extensions and other UI state (display language) across all your devices.");
		}
		if (enableSettings && enableKeybindings && enableExtensions) {
			return localize('turn on sync detail 2', "This will synchronize your settings, keybindings and extensions across all your devices.");
		}
		if (enableSettings && enableKeybindings && enableUIState) {
			return localize('turn on sync detail 3', "This will synchronize your settings, keybindings and other UI state (display language) across all your devices.");
		}
		if (enableSettings && enableExtensions && enableUIState) {
			return localize('turn on sync detail 4', "This will synchronize your settings, extensions and other UI state (display language) across all your devices.");
		}
		if (enableSettings && enableKeybindings) {
			return localize('turn on sync detail 5', "This will synchronize your settings and keybindings across all your devices.");
		}
		if (enableSettings && enableExtensions) {
			return localize('turn on sync detail 6', "This will synchronize your settings and extensions across all your devices.");
		}
		if (enableSettings && enableUIState) {
			return localize('turn on sync detail 7', "This will synchronize your settings and UI state (display language) across all your devices.");
		}
		if (enableKeybindings && enableExtensions) {
			return localize('turn on sync detail 8', "This will synchronize your keybindings and extensions across all your devices.");
		}
		if (enableKeybindings && enableUIState) {
			return localize('turn on sync detail 9', "This will synchronize your keybindings and UI state (display language) across all your devices.");
		}
		if (enableExtensions && enableUIState) {
			return localize('turn on sync detail 10', "This will synchronize your extensions and UI state (display language) across all your devices.");
		}
		if (enableSettings) {
			return localize('turn on sync detail 11', "This will synchronize your settings across all your devices.");
		}
		if (enableKeybindings) {
			return localize('turn on sync detail 12', "This will synchronize your keybindings across all your devices.");
		}
		if (enableExtensions) {
			return localize('turn on sync detail 13', "This will synchronize your extensions across all your devices.");
		}
		if (enableUIState) {
			return localize('turn on sync detail 14', "This will synchronize your UI state (display language) across all your devices.");
		}
		return '';
	}

	private getSignInAndTurnOnDetailString(): string {
		const { enableSettings, enableKeybindings, enableExtensions, enableUIState } = this.configurationService.getValue<ISyncConfiguration>().sync;
		if (enableSettings && enableKeybindings && enableExtensions && enableUIState) {
			return localize('sign in and turn on sync detail 1', "Please sign in with your {0} account to synchronize your settings, keybindings, extensions and other UI state (display language) across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableSettings && enableKeybindings && enableExtensions) {
			return localize('sign in and turn on sync detail 2', "Please sign in with your {0} account to synchronize your settings, keybindings and extensions across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableSettings && enableKeybindings && enableUIState) {
			return localize('sign in and turn on sync detail 3', "Please sign in with your {0} account to synchronize your settings, keybindings and other UI state (display language) across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableSettings && enableExtensions && enableUIState) {
			return localize('sign in and turn on sync detail 4', "Please sign in with your {0} account to synchronize your settings, extensions and other UI state (display language) across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableSettings && enableKeybindings) {
			return localize('sign in and turn on sync detail 5', "Please sign in with your {0} account to synchronize your settings and keybindings across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableSettings && enableExtensions) {
			return localize('sign in and turn on sync detail 6', "Please sign in with your {0} account to synchronize your settings and extensions across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableSettings && enableUIState) {
			return localize('sign in and turn on sync detail 7', "Please sign in with your {0} account to synchronize your settings and UI state (display language) across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableKeybindings && enableExtensions) {
			return localize('sign in and turn on sync detail 8', "Please sign in with your {0} account to synchronize your keybindings and extensions across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableKeybindings && enableUIState) {
			return localize('sign in and turn on sync detail 9', "Please sign in with your {0} account to synchronize your keybindings and UI state (display language) across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableExtensions && enableUIState) {
			return localize('sign in and turn on sync detail 10', "Please sign in with your {0} account to synchronize your extensions and UI state (display language) across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableSettings) {
			return localize('sign in and turn on sync detail 11', "Please sign in with your {0} account to synchronize your settings across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableKeybindings) {
			return localize('sign in and turn on sync detail 12', "Please sign in with your {0} account to synchronize your keybindings across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableExtensions) {
			return localize('sign in and turn on sync detail 13', "Please sign in with your {0} account to synchronize your extensions across all your devices.", this.userDataSyncStore!.account);
		}
		if (enableUIState) {
			return localize('sign in and turn on sync detail 14', "Please sign in with your {0} account to synchronize your UI state (display language) across all your devices.", this.userDataSyncStore!.account);
		}
		return '';
	}

	private async turnOn(): Promise<void> {
		const message = localize('turn on sync', "Turn on Sync");
		let detail: string, primaryButton: string;
		if (this.authenticationState.get() === MSAAuthStatus.SignedIn) {
			detail = this.getTurnOnDetailString();
			primaryButton = localize('turn on', "Turn on");
		} else {
			detail = this.getSignInAndTurnOnDetailString();
			primaryButton = localize('sign in and turn on sync', "Sign in & Turn on");
		}
		const result = await this.dialogService.show(Severity.Info, message, [primaryButton, localize('cancel', "Cancel"), localize('configure', "Configure")], { detail, cancelId: 1 });
		switch (result.choice) {
			case 1: return;
			case 2: await this.configureSyncOptions(); return this.turnOn();
		}
		if (this.authenticationState.get() === MSAAuthStatus.SignedOut) {
			await this.signIn();
		}
		await this.configurationService.updateValue(UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING, true);
		this.notificationService.info(localize('Sync Started', "Sync Started."));
	}

	private async configureSyncOptions(): Promise<ISyncConfiguration> {
		return new Promise((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = this.quickInputService.createQuickPick();
			disposables.add(quickPick);
			quickPick.title = localize('configure sync title', "Sync: Configure");
			quickPick.placeholder = localize('select configurations to sync', "Choose what to sync");
			quickPick.canSelectMany = true;
			quickPick.ignoreFocusOut = true;
			const items = [{
				id: 'sync.enableSettings',
				label: localize('user settings', "User Settings")
			}, {
				id: 'sync.enableKeybindings',
				label: localize('user keybindings', "User Keybindings")
			}, {
				id: 'sync.enableUIState',
				label: localize('ui state', "UI State"),
				description: localize('ui state description', "Display Language (Only)")
			}, {
				id: 'sync.enableExtensions',
				label: localize('extensions', "Extensions")
			}];
			quickPick.items = items;
			quickPick.selectedItems = items.filter(item => this.configurationService.getValue(item.id));
			disposables.add(quickPick.onDidAccept(async () => {
				if (quickPick.selectedItems.length) {
					for (const item of items) {
						const wasEnabled = this.configurationService.getValue(item.id);
						const isEnabled = !!quickPick.selectedItems.filter(selected => selected.id === item.id)[0];
						if (wasEnabled !== isEnabled) {
							await this.configurationService.updateValue(item.id!, isEnabled);
						}
					}
					quickPick.hide();
				}
			}));
			disposables.add(quickPick.onDidHide(() => {
				disposables.dispose();
				c();
			}));
			quickPick.show();
		});
	}

	private async turnOff(): Promise<void> {
		const result = await this.dialogService.confirm({
			type: 'info',
			message: localize('turn off sync confirmation', "Turn off Sync"),
			detail: localize('turn off sync detail', "Your settings, keybindings, extensions and more will no longer be synced."),
			primaryButton: localize('turn off', "Turn off")
		});
		if (result.confirmed) {
			await this.configurationService.updateValue(UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING, false);
		}
	}

	private async signIn(): Promise<void> {
		try {
			this.activeAccount = await this.authenticationService.login(MSA);
		} catch (e) {
			this.notificationService.error(e);
			throw e;
		}
	}

	private async signOut(): Promise<void> {
		if (this.activeAccount) {
			await this.authenticationService.logout(MSA, this.activeAccount.id);
			this.activeAccount = undefined;
		}
	}

	private async continueSync(): Promise<void> {
		// Get the preview editor
		const previewEditorInput = this.getPreviewEditorInput();
		// Save the preview
		if (previewEditorInput && previewEditorInput.isDirty()) {
			await this.textFileService.save(previewEditorInput.getResource()!);
		}
		try {
			// Continue Sync
			await this.userDataSyncService.sync(true);
		} catch (error) {
			this.notificationService.error(error);
			return;
		}
		// Close the preview editor
		if (previewEditorInput) {
			previewEditorInput.dispose();
		}
	}

	private getPreviewEditorInput(): IEditorInput | undefined {
		return this.editorService.editors.filter(input => isEqual(input.getResource(), this.workbenchEnvironmentService.settingsSyncPreviewResource) || isEqual(input.getResource(), this.workbenchEnvironmentService.keybindingsSyncPreviewResource))[0];
	}

	private async handleConflicts(): Promise<void> {
		const conflictsResource = this.getConflictsResource();
		if (conflictsResource) {
			const resourceInput = {
				resource: conflictsResource,
				options: {
					preserveFocus: false,
					pinned: false,
					revealIfVisible: true,
				},
				mode: 'jsonc'
			};
			this.editorService.openEditor(resourceInput)
				.then(editor => {
					this.historyService.remove(resourceInput);
					if (editor && editor.input) {
						// Trigger sync after closing the conflicts editor.
						const disposable = editor.input.onDispose(() => {
							disposable.dispose();
							this.userDataSyncService.sync(true);
						});
					}
				});
		}
	}

	private getConflictsResource(): URI | null {
		if (this.userDataSyncService.conflictsSource === SyncSource.Settings) {
			return this.workbenchEnvironmentService.settingsSyncPreviewResource;
		}
		if (this.userDataSyncService.conflictsSource === SyncSource.Keybindings) {
			return this.workbenchEnvironmentService.keybindingsSyncPreviewResource;
		}
		return null;
	}

	private showSyncLog(): Promise<void> {
		return this.outputService.showChannel(Constants.userDataSyncLogChannelId);
	}

	private registerActions(): void {

		const turnOnSyncCommandId = 'workbench.userData.actions.syncStart';
		const turnOnSyncWhenContext = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), ContextKeyExpr.not(`config.${UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING}`), CONTEXT_AUTH_TOKEN_STATE.notEqualsTo(MSAAuthStatus.Initializing));
		CommandsRegistry.registerCommand(turnOnSyncCommandId, () => this.turnOn());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: turnOnSyncCommandId,
				title: localize('global activity turn on sync', "Turn on sync...")
			},
			when: turnOnSyncWhenContext,
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: turnOnSyncCommandId,
				title: localize('turn on sync...', "Sync: Turn on sync...")
			},
			when: turnOnSyncWhenContext,
		});

		const signInCommandId = 'workbench.userData.actions.signin';
		const signInWhenContext = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), ContextKeyExpr.has(`config.${UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING}`), CONTEXT_AUTH_TOKEN_STATE.isEqualTo(MSAAuthStatus.SignedOut));
		CommandsRegistry.registerCommand(signInCommandId, () => this.signIn());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: signInCommandId,
				title: localize('global activity sign in', "Sign in to sync... (1)")
			},
			when: signInWhenContext,
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: signInCommandId,
				title: localize('sign in', "Sync: Sign in to sync...")
			},
			when: signInWhenContext,
		});

		const stopSyncCommandId = 'workbench.userData.actions.stopSync';
		CommandsRegistry.registerCommand(stopSyncCommandId, () => this.turnOff());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: stopSyncCommandId,
				title: localize('global activity stop sync', "Turn off sync")
			},
			when: ContextKeyExpr.and(ContextKeyExpr.has(`config.${UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING}`), CONTEXT_AUTH_TOKEN_STATE.isEqualTo(MSAAuthStatus.SignedIn), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.HasConflicts))
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: stopSyncCommandId,
				title: localize('stop sync', "Sync: Turn off sync")
			},
			when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), ContextKeyExpr.has(`config.${UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING}`)),
		});

		const resolveConflictsCommandId = 'workbench.userData.actions.resolveConflicts';
		const resolveConflictsWhenContext = CONTEXT_SYNC_STATE.isEqualTo(SyncStatus.HasConflicts);
		CommandsRegistry.registerCommand(resolveConflictsCommandId, () => this.handleConflicts());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: resolveConflictsCommandId,
				title: localize('resolveConflicts_global', "Resolve sync conflicts (1)"),
			},
			when: resolveConflictsWhenContext,
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: resolveConflictsCommandId,
				title: localize('resolveConflicts', "Sync: Resolve sync conflicts"),
			},
			when: resolveConflictsWhenContext,
		});

		const continueSyncCommandId = 'workbench.userData.actions.continueSync';
		CommandsRegistry.registerCommand(continueSyncCommandId, () => this.continueSync());
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: continueSyncCommandId,
				title: localize('continue sync', "Sync: Continue sync")
			},
			when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.isEqualTo(SyncStatus.HasConflicts)),
		});
		MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
			command: {
				id: continueSyncCommandId,
				title: localize('continue sync', "Sync: Continue sync"),
				icon: {
					light: SYNC_PUSH_LIGHT_ICON_URI,
					dark: SYNC_PUSH_DARK_ICON_URI
				}
			},
			group: 'navigation',
			order: 1,
			when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.isEqualTo(SyncStatus.HasConflicts), ResourceContextKey.Resource.isEqualTo(this.workbenchEnvironmentService.settingsSyncPreviewResource.toString())),
		});
		MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
			command: {
				id: continueSyncCommandId,
				title: localize('continue sync', "Sync: Continue sync"),
				icon: {
					light: SYNC_PUSH_LIGHT_ICON_URI,
					dark: SYNC_PUSH_DARK_ICON_URI
				}
			},
			group: 'navigation',
			order: 1,
			when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.isEqualTo(SyncStatus.HasConflicts), ResourceContextKey.Resource.isEqualTo(this.workbenchEnvironmentService.keybindingsSyncPreviewResource.toString())),
		});

		const signOutMenuItem: IMenuItem = {
			group: '5_sync',
			command: {
				id: 'workbench.userData.actions.signout',
				title: localize('sign out', "Sync: Sign out")
			},
			when: ContextKeyExpr.and(CONTEXT_AUTH_TOKEN_STATE.isEqualTo(MSAAuthStatus.SignedIn)),
		};
		CommandsRegistry.registerCommand(signOutMenuItem.command.id, () => this.signOut());
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, signOutMenuItem);

		const configureSyncCommandId = 'workbench.userData.actions.configureSync';
		CommandsRegistry.registerCommand(configureSyncCommandId, () => this.configureSyncOptions());
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: configureSyncCommandId,
				title: localize('configure sync', "Sync: Configure")
			},
			when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), ContextKeyExpr.has(`config.${UserDataSyncWorkbenchContribution.ENABLEMENT_SETTING}`)),
		});

		const showSyncLogCommandId = 'workbench.userData.actions.showSyncLog';
		CommandsRegistry.registerCommand(showSyncLogCommandId, () => this.showSyncLog());
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: showSyncLogCommandId,
				title: localize('show sync log', "Sync: Show Sync Log")
			},
			when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized)),
		});
	}
}
