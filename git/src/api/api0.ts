/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Model } from '../model';
import { GitExtension } from './git';
import { Api } from './api';

@Api('0.1.0')
export class ApiImpl implements GitExtension.API {

	get gitPath(): string {
		return this._model.git.path;
	}

	constructor(private _model: Model) { }
}
