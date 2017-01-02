/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Theme } from 'vs/editor/common/modes/supports/tokenization';

export var IStandaloneColorService = createDecorator<IStandaloneColorService>('standaloneColorService');

export interface IStandaloneColorService {
	_serviceBrand: any;

	setTheme(themeName: string): void;

	getTheme(): Theme;
}
