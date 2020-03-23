/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { AuthenticationSession, AuthenticationSessionsChangeEvent } from 'vs/editor/common/modes';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MainThreadAuthenticationProvider } from 'vs/workbench/api/browser/mainThreadAuthentication';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';

export const IAuthenticationService = createDecorator<IAuthenticationService>('IAuthenticationService');

export interface IAuthenticationService {
	_serviceBrand: undefined;

	registerAuthenticationProvider(id: string, provider: MainThreadAuthenticationProvider): void;
	unregisterAuthenticationProvider(id: string): void;
	sessionsUpdate(providerId: string, event: AuthenticationSessionsChangeEvent): void;

	readonly onDidRegisterAuthenticationProvider: Event<string>;
	readonly onDidUnregisterAuthenticationProvider: Event<string>;

	readonly onDidChangeSessions: Event<{ providerId: string, event: AuthenticationSessionsChangeEvent }>;
	getSessions(providerId: string): Promise<ReadonlyArray<AuthenticationSession> | undefined>;
	getDisplayName(providerId: string): string;
	login(providerId: string, scopes: string[]): Promise<AuthenticationSession>;
	logout(providerId: string, accountId: string): Promise<void>;
}

export class AuthenticationService extends Disposable implements IAuthenticationService {
	_serviceBrand: undefined;
	private _placeholderMenuItem: IDisposable | undefined;

	private _authenticationProviders: Map<string, MainThreadAuthenticationProvider> = new Map<string, MainThreadAuthenticationProvider>();

	private _onDidRegisterAuthenticationProvider: Emitter<string> = this._register(new Emitter<string>());
	readonly onDidRegisterAuthenticationProvider: Event<string> = this._onDidRegisterAuthenticationProvider.event;

	private _onDidUnregisterAuthenticationProvider: Emitter<string> = this._register(new Emitter<string>());
	readonly onDidUnregisterAuthenticationProvider: Event<string> = this._onDidUnregisterAuthenticationProvider.event;

	private _onDidChangeSessions: Emitter<{ providerId: string, event: AuthenticationSessionsChangeEvent }> = this._register(new Emitter<{ providerId: string, event: AuthenticationSessionsChangeEvent }>());
	readonly onDidChangeSessions: Event<{ providerId: string, event: AuthenticationSessionsChangeEvent }> = this._onDidChangeSessions.event;

	constructor() {
		super();
		this._placeholderMenuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			command: {
				id: 'noAuthenticationProviders',
				title: nls.localize('noAuthenticationProviders', "No authentication providers registered")
			},
		});
	}

	registerAuthenticationProvider(id: string, authenticationProvider: MainThreadAuthenticationProvider): void {
		this._authenticationProviders.set(id, authenticationProvider);
		this._onDidRegisterAuthenticationProvider.fire(id);

		if (authenticationProvider.dependents.length && this._placeholderMenuItem) {
			this._placeholderMenuItem.dispose();
			this._placeholderMenuItem = undefined;
		}
	}

	unregisterAuthenticationProvider(id: string): void {
		const provider = this._authenticationProviders.get(id);
		if (provider) {
			provider.dispose();
			this._authenticationProviders.delete(id);
			this._onDidUnregisterAuthenticationProvider.fire(id);
		}

		if (!this._authenticationProviders.size) {
			this._placeholderMenuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
				command: {
					id: 'noAuthenticationProviders',
					title: nls.localize('noAuthenticationProviders', "No authentication providers registered")
				},
			});
		}
	}

	sessionsUpdate(id: string, event: AuthenticationSessionsChangeEvent): void {
		this._onDidChangeSessions.fire({ providerId: id, event: event });
		const provider = this._authenticationProviders.get(id);
		if (provider) {
			provider.updateSessionItems();
		}
	}

	getDisplayName(id: string): string {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.displayName;
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async getSessions(id: string): Promise<ReadonlyArray<AuthenticationSession> | undefined> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return await authProvider.getSessions();
		}

		return undefined;
	}

	async login(id: string, scopes: string[]): Promise<AuthenticationSession> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.login(scopes);
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async logout(id: string, accountId: string): Promise<void> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.logout(accountId);
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}
}

registerSingleton(IAuthenticationService, AuthenticationService);
