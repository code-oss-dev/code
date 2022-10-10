/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { getErrorMessage, isCancellationError } from 'vs/base/common/errors';
import { Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, MutableDisposable, toDisposable, IDisposable } from 'vs/base/common/lifecycle';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import type { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/model';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { ITextModelContentProvider, ITextModelService } from 'vs/editor/common/services/resolverService';
import { localize } from 'vs/nls';
import { MenuId, MenuRegistry, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { QuickPickItem, IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import {
	IUserDataAutoSyncService, IUserDataSyncService, registerConfiguration,
	SyncResource, SyncStatus, UserDataSyncError, UserDataSyncErrorCode, USER_DATA_SYNC_SCHEME, IUserDataSyncEnablementService,
	IResourcePreview, IUserDataSyncStoreManagementService, UserDataSyncStoreType, IUserDataSyncStore, IUserDataSyncResourceConflicts, IUserDataSyncResource, IUserDataSyncResourceError
} from 'vs/platform/userDataSync/common/userDataSync';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import * as Constants from 'vs/workbench/contrib/logs/common/logConstants';
import { IOutputService } from 'vs/workbench/services/output/common/output';
import { IActivityService, IBadge, NumberBadge, ProgressBadge } from 'vs/workbench/services/activity/common/activity';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IUserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { fromNow } from 'vs/base/common/date';
import { IProductService } from 'vs/platform/product/common/productService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IAuthenticationService } from 'vs/workbench/services/authentication/common/authentication';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewContainerLocation, IViewContainersRegistry, Extensions, ViewContainer } from 'vs/workbench/common/views';
import { UserDataSyncDataViews } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncViews';
import { IUserDataSyncWorkbenchService, getSyncAreaLabel, AccountStatus, CONTEXT_SYNC_STATE, CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE, CONFIGURE_SYNC_COMMAND_ID, SHOW_SYNC_LOG_COMMAND_ID, SYNC_VIEW_CONTAINER_ID, SYNC_TITLE, SYNC_VIEW_ICON, CONTEXT_HAS_CONFLICTS } from 'vs/workbench/services/userDataSync/common/userDataSync';
import { Codicon } from 'vs/base/common/codicons';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { IUserDataInitializationService } from 'vs/workbench/services/userData/browser/userDataInit';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IUserDataProfilesService } from 'vs/platform/userDataProfile/common/userDataProfile';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ctxIsMergeResultEditor, ctxMergeBaseUri } from 'vs/workbench/contrib/mergeEditor/common/mergeEditor';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

type ConfigureSyncQuickPickItem = { id: SyncResource; label: string; description?: string };

type SyncConflictsClassification = {
	owner: 'sandy081';
	comment: 'Response information when conflict happens during settings sync';
	source: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'settings sync resource. eg., settings, keybindings...' };
	action?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'action taken while resolving conflicts. Eg: acceptLocal, acceptRemote' };
};

const turnOnSyncCommand = { id: 'workbench.userDataSync.actions.turnOn', title: localize('turn on sync with category', "{0}: Turn On...", SYNC_TITLE) };
const turnOffSyncCommand = { id: 'workbench.userDataSync.actions.turnOff', title: localize('stop sync', "{0}: Turn Off", SYNC_TITLE) };
const configureSyncCommand = { id: CONFIGURE_SYNC_COMMAND_ID, title: localize('configure sync', "{0}: Configure...", SYNC_TITLE) };
const showConflictsCommand = { id: 'workbench.userDataSync.actions.showConflicts', title: localize('showConflicts', "{0}: Show Conflicts", SYNC_TITLE) };
const syncNowCommand = {
	id: 'workbench.userDataSync.actions.syncNow',
	title: localize('sync now', "{0}: Sync Now", SYNC_TITLE),
	description(userDataSyncService: IUserDataSyncService): string | undefined {
		if (userDataSyncService.status === SyncStatus.Syncing) {
			return localize('syncing', "syncing");
		}
		if (userDataSyncService.lastSyncTime) {
			return localize('synced with time', "synced {0}", fromNow(userDataSyncService.lastSyncTime, true));
		}
		return undefined;
	}
};
const showSyncSettingsCommand = { id: 'workbench.userDataSync.actions.settings', title: localize('sync settings', "{0}: Show Settings", SYNC_TITLE), };
const showSyncedDataCommand = { id: 'workbench.userDataSync.actions.showSyncedData', title: localize('show synced data', "{0}: Show Synced Data", SYNC_TITLE), };

const CONTEXT_SYNC_AFTER_INITIALIZATION = new RawContextKey<false>('syncAfterInitialization', false);
const CONTEXT_TURNING_ON_STATE = new RawContextKey<false>('userDataSyncTurningOn', false);

export class UserDataSyncWorkbenchContribution extends Disposable implements IWorkbenchContribution {

	private readonly syncAfterInitializationContext: IContextKey<boolean>;
	private readonly turningOnSyncContext: IContextKey<boolean>;

	private readonly globalActivityBadgeDisposable = this._register(new MutableDisposable());
	private readonly accountBadgeDisposable = this._register(new MutableDisposable());

