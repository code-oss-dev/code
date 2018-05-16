/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { ICommandAction } from 'vs/platform/actions/common/actions';
import { TPromise } from 'vs/base/common/winjs.base';
import { IMenubarService } from 'vs/platform/menubar/common/menubar';

export interface IMenubarChannel extends IChannel {
	call(command: 'updateMenubar', arg: [number, ICommandAction[][]]): TPromise<void>;
	call(command: string, arg?: any): TPromise<any>;
}

export class MenubarChannel implements IMenubarChannel {

	constructor(private service: IMenubarService) { }

	call(command: string, arg?: any): TPromise<any> {
		switch (command) {
			case 'updateMenubar': return this.service.updateMenubar(arg[0], arg[1]);
		}
		return undefined;
	}
}

export class MenubarChannelClient implements IMenubarService {

	_serviceBrand: any;

	constructor(private channel: IMenubarChannel) { }

	updateMenubar(windowId: number, items: ICommandAction[][]): TPromise<void> {
		return this.channel.call('updateMenubar', [windowId, items]);
	}
}