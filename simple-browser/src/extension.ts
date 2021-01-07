/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URL } from 'url';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { SimpleBrowserManager } from './simpleBrowserManager';

const localize = nls.loadMessageBundle();

const openApiCommand = 'simpleBrowser.api.open';
const showCommand = 'simpleBrowser.show';

export function activate(context: vscode.ExtensionContext) {

	const manager = new SimpleBrowserManager(context.extensionUri);
	context.subscriptions.push(manager);

	context.subscriptions.push(vscode.commands.registerCommand(showCommand, async (url?: string) => {
		if (!url) {
			url = await vscode.window.showInputBox({
				placeHolder: localize('simpleBrowser.show.placeholder', "https://example.com"),
				prompt: localize('simpleBrowser.show.prompt', "Enter url to visit")
			});
		}

		if (url) {
			manager.show(url);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(openApiCommand, (url: vscode.Uri, showOptions?: { preserveFocus?: boolean }) => {
		manager.show(url.toString(), showOptions);
	}));

	context.subscriptions.push(vscode.window.registerExternalUriOpener(['http', 'https'], {
		openExternalUri(uri: vscode.Uri, context: vscode.OpenExternalUriContext): vscode.Command | undefined {
			const configuration = vscode.workspace.getConfiguration('simpleBrowser');
			if (!configuration.get('opener.enabled', false)) {
				return undefined;
			}

			const enabledHosts = configuration.get<string[]>('opener.enabledHosts', [
				'localhost',
				'127.0.0.1'
			]);
			try {
				// Check against the original uri that triggered the open.
				// We check this since the `uri` passed to us may have been transformed
				// by port forwarding.
				const originalUri = new URL(context.originalUri.toString());
				if (!enabledHosts.includes(originalUri.hostname)) {
					return;
				}
			} catch {
				return undefined;
			}

			return {
				title: localize('openTitle', "Open in simple browser"),
				command: openApiCommand,
				arguments: [uri]
			};
		}
	}));
}
