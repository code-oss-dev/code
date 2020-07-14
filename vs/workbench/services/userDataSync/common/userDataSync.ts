/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IAuthenticationProvider, SyncStatus, SyncResource, Change } from 'vs/platform/userDataSync/common/userDataSync';
import { Event } from 'vs/base/common/event';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';

export interface IUserDataSyncAccount {
	readonly authenticationProviderId: string;
	readonly accountName: string;
	readonly accountId: string;
}

export interface IUserDataSyncPreview {
	readonly onDidChangeChanges: Event<ReadonlyArray<IUserDataSyncResourceGroup>>;
	readonly changes: ReadonlyArray<IUserDataSyncResourceGroup>;

	onDidChangeConflicts: Event<ReadonlyArray<IUserDataSyncResourceGroup>>;
	readonly conflicts: ReadonlyArray<IUserDataSyncResourceGroup>;

	accept(syncResource: SyncResource, resource: URI, content: string): Promise<void>;
	merge(resource?: URI): Promise<void>;
	pull(): Promise<void>;
	push(): Promise<void>;
}

export interface IUserDataSyncResourceGroup {
	readonly syncResource: SyncResource;
	readonly local: URI;
	readonly remote: URI;
	readonly preview: URI;
	readonly localChange: Change;
	readonly remoteChange: Change;
}

export const IUserDataSyncWorkbenchService = createDecorator<IUserDataSyncWorkbenchService>('IUserDataSyncWorkbenchService');
export interface IUserDataSyncWorkbenchService {
	_serviceBrand: any;

	readonly authenticationProviders: IAuthenticationProvider[];
	readonly all: IUserDataSyncAccount[];
	readonly current: IUserDataSyncAccount | undefined;

	readonly accountStatus: AccountStatus;
	readonly onDidChangeAccountStatus: Event<AccountStatus>;

	readonly userDataSyncPreview: IUserDataSyncPreview;

	turnOn(): Promise<void>;
	turnoff(everyWhere: boolean): Promise<void>;
	signIn(): Promise<void>;
}

export function getSyncAreaLabel(source: SyncResource): string {
	switch (source) {
		case SyncResource.Settings: return localize('settings', "Settings");
		case SyncResource.Keybindings: return localize('keybindings', "Keyboard Shortcuts");
		case SyncResource.Snippets: return localize('snippets', "User Snippets");
		case SyncResource.Extensions: return localize('extensions', "Extensions");
		case SyncResource.GlobalState: return localize('ui state label', "UI State");
	}
}

export const enum AccountStatus {
	Uninitialized = 'uninitialized',
	Unavailable = 'unavailable',
	Available = 'available',
}

// Contexts
export const CONTEXT_SYNC_STATE = new RawContextKey<string>('syncStatus', SyncStatus.Uninitialized);
export const CONTEXT_SYNC_ENABLEMENT = new RawContextKey<boolean>('syncEnabled', false);
export const CONTEXT_ACCOUNT_STATE = new RawContextKey<string>('userDataSyncAccountStatus', AccountStatus.Uninitialized);
export const CONTEXT_ENABLE_VIEWS = new RawContextKey<boolean>(`showUserDataSyncViews`, false);
export const CONTEXT_SHOW_MANUAL_SYNC_VIEW = new RawContextKey<boolean>(`showManualSyncView`, false);

// Commands
export const CONFIGURE_SYNC_COMMAND_ID = 'workbench.userDataSync.actions.configure';
export const SHOW_SYNC_LOG_COMMAND_ID = 'workbench.userDataSync.actions.showLog';
export const SHOW_SYNCED_DATA_COMMAND_ID = 'workbench.userDataSync.actions.showSyncedData';

// VIEWS
export const MANUAL_SYNC_VIEW_ID = 'workbench.views.manualSyncView';
