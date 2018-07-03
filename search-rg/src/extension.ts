/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RipgrepTextSearchEngine } from './ripgrepTextSearch';
import { RipgrepFileSearch } from './ripgrepFileSearch';
import { CachedSearchProvider } from './cachedSearchProvider';

export function activate(): void {
	if (vscode.workspace.getConfiguration('searchRipgrep').get('enable')) {
		const outputChannel = vscode.window.createOutputChannel('search-rg');
		const provider = new RipgrepSearchProvider(outputChannel);
		vscode.workspace.registerSearchProvider('file', provider);
	}
}

class RipgrepSearchProvider implements vscode.SearchProvider {
	private cachedProvider: CachedSearchProvider;

	constructor(private outputChannel: vscode.OutputChannel) {
		this.cachedProvider = new CachedSearchProvider(this.outputChannel);
	}

	provideTextSearchResults(query: vscode.TextSearchQuery, options: vscode.TextSearchOptions, progress: vscode.Progress<vscode.TextSearchResult>, token: vscode.CancellationToken): Thenable<void> {
		const engine = new RipgrepTextSearchEngine(this.outputChannel);
		return engine.provideTextSearchResults(query, options, progress, token);
	}

	provideFileSearchResults(query: vscode.FileSearchQuery, options: vscode.SearchOptions, progress: vscode.Progress<vscode.Uri>, token: vscode.CancellationToken): Thenable<void> {
		const engine = new RipgrepFileSearch(this.outputChannel);
		return this.cachedProvider.provideFileSearchResults(engine, query, options, progress, token);
	}
}