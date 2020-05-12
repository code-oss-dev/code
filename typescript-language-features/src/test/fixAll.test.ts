/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { disposeAll } from '../utils/dispose';
import { createTestEditor, wait, joinLines } from './testUtils';

const testDocumentUri = vscode.Uri.parse('untitled:test.ts');

const emptyRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

suite('TypeScript Fix All', () => {

	const _disposables: vscode.Disposable[] = [];

	teardown(async () => {
		disposeAll(_disposables);

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('Should fix unreachable code', async () => {
		const editor = await createTestEditor(testDocumentUri,
			`function foo() {`,
			`    return 1;`,
			`    return 2;`,
			`};`,
			`function boo() {`,
			`    return 3;`,
			`    return 4;`,
			`};`,
		);

		await wait(2500);

		const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider',
			testDocumentUri,
			emptyRange,
			vscode.CodeActionKind.SourceFixAll
		);
		assert.strictEqual(fixes?.length, 1);

		await vscode.workspace.applyEdit(fixes![0].edit!);
		assert.strictEqual(editor.document.getText(), joinLines(
			`function foo() {`,
			`    return 1;`,
			`};`,
			`function boo() {`,
			`    return 3;`,
			`};`,
		));
	});

	test('Should implement interfaces', async () => {
		const editor = await createTestEditor(testDocumentUri,
			`interface I {`,
			`    x: number;`,
			`}`,
			`class A implements I {}`,
			`class B implements I {}`,
		);

		await wait(2500);

		const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider',
			testDocumentUri,
			emptyRange,
			vscode.CodeActionKind.SourceFixAll
		);
		assert.strictEqual(fixes?.length, 1);

		await vscode.workspace.applyEdit(fixes![0].edit!);
		assert.strictEqual(editor.document.getText(), joinLines(
			`interface I {`,
			`    x: number;`,
			`}`,
			`class A implements I {`,
			`    x: number;`,
			`}`,
			`class B implements I {`,
			`    x: number;`,
			`}`,
		));
	});
});
