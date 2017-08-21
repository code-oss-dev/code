/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { IDisposable, toDisposable, empty as EmptyDisposable, combinedDisposable } from 'vs/base/common/lifecycle';
import Event, { Emitter } from 'vs/base/common/event';
import { memoize } from 'vs/base/common/decorators';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IStatusbarService, StatusbarAlignment as MainThreadStatusBarAlignment } from 'vs/platform/statusbar/common/statusbar';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ISCMService, ISCMProvider, ISCMInput, DefaultSCMProviderIdStorageKey } from './scm';

class SCMInput implements ISCMInput {

	private _value = '';

	get value(): string {
		return this._value;
	}

	set value(value: string) {
		this._value = value;
		this._onDidChange.fire(value);
	}

	private _onDidChange = new Emitter<string>();
	get onDidChange(): Event<string> { return this._onDidChange.event; }
}

export class SCMService implements ISCMService {

	_serviceBrand;

	private activeProviderDisposable: IDisposable = EmptyDisposable;
	private statusBarDisposable: IDisposable = EmptyDisposable;

	private _activeProvider: ISCMProvider | undefined;

	get activeProvider(): ISCMProvider | undefined {
		return this._activeProvider;
	}

	set activeProvider(provider: ISCMProvider | undefined) {
		this.setActiveSCMProvider(provider);
		this.storageService.store(DefaultSCMProviderIdStorageKey, provider.contextValue, StorageScope.WORKSPACE);
	}

	private _providerIds = new Set<string>();
	private _providers: ISCMProvider[] = [];
	get providers(): ISCMProvider[] { return [...this._providers]; }

	private _onDidAddProvider = new Emitter<ISCMProvider>();
	get onDidAddProvider(): Event<ISCMProvider> { return this._onDidAddProvider.event; }

	private _onDidRemoveProvider = new Emitter<ISCMProvider>();
	get onDidRemoveProvider(): Event<ISCMProvider> { return this._onDidRemoveProvider.event; }

	private _onDidChangeProvider = new Emitter<ISCMProvider>();
	get onDidChangeProvider(): Event<ISCMProvider> { return this._onDidChangeProvider.event; }

	@memoize
	get input(): ISCMInput { return new SCMInput(); }

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private storageService: IStorageService,
		@IStatusbarService private statusbarService: IStatusbarService
	) { }

	private setActiveSCMProvider(provider: ISCMProvider): void {
		this.activeProviderDisposable.dispose();

		if (!provider) {
			throw new Error('invalid provider');
		}

		if (provider && this._providers.indexOf(provider) === -1) {
			throw new Error('Provider not registered');
		}

		this._activeProvider = provider;

		this.activeProviderDisposable = provider.onDidChange(() => this.onDidProviderChange(provider));
		this.onDidProviderChange(provider);

		this._onDidChangeProvider.fire(provider);
	}

	registerSCMProvider(provider: ISCMProvider): IDisposable {
		if (this._providerIds.has(provider.id)) {
			throw new Error(`SCM Provider ${provider.id} already exists.`);
		}

		this._providerIds.add(provider.id);
		this._providers.push(provider);

		const defaultProviderId = this.storageService.get(DefaultSCMProviderIdStorageKey, StorageScope.WORKSPACE);

		if (this._providers.length === 1 || defaultProviderId === provider.contextValue) {
			this.setActiveSCMProvider(provider);
		}

		this._onDidAddProvider.fire(provider);

		return toDisposable(() => {
			const index = this._providers.indexOf(provider);

			if (index < 0) {
				return;
			}

			this._providerIds.delete(provider.id);
			this._providers.splice(index, 1);

			if (this.activeProvider === provider) {
				this.activeProvider = this._providers[0];
			}

			this._onDidRemoveProvider.fire(provider);
		});
	}

	private onDidProviderChange(provider: ISCMProvider): void {
		this.statusBarDisposable.dispose();

		const commands = provider.statusBarCommands || [];
		const disposables = commands.map(c => this.statusbarService.addEntry({
			text: c.title,
			tooltip: c.tooltip,
			command: c.id
		}, MainThreadStatusBarAlignment.LEFT, 10000));

		this.statusBarDisposable = combinedDisposable(disposables);
	}
}