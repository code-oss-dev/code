/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyncStatus, SyncResource, IUserDataSyncService, UserDataSyncError, SyncResourceConflicts, ISyncResourceHandle, ISyncTask } from 'vs/platform/userDataSync/common/userDataSync';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';

export class UserDataSyncService extends Disposable implements IUserDataSyncService {

	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;

	private _status: SyncStatus = SyncStatus.Uninitialized;
	get status(): SyncStatus { return this._status; }
	private _onDidChangeStatus: Emitter<SyncStatus> = this._register(new Emitter<SyncStatus>());
	readonly onDidChangeStatus: Event<SyncStatus> = this._onDidChangeStatus.event;

	get onDidChangeLocal(): Event<SyncResource> { return this.channel.listen<SyncResource>('onDidChangeLocal'); }

	private _conflicts: SyncResourceConflicts[] = [];
	get conflicts(): SyncResourceConflicts[] { return this._conflicts; }
	private _onDidChangeConflicts: Emitter<SyncResourceConflicts[]> = this._register(new Emitter<SyncResourceConflicts[]>());
	readonly onDidChangeConflicts: Event<SyncResourceConflicts[]> = this._onDidChangeConflicts.event;

	private _lastSyncTime: number | undefined = undefined;
	get lastSyncTime(): number | undefined { return this._lastSyncTime; }
	private _onDidChangeLastSyncTime: Emitter<number> = this._register(new Emitter<number>());
	readonly onDidChangeLastSyncTime: Event<number> = this._onDidChangeLastSyncTime.event;

	private _onSyncErrors: Emitter<[SyncResource, UserDataSyncError][]> = this._register(new Emitter<[SyncResource, UserDataSyncError][]>());
	readonly onSyncErrors: Event<[SyncResource, UserDataSyncError][]> = this._onSyncErrors.event;

	get onSynchronizeResource(): Event<SyncResource> { return this.channel.listen<SyncResource>('onSynchronizeResource'); }

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService
	) {
		super();
		const userDataSyncChannel = sharedProcessService.getChannel('userDataSync');
		this.channel = {
			call<T>(command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T> {
				return userDataSyncChannel.call(command, arg, cancellationToken)
					.then(null, error => { throw UserDataSyncError.toUserDataSyncError(error); });
			},
			listen<T>(event: string, arg?: any): Event<T> {
				return userDataSyncChannel.listen(event, arg);
			}
		};
		this.channel.call<[SyncStatus, SyncResourceConflicts[], number | undefined]>('_getInitialData').then(([status, conflicts, lastSyncTime]) => {
			this.updateStatus(status);
			this.updateConflicts(conflicts);
			if (lastSyncTime) {
				this.updateLastSyncTime(lastSyncTime);
			}
			this._register(this.channel.listen<SyncStatus>('onDidChangeStatus')(status => this.updateStatus(status)));
			this._register(this.channel.listen<number>('onDidChangeLastSyncTime')(lastSyncTime => this.updateLastSyncTime(lastSyncTime)));
		});
		this._register(this.channel.listen<SyncResourceConflicts[]>('onDidChangeConflicts')(conflicts => this.updateConflicts(conflicts)));
		this._register(this.channel.listen<[SyncResource, Error][]>('onSyncErrors')(errors => this._onSyncErrors.fire(errors.map(([source, error]) => ([source, UserDataSyncError.toUserDataSyncError(error)])))));
	}

	pull(): Promise<void> {
		return this.channel.call('pull');
	}

	createSyncTask(): Promise<ISyncTask> {
		throw new Error('not supported');
	}

	replace(uri: URI): Promise<void> {
		return this.channel.call('replace', [uri]);
	}

	reset(): Promise<void> {
		return this.channel.call('reset');
	}

	resetLocal(): Promise<void> {
		return this.channel.call('resetLocal');
	}

	hasPreviouslySynced(): Promise<boolean> {
		return this.channel.call('hasPreviouslySynced');
	}

	isFirstTimeSyncingWithAnotherMachine(): Promise<boolean> {
		return this.channel.call('isFirstTimeSyncingWithAnotherMachine');
	}

	acceptPreviewContent(resource: URI, content: string): Promise<void> {
		return this.channel.call('acceptPreviewContent', [resource, content]);
	}

	resolveContent(resource: URI): Promise<string | null> {
		return this.channel.call('resolveContent', [resource]);
	}

	async getLocalSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]> {
		const handles = await this.channel.call<ISyncResourceHandle[]>('getLocalSyncResourceHandles', [resource]);
		return handles.map(({ created, uri }) => ({ created, uri: URI.revive(uri) }));
	}

	async getRemoteSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]> {
		const handles = await this.channel.call<ISyncResourceHandle[]>('getRemoteSyncResourceHandles', [resource]);
		return handles.map(({ created, uri }) => ({ created, uri: URI.revive(uri) }));
	}

	async getAssociatedResources(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<{ resource: URI, comparableResource?: URI }[]> {
		const result = await this.channel.call<{ resource: URI, comparableResource?: URI }[]>('getAssociatedResources', [resource, syncResourceHandle]);
		return result.map(({ resource, comparableResource }) => ({ resource: URI.revive(resource), comparableResource: URI.revive(comparableResource) }));
	}

	async getMachineId(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<string | undefined> {
		return this.channel.call<string | undefined>('getMachineId', [resource, syncResourceHandle]);
	}

	private async updateStatus(status: SyncStatus): Promise<void> {
		this._status = status;
		this._onDidChangeStatus.fire(status);
	}

	private async updateConflicts(conflicts: SyncResourceConflicts[]): Promise<void> {
		// Revive URIs
		this._conflicts = conflicts.map(c =>
			({
				syncResource: c.syncResource,
				conflicts: c.conflicts.map(r =>
					({
						...r,
						localResource: URI.revive(r.localResource),
						remoteResource: URI.revive(r.remoteResource),
						previewResource: URI.revive(r.previewResource),
					}))
			}));
		this._onDidChangeConflicts.fire(conflicts);
	}

	private updateLastSyncTime(lastSyncTime: number): void {
		if (this._lastSyncTime !== lastSyncTime) {
			this._lastSyncTime = lastSyncTime;
			this._onDidChangeLastSyncTime.fire(lastSyncTime);
		}
	}
}

registerSingleton(IUserDataSyncService, UserDataSyncService);
