/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import Event, { Emitter } from 'vs/base/common/event';
import { localize } from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import { IMessageService, Severity } from 'vs/platform/message/common/message';
import { InternalTreeExplorerNode, InternalTreeExplorerNodeProvider } from 'vs/workbench/parts/explorers/common/treeExplorerViewModel';
import { ITreeExplorerService } from 'vs/workbench/parts/explorers/common/treeExplorerService';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';

export class TreeExplorerService implements ITreeExplorerService {
	public _serviceBrand: any;

	private _activeProvider: string;
	private activeProviderContextKey: IContextKey<string | undefined>;

	private _onDidChangeProvider = new Emitter<string>();
	get onDidChangeProvider(): Event<string> { return this._onDidChangeProvider.event; }

	private _onTreeExplorerNodeProviderRegistered = new Emitter<String>();
	public get onTreeExplorerNodeProviderRegistered(): Event<string> { return this._onTreeExplorerNodeProviderRegistered.event; };

	private _treeExplorerNodeProviders: { [providerId: string]: InternalTreeExplorerNodeProvider };

	constructor(
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IMessageService private messageService: IMessageService
	) {
		this._treeExplorerNodeProviders = Object.create(null);
		this.activeProviderContextKey = this.contextKeyService.createKey<string | undefined>('treeExplorerProvider', void 0);
	}

	get activeProvider(): string {
		return this._activeProvider;
	}

	set activeProvider(provider: string) {
		if (!provider) {
			throw new Error('invalid provider');
		}

		if (provider && !!this._treeExplorerNodeProviders[provider]) {
			throw new Error('Provider not registered');
		}

		this._activeProvider = provider;
		this.activeProviderContextKey.set(provider ? provider : void 0);

		this._onDidChangeProvider.fire(provider);
	}

	public registerTreeExplorerNodeProvider(providerId: string, provider: InternalTreeExplorerNodeProvider): void {
		this._treeExplorerNodeProviders[providerId] = provider;
		this._onTreeExplorerNodeProviderRegistered.fire(providerId);
	}

	public hasProvider(providerId: string): boolean {
		return !!this._treeExplorerNodeProviders[providerId];
	}

	public provideRootNode(providerId: string): TPromise<InternalTreeExplorerNode> {
		const provider = this.getProvider(providerId);
		return TPromise.wrap(provider.provideRootNode());
	}

	public resolveChildren(providerId: string, node: InternalTreeExplorerNode): TPromise<InternalTreeExplorerNode[]> {
		const provider = this.getProvider(providerId);
		return TPromise.wrap(provider.resolveChildren(node));
	}

	public executeCommand(providerId: string, node: InternalTreeExplorerNode): TPromise<any> {
		const provider = this.getProvider(providerId);
		return TPromise.wrap(provider.executeCommand(node));
	}

	private getProvider(providerId: string): InternalTreeExplorerNodeProvider {
		const provider = this._treeExplorerNodeProviders[providerId];

		if (!provider) {
			this.messageService.show(Severity.Error, localize('treeExplorer.noMatchingProviderId', 'No TreeExplorerNodeProvider with id {providerId} registered.'));
		}

		return provider;
	}
}
