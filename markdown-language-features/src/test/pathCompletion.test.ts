/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import { PathCompletionProvider } from '../features/pathCompletions';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { CURSOR, getCursorPositions, joinLines, noopToken } from './util';


function workspaceFile(...segments: string[]): vscode.Uri {
	return vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, ...segments);
}

function getCompletionsAtCursor(resource: vscode.Uri, fileContents: string) {
	const doc = new InMemoryDocument(resource, fileContents);
	const provider = new PathCompletionProvider(createNewMarkdownEngine());
	const cursorPositions = getCursorPositions(fileContents, doc);
	return provider.provideCompletionItems(doc, cursorPositions[0], noopToken, {
		triggerCharacter: undefined,
		triggerKind: vscode.CompletionTriggerKind.Invoke,
	});
}


suite('markdown.PathCompletionProvider', () => {

	setup(async () => {
		// These tests assume that the markdown completion provider is already registered
		await vscode.extensions.getExtension('vscode.markdown-language-features')!.activate();
	});

	test('Should not return anything when triggered in empty doc', async () => {
		const completions = await getCompletionsAtCursor(workspaceFile('new.md'), `${CURSOR}`);
		assert.strictEqual(completions.length, 0);
	});

	test('Should return anchor completions', async () => {
		const completions = await getCompletionsAtCursor(workspaceFile('new.md'), joinLines(
			`[](#${CURSOR}`,
			``,
			`# A b C`,
			`# x y Z`,
		));

		assert.strictEqual(completions.length, 2);
		assert.ok(completions.some(x => x.label === '#a-b-c'), 'Has a-b-c anchor completion');
		assert.ok(completions.some(x => x.label === '#x-y-z'), 'Has x-y-z anchor completion');
	});

	test('Should not return suggestions for http links', async () => {
		const completions = await getCompletionsAtCursor(workspaceFile('new.md'), joinLines(
			`[](http:${CURSOR}`,
			``,
			`# http`,
			`# http:`,
			`# https:`,
		));

		assert.strictEqual(completions.length, 0);
	});

	test('Should return relative path suggestions', async () => {
		const completions = await getCompletionsAtCursor(workspaceFile('new.md'), joinLines(
			`[](${CURSOR}`,
			``,
			`# A b C`,
		));

		assert.ok(completions.some(x => x.label === 'a.md'), 'Has a.md file completion');
		assert.ok(completions.some(x => x.label === 'b.md'), 'Has b.md file completion');
		assert.ok(completions.some(x => x.label === 'sub/'), 'Has sub folder completion');
	});

	test('Should return relative path suggestions using ./', async () => {
		const completions = await getCompletionsAtCursor(workspaceFile('new.md'), joinLines(
			`[](./${CURSOR}`,
			``,
			`# A b C`,
		));

		assert.ok(completions.some(x => x.label === 'a.md'), 'Has a.md file completion');
		assert.ok(completions.some(x => x.label === 'b.md'), 'Has b.md file completion');
		assert.ok(completions.some(x => x.label === 'sub/'), 'Has sub folder completion');
	});

	test('Should return absolute path suggestions using /', async () => {
		const completions = await getCompletionsAtCursor(workspaceFile('sub', 'new.md'), joinLines(
			`[](/${CURSOR}`,
			``,
			`# A b C`,
		));

		assert.ok(completions.some(x => x.label === 'a.md'), 'Has a.md file completion');
		assert.ok(completions.some(x => x.label === 'b.md'), 'Has b.md file completion');
		assert.ok(completions.some(x => x.label === 'sub/'), 'Has sub folder completion');
		assert.ok(!completions.some(x => x.label === 'c.md'), 'Should not have c.md from sub folder');
	});

	test('Should return anchor suggestions in other file', async () => {
		const completions = await getCompletionsAtCursor(workspaceFile('sub', 'new.md'), joinLines(
			`[](/b.md#${CURSOR}`,
		));

		assert.ok(completions.some(x => x.label === '#b'), 'Has #b header completion');
		assert.ok(completions.some(x => x.label === '#header1'), 'Has #header1 header completion');
	});
});
