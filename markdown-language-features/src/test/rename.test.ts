/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import { MdLinkProvider } from '../languageFeatures/documentLinkProvider';
import { MdReferencesProvider } from '../languageFeatures/references';
import { MdRenameProvider } from '../languageFeatures/rename';
import { githubSlugifier } from '../slugify';
import { InMemoryDocument } from '../util/inMemoryDocument';
import { MdWorkspaceContents } from '../workspaceContents';
import { createNewMarkdownEngine } from './engine';
import { InMemoryWorkspaceMarkdownDocuments } from './inMemoryWorkspace';
import { assertRangeEqual, joinLines, noopToken, workspacePath } from './util';


/**
 * Get the range that the rename should happen on.
 */
function getRenameRange(doc: InMemoryDocument, pos: vscode.Position, workspaceContents: MdWorkspaceContents) {
	const engine = createNewMarkdownEngine();
	const linkProvider = new MdLinkProvider(engine);
	const referencesProvider = new MdReferencesProvider(linkProvider, workspaceContents, engine, githubSlugifier);
	const renameProvider = new MdRenameProvider(referencesProvider, githubSlugifier);
	return renameProvider.prepareRename(doc, pos, noopToken);
}

/**
 * Get all the edits for the rename.
 */
function getRenameEdits(doc: InMemoryDocument, pos: vscode.Position, newName: string, workspaceContents: MdWorkspaceContents) {
	const engine = createNewMarkdownEngine();
	const linkProvider = new MdLinkProvider(engine);
	const referencesProvider = new MdReferencesProvider(linkProvider, workspaceContents, engine, githubSlugifier);
	const renameProvider = new MdRenameProvider(referencesProvider, githubSlugifier);
	return renameProvider.provideRenameEdits(doc, pos, newName, noopToken);
}

function assertEditsEqual(actualEdit: vscode.WorkspaceEdit, ...expectedEdits: { uri: vscode.Uri; edits: vscode.TextEdit[] }[]) {
	const actualEntries = actualEdit.entries();
	assert.strictEqual(actualEntries.length, expectedEdits.length, `Reference counts should match`);

	for (let i = 0; i < actualEntries.length; ++i) {
		const actual = actualEntries[i];
		const expected = expectedEdits[i];
		assert.strictEqual(actual[0].toString(), expected.uri.toString(), `Ref '${i}' has expected document`);

		const actualEditForDoc = actual[1];
		const expectedEditsForDoc = expected.edits;
		assert.strictEqual(actualEditForDoc.length, expectedEditsForDoc.length, `Edit counts for '${actual[0]}' should match`);

		for (let g = 0; g < actualEditForDoc.length; ++g) {
			assertRangeEqual(actualEditForDoc[g].range, expectedEditsForDoc[g].range, `Edit '${g}' of '${actual[0]}' has expected expected range. Expected range: ${JSON.stringify(actualEditForDoc[g].range)}. Actual range: ${JSON.stringify(expectedEditsForDoc[g].range)}`);
			assert.strictEqual(actualEditForDoc[g].newText, expectedEditsForDoc[g].newText, `Edit '${g}' of '${actual[0]}' has expected edits`);
		}
	}
}

suite('markdown: rename', () => {

	setup(async () => {
		// the tests make the assumption that link providers are already registered
		await vscode.extensions.getExtension('vscode.markdown-language-features')!.activate();
	});

	test('Rename on header should not include leading #', async () => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`# abc`
		));

		const range = await getRenameRange(doc, new vscode.Position(0, 0), new InMemoryWorkspaceMarkdownDocuments([doc]));
		assertRangeEqual(range!, new vscode.Range(0, 2, 0, 5));

		const edit = await getRenameEdits(doc, new vscode.Position(0, 0), "New Header", new InMemoryWorkspaceMarkdownDocuments([doc]));
		assertEditsEqual(edit!, {
			uri, edits: [
				new vscode.TextEdit(new vscode.Range(0, 2, 0, 5), 'New Header')
			]
		});
	});

	test('Rename on header should include leading or trailing #s', async () => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`### abc ###`
		));

		const range = await getRenameRange(doc, new vscode.Position(0, 0), new InMemoryWorkspaceMarkdownDocuments([doc]));
		assertRangeEqual(range!, new vscode.Range(0, 4, 0, 7));

		const edit = await getRenameEdits(doc, new vscode.Position(0, 0), "New Header", new InMemoryWorkspaceMarkdownDocuments([doc]));
		assertEditsEqual(edit!, {
			uri, edits: [
				new vscode.TextEdit(new vscode.Range(0, 4, 0, 7), 'New Header')
			]
		});
	});

	test('Rename on header should pick up links in doc', async () => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`### A b C`, // rename here
			`[text](#a-b-c)`,
		));

		const edit = await getRenameEdits(doc, new vscode.Position(0, 0), "New Header", new InMemoryWorkspaceMarkdownDocuments([doc]));
		assertEditsEqual(edit!, {
			uri, edits: [
				new vscode.TextEdit(new vscode.Range(0, 4, 0, 9), 'New Header'),
				new vscode.TextEdit(new vscode.Range(1, 8, 1, 13), 'new-header'),
			]
		});
	});

	test('Rename on link should use slug for link', async () => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`### A b C`,
			`[text](#a-b-c)`, // rename here
		));

		const edit = await getRenameEdits(doc, new vscode.Position(1, 10), "New Header", new InMemoryWorkspaceMarkdownDocuments([doc]));
		assertEditsEqual(edit!, {
			uri, edits: [
				new vscode.TextEdit(new vscode.Range(0, 4, 0, 9), 'New Header'),
				new vscode.TextEdit(new vscode.Range(1, 8, 1, 13), 'new-header'),
			]
		});
	});

	test('Rename on link definition should work', async () => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`### A b C`,
			`[text](#a-b-c)`,
			`[ref]: #a-b-c`// rename here
		));

		const edit = await getRenameEdits(doc, new vscode.Position(2, 10), "New Header", new InMemoryWorkspaceMarkdownDocuments([doc]));
		assertEditsEqual(edit!, {
			uri, edits: [
				new vscode.TextEdit(new vscode.Range(0, 4, 0, 9), 'New Header'),
				new vscode.TextEdit(new vscode.Range(1, 8, 1, 13), 'new-header'),
				new vscode.TextEdit(new vscode.Range(2, 8, 2, 13), 'new-header'),
			]
		});
	});
});
