/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'vs/base/common/path';
import { readFileSync, promises } from 'fs';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { writeFileSync } from 'vs/base/node/pfs';
import { isUndefined, isUndefinedOrNull } from 'vs/base/common/types';
import { IStateService } from 'vs/platform/state/node/state';
import { ILogService } from 'vs/platform/log/common/log';

type StorageDatabase = { [key: string]: unknown; };

export class FileStorage {

	private _database: StorageDatabase | undefined = undefined;
	private lastFlushedSerializedDatabase: string | undefined = undefined;

	constructor(private dbPath: string, private onError: (error: Error) => void) { }

	private get database(): StorageDatabase {
		if (!this._database) {
			this._database = this.loadSync();
		}

		return this._database;
	}

	async init(): Promise<void> {
		if (this._database) {
			return; // return if database was already loaded
		}

		const database = await this.loadAsync();

		if (this._database) {
			return; // return if database was already loaded
		}

		this._database = database;
	}

	private loadSync(): StorageDatabase {
		try {
			this.lastFlushedSerializedDatabase = readFileSync(this.dbPath).toString();

			return JSON.parse(this.lastFlushedSerializedDatabase);
		} catch (error) {
			if (error.code !== 'ENOENT') {
				this.onError(error);
			}

			return {};
		}
	}

	private async loadAsync(): Promise<StorageDatabase> {
		try {
			this.lastFlushedSerializedDatabase = (await promises.readFile(this.dbPath)).toString();

			return JSON.parse(this.lastFlushedSerializedDatabase);
		} catch (error) {
			if (error.code !== 'ENOENT') {
				this.onError(error);
			}

			return {};
		}
	}

	getItem<T>(key: string, defaultValue: T): T;
	getItem<T>(key: string, defaultValue?: T): T | undefined;
	getItem<T>(key: string, defaultValue?: T): T | undefined {
		const res = this.database[key];
		if (isUndefinedOrNull(res)) {
			return defaultValue;
		}

		return res as T;
	}

	setItem(key: string, data?: object | string | number | boolean | undefined | null): void {

		// Remove an item when it is undefined or null
		if (isUndefinedOrNull(data)) {
			return this.removeItem(key);
		}

		// Shortcut for primitives that did not change
		if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
			if (this.database[key] === data) {
				return;
			}
		}

		this.database[key] = data;
		this.saveSync();
	}

	setItems(items: readonly { key: string, data?: object | string | number | boolean | undefined | null }[]): void {
		let save = false;

		for (const { key, data } of items) {

			// Remove items when they are undefined or null
			if (isUndefinedOrNull(data)) {
				this.database[key] = undefined;
				save = true;
			}

			// Otherwise set items if changed
			else {
				if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
					if (this.database[key] === data) {
						continue; // Shortcut for primitives that did not change
					}
				}

				this.database[key] = data;
				save = true;
			}
		}

		if (save) {
			this.saveSync();
		}
	}

	removeItem(key: string): void {

		// Only update if the key is actually present (not undefined)
		if (!isUndefined(this.database[key])) {
			this.database[key] = undefined;
			this.saveSync();
		}
	}

	private saveSync(): void {
		const serializedDatabase = JSON.stringify(this.database, null, 4);
		if (serializedDatabase === this.lastFlushedSerializedDatabase) {
			return; // return early if the database has not changed
		}

		try {
			writeFileSync(this.dbPath, serializedDatabase); // permission issue can happen here
			this.lastFlushedSerializedDatabase = serializedDatabase;
		} catch (error) {
			this.onError(error);
		}
	}
}

export class StateService implements IStateService {

	declare readonly _serviceBrand: undefined;

	private static readonly STATE_FILE = 'storage.json';

	private fileStorage: FileStorage;

	constructor(
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@ILogService logService: ILogService
	) {
		this.fileStorage = new FileStorage(join(environmentService.userDataPath, StateService.STATE_FILE), error => logService.error(error));
	}

	init(): Promise<void> {
		return this.fileStorage.init();
	}

	getItem<T>(key: string, defaultValue: T): T;
	getItem<T>(key: string, defaultValue?: T): T | undefined;
	getItem<T>(key: string, defaultValue?: T): T | undefined {
		return this.fileStorage.getItem(key, defaultValue);
	}

	setItem(key: string, data?: object | string | number | boolean | undefined | null): void {
		this.fileStorage.setItem(key, data);
	}

	setItems(items: readonly { key: string, data?: object | string | number | boolean | undefined | null }[]): void {
		this.fileStorage.setItems(items);
	}

	removeItem(key: string): void {
		this.fileStorage.removeItem(key);
	}
}
