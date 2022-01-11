/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { TerminalCapability } from 'vs/platform/terminal/common/terminal';
import { ITerminalCapabilityStore } from 'vs/workbench/contrib/terminal/common/terminal';

export class TerminalCapabilityStore extends Disposable implements ITerminalCapabilityStore {
	readonly items: TerminalCapability[] = [];

	private readonly _onDidDisableCapability = this._register(new Emitter<TerminalCapability>());
	readonly onDidDisableCapability = this._onDidDisableCapability.event;
	private readonly _onDidEnableCapability = this._register(new Emitter<TerminalCapability>());
	readonly onDidEnableCapability = this._onDidEnableCapability.event;

	addCapability(capability: TerminalCapability) {
		this.items.push(capability);
		this._onDidEnableCapability.fire(capability);
	}

	removeCapability(capability: TerminalCapability) {
		const index = this.items.indexOf(capability);
		if (index === -1) {
			return;
		}
		this.items.splice(index, 1);
		this._onDidDisableCapability.fire(capability);
	}
}

export class TerminalCapabilityStoreMultiplexer extends Disposable implements ITerminalCapabilityStore {
	readonly _stores: ITerminalCapabilityStore[] = [];

	private readonly _onDidDisableCapability = this._register(new Emitter<TerminalCapability>());
	readonly onDidDisableCapability = this._onDidDisableCapability.event;
	private readonly _onDidEnableCapability = this._register(new Emitter<TerminalCapability>());
	readonly onDidEnableCapability = this._onDidEnableCapability.event;

	get items(): readonly TerminalCapability[] {
		return this._stores.reduce<TerminalCapability[]>((p, c) => {
			p.push(...c.items);
			return p;
		}, []);
	}

	addCapabilityStore(store: ITerminalCapabilityStore) {
		this._stores.push(store);
		for (const capability of store.items) {
			this._onDidEnableCapability.fire(capability);
		}
	}
}
