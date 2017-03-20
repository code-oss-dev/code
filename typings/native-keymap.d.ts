/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'native-keymap' {

	export interface IWindowsKeyMapping {
		vkey: string;
		value: string;
		withShift: string;
		withAltGr: string;
		withShiftAltGr: string;
	}
	export interface IWindowsKeyboardMapping {
		[code: string]: IWindowsKeyMapping;
	}
	export interface ILinuxKeyMapping {
		value: string;
		withShift: string;
		withAltGr: string;
		withShiftAltGr: string;
	}
	export interface ILinuxKeyboardMapping {
		[code: string]: ILinuxKeyMapping;
	}
	export interface IMacKeyMapping {
		value: string;
		withShift: string;
		withAltGr: string;
		withShiftAltGr: string;
		valueIsDeadKey: boolean;
		withShiftIsDeadKey: boolean;
		withAltGrIsDeadKey: boolean;
		withShiftAltGrIsDeadKey: boolean;
	}
	export interface IMacKeyboardMapping {
		[code: string]: IMacKeyMapping;
	}

	export function getKeyMap(): IWindowsKeyboardMapping | ILinuxKeyboardMapping | IMacKeyboardMapping;

	export interface IWindowsKeyboardLayoutInfo {
		name: string;
		id: string;
		text: string;
	}

	export interface ILinuxKeyboardLayoutInfo {
		model: string;
		layout: string;
		variant: string;
		options: string;
		rules: string;
	}

	export interface IMacKeyboardLayoutInfo {
		id: string;
		lang: string;
	}

	export function getCurrentKeyboardLayout(): IWindowsKeyboardLayoutInfo | ILinuxKeyboardLayoutInfo | IMacKeyboardLayoutInfo;
}