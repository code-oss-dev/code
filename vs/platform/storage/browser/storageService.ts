/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { IWorkspaceStorageChangeEvent, IStorageService, StorageScope, IWillSaveStateEvent, WillSaveStateReason, logStorage } from 'vs/platform/storage/common/storage';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IWorkspaceInitializationPayload } from 'vs/platform/workspaces/common/workspaces';
import { ServiceIdentifier } from 'vs/platform/instantiation/common/instantiation';
import { IFileService, FileChangesEvent } from 'vs/platform/files/common/files';
import { IStorage, IStorageDatabase, IUpdateRequest, Storage } from 'vs/base/parts/storage/common/storage';
import { URI } from 'vs/base/common/uri';
import { VSBuffer } from 'vs/base/common/buffer';
import { joinPath } from 'vs/base/common/resources';
import { serializableToMap, mapToSerializable } from 'vs/base/common/map';

export class BrowserStorageService extends Disposable implements IStorageService {

	_serviceBrand: ServiceIdentifier<any>;

	private readonly _onDidChangeStorage: Emitter<IWorkspaceStorageChangeEvent> = this._register(new Emitter<IWorkspaceStorageChangeEvent>());
	get onDidChangeStorage(): Event<IWorkspaceStorageChangeEvent> { return this._onDidChangeStorage.event; }

	private readonly _onWillSaveState: Emitter<IWillSaveStateEvent> = this._register(new Emitter<IWillSaveStateEvent>());
	get onWillSaveState(): Event<IWillSaveStateEvent> { return this._onWillSaveState.event; }

	private globalStorage: IStorage;
	private workspaceStorage: IStorage;

	private globalStorageFile: URI;
	private workspaceStorageFile: URI;

	private initializePromise: Promise<void>;

	constructor(
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	initialize(payload: IWorkspaceInitializationPayload): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = this.doInitialize(payload);
		}

		return this.initializePromise;
	}

	private async doInitialize(payload: IWorkspaceInitializationPayload): Promise<void> {

		// Workspace Storage
		this.workspaceStorageFile = joinPath(this.environmentService.userRoamingDataHome, 'state', `${payload.id}.json`);
		this.workspaceStorage = new Storage(this._register(new FileStorageDatabase(this.workspaceStorageFile, this.fileService)));
		this._register(this.workspaceStorage.onDidChangeStorage(key => this._onDidChangeStorage.fire({ key, scope: StorageScope.WORKSPACE })));

		// Global Storage
		this.globalStorageFile = joinPath(this.environmentService.userRoamingDataHome, 'state', 'global.json');
		this.globalStorage = new Storage(this._register(new FileStorageDatabase(this.globalStorageFile, this.fileService)));
		this._register(this.globalStorage.onDidChangeStorage(key => this._onDidChangeStorage.fire({ key, scope: StorageScope.GLOBAL })));

		// Init both
		await Promise.all([
			this.workspaceStorage.init(),
			this.globalStorage.init()
		]);
	}

	//#region

	get(key: string, scope: StorageScope, fallbackValue: string): string;
	get(key: string, scope: StorageScope): string | undefined;
	get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined {
		return this.getStorage(scope).get(key, fallbackValue);
	}

	getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
	getBoolean(key: string, scope: StorageScope): boolean | undefined;
	getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined {
		return this.getStorage(scope).getBoolean(key, fallbackValue);
	}

	getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
	getNumber(key: string, scope: StorageScope): number | undefined;
	getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined {
		return this.getStorage(scope).getNumber(key, fallbackValue);
	}

	store(key: string, value: string | boolean | number | undefined | null, scope: StorageScope): void {
		this.getStorage(scope).set(key, value);
	}

	remove(key: string, scope: StorageScope): void {
		this.getStorage(scope).delete(key);
	}

	async close(): Promise<void> {

		// Signal as event so that clients can still store data
		this._onWillSaveState.fire({ reason: WillSaveStateReason.SHUTDOWN });

		// Do it
		await Promise.all([
			this.globalStorage.close(),
			this.workspaceStorage.close()
		]);
	}

	private getStorage(scope: StorageScope): IStorage {
		return scope === StorageScope.GLOBAL ? this.globalStorage : this.workspaceStorage;
	}

	async logStorage(): Promise<void> {
		const result = await Promise.all([
			this.globalStorage.items,
			this.workspaceStorage.items
		]);

		return logStorage(result[0], result[1], this.globalStorageFile.toString(), this.workspaceStorageFile.toString());
	}

	//#endregion
}

export class FileStorageDatabase extends Disposable implements IStorageDatabase {

	readonly onDidChangeItemsExternal = Event.None; // TODO@Ben implement global UI storage events

	private cache: Map<string, string> | undefined;

	private pendingUpdate: Promise<void> = Promise.resolve();

	constructor(
		private readonly file: URI,
		private readonly fileService: IFileService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.fileService.watch(this.file));
		this._register(this.fileService.onFileChanges(e => this.onFileChanges(e)));
	}

	private onFileChanges(e: FileChangesEvent): void {

	}

	async getItems(): Promise<Map<string, string>> {
		if (!this.cache) {
			try {
				this.cache = await this.doGetItemsFromFile();
			} catch (error) {
				this.cache = new Map();
			}
		}

		return this.cache;
	}

	private async doGetItemsFromFile(): Promise<Map<string, string>> {
		await this.pendingUpdate;

		const itemsRaw = await this.fileService.readFile(this.file);

		return serializableToMap(JSON.parse(itemsRaw.value.toString()));
	}

	async updateItems(request: IUpdateRequest): Promise<void> {
		let updateCount = 0;
		if (request.insert) {
			updateCount += request.insert.size;
		}
		if (request.delete) {
			updateCount += request.delete.size;
		}

		if (updateCount === 0) {
			return Promise.resolve();
		}

		const items = await this.getItems();

		if (request.insert) {
			request.insert.forEach((value, key) => items.set(key, value));
		}

		if (request.delete) {
			request.delete.forEach(key => items.delete(key));
		}

		await this.pendingUpdate;

		this.pendingUpdate = this.fileService.writeFile(this.file, VSBuffer.fromString(JSON.stringify(mapToSerializable(items)))).then();

		return this.pendingUpdate;
	}

	close(): Promise<void> {
		return this.pendingUpdate;
	}
}