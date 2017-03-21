/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { TokenTheme, ITokenThemeRule } from 'vs/editor/common/modes/supports/tokenization';
import { ITheme } from "vs/platform/theme/common/themeService";

export var IStandaloneColorService = createDecorator<IStandaloneColorService>('standaloneColorService');

export type BuiltinTheme = 'vs' | 'vs-dark' | 'hc-black';
export type IColors = { [colorId: string]: string; };

export interface IStandaloneThemeData {
	base: BuiltinTheme;
	inherit: boolean;
	rules: ITokenThemeRule[];
	colors: IColors;
}

export interface IStandaloneTheme extends ITheme {
	tokenTheme: TokenTheme;
}

export interface IStandaloneColorService {
	_serviceBrand: any;

	setTheme(themeName: string): string;

	defineTheme(themeName: string, themeData: IStandaloneThemeData): void;

	getTheme(): IStandaloneTheme;
}
