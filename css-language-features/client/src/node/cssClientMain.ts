/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeFSRequestService } from './nodeFs';
import { ExtensionContext, extensions } from 'vscode';
import { startClient, LanguageClientConstructor } from '../cssClient';

import { ServerOptions, TransportKind, LanguageClientOptions, LanguageClient } from 'vscode-languageclient/node';

// this method is called when vs code is activated
export function activate(context: ExtensionContext) {

	const clientMain = extensions.getExtension('vscode.css-language-features')?.packageJSON?.main;
	const serverMain = clientMain?.replace('client', 'server').replace('cssClientMain', 'cssServerMain');
	if (!serverMain) {
		throw new Error('Unable to compute CSS server module path. Client: ' + clientMain);
	}

	const serverModule = context.asAbsolutePath(serverMain);

	// The debug options for the server
	const debugOptions = { execArgv: ['--nolazy', '--inspect=6044'] };

	// If the extension is launch in debug mode the debug server options are use
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	const newLanguageClient: LanguageClientConstructor = (id: string, name: string, clientOptions: LanguageClientOptions) => {
		return new LanguageClient(id, name, serverOptions, clientOptions);
	};

	startClient(context, newLanguageClient, { fs: getNodeFSRequestService() });
}
