/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { IHTMLContentElement } from 'vs/base/common/htmlContent';
import { SimpleKeybinding, Keybinding } from 'vs/base/common/keyCodes';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ContextKeyExpr, IContextKeyServiceTarget } from 'vs/platform/contextkey/common/contextkey';
import { IResolveResult } from 'vs/platform/keybinding/common/keybindingResolver';
import Event from 'vs/base/common/event';

export interface IUserFriendlyKeybinding {
	key: string;
	command: string;
	args?: any;
	when?: string;
}

export interface IKeybindings {
	primary: number;
	secondary?: number[];
	win?: {
		primary: number;
		secondary?: number[];
	};
	linux?: {
		primary: number;
		secondary?: number[];
	};
	mac?: {
		primary: number;
		secondary?: number[];
	};
}

export interface IKeybindingItem {
	keybinding: number;
	command: string;
	commandArgs?: any;
	when: ContextKeyExpr;
	weight1: number;
	weight2: number;
}

export enum KeybindingSource {
	Default = 1,
	User
}

export interface IKeybindingEvent {
	source: KeybindingSource;
	keybindings?: IUserFriendlyKeybinding[];
}

export let IKeybindingService = createDecorator<IKeybindingService>('keybindingService');

/**
 * A resolved keybinding.
 */
export abstract class ResolvedKeybinding {
	public abstract getLabel(): string;
	public abstract getAriaLabel(): string;
	public abstract getHTMLLabel(): IHTMLContentElement[];
	public abstract getElectronAccelerator(): string;
	public abstract getUserSettingsLabel(): string;
}

export interface IKeybindingService {
	_serviceBrand: any;

	onDidUpdateKeybindings: Event<IKeybindingEvent>;

	getLabelFor(keybinding: Keybinding): string;
	getElectronAcceleratorFor(keybinding: Keybinding): string;
	resolveKeybinding(keybinding: SimpleKeybinding): ResolvedKeybinding;

	getDefaultKeybindings(): string;
	lookupKeybindings(commandId: string): Keybinding[];
	lookupKeybindings2(commandId: string): ResolvedKeybinding[];
	customKeybindingsCount(): number;
	resolve(keybinding: SimpleKeybinding, target: IContextKeyServiceTarget): IResolveResult;
}

