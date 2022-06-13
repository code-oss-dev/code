/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isNonEmptyArray } from 'vs/base/common/arrays';
import { VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Event } from 'vs/base/common/event';
import { parse } from 'vs/base/common/json';
import { OperatingSystem, OS } from 'vs/base/common/platform';
import { isUndefined } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { FileOperationError, FileOperationResult, IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { IUserDataProfilesService } from 'vs/platform/userDataProfile/common/userDataProfile';
import { AbstractInitializer, AbstractJsonFileSynchroniser, IAcceptResult, IFileResourcePreview, IMergeResult } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { merge } from 'vs/platform/userDataSync/common/keybindingsMerge';
import { Change, IRemoteUserData, ISyncResourceHandle, IUserDataSyncBackupStoreService, IUserDataSyncConfiguration, IUserDataSynchroniser, IUserDataSyncLogService, IUserDataSyncEnablementService, IUserDataSyncStoreService, IUserDataSyncUtilService, SyncResource, UserDataSyncError, UserDataSyncErrorCode, USER_DATA_SYNC_SCHEME } from 'vs/platform/userDataSync/common/userDataSync';

interface ISyncContent {
	mac?: string;
	linux?: string;
	windows?: string;
	all?: string;
}

interface IKeybindingsResourcePreview extends IFileResourcePreview {
	previewResult: IMergeResult;
}

interface ILastSyncUserData extends IRemoteUserData {
	platformSpecific?: boolean;
}

export function getKeybindingsContentFromSyncContent(syncContent: string, platformSpecific: boolean, logService: ILogService): string | null {
	try {
		const parsed = <ISyncContent>JSON.parse(syncContent);
		if (!platformSpecific) {
			return isUndefined(parsed.all) ? null : parsed.all;
		}
		switch (OS) {
			case OperatingSystem.Macintosh:
				return isUndefined(parsed.mac) ? null : parsed.mac;
			case OperatingSystem.Linux:
				return isUndefined(parsed.linux) ? null : parsed.linux;
			case OperatingSystem.Windows:
				return isUndefined(parsed.windows) ? null : parsed.windows;
		}
	} catch (e) {
		logService.error(e);
		return null;
	}
}

export class KeybindingsSynchroniser extends AbstractJsonFileSynchroniser implements IUserDataSynchroniser {

	/* Version 2: Change settings from `sync.${setting}` to `settingsSync.{setting}` */
	protected readonly version: number = 2;
	private readonly previewResource: URI = this.extUri.joinPath(this.syncPreviewFolder, 'keybindings.json');
	private readonly baseResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'base' });
	private readonly localResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' });
	private readonly remoteResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' });
	private readonly acceptedResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

	constructor(
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@IFileService fileService: IFileService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncUtilService userDataSyncUtilService: IUserDataSyncUtilService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
	) {
		super(userDataProfilesService.defaultProfile.keybindingsResource, SyncResource.Keybindings, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncEnablementService, telemetryService, logService, userDataSyncUtilService, configurationService, uriIdentityService);
		this._register(Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('settingsSync.keybindingsPerPlatform'))(() => this.triggerLocalChange()));
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null, isRemoteDataFromCurrentMachine: boolean, userDataSyncConfiguration: IUserDataSyncConfiguration): Promise<IKeybindingsResourcePreview[]> {
		const remoteContent = remoteUserData.syncData ? getKeybindingsContentFromSyncContent(remoteUserData.syncData.content, userDataSyncConfiguration.keybindingsPerPlatform ?? this.syncKeybindingsPerPlatform(), this.logService) : null;

		// Use remote data as last sync data if last sync data does not exist and remote data is from same machine
		lastSyncUserData = lastSyncUserData === null && isRemoteDataFromCurrentMachine ? remoteUserData : lastSyncUserData;
		const lastSyncContent: string | null = lastSyncUserData ? this.getKeybindingsContentFromLastSyncUserData(lastSyncUserData) : null;

		// Get file content last to get the latest
		const fileContent = await this.getLocalFileContent();
		const formattingOptions = await this.getFormattingOptions();

		let mergedContent: string | null = null;
		let hasLocalChanged: boolean = false;
		let hasRemoteChanged: boolean = false;
		let hasConflicts: boolean = false;

		if (remoteContent) {
			let localContent: string = fileContent ? fileContent.value.toString() : '[]';
			localContent = localContent || '[]';
			if (this.hasErrors(localContent, true)) {
				throw new UserDataSyncError(localize('errorInvalidSettings', "Unable to sync keybindings because the content in the file is not valid. Please open the file and correct it."), UserDataSyncErrorCode.LocalInvalidContent, this.resource);
			}

			if (!lastSyncContent // First time sync
				|| lastSyncContent !== localContent // Local has forwarded
				|| lastSyncContent !== remoteContent // Remote has forwarded
			) {
				this.logService.trace(`${this.syncResourceLogLabel}: Merging remote keybindings with local keybindings...`);
				const result = await merge(localContent, remoteContent, lastSyncContent, formattingOptions, this.userDataSyncUtilService);
				// Sync only if there are changes
				if (result.hasChanges) {
					mergedContent = result.mergeContent;
					hasConflicts = result.hasConflicts;
					hasLocalChanged = hasConflicts || result.mergeContent !== localContent;
					hasRemoteChanged = hasConflicts || result.mergeContent !== remoteContent;
				}
			}
		}

		// First time syncing to remote
		else if (fileContent) {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote keybindings does not exist. Synchronizing keybindings for the first time.`);
			mergedContent = fileContent.value.toString();
			hasRemoteChanged = true;
		}

		const previewResult: IMergeResult = {
			content: mergedContent,
			localChange: hasLocalChanged ? fileContent ? Change.Modified : Change.Added : Change.None,
			remoteChange: hasRemoteChanged ? Change.Modified : Change.None,
			hasConflicts
		};

		return [{
			fileContent,

			baseResource: this.baseResource,
			baseContent: lastSyncContent,

			localResource: this.localResource,
			localContent: fileContent ? fileContent.value.toString() : null,
			localChange: previewResult.localChange,

			remoteResource: this.remoteResource,
			remoteContent,
			remoteChange: previewResult.remoteChange,

			previewResource: this.previewResource,
			previewResult,
			acceptedResource: this.acceptedResource,
		}];

	}

	protected async hasRemoteChanged(lastSyncUserData: IRemoteUserData): Promise<boolean> {
		const lastSyncContent = this.getKeybindingsContentFromLastSyncUserData(lastSyncUserData);
		if (lastSyncContent === null) {
			return true;
		}

		const fileContent = await this.getLocalFileContent();
		const localContent: string = fileContent ? fileContent.value.toString() : '';
		const formattingOptions = await this.getFormattingOptions();
		const result = await merge(localContent || '[]', lastSyncContent, lastSyncContent, formattingOptions, this.userDataSyncUtilService);
		return result.hasConflicts || result.mergeContent !== lastSyncContent;
	}

	protected async getMergeResult(resourcePreview: IKeybindingsResourcePreview, token: CancellationToken): Promise<IMergeResult> {
		return resourcePreview.previewResult;
	}

	protected async getAcceptResult(resourcePreview: IKeybindingsResourcePreview, resource: URI, content: string | null | undefined, token: CancellationToken): Promise<IAcceptResult> {

		/* Accept local resource */
		if (this.extUri.isEqual(resource, this.localResource)) {
			return {
				content: resourcePreview.fileContent ? resourcePreview.fileContent.value.toString() : null,
				localChange: Change.None,
				remoteChange: Change.Modified,
			};
		}

		/* Accept remote resource */
		if (this.extUri.isEqual(resource, this.remoteResource)) {
			return {
				content: resourcePreview.remoteContent,
				localChange: Change.Modified,
				remoteChange: Change.None,
			};
		}

		/* Accept preview resource */
		if (this.extUri.isEqual(resource, this.previewResource)) {
			if (content === undefined) {
				return {
					content: resourcePreview.previewResult.content,
					localChange: resourcePreview.previewResult.localChange,
					remoteChange: resourcePreview.previewResult.remoteChange,
				};
			} else {
				return {
					content,
					localChange: Change.Modified,
					remoteChange: Change.Modified,
				};
			}
		}

		throw new Error(`Invalid Resource: ${resource.toString()}`);
	}

	protected async applyResult(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resourcePreviews: [IKeybindingsResourcePreview, IAcceptResult][], force: boolean): Promise<void> {
		const { fileContent } = resourcePreviews[0][0];
		let { content, localChange, remoteChange } = resourcePreviews[0][1];

		if (localChange === Change.None && remoteChange === Change.None) {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing keybindings.`);
		}

		if (content !== null) {
			content = content.trim();
			content = content || '[]';
			if (this.hasErrors(content, true)) {
				throw new UserDataSyncError(localize('errorInvalidSettings', "Unable to sync keybindings because the content in the file is not valid. Please open the file and correct it."), UserDataSyncErrorCode.LocalInvalidContent, this.resource);
			}
		}

		if (localChange !== Change.None) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating local keybindings...`);
			if (fileContent) {
				await this.backupLocal(this.toSyncContent(fileContent.value.toString()));
			}
			await this.updateLocalFileContent(content || '[]', fileContent, force);
			this.logService.info(`${this.syncResourceLogLabel}: Updated local keybindings`);
		}

		if (remoteChange !== Change.None) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating remote keybindings...`);
			const remoteContents = this.toSyncContent(content || '[]', remoteUserData.syncData?.content);
			remoteUserData = await this.updateRemoteUserData(remoteContents, force ? null : remoteUserData.ref);
			this.logService.info(`${this.syncResourceLogLabel}: Updated remote keybindings`);
		}

		// Delete the preview
		try {
			await this.fileService.del(this.previewResource);
		} catch (e) { /* ignore */ }

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized keybindings...`);
			await this.updateLastSyncUserData(remoteUserData, { platformSpecific: this.syncKeybindingsPerPlatform() });
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized keybindings`);
		}

	}

	async hasLocalData(): Promise<boolean> {
		try {
			const localFileContent = await this.getLocalFileContent();
			if (localFileContent) {
				const keybindings = parse(localFileContent.value.toString());
				if (isNonEmptyArray(keybindings)) {
					return true;
				}
			}
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				return true;
			}
		}
		return false;
	}

	async getAssociatedResources({ uri }: ISyncResourceHandle): Promise<{ resource: URI; comparableResource: URI }[]> {
		const comparableResource = (await this.fileService.exists(this.file)) ? this.file : this.localResource;
		return [{ resource: this.extUri.joinPath(uri, 'keybindings.json'), comparableResource }];
	}

	override async resolveContent(uri: URI): Promise<string | null> {
		if (this.extUri.isEqual(this.remoteResource, uri)
			|| this.extUri.isEqual(this.baseResource, uri)
			|| this.extUri.isEqual(this.localResource, uri)
			|| this.extUri.isEqual(this.acceptedResource, uri)
		) {
			return this.resolvePreviewContent(uri);
		}
		let content = await super.resolveContent(uri);
		if (content) {
			return content;
		}
		content = await super.resolveContent(this.extUri.dirname(uri));
		if (content) {
			const syncData = this.parseSyncData(content);
			if (syncData) {
				switch (this.extUri.basename(uri)) {
					case 'keybindings.json':
						return getKeybindingsContentFromSyncContent(syncData.content, this.syncKeybindingsPerPlatform(), this.logService);
				}
			}
		}
		return null;
	}

	private getKeybindingsContentFromLastSyncUserData(lastSyncUserData: ILastSyncUserData): string | null {
		if (!lastSyncUserData.syncData) {
			return null;
		}

		// Return null if there is a change in platform specific property from last time sync.
		if (lastSyncUserData.platformSpecific !== undefined && lastSyncUserData.platformSpecific !== this.syncKeybindingsPerPlatform()) {
			return null;
		}

		return getKeybindingsContentFromSyncContent(lastSyncUserData.syncData.content, this.syncKeybindingsPerPlatform(), this.logService);
	}

	private toSyncContent(keybindingsContent: string, syncContent?: string): string {
		let parsed: ISyncContent = {};
		try {
			parsed = JSON.parse(syncContent || '{}');
		} catch (e) {
			this.logService.error(e);
		}
		if (this.syncKeybindingsPerPlatform()) {
			delete parsed.all;
		} else {
			parsed.all = keybindingsContent;
		}
		switch (OS) {
			case OperatingSystem.Macintosh:
				parsed.mac = keybindingsContent;
				break;
			case OperatingSystem.Linux:
				parsed.linux = keybindingsContent;
				break;
			case OperatingSystem.Windows:
				parsed.windows = keybindingsContent;
				break;
		}
		return JSON.stringify(parsed);
	}

	private syncKeybindingsPerPlatform(): boolean {
		return !!this.configurationService.getValue('settingsSync.keybindingsPerPlatform');
	}

}

export class KeybindingsInitializer extends AbstractInitializer {

	constructor(
		@IFileService fileService: IFileService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
	) {
		super(SyncResource.Keybindings, userDataProfilesService, environmentService, logService, fileService, uriIdentityService);
	}

	async doInitialize(remoteUserData: IRemoteUserData): Promise<void> {
		const keybindingsContent = remoteUserData.syncData ? this.getKeybindingsContentFromSyncContent(remoteUserData.syncData.content) : null;
		if (!keybindingsContent) {
			this.logService.info('Skipping initializing keybindings because remote keybindings does not exist.');
			return;
		}

		const isEmpty = await this.isEmpty();
		if (!isEmpty) {
			this.logService.info('Skipping initializing keybindings because local keybindings exist.');
			return;
		}

		await this.fileService.writeFile(this.userDataProfilesService.defaultProfile.keybindingsResource, VSBuffer.fromString(keybindingsContent));

		await this.updateLastSyncUserData(remoteUserData);
	}

	private async isEmpty(): Promise<boolean> {
		try {
			const fileContent = await this.fileService.readFile(this.userDataProfilesService.defaultProfile.settingsResource);
			const keybindings = parse(fileContent.value.toString());
			return !isNonEmptyArray(keybindings);
		} catch (error) {
			return (<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_NOT_FOUND;
		}
	}

	private getKeybindingsContentFromSyncContent(syncContent: string): string | null {
		try {
			return getKeybindingsContentFromSyncContent(syncContent, true, this.logService);
		} catch (e) {
			this.logService.error(e);
			return null;
		}
	}

}
