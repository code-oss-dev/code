/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { scm, ExtensionContext, workspace, Uri, window, Disposable } from 'vscode';
import * as path from 'path';
import { findGit, Git } from './git';
import { registerCommands } from './commands';
import * as nls from 'vscode-nls';

nls.config();

export function log(...args: any[]): void {
	console.log.apply(console, ['git:', ...args]);
}

class GitSCMProvider {
	resourceGroups = [];
	onDidChangeResourceGroup: any = null;

	getOriginalResource(uri: Uri): Uri | undefined {
		if (uri.scheme !== 'file') {
			return void 0;
		}

		return uri.with({ scheme: 'git-index' });
	}
}

class TextDocumentContentProvider {

	constructor(private git: Git, private rootPath: string) { }

	async provideTextDocumentContent(uri: Uri): Promise<string> {
		const relativePath = path.relative(this.rootPath, uri.fsPath);

		try {
			const result = await this.git.exec(this.rootPath, ['show', `HEAD:${relativePath}`]);

			if (result.exitCode !== 0) {
				return '';
			}

			return result.stdout;
		} catch (err) {
			return '';
		}
	}
}

async function init(disposables: Disposable[]): Promise<void> {
	const rootPath = workspace.rootPath;

	if (!rootPath) {
		return;
	}

	const pathHint = workspace.getConfiguration('git').get<string>('path');
	const info = await findGit(pathHint);
	const git = new Git({ gitPath: info.path, version: info.version });

	const outputChannel = window.createOutputChannel('git');
	outputChannel.appendLine(`Using git ${info.version} from ${info.path}`);
	git.onOutput(str => outputChannel.append(str), null, disposables);

	disposables.push(
		registerCommands(),
		scm.registerSCMProvider('git', new GitSCMProvider()),
		workspace.registerTextDocumentContentProvider('git-index', new TextDocumentContentProvider(git, rootPath)),
		outputChannel
	);
}

export function activate(context: ExtensionContext): any {
	if (!workspace.rootPath) {
		return;
	}

	const disposables: Disposable[] = [];
	context.subscriptions.push(new Disposable(() => Disposable.from(...disposables).dispose()));

	init(disposables)
		.catch(err => console.error(err));
}