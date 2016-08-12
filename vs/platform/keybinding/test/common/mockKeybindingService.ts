/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {IHTMLContentElement} from 'vs/base/common/htmlContent';
import {Keybinding} from 'vs/base/common/keyCodes';
import Event from 'vs/base/common/event';
import {IKeybindingService2} from 'vs/platform/keybinding/common/keybinding';
import {IKeybindingContextKey, IKeybindingService, IKeybindingContext, KbExpr} from 'vs/platform/contextkey/common/contextkey';

class MockKeybindingContextKey<T> implements IKeybindingContextKey<T> {
	private _key: string;
	private _defaultValue: T;
	private _value: T;

	constructor(key: string, defaultValue: T) {
		this._key = key;
		this._defaultValue = defaultValue;
		this._value = this._defaultValue;
	}

	public set(value: T): void {
		this._value = value;
	}

	public reset(): void {
		this._value = this._defaultValue;
	}

	public get(): T {
		return this._value;
	}
}

export class MockKeybindingService implements IKeybindingService {
	public _serviceBrand: any;

	public dispose(): void { }

	public createKey<T>(key: string, defaultValue: T): IKeybindingContextKey<T> {
		return new MockKeybindingContextKey(key, defaultValue);
	}
	public contextMatchesRules(rules: KbExpr): boolean {
		return false;
	}
	public get onDidChangeContext(): Event<string[]> {
		return Event.None;
	}
	public getContextValue(key: string) {
		return;
	}
	public getContext(contextId: number): IKeybindingContext {
		return null;
	}
	public createScoped(domNode: HTMLElement): IKeybindingService {
		return this;
	}
}

export class MockKeybindingService2 implements IKeybindingService2 {
	public _serviceBrand: any;

	public getLabelFor(keybinding: Keybinding): string {
		return keybinding._toUSLabel();
	}

	public getHTMLLabelFor(keybinding: Keybinding): IHTMLContentElement[] {
		return keybinding._toUSHTMLLabel();
	}

	public getAriaLabelFor(keybinding: Keybinding): string {
		return keybinding._toUSAriaLabel();
	}

	public getElectronAcceleratorFor(keybinding: Keybinding): string {
		return keybinding._toElectronAccelerator();
	}

	public getDefaultKeybindings(): string {
		return null;
	}

	public lookupKeybindings(commandId: string): Keybinding[] {
		return [];
	}

	public customKeybindingsCount(): number {
		return 0;
	}
}
