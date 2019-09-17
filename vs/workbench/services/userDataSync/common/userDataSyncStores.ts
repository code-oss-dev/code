/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { IUserData, UserDataSyncStoreErrorCode, UserDataSyncStoreError } from 'vs/platform/userDataSync/common/userDataSync';
import { Disposable } from 'vs/base/common/lifecycle';
import { values } from 'vs/base/common/map';
import { Registry } from 'vs/platform/registry/common/platform';

export function markAsUserDataSyncStoreError(error: Error, code: UserDataSyncStoreErrorCode): Error {
	error.name = code ? `${code} (UserDataSyncStoreError)` : `UserDataSyncStoreError`;

	return error;
}

export function toUserDataSyncStoreErrorCode(error: Error | undefined | null): UserDataSyncStoreErrorCode {

	// Guard against abuse
	if (!error) {
		return UserDataSyncStoreErrorCode.Unknown;
	}

	// FileSystemProviderError comes with the code
	if (error instanceof UserDataSyncStoreError) {
		return error.code;
	}

	// Any other error, check for name match by assuming that the error
	// went through the markAsUserDataSyncStoreError() method
	const match = /^(.+) \(UserDataSyncStoreError\)$/.exec(error.name);
	if (!match) {
		return UserDataSyncStoreErrorCode.Unknown;
	}

	switch (match[1]) {
		case UserDataSyncStoreErrorCode.Rejected: return UserDataSyncStoreErrorCode.Rejected;
	}

	return UserDataSyncStoreErrorCode.Unknown;
}

export interface IUserDataSyncStore {
	readonly id: string;
	readonly name: string;
	read(key: string): Promise<IUserData | null>;
	write(key: string, content: string, ref: string | null): Promise<string>;
}

export namespace Extensions {
	export const UserDataSyncStoresRegistry = 'workbench.registry.userData.syncStores';
}

export interface IUserDataSyncStoresRegistry {
	/**
	 * An event that is triggerred when a user data sync store is registered.
	 */
	readonly onDidRegister: Event<IUserDataSyncStore>;

	/**
	 * An event that is triggerred when a user data sync store is deregistered.
	 */
	readonly onDidDeregister: Event<string>;

	/**
	 * All registered user data sync stores
	 */
	readonly all: IUserDataSyncStore[];

	/**
	 * Registers a user data sync store
	 *
	 * @param userDataSyncStore to register
	 */
	registerUserDataSyncStore(userDataSyncStore: IUserDataSyncStore): void;

	/**
	 * Deregisters the user data sync store with given id
	 */
	deregisterUserDataSyncStore(id: string): void;

	/**
	 * Returns the user data sync store with given id.
	 *
	 * @returns the user data sync store with given id.
	 */
	get(id: string): IUserDataSyncStore | undefined;
}

class UserDataSyncStoresRegistryImpl extends Disposable implements IUserDataSyncStoresRegistry {

	private readonly _onDidRegister = this._register(new Emitter<IUserDataSyncStore>());
	readonly onDidRegister: Event<IUserDataSyncStore> = this._onDidRegister.event;

	private readonly _onDidDeregister = this._register(new Emitter<string>());
	readonly onDidDeregister: Event<string> = this._onDidDeregister.event;

	private userDataSyncStores: Map<string, IUserDataSyncStore> = new Map<string, IUserDataSyncStore>();

	get all(): IUserDataSyncStore[] {
		return values(this.userDataSyncStores);
	}

	registerUserDataSyncStore(userDataSyncStore: IUserDataSyncStore): void {
		const existing = this.userDataSyncStores.get(userDataSyncStore.id);
		if (existing) {
			return;
		}

		this.userDataSyncStores.set(userDataSyncStore.id, userDataSyncStore);
		this._onDidRegister.fire(userDataSyncStore);
	}

	deregisterUserDataSyncStore(id: string): void {
		const existing = this.userDataSyncStores.get(id);
		if (existing) {
			this.userDataSyncStores.delete(id);
			this._onDidDeregister.fire(id);
		}
	}

	get(id: string): IUserDataSyncStore | undefined {
		return this.userDataSyncStores.get(id);
	}
}

Registry.add(Extensions.UserDataSyncStoresRegistry, new UserDataSyncStoresRegistryImpl());