	constructor(
		@IUserDataSyncEnablementService private readonly userDataSyncEnablementService: IUserDataSyncEnablementService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IUserDataSyncWorkbenchService private readonly userDataSyncWorkbenchService: IUserDataSyncWorkbenchService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IActivityService private readonly activityService: IActivityService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService,
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IOutputService private readonly outputService: IOutputService,
		@IUserDataSyncAccountService readonly authTokenService: IUserDataSyncAccountService,
		@IUserDataAutoSyncService userDataAutoSyncService: IUserDataAutoSyncService,
		@ITextModelService textModelResolverService: ITextModelService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IProductService private readonly productService: IProductService,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IUserDataSyncStoreManagementService private readonly userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IUserDataInitializationService private readonly userDataInitializationService: IUserDataInitializationService,
		@IHostService private readonly hostService: IHostService
	) {
		super();

		this.syncAfterInitializationContext = CONTEXT_SYNC_AFTER_INITIALIZATION.bindTo(contextKeyService);
		this.turningOnSyncContext = CONTEXT_TURNING_ON_STATE.bindTo(contextKeyService);

		if (userDataSyncWorkbenchService.enabled) {
			registerConfiguration();

			this.initializeSyncAfterInitializationContext();
			this.updateAccountBadge();
			this.updateGlobalActivityBadge();
			this.onDidChangeConflicts(this.userDataSyncService.conflicts);

			this._register(Event.any(
				Event.debounce(userDataSyncService.onDidChangeStatus, () => undefined, 500),
				this.userDataSyncEnablementService.onDidChangeEnablement,
				this.userDataSyncWorkbenchService.onDidChangeAccountStatus
			)(() => {
				this.updateAccountBadge();
				this.updateGlobalActivityBadge();
			}));
			this._register(userDataSyncService.onDidChangeConflicts(() => this.onDidChangeConflicts(this.userDataSyncService.conflicts)));
			this._register(userDataSyncEnablementService.onDidChangeEnablement(() => this.onDidChangeConflicts(this.userDataSyncService.conflicts)));
			this._register(userDataSyncService.onSyncErrors(errors => this.onSynchronizerErrors(errors)));
			this._register(userDataAutoSyncService.onError(error => this.onAutoSyncError(error)));

			this.registerActions();
			this.registerViews();

			textModelResolverService.registerTextModelContentProvider(USER_DATA_SYNC_SCHEME, instantiationService.createInstance(UserDataRemoteContentProvider));

			this._register(Event.any(userDataSyncService.onDidChangeStatus, userDataSyncEnablementService.onDidChangeEnablement)
				(() => this.turningOnSync = !userDataSyncEnablementService.isEnabled() && userDataSyncService.status !== SyncStatus.Idle));
		}
	}

	private get turningOnSync(): boolean {
		return !!this.turningOnSyncContext.get();
	}

	private set turningOnSync(turningOn: boolean) {
		this.turningOnSyncContext.set(turningOn);
		this.updateGlobalActivityBadge();
	}

	private async initializeSyncAfterInitializationContext(): Promise<void> {
		const requiresInitialization = await this.userDataInitializationService.requiresInitialization();
		if (requiresInitialization && !this.userDataSyncEnablementService.isEnabled()) {
			this.updateSyncAfterInitializationContext(true);
		} else {
			this.updateSyncAfterInitializationContext(this.storageService.getBoolean(CONTEXT_SYNC_AFTER_INITIALIZATION.key, StorageScope.APPLICATION, false));
		}
		const disposable = this._register(this.userDataSyncEnablementService.onDidChangeEnablement(() => {
			if (this.userDataSyncEnablementService.isEnabled()) {
				this.updateSyncAfterInitializationContext(false);
				disposable.dispose();
			}
		}));
	}

	private async updateSyncAfterInitializationContext(value: boolean): Promise<void> {
		this.storageService.store(CONTEXT_SYNC_AFTER_INITIALIZATION.key, value, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.syncAfterInitializationContext.set(value);
		this.updateGlobalActivityBadge();
	}

	private toKey({ syncResource: resource, profile }: IUserDataSyncResource): string {
		return `${profile.id}:${resource}`;
	}

	private readonly conflictsDisposables = new Map<string, IDisposable>();
	private onDidChangeConflicts(conflicts: IUserDataSyncResourceConflicts[]) {
		if (!this.userDataSyncEnablementService.isEnabled()) {
			return;
		}
		this.updateGlobalActivityBadge();
		if (conflicts.length) {
			// Clear and dispose conflicts those were cleared
			for (const [key, disposable] of this.conflictsDisposables.entries()) {
				if (!conflicts.some(conflict => this.toKey(conflict) === key)) {
					disposable.dispose();
					this.conflictsDisposables.delete(key);
				}
			}

			for (const conflict of this.userDataSyncService.conflicts) {
				const key = this.toKey(conflict);
				// Show conflicts notification if not shown before
				if (!this.conflictsDisposables.has(key)) {
					const conflictsArea = getSyncAreaLabel(conflict.syncResource);
					const handle = this.notificationService.prompt(Severity.Warning, localize('conflicts detected', "Unable to sync due to conflicts in {0}. Please resolve them to continue.", conflictsArea.toLowerCase()),
						[
							{
								label: localize('replace remote', "Replace Remote"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string; action: string }, SyncConflictsClassification>('sync/handleConflicts', { source: conflict.syncResource, action: 'acceptLocal' });
									this.acceptLocal(conflict, conflict.conflicts[0]);
								}
							},
							{
								label: localize('replace local', "Replace Local"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string; action: string }, SyncConflictsClassification>('sync/handleConflicts', { source: conflict.syncResource, action: 'acceptRemote' });
									this.acceptRemote(conflict, conflict.conflicts[0]);
								}
							},
							{
								label: localize('show conflicts', "Show Conflicts"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string; action?: string }, SyncConflictsClassification>('sync/showConflicts', { source: conflict.syncResource });
									this.userDataSyncWorkbenchService.showConflicts(conflict.conflicts[0]);
								}
							}
						],
						{
							sticky: true
						}
					);
					this.conflictsDisposables.set(key, toDisposable(() => {
						// close the conflicts warning notification
						handle.close();
						this.conflictsDisposables.delete(key);
					}));
				}
			}
		} else {
			this.conflictsDisposables.forEach(disposable => disposable.dispose());
			this.conflictsDisposables.clear();
		}
	}

	private async acceptRemote(syncResource: IUserDataSyncResource, conflict: IResourcePreview) {
		try {
			await this.userDataSyncService.accept(syncResource, conflict.remoteResource, undefined, this.userDataSyncEnablementService.isEnabled());
		} catch (e) {
			this.notificationService.error(localize('accept failed', "Error while accepting changes. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
		}
	}

	private async acceptLocal(syncResource: IUserDataSyncResource, conflict: IResourcePreview): Promise<void> {
		try {
			await this.userDataSyncService.accept(syncResource, conflict.localResource, undefined, this.userDataSyncEnablementService.isEnabled());
		} catch (e) {
			this.notificationService.error(localize('accept failed', "Error while accepting changes. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
		}
	}

	private onAutoSyncError(error: UserDataSyncError): void {
		switch (error.code) {
			case UserDataSyncErrorCode.SessionExpired:
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('session expired', "Settings sync was turned off because current session is expired, please sign in again to turn on sync."),
					actions: {
						primary: [new Action('turn on sync', localize('turn on sync', "Turn on Settings Sync..."), undefined, true, () => this.turnOn())]
					}
				});
				break;
			case UserDataSyncErrorCode.TurnedOff:
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('turned off', "Settings sync was turned off from another device, please turn on sync again."),
					actions: {
						primary: [new Action('turn on sync', localize('turn on sync', "Turn on Settings Sync..."), undefined, true, () => this.turnOn())]
					}
				});
				break;
			case UserDataSyncErrorCode.TooLarge:
				if (error.resource === SyncResource.Keybindings || error.resource === SyncResource.Settings || error.resource === SyncResource.Tasks) {
					this.disableSync(error.resource);
					const sourceArea = getSyncAreaLabel(error.resource);
					this.handleTooLargeError(error.resource, localize('too large', "Disabled syncing {0} because size of the {1} file to sync is larger than {2}. Please open the file and reduce the size and enable sync", sourceArea.toLowerCase(), sourceArea.toLowerCase(), '100kb'), error);
				}
				break;
			case UserDataSyncErrorCode.IncompatibleLocalContent:
			case UserDataSyncErrorCode.Gone:
			case UserDataSyncErrorCode.UpgradeRequired: {
				const message = localize('error upgrade required', "Settings sync is disabled because the current version ({0}, {1}) is not compatible with the sync service. Please update before turning on sync.", this.productService.version, this.productService.commit);
				const operationId = error.operationId ? localize('operationId', "Operation Id: {0}", error.operationId) : undefined;
				this.notificationService.notify({
					severity: Severity.Error,
					message: operationId ? `${message} ${operationId}` : message,
				});
				break;
			}
			case UserDataSyncErrorCode.IncompatibleRemoteContent:
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('error reset required', "Settings sync is disabled because your data in the cloud is older than that of the client. Please clear your data in the cloud before turning on sync."),
					actions: {
						primary: [
							new Action('reset', localize('reset', "Clear Data in Cloud..."), undefined, true, () => this.userDataSyncWorkbenchService.resetSyncedData()),
							new Action('show synced data', localize('show synced data action', "Show Synced Data"), undefined, true, () => this.userDataSyncWorkbenchService.showSyncActivity())
						]
					}
				});
				return;

			case UserDataSyncErrorCode.ServiceChanged:
				this.notificationService.notify({
					severity: Severity.Info,
					message: this.userDataSyncStoreManagementService.userDataSyncStore?.type === 'insiders' ?
						localize('service switched to insiders', "Settings Sync has been switched to insiders service") :
						localize('service switched to stable', "Settings Sync has been switched to stable service"),
				});

				return;

			case UserDataSyncErrorCode.DefaultServiceChanged:
				// Settings sync is using separate service
				if (this.userDataSyncEnablementService.isEnabled()) {
					this.notificationService.notify({
						severity: Severity.Info,
						message: localize('using separate service', "Settings sync now uses a separate service, more information is available in the [Settings Sync Documentation](https://aka.ms/vscode-settings-sync-help#_syncing-stable-versus-insiders)."),
					});
				}

				// If settings sync got turned off then ask user to turn on sync again.
				else {
					this.notificationService.notify({
						severity: Severity.Info,
						message: localize('service changed and turned off', "Settings sync was turned off because {0} now uses a separate service. Please turn on sync again.", this.productService.nameLong),
						actions: {
							primary: [new Action('turn on sync', localize('turn on sync', "Turn on Settings Sync..."), undefined, true, () => this.turnOn())]
						}
					});
				}
				return;
		}
	}

	private handleTooLargeError(resource: SyncResource, message: string, error: UserDataSyncError): void {
		const operationId = error.operationId ? localize('operationId', "Operation Id: {0}", error.operationId) : undefined;
		this.notificationService.notify({
			severity: Severity.Error,
			message: operationId ? `${message} ${operationId}` : message,
			actions: {
				primary: [new Action('open sync file', localize('open file', "Open {0} File", getSyncAreaLabel(resource)), undefined, true,
					() => resource === SyncResource.Settings ? this.preferencesService.openUserSettings({ jsonEditor: true }) : this.preferencesService.openGlobalKeybindingSettings(true))]
			}
		});
	}

	private readonly invalidContentErrorDisposables = new Map<string, IDisposable>();
	private onSynchronizerErrors(errors: IUserDataSyncResourceError[]): void {
		if (errors.length) {
			for (const { profile, syncResource: resource, error } of errors) {
				switch (error.code) {
					case UserDataSyncErrorCode.LocalInvalidContent:
						this.handleInvalidContentError({ profile, syncResource: resource });
						break;
					default: {
						const key = `${profile.id}:${resource}`;
						const disposable = this.invalidContentErrorDisposables.get(key);
						if (disposable) {
							disposable.dispose();
							this.invalidContentErrorDisposables.delete(key);
						}
					}
				}
			}
		} else {
			this.invalidContentErrorDisposables.forEach(disposable => disposable.dispose());
			this.invalidContentErrorDisposables.clear();
		}
	}

	private handleInvalidContentError({ profile, syncResource: source }: IUserDataSyncResource): void {
		const key = `${profile.id}:${source}`;
		if (this.invalidContentErrorDisposables.has(key)) {
			return;
		}
		if (source !== SyncResource.Settings && source !== SyncResource.Keybindings && source !== SyncResource.Tasks) {
			return;
		}
		if (!this.hostService.hasFocus) {
			return;
		}
		const resource = source === SyncResource.Settings ? this.userDataProfilesService.defaultProfile.settingsResource : this.userDataProfilesService.defaultProfile.keybindingsResource;
		if (isEqual(resource, EditorResourceAccessor.getCanonicalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY }))) {
			// Do not show notification if the file in error is active
			return;
		}
		const errorArea = getSyncAreaLabel(source);
		const handle = this.notificationService.notify({
			severity: Severity.Error,
			message: localize('errorInvalidConfiguration', "Unable to sync {0} because the content in the file is not valid. Please open the file and correct it.", errorArea.toLowerCase()),
			actions: {
				primary: [new Action('open sync file', localize('open file', "Open {0} File", errorArea), undefined, true,
					() => source === SyncResource.Settings ? this.preferencesService.openUserSettings({ jsonEditor: true }) : this.preferencesService.openGlobalKeybindingSettings(true))]
			}
		});
		this.invalidContentErrorDisposables.set(key, toDisposable(() => {
			// close the error warning notification
			handle.close();
			this.invalidContentErrorDisposables.delete(key);
		}));
	}

	private getConflictsCount(): number {
		return this.userDataSyncService.conflicts.reduce((result, { conflicts }) => { return result + conflicts.length; }, 0);
	}

	private async updateGlobalActivityBadge(): Promise<void> {
		this.globalActivityBadgeDisposable.clear();

		let badge: IBadge | undefined = undefined;
		let clazz: string | undefined;
		let priority: number | undefined = undefined;

		if (this.userDataSyncService.conflicts.length && this.userDataSyncEnablementService.isEnabled()) {
			badge = new NumberBadge(this.getConflictsCount(), () => localize('has conflicts', "{0}: Conflicts Detected", SYNC_TITLE));
		} else if (this.turningOnSync) {
			badge = new ProgressBadge(() => localize('turning on syncing', "Turning on Settings Sync..."));
			clazz = 'progress-badge';
			priority = 1;
		} else if (this.userDataSyncWorkbenchService.accountStatus === AccountStatus.Available && this.syncAfterInitializationContext.get() && !this.userDataSyncEnablementService.isEnabled()) {
			badge = new NumberBadge(1, () => localize('settings sync is off', "Settings Sync is Off", SYNC_TITLE));
		}

		if (badge) {
			this.globalActivityBadgeDisposable.value = this.activityService.showGlobalActivity({ badge, clazz, priority });
		}
	}

	private async updateAccountBadge(): Promise<void> {
		this.accountBadgeDisposable.clear();

		let badge: IBadge | undefined = undefined;

		if (this.userDataSyncService.status !== SyncStatus.Uninitialized && this.userDataSyncEnablementService.isEnabled() && this.userDataSyncWorkbenchService.accountStatus === AccountStatus.Unavailable) {
			badge = new NumberBadge(1, () => localize('sign in to sync', "Sign in to Sync Settings"));
		}

		if (badge) {
			this.accountBadgeDisposable.value = this.activityService.showAccountsActivity({ badge, clazz: undefined, priority: undefined });
		}
	}

	private async turnOnSyncAfterInitialization(): Promise<void> {
		this.updateSyncAfterInitializationContext(false);
		const result = await this.dialogService.show(
			Severity.Info,
			localize('settings sync is off', "Settings Sync is Off"),
			[
				localize('turn on settings sync', "Turn On Settings Sync"),
				localize('cancel', "Cancel"),
			],
			{
				cancelId: 1,
				custom: {
					markdownDetails: [{
						markdown: new MarkdownString(`${localize('turnon sync after initialization message', "Your settings, keybindings, extensions, snippets and UI State were initialized but are not getting synced. Do you want to turn on Settings Sync?")}`, { isTrusted: true })
					}, {
						markdown: new MarkdownString(`${localize({ key: 'change later', comment: ['Context here is that user can change (turn on/off) settings sync later.'] }, "You can always change this later.")} [${localize('learn more', "Learn More")}](https://aka.ms/vscode-settings-sync-help).`, { isTrusted: true })
					}]
				}
			}
		);
		if (result.choice === 0) {
			await this.userDataSyncWorkbenchService.turnOnUsingCurrentAccount();
		}
	}

	private async turnOn(): Promise<void> {
		try {
			if (!this.userDataSyncWorkbenchService.authenticationProviders.length) {
				throw new Error(localize('no authentication providers', "No authentication providers are available."));
			}
			const turnOn = await this.askToConfigure();
			if (!turnOn) {
				return;
			}
			if (this.userDataSyncStoreManagementService.userDataSyncStore?.canSwitch) {
				await this.selectSettingsSyncService(this.userDataSyncStoreManagementService.userDataSyncStore);
			}
			await this.userDataSyncWorkbenchService.turnOn();
		} catch (e) {
			if (isCancellationError(e)) {
				return;
			}
			if (e instanceof UserDataSyncError) {
				switch (e.code) {
					case UserDataSyncErrorCode.TooLarge:
						if (e.resource === SyncResource.Keybindings || e.resource === SyncResource.Settings || e.resource === SyncResource.Tasks) {
							this.handleTooLargeError(e.resource, localize('too large while starting sync', "Settings sync cannot be turned on because size of the {0} file to sync is larger than {1}. Please open the file and reduce the size and turn on sync", getSyncAreaLabel(e.resource).toLowerCase(), '100kb'), e);
							return;
						}
						break;
					case UserDataSyncErrorCode.IncompatibleLocalContent:
					case UserDataSyncErrorCode.Gone:
					case UserDataSyncErrorCode.UpgradeRequired: {
						const message = localize('error upgrade required while starting sync', "Settings sync cannot be turned on because the current version ({0}, {1}) is not compatible with the sync service. Please update before turning on sync.", this.productService.version, this.productService.commit);
						const operationId = e.operationId ? localize('operationId', "Operation Id: {0}", e.operationId) : undefined;
						this.notificationService.notify({
							severity: Severity.Error,
							message: operationId ? `${message} ${operationId}` : message,
						});
						return;
					}
					case UserDataSyncErrorCode.IncompatibleRemoteContent:
						this.notificationService.notify({
							severity: Severity.Error,
							message: localize('error reset required while starting sync', "Settings sync cannot be turned on because your data in the cloud is older than that of the client. Please clear your data in the cloud before turning on sync."),
							actions: {
								primary: [
									new Action('reset', localize('reset', "Clear Data in Cloud..."), undefined, true, () => this.userDataSyncWorkbenchService.resetSyncedData()),
									new Action('show synced data', localize('show synced data action', "Show Synced Data"), undefined, true, () => this.userDataSyncWorkbenchService.showSyncActivity())
								]
							}
						});
						return;
					case UserDataSyncErrorCode.Unauthorized:
						this.notificationService.error(localize('auth failed', "Error while turning on Settings Sync: Authentication failed."));
						return;
				}
				this.notificationService.error(localize('turn on failed with user data sync error', "Error while turning on Settings Sync. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
			} else {
				this.notificationService.error(localize({ key: 'turn on failed', comment: ['Substitution is for error reason'] }, "Error while turning on Settings Sync. {0}", getErrorMessage(e)));
			}
		}
	}

	private async askToConfigure(): Promise<boolean> {
		return new Promise<boolean>((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = this.quickInputService.createQuickPick<ConfigureSyncQuickPickItem>();
			disposables.add(quickPick);
			quickPick.title = SYNC_TITLE;
			quickPick.ok = false;
			quickPick.customButton = true;
			quickPick.customLabel = localize('sign in and turn on', "Sign in & Turn on");
			quickPick.description = localize('configure and turn on sync detail', "Please sign in to synchronize your data across devices.");
			quickPick.canSelectMany = true;
			quickPick.ignoreFocusOut = true;
			quickPick.hideInput = true;
			quickPick.hideCheckAll = true;

			const items = this.getConfigureSyncQuickPickItems();
			quickPick.items = items;
			quickPick.selectedItems = items.filter(item => this.userDataSyncEnablementService.isResourceEnabled(item.id));
			let accepted: boolean = false;
			disposables.add(Event.any(quickPick.onDidAccept, quickPick.onDidCustom)(() => {
				accepted = true;
				quickPick.hide();
			}));
			disposables.add(quickPick.onDidHide(() => {
				try {
					if (accepted) {
						this.updateConfiguration(items, quickPick.selectedItems);
					}
					c(accepted);
				} catch (error) {
					e(error);
				} finally {
					disposables.dispose();
				}
			}));
			quickPick.show();
		});
	}

	private getConfigureSyncQuickPickItems(): ConfigureSyncQuickPickItem[] {
		const result = [{
			id: SyncResource.Settings,
			label: getSyncAreaLabel(SyncResource.Settings)
		}, {
			id: SyncResource.Keybindings,
			label: getSyncAreaLabel(SyncResource.Keybindings),
			description: this.configurationService.getValue('settingsSync.keybindingsPerPlatform') ? localize('per platform', "for each platform") : undefined
		}, {
			id: SyncResource.Snippets,
			label: getSyncAreaLabel(SyncResource.Snippets)
		}, {
			id: SyncResource.Tasks,
			label: getSyncAreaLabel(SyncResource.Tasks)
		}, {
			id: SyncResource.Extensions,
			label: getSyncAreaLabel(SyncResource.Extensions)
		}, {
			id: SyncResource.GlobalState,
			label: getSyncAreaLabel(SyncResource.GlobalState),
		}];
		if (!this.environmentService.isBuilt || this.productService.enableSyncingProfiles) {
			result.push({
				id: SyncResource.Profiles,
				label: getSyncAreaLabel(SyncResource.Profiles),
			});
		}
		return result;
	}

	private updateConfiguration(items: ConfigureSyncQuickPickItem[], selectedItems: ReadonlyArray<ConfigureSyncQuickPickItem>): void {
		for (const item of items) {
			const wasEnabled = this.userDataSyncEnablementService.isResourceEnabled(item.id);
			const isEnabled = !!selectedItems.filter(selected => selected.id === item.id)[0];
			if (wasEnabled !== isEnabled) {
				this.userDataSyncEnablementService.setResourceEnablement(item.id!, isEnabled);
			}
		}
	}

	private async configureSyncOptions(): Promise<void> {
		return new Promise((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = this.quickInputService.createQuickPick<ConfigureSyncQuickPickItem>();
			disposables.add(quickPick);
			quickPick.title = localize('configure sync', "{0}: Configure...", SYNC_TITLE);
			quickPick.placeholder = localize('configure sync placeholder', "Choose what to sync");
			quickPick.canSelectMany = true;
			quickPick.ignoreFocusOut = true;
			quickPick.ok = true;
			const items = this.getConfigureSyncQuickPickItems();
			quickPick.items = items;
			quickPick.selectedItems = items.filter(item => this.userDataSyncEnablementService.isResourceEnabled(item.id));
			disposables.add(quickPick.onDidAccept(async () => {
				if (quickPick.selectedItems.length) {
					this.updateConfiguration(items, quickPick.selectedItems);
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
			message: localize('turn off sync confirmation', "Do you want to turn off sync?"),
			detail: localize('turn off sync detail', "Your settings, keybindings, extensions, snippets and UI State will no longer be synced."),
			primaryButton: localize({ key: 'turn off', comment: ['&& denotes a mnemonic'] }, "&&Turn off"),
			checkbox: this.userDataSyncWorkbenchService.accountStatus === AccountStatus.Available ? {
				label: localize('turn off sync everywhere', "Turn off sync on all your devices and clear the data from the cloud.")
			} : undefined
		});
		if (result.confirmed) {
			return this.userDataSyncWorkbenchService.turnoff(!!result.checkboxChecked);
		}
	}

	private disableSync(source: SyncResource): void {
		switch (source) {
			case SyncResource.Settings: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Settings, false);
			case SyncResource.Keybindings: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Keybindings, false);
			case SyncResource.Snippets: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Snippets, false);
			case SyncResource.Tasks: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Tasks, false);
			case SyncResource.Extensions: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Extensions, false);
			case SyncResource.GlobalState: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.GlobalState, false);
		}
	}

	private showSyncActivity(): Promise<void> {
		return this.outputService.showChannel(Constants.userDataSyncLogChannelId);
	}

	private async selectSettingsSyncService(userDataSyncStore: IUserDataSyncStore): Promise<void> {
		return new Promise<void>((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = disposables.add(this.quickInputService.createQuickPick<{ id: UserDataSyncStoreType; label: string; description?: string }>());
			quickPick.title = localize('switchSyncService.title', "{0}: Select Service", SYNC_TITLE);
			quickPick.description = localize('switchSyncService.description', "Ensure you are using the same settings sync service when syncing with multiple environments");
			quickPick.hideInput = true;
			quickPick.ignoreFocusOut = true;
			const getDescription = (url: URI): string | undefined => {
				const isDefault = isEqual(url, userDataSyncStore.defaultUrl);
				if (isDefault) {
					return localize('default', "Default");
				}
				return undefined;
			};
			quickPick.items = [
				{
					id: 'insiders',
					label: localize('insiders', "Insiders"),
					description: getDescription(userDataSyncStore.insidersUrl)
				},
				{
					id: 'stable',
					label: localize('stable', "Stable"),
					description: getDescription(userDataSyncStore.stableUrl)
				}
			];
			disposables.add(quickPick.onDidAccept(async () => {
				try {
					await this.userDataSyncStoreManagementService.switch(quickPick.selectedItems[0].id);
					c();
				} catch (error) {
					e(error);
				} finally {
					quickPick.hide();
				}
			}));
			disposables.add(quickPick.onDidHide(() => disposables.dispose()));
			quickPick.show();
		});
	}

	private registerActions(): void {
		if (this.userDataSyncEnablementService.canToggleEnablement()) {
			this.registerTurnOnSyncAction();
			this.registerTurnOffSyncAction();
			this.registerTurnOnSyncAfterInitializationAction();
		}
		this.registerTurningOnSyncAction();
		this.registerCancelTurnOnSyncAction();
		this.registerSignInAction(); // When Sync is turned on from CLI
		this.registerShowConflictsAction();

		this.registerEnableSyncViewsAction();
		this.registerManageSyncAction();
		this.registerSyncNowAction();
		this.registerConfigureSyncAction();
		this.registerShowSettingsAction();
		this.registerHelpAction();
		this.registerShowLogAction();
		this.registerResetSyncDataAction();
		this.registerAcceptMergesAction();
	}

	private registerTurnOnSyncAction(): void {
		const turnOnSyncWhenContext = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT.toNegated(), CONTEXT_ACCOUNT_STATE.notEqualsTo(AccountStatus.Uninitialized), CONTEXT_TURNING_ON_STATE.negate());
		CommandsRegistry.registerCommand(turnOnSyncCommand.id, () => this.turnOn());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_settings',
			command: {
				id: turnOnSyncCommand.id,
				title: localize('global activity turn on sync', "Turn on Settings Sync...")
			},
			when: ContextKeyExpr.and(turnOnSyncWhenContext, CONTEXT_SYNC_AFTER_INITIALIZATION.negate()),
			order: 3
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: turnOnSyncCommand,
			when: turnOnSyncWhenContext,
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_settings',
			command: {
				id: turnOnSyncCommand.id,
				title: localize('global activity turn on sync', "Turn on Settings Sync...")
			},
			when: turnOnSyncWhenContext,
			order: 3
		});
		MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '1_settings',
			command: {
				id: turnOnSyncCommand.id,
				title: localize('global activity turn on sync', "Turn on Settings Sync...")
			},
			when: turnOnSyncWhenContext,
			order: 2
		});
	}

	private registerTurnOnSyncAfterInitializationAction(): void {
		const that = this;
		const id = 'workbench.userData.actions.askToTunrOnAfterInit';
		const when = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT.toNegated(), CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_TURNING_ON_STATE.negate(), CONTEXT_SYNC_AFTER_INITIALIZATION);
		this._register(registerAction2(class AskToTurnOnSync extends Action2 {
			constructor() {
				super({
					id,
					title: localize('ask to turn on in global', "Settings Sync is Off (1)"),
					menu: {
						group: '5_settings',
						id: MenuId.GlobalActivity,
						when,
						order: 3
					}
				});
			}
			async run(): Promise<any> {
				try {
					await that.turnOnSyncAfterInitialization();
				} catch (e) {
					that.notificationService.error(e);
				}
			}
		}));
	}

	private registerTurningOnSyncAction(): void {
		const when = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT.toNegated(), CONTEXT_ACCOUNT_STATE.notEqualsTo(AccountStatus.Uninitialized), CONTEXT_TURNING_ON_STATE);
		this._register(registerAction2(class TurningOnSyncAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userData.actions.turningOn',
					title: localize('turnin on sync', "Turning on Settings Sync..."),
					precondition: ContextKeyExpr.false(),
					menu: [{
						group: '5_settings',
						id: MenuId.GlobalActivity,
						when,
						order: 3
					}, {
						group: '1_settings',
						id: MenuId.AccountsContext,
						when,
					}]
				});
			}
			async run(): Promise<any> { }
		}));
	}

	private registerCancelTurnOnSyncAction(): void {
		const that = this;
		this._register(registerAction2(class TurningOnSyncAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userData.actions.cancelTurnOn',
					title: localize('cancel turning on sync', "Cancel"),
					icon: Codicon.stopCircle,
					menu: {
						id: MenuId.ViewContainerTitle,
						when: ContextKeyExpr.and(CONTEXT_TURNING_ON_STATE, ContextKeyExpr.equals('viewContainer', SYNC_VIEW_CONTAINER_ID)),
						group: 'navigation',
						order: 1
					}
				});
			}
			async run(): Promise<any> {
				return that.userDataSyncWorkbenchService.turnoff(false);
			}
		}));
	}

	private registerSignInAction(): void {
		const that = this;
		const id = 'workbench.userData.actions.signin';
		const when = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Unavailable));
		this._register(registerAction2(class StopSyncAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userData.actions.signin',
					title: localize('sign in global', "Sign in to Sync Settings"),
					menu: {
						group: '5_settings',
						id: MenuId.GlobalActivity,
						when,
						order: 3
					}
				});
			}
			async run(): Promise<any> {
				try {
					await that.userDataSyncWorkbenchService.signIn();
				} catch (e) {
					that.notificationService.error(e);
				}
			}
		}));
		this._register(MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '1_settings',
			command: {
				id,
				title: localize('sign in accounts', "Sign in to Sync Settings (1)"),
			},
			when
		}));
	}

	private registerShowConflictsAction(): void {
		CommandsRegistry.registerCommand(showConflictsCommand.id, () => this.userDataSyncWorkbenchService.showConflicts());
		const getTitle = () => localize('resolveConflicts_global', "{0}: Show Conflicts ({1})", SYNC_TITLE, this.getConflictsCount());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_settings',
			command: {
				id: showConflictsCommand.id,
				get title() { return getTitle(); }
			},
			when: CONTEXT_HAS_CONFLICTS,
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_settings',
			command: {
				id: showConflictsCommand.id,
				get title() { return getTitle(); }
			},
			when: CONTEXT_HAS_CONFLICTS,
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: showConflictsCommand,
			when: CONTEXT_HAS_CONFLICTS,
		});
	}

	private registerManageSyncAction(): void {
		const that = this;
		const when = ContextKeyExpr.and(CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized));
		this._register(registerAction2(class SyncStatusAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userDataSync.actions.manage',
					title: localize('sync is on', "Settings Sync is On"),
					menu: [
						{
							id: MenuId.GlobalActivity,
							group: '5_settings',
							when,
							order: 3
						},
						{
							id: MenuId.MenubarPreferencesMenu,
							group: '5_settings',
							when,
							order: 3,
						},
						{
							id: MenuId.AccountsContext,
							group: '1_settings',
							when,
						}
					],
				});
			}
			run(accessor: ServicesAccessor): any {
				return new Promise<void>((c, e) => {
					const quickInputService = accessor.get(IQuickInputService);
					const commandService = accessor.get(ICommandService);
					const disposables = new DisposableStore();
					const quickPick = quickInputService.createQuickPick();
					disposables.add(quickPick);
					const items: Array<QuickPickItem> = [];
					if (that.userDataSyncService.conflicts.length) {
						items.push({ id: showConflictsCommand.id, label: showConflictsCommand.title });
						items.push({ type: 'separator' });
					}
					items.push({ id: configureSyncCommand.id, label: configureSyncCommand.title });
					items.push({ id: showSyncSettingsCommand.id, label: showSyncSettingsCommand.title });
					items.push({ id: showSyncedDataCommand.id, label: showSyncedDataCommand.title });
					items.push({ type: 'separator' });
					items.push({ id: syncNowCommand.id, label: syncNowCommand.title, description: syncNowCommand.description(that.userDataSyncService) });
					if (that.userDataSyncEnablementService.canToggleEnablement()) {
						const account = that.userDataSyncWorkbenchService.current;
						items.push({ id: turnOffSyncCommand.id, label: turnOffSyncCommand.title, description: account ? `${account.accountName} (${that.authenticationService.getLabel(account.authenticationProviderId)})` : undefined });
					}
					quickPick.items = items;
					disposables.add(quickPick.onDidAccept(() => {
						if (quickPick.selectedItems[0] && quickPick.selectedItems[0].id) {
							commandService.executeCommand(quickPick.selectedItems[0].id);
						}
						quickPick.hide();
					}));
					disposables.add(quickPick.onDidHide(() => {
						disposables.dispose();
						c();
					}));
					quickPick.show();
				});
			}
		}));
	}

	private registerEnableSyncViewsAction(): void {
		const that = this;
		const when = ContextKeyExpr.and(CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized));
		this._register(registerAction2(class SyncStatusAction extends Action2 {
			constructor() {
				super({
					id: showSyncedDataCommand.id,
					title: { value: localize('workbench.action.showSyncRemoteBackup', "Show Synced Data"), original: `Show Synced Data` },
					category: { value: SYNC_TITLE, original: `Settings Sync` },
					precondition: when,
					menu: {
						id: MenuId.CommandPalette,
						when
					}
				});
			}
			run(accessor: ServicesAccessor): Promise<void> {
				return that.userDataSyncWorkbenchService.showSyncActivity();
			}
		}));
	}

	private registerSyncNowAction(): void {
		const that = this;
		this._register(registerAction2(class SyncNowAction extends Action2 {
			constructor() {
				super({
					id: syncNowCommand.id,
					title: syncNowCommand.title,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized))
					}
				});
			}
			run(accessor: ServicesAccessor): Promise<any> {
				return that.userDataSyncWorkbenchService.syncNow();
			}
		}));
	}

	private registerTurnOffSyncAction(): void {
		const that = this;
		this._register(registerAction2(class StopSyncAction extends Action2 {
			constructor() {
				super({
					id: turnOffSyncCommand.id,
					title: turnOffSyncCommand.title,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT),
					},
				});
			}
			async run(): Promise<any> {
				try {
					await that.turnOff();
				} catch (e) {
					if (!isCancellationError(e)) {
						that.notificationService.error(localize('turn off failed', "Error while turning off Settings Sync. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
					}
				}
			}
		}));
	}

	private registerConfigureSyncAction(): void {
		const that = this;
		const when = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT);
		this._register(registerAction2(class ConfigureSyncAction extends Action2 {
			constructor() {
				super({
					id: configureSyncCommand.id,
					title: configureSyncCommand.title,
					icon: Codicon.settingsGear,
					tooltip: localize('configure', "Configure..."),
					menu: [{
						id: MenuId.CommandPalette,
						when
					}, {
						id: MenuId.ViewContainerTitle,
						when: ContextKeyExpr.and(CONTEXT_SYNC_ENABLEMENT, ContextKeyExpr.equals('viewContainer', SYNC_VIEW_CONTAINER_ID)),
						group: 'navigation',
						order: 2
					}]
				});
			}
			run(): any { return that.configureSyncOptions(); }
		}));
	}

	private registerShowLogAction(): void {
		const that = this;
		this._register(registerAction2(class ShowSyncActivityAction extends Action2 {
			constructor() {
				super({
					id: SHOW_SYNC_LOG_COMMAND_ID,
					title: localize('show sync log title', "{0}: Show Log", SYNC_TITLE),
					tooltip: localize('show sync log toolrip', "Show Log"),
					icon: Codicon.output,
					menu: [{
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized)),
					}, {
						id: MenuId.ViewContainerTitle,
						when: ContextKeyExpr.equals('viewContainer', SYNC_VIEW_CONTAINER_ID),
						group: 'navigation',
						order: 1
					}],
				});
			}
			run(): any { return that.showSyncActivity(); }
		}));
	}

	private registerShowSettingsAction(): void {
		this._register(registerAction2(class ShowSyncSettingsAction extends Action2 {
			constructor() {
				super({
					id: showSyncSettingsCommand.id,
					title: showSyncSettingsCommand.title,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized)),
					},
				});
			}
			run(accessor: ServicesAccessor): any {
				accessor.get(IPreferencesService).openUserSettings({ jsonEditor: false, query: '@tag:sync' });
			}
		}));
	}

	private registerHelpAction(): void {
		const that = this;
		this._register(registerAction2(class HelpAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userDataSync.actions.help',
					title: { value: SYNC_TITLE, original: 'Settings Sync' },
					category: Categories.Help,
					menu: [{
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized)),
					}],
				});
			}
			run(): any { return that.openerService.open(URI.parse('https://aka.ms/vscode-settings-sync-help')); }
		}));
		MenuRegistry.appendMenuItem(MenuId.ViewContainerTitle, {
			command: {
				id: 'workbench.userDataSync.actions.help',
				title: Categories.Help.value
			},
			when: ContextKeyExpr.equals('viewContainer', SYNC_VIEW_CONTAINER_ID),
			group: '1_help',
		});
	}

	private registerAcceptMergesAction(): void {
		const that = this;
		this._register(registerAction2(class AcceptMergesAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userDataSync.actions.acceptMerges',
					title: localize('complete merges title', "Complete Merge"),
					menu: [{
						id: MenuId.EditorContent,
						when: ContextKeyExpr.and(ctxIsMergeResultEditor, ContextKeyExpr.regex(ctxMergeBaseUri.key, new RegExp(`^${USER_DATA_SYNC_SCHEME}:`))),
					}],
				});
			}

			async run(accessor: ServicesAccessor, previewResource: URI): Promise<void> {
				const textFileService = accessor.get(ITextFileService);
				await textFileService.save(previewResource);
				const content = await textFileService.read(previewResource);
				await that.userDataSyncService.accept(this.getSyncResource(previewResource), previewResource, content.value, true);
			}

			private getSyncResource(previewResource: URI): IUserDataSyncResource {
				const conflict = that.userDataSyncService.conflicts.find(({ conflicts }) => conflicts.some(conflict => isEqual(conflict.previewResource, previewResource)));
				if (conflict) {
					return conflict;
				}
				throw new Error(`Unknown resource: ${previewResource.toString()}`);
			}
		}));
	}

	private registerViews(): void {
		const container = this.registerViewContainer();
		this.registerDataViews(container);
	}

	private registerViewContainer(): ViewContainer {
		return Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer(
			{
				id: SYNC_VIEW_CONTAINER_ID,
				title: SYNC_TITLE,
				ctorDescriptor: new SyncDescriptor(
					ViewPaneContainer,
					[SYNC_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]
				),
				icon: SYNC_VIEW_ICON,
				hideIfEmpty: true,
			}, ViewContainerLocation.Sidebar);
	}

	private registerResetSyncDataAction(): void {
		const that = this;
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.actions.syncData.reset',
					title: localize('workbench.actions.syncData.reset', "Clear Data in Cloud..."),
					menu: [{
						id: MenuId.ViewContainerTitle,
						when: ContextKeyExpr.equals('viewContainer', SYNC_VIEW_CONTAINER_ID),
						group: '0_configure',
					}],
				});
			}
			run(): any { return that.userDataSyncWorkbenchService.resetSyncedData(); }
		}));
	}

	private registerDataViews(container: ViewContainer): void {
		this._register(this.instantiationService.createInstance(UserDataSyncDataViews, container));
	}

}

class UserDataRemoteContentProvider implements ITextModelContentProvider {

	constructor(
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
	) {
	}

	provideTextContent(uri: URI): Promise<ITextModel> | null {
		if (uri.scheme === USER_DATA_SYNC_SCHEME) {
			return this.userDataSyncService.resolveContent(uri).then(content => this.modelService.createModel(content || '', this.languageService.createById('jsonc'), uri));
		}
		return null;
	}
}
