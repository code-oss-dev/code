/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IWindowDriver, IElement, WindowDriverChannel, WindowDriverRegistryChannelClient } from 'vs/platform/driver/common/driver';
import { IPCClient } from 'vs/base/parts/ipc/common/ipc';
import { KeybindingIO } from 'vs/workbench/services/keybinding/common/keybindingIO';
import { SimpleKeybinding } from 'vs/base/common/keyCodes';
import { ScanCodeBinding, IMMUTABLE_KEY_CODE_TO_CODE, ScanCodeUtils } from 'vs/workbench/services/keybinding/common/scanCode';
import { IKeybindingService, IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

class WindowDriver implements IWindowDriver {

	constructor(
		@IKeybindingService private keybindingService: IKeybindingService
	) { }

	async dispatchKeybinding(rawKeybinding: string): TPromise<void> {
		const [first, second] = KeybindingIO._readUserBinding(rawKeybinding);

		this._dispatchKeybinding(first);

		if (second) {
			this._dispatchKeybinding(second);
		}
	}

	private _dispatchKeybinding(keybinding: SimpleKeybinding | ScanCodeBinding): void {
		if (keybinding instanceof ScanCodeBinding) {
			throw new Error('ScanCodeBindings not supported');
		}

		const scanCode = IMMUTABLE_KEY_CODE_TO_CODE[keybinding.keyCode];
		const event: IKeyboardEvent = {
			ctrlKey: keybinding.ctrlKey,
			altKey: keybinding.altKey,
			shiftKey: keybinding.shiftKey,
			metaKey: keybinding.metaKey,
			keyCode: keybinding.keyCode,
			code: ScanCodeUtils.toString(scanCode)
		};

		this.keybindingService.dispatchEvent(event, document.activeElement);

		// console.log(keybinding);

		// const e = new KeyboardEvent('keydown', event);
		// console.log('dispatching', e);
		// document.activeElement.dispatchEvent(e);
		// document.activeElement.dispatchEvent(new KeyboardEvent('keyup', event));
	}

	async getElements(selector: string): TPromise<IElement[]> {
		const query = document.querySelectorAll(selector);
		const result: IElement[] = [];

		for (let i = 0; i < query.length; i++) {
			const element = query.item(i);

			result.push({
				tagName: element.tagName,
				className: element.className,
				textContent: element.textContent || ''
			});
		}

		return result;
	}
}

export async function registerWindowDriver(
	client: IPCClient,
	windowId: number,
	instantiationService: IInstantiationService
): TPromise<IDisposable> {
	const windowDriver = instantiationService.createInstance(WindowDriver);
	const windowDriverChannel = new WindowDriverChannel(windowDriver);
	client.registerChannel('windowDriver', windowDriverChannel);

	const windowDriverRegistryChannel = client.getChannel('windowDriverRegistry');
	const windowDriverRegistry = new WindowDriverRegistryChannelClient(windowDriverRegistryChannel);

	await windowDriverRegistry.registerWindowDriver(windowId);

	return client;
}