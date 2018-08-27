/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { MainContext, MainThreadLanguagesShape, IMainContext } from './extHost.protocol';
import * as vscode from 'vscode';

export class ExtHostLanguages {

	private _proxy: MainThreadLanguagesShape;

	constructor(
		mainContext: IMainContext
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadLanguages);
	}

	getLanguages(): TPromise<string[]> {
		return this._proxy.$getLanguages();
	}
	changeLanguage(documentUri: vscode.Uri, languageId: string): TPromise<void> {
		return this._proxy.$changeLanguage(documentUri, languageId);
	}
}
