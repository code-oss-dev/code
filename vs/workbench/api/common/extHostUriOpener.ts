/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { toDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import * as modes from 'vs/editor/common/modes';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import type * as vscode from 'vscode';
import { ExtHostUriOpenersShape, IMainContext, MainContext, MainThreadUriOpenersShape } from './extHost.protocol';


export class ExtHostUriOpeners implements ExtHostUriOpenersShape {

	private readonly _proxy: MainThreadUriOpenersShape;

	private readonly _openers = new Map<string, vscode.ExternalUriOpener>();

	constructor(
		mainContext: IMainContext,
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadUriOpeners);
	}

	registerUriOpener(
		extensionId: ExtensionIdentifier,
		id: string,
		opener: vscode.ExternalUriOpener,
		metadata: vscode.ExternalUriOpenerMetadata,
	): vscode.Disposable {
		if (this._openers.has(id)) {
			throw new Error(`Opener with id already registered: '${id}'`);
		}

		this._openers.set(id, opener);
		this._proxy.$registerUriOpener(id, metadata.schemes, extensionId, metadata.label);

		return toDisposable(() => {
			this._openers.delete(id);
			this._proxy.$unregisterUriOpener(id);
		});
	}

	async $canOpenUri(id: string, uriComponents: UriComponents, token: CancellationToken): Promise<modes.ExternalUriOpenerPriority> {
		const opener = this._openers.get(id);
		if (!opener) {
			throw new Error(`Unknown opener with id: ${id}`);
		}

		const uri = URI.revive(uriComponents);
		return opener.canOpenExternalUri(uri, token);
	}

	async $openUri(id: string, context: { resolvedUri: UriComponents, sourceUri: UriComponents }, token: CancellationToken): Promise<void> {
		const opener = this._openers.get(id);
		if (!opener) {
			throw new Error(`Unknown opener id: '${id}'`);
		}

		return opener.openExternalUri(URI.revive(context.resolvedUri), {
			sourceUri: URI.revive(context.sourceUri)
		}, token);
	}
}
