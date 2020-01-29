/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IExtensionIdentifier, IGlobalExtensionEnablementService, DISABLED_EXTENSIONS_STORAGE_PATH } from 'vs/platform/extensionManagement/common/extensionManagement';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IStorageService, StorageScope, IWorkspaceStorageChangeEvent } from 'vs/platform/storage/common/storage';
import { isUndefinedOrNull } from 'vs/base/common/types';

export class GlobalExtensionEnablementService extends Disposable implements IGlobalExtensionEnablementService {

	_serviceBrand: undefined;

	private _onDidChangeEnablement = new Emitter<readonly IExtensionIdentifier[]>();
	readonly onDidChangeEnablement: Event<readonly IExtensionIdentifier[]> = this._onDidChangeEnablement.event;
	private readonly storageManger: StorageManager;

	constructor(
		@IStorageService storageService: IStorageService,
	) {
		super();
		this.storageManger = this._register(new StorageManager(storageService));
		this._register(this.storageManger.onDidChange(extensions => this._onDidChangeEnablement.fire(extensions)));
	}

	async enableExtension(extension: IExtensionIdentifier): Promise<boolean> {
		if (this._removeFromDisabledExtensions(extension)) {
			this._onDidChangeEnablement.fire([extension]);
			return true;
		}
		return false;
	}

	async disableExtension(extension: IExtensionIdentifier): Promise<boolean> {
		if (this._addToDisabledExtensions(extension)) {
			this._onDidChangeEnablement.fire([extension]);
			return true;
		}
		return false;
	}

	getDisabledExtensions(): IExtensionIdentifier[] {
		return this._getExtensions(DISABLED_EXTENSIONS_STORAGE_PATH);
	}

	async getDisabledExtensionsAsync(): Promise<IExtensionIdentifier[]> {
		return this.getDisabledExtensions();
	}

	private _addToDisabledExtensions(identifier: IExtensionIdentifier): boolean {
		let disabledExtensions = this.getDisabledExtensions();
		if (disabledExtensions.every(e => !areSameExtensions(e, identifier))) {
			disabledExtensions.push(identifier);
			this._setDisabledExtensions(disabledExtensions);
			return true;
		}
		return false;
	}

	private _removeFromDisabledExtensions(identifier: IExtensionIdentifier): boolean {
		let disabledExtensions = this.getDisabledExtensions();
		for (let index = 0; index < disabledExtensions.length; index++) {
			const disabledExtension = disabledExtensions[index];
			if (areSameExtensions(disabledExtension, identifier)) {
				disabledExtensions.splice(index, 1);
				this._setDisabledExtensions(disabledExtensions);
				return true;
			}
		}
		return false;
	}

	private _setDisabledExtensions(disabledExtensions: IExtensionIdentifier[]): void {
		this._setExtensions(DISABLED_EXTENSIONS_STORAGE_PATH, disabledExtensions);
	}

	private _getExtensions(storageId: string): IExtensionIdentifier[] {
		return this.storageManger.get(storageId, StorageScope.GLOBAL);
	}

	private _setExtensions(storageId: string, extensions: IExtensionIdentifier[]): void {
		this.storageManger.set(storageId, extensions, StorageScope.GLOBAL);
	}

}

export class StorageManager extends Disposable {

	private storage: { [key: string]: string } = Object.create(null);

	private _onDidChange: Emitter<IExtensionIdentifier[]> = this._register(new Emitter<IExtensionIdentifier[]>());
	readonly onDidChange: Event<IExtensionIdentifier[]> = this._onDidChange.event;

	constructor(private storageService: IStorageService) {
		super();
		this._register(storageService.onDidChangeStorage(e => this.onDidStorageChange(e)));
	}

	get(key: string, scope: StorageScope): IExtensionIdentifier[] {
		let value: string;
		if (scope === StorageScope.GLOBAL) {
			if (isUndefinedOrNull(this.storage[key])) {
				this.storage[key] = this._get(key, scope);
			}
			value = this.storage[key];
		} else {
			value = this._get(key, scope);
		}
		return JSON.parse(value);
	}

	set(key: string, value: IExtensionIdentifier[], scope: StorageScope): void {
		let newValue: string = JSON.stringify(value.map(({ id, uuid }) => (<IExtensionIdentifier>{ id, uuid })));
		const oldValue = this._get(key, scope);
		if (oldValue !== newValue) {
			if (scope === StorageScope.GLOBAL) {
				if (value.length) {
					this.storage[key] = newValue;
				} else {
					delete this.storage[key];
				}
			}
			this._set(key, value.length ? newValue : undefined, scope);
		}
	}

	private onDidStorageChange(workspaceStorageChangeEvent: IWorkspaceStorageChangeEvent): void {
		if (workspaceStorageChangeEvent.scope === StorageScope.GLOBAL) {
			if (!isUndefinedOrNull(this.storage[workspaceStorageChangeEvent.key])) {
				const newValue = this._get(workspaceStorageChangeEvent.key, workspaceStorageChangeEvent.scope);
				if (newValue !== this.storage[workspaceStorageChangeEvent.key]) {
					const oldValues = this.get(workspaceStorageChangeEvent.key, workspaceStorageChangeEvent.scope);
					delete this.storage[workspaceStorageChangeEvent.key];
					const newValues = this.get(workspaceStorageChangeEvent.key, workspaceStorageChangeEvent.scope);
					const added = oldValues.filter(oldValue => !newValues.some(newValue => areSameExtensions(oldValue, newValue)));
					const removed = newValues.filter(newValue => !oldValues.some(oldValue => areSameExtensions(oldValue, newValue)));
					if (added.length || removed.length) {
						this._onDidChange.fire([...added, ...removed]);
					}
				}
			}
		}
	}

	private _get(key: string, scope: StorageScope): string {
		return this.storageService.get(key, scope, '[]');
	}

	private _set(key: string, value: string | undefined, scope: StorageScope): void {
		if (value) {
			this.storageService.store(key, value, scope);
		} else {
			this.storageService.remove(key, scope);
		}
	}
}
