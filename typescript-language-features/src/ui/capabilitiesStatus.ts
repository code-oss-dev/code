/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ClientCapability, ITypeScriptServiceClient } from '../typescriptService';
import { Disposable } from '../utils/dispose';
import { jsTsLanguageModes } from '../utils/languageModeIds';

const localize = nls.loadMessageBundle();

export class CapabilitiesStatus extends Disposable {

	private _statusItem?: vscode.LanguageStatusItem;

	constructor(
		private readonly _client: ITypeScriptServiceClient,
	) {
		super();

		this._register(this._client.onTsServerStarted(() => this.update()));
		this._register(this._client.onDidChangeCapabilities(() => this.update()));

		this.update();
	}

	public override dispose() {
		super.dispose();
		this._statusItem?.dispose();
	}

	private update() {
		if (this._client.capabilities.has(ClientCapability.Semantic)) {
			this._statusItem?.dispose();
		} else {
			if (!this._statusItem) {
				this._statusItem = this._register(vscode.languages.createLanguageStatusItem('typescript.capabilities', jsTsLanguageModes));
			}

			this._statusItem.name = localize('capabilitiesStatus.name', "IntelliSense Status");
			this._statusItem.text = localize('capabilitiesStatus.detail.syntaxOnly', "Using single file IntelliSense");
		}
	}
}
