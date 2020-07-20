/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as rimraf from 'rimraf';
import * as vscode from 'vscode';
import { NodeLogDirectoryProvider } from './utils/logDirectoryProvider.electron';
import { Api, getExtensionApi } from './api';
import { registerCommands } from './commands/index';
import { LanguageConfigurationManager } from './features/languageConfiguration';
import * as task from './features/task';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { CommandManager } from './utils/commandManager';
import * as electron from './utils/electron';
import { PluginManager } from './utils/plugins';

export function activate(
	context: vscode.ExtensionContext
): Api {
	const pluginManager = new PluginManager();
	context.subscriptions.push(pluginManager);

	const commandManager = new CommandManager();
	context.subscriptions.push(commandManager);

	const onCompletionAccepted = new vscode.EventEmitter<vscode.CompletionItem>();
	context.subscriptions.push(onCompletionAccepted);

	const logDirectoryProvider = new NodeLogDirectoryProvider(context);

	const lazyClientHost = createLazyClientHost(context, pluginManager, commandManager, logDirectoryProvider, item => {
		onCompletionAccepted.fire(item);
	});

	registerCommands(commandManager, lazyClientHost, pluginManager);
	context.subscriptions.push(task.register(lazyClientHost.map(x => x.serviceClient)));
	context.subscriptions.push(new LanguageConfigurationManager());

	import('./features/tsconfig').then(module => {
		context.subscriptions.push(module.register());
	});

	context.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginManager));

	return getExtensionApi(onCompletionAccepted.event, pluginManager);
}

export function deactivate() {
	rimraf.sync(electron.getInstanceDir());
}
