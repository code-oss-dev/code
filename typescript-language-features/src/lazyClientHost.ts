/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import TypeScriptServiceClientHost from './typeScriptServiceClientHost';
import { flatten } from './utils/arrays';
import { CommandManager } from './utils/commandManager';
import * as fileSchemes from './utils/fileSchemes';
import { standardLanguageDescriptions } from './utils/languageDescription';
import * as ProjectStatus from './utils/largeProjectStatus';
import { lazy, Lazy } from './utils/lazy';
import { ILogDirectoryProvider } from './utils/logDirectoryProvider';
import ManagedFileContextManager from './utils/managedFileContext';
import { PluginManager } from './utils/plugins';

export function createLazyClientHost(
	context: vscode.ExtensionContext,
	pluginManager: PluginManager,
	commandManager: CommandManager,
	logDirectoryProvider: ILogDirectoryProvider,
	onCompletionAccepted: (item: vscode.CompletionItem) => void,
): Lazy<TypeScriptServiceClientHost> {
	return lazy(() => {
		const clientHost = new TypeScriptServiceClientHost(
			standardLanguageDescriptions,
			context.workspaceState,
			pluginManager,
			commandManager,
			logDirectoryProvider,
			onCompletionAccepted);

		context.subscriptions.push(clientHost);

		clientHost.serviceClient.onReady(() => {
			context.subscriptions.push(
				ProjectStatus.create(
					clientHost.serviceClient,
					clientHost.serviceClient.telemetryReporter));
		});

		return clientHost;
	});
}


export function lazilyActivateClient(
	lazyClientHost: Lazy<TypeScriptServiceClientHost>,
	pluginManager: PluginManager,
) {
	const disposables: vscode.Disposable[] = [];

	const supportedLanguage = flatten([
		...standardLanguageDescriptions.map(x => x.modeIds),
		...pluginManager.plugins.map(x => x.languages)
	]);

	let hasActivated = false;
	const maybeActivate = (textDocument: vscode.TextDocument): boolean => {
		if (!hasActivated && isSupportedDocument(supportedLanguage, textDocument)) {
			hasActivated = true;
			// Force activation
			void lazyClientHost.value;

			disposables.push(new ManagedFileContextManager(resource => {
				return lazyClientHost.value.serviceClient.toPath(resource);
			}));
			return true;
		}
		return false;
	};

	const didActivate = vscode.workspace.textDocuments.some(maybeActivate);
	if (!didActivate) {
		const openListener = vscode.workspace.onDidOpenTextDocument(doc => {
			if (maybeActivate(doc)) {
				openListener.dispose();
			}
		}, undefined, disposables);
	}

	return vscode.Disposable.from(...disposables);
}

function isSupportedDocument(
	supportedLanguage: string[],
	document: vscode.TextDocument
): boolean {
	if (supportedLanguage.indexOf(document.languageId) < 0) {
		return false;
	}
	return fileSchemes.isSupportedScheme(document.uri.scheme);
}
