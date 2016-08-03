/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import Event from 'vs/base/common/event';
import {createDecorator} from 'vs/platform/instantiation/common/instantiation';

export const ID = 'urlService';
export const IURLService = createDecorator<IURLService>(ID);

export interface IURLService {
	onOpenUrl: Event<string>;
}
