/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';

export interface IDirtyDiffTextDocumentProvider {
	getDirtyDiffTextDocument(resource: URI): TPromise<URI>;
}

export const IDirtyDiffService = createDecorator<IDirtyDiffService>('dirtyDiff');

export interface IDirtyDiffService {

	_serviceBrand: any;

	getDirtyDiffTextDocument(resource: URI): TPromise<URI>;
	registerDirtyDiffTextDocumentProvider(provider: IDirtyDiffTextDocumentProvider): IDisposable;
}