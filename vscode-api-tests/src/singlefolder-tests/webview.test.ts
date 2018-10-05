/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { join } from 'path';
import { closeAllEditors, disposeAll } from '../utils';

const webviewId = 'myWebview';

const testDocument = join(vscode.workspace.rootPath || '', './bower.json');

suite('Webview tests', () => {
	const disposables: vscode.Disposable[] = [];

	function _register<T extends vscode.Disposable>(disposable: T) {
		disposables.push(disposable);
		return disposable;
	}

	teardown(async () => {
		await closeAllEditors();

		disposeAll(disposables);
	});

	test('webviews should be able to send and receive messages', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true }));
		const firstResponse = getMesssage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				window.addEventListener('message', (message) => {
					vscode.postMessage({ value: message.data.value + 1 });
				});
			</script>`);

		webview.webview.postMessage({ value: 1 });
		assert.strictEqual((await firstResponse).value, 2);
	});

	test('webviews should not have scripts enabled by default', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { }));
		const response = Promise.race<any>([
			getMesssage(webview),
			new Promise<{}>(resolve => setTimeout(() => resolve({ value: '🎉' }), 1000))
		]);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				vscode.postMessage({ value: '💉' });
			</script>`);

		assert.strictEqual((await response).value, '🎉');
	});

	test('webviews should update html', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true }));

		{
			const response = getMesssage(webview);
			webview.webview.html = createHtmlDocumentWithBody(/*html*/`
				<script>
					const vscode = acquireVsCodeApi();
					vscode.postMessage({ value: 'first' });
				</script>`);

			assert.strictEqual((await response).value, 'first');
		}
		{
			const firstResponse = getMesssage(webview);
			webview.webview.html = createHtmlDocumentWithBody(/*html*/`
				<script>
					const vscode = acquireVsCodeApi();
					vscode.postMessage({ value: 'second' });
				</script>`);

			assert.strictEqual((await firstResponse).value, 'second');
		}
	});

	test('webviews should preserve vscode API state when they are hidden', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true }));
		const ready = getMesssage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				let value = (vscode.getState() || {}).value || 0;

				window.addEventListener('message', (message) => {
					switch (message.data.type) {
					case 'get':
						vscode.postMessage({ value });
						break;

					case 'add':
						++value;;
						vscode.setState({ value });
						vscode.postMessage({ value });
						break;
					}
				});

				vscode.postMessage({ type: 'ready' });
			</script>`);
		await ready;

		const firstResponse = await sendRecieveMessage(webview, { type: 'add' });
		assert.strictEqual(firstResponse.value, 1);

		// Swap away from the webview
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc);

		// And then back
		const ready2 = getMesssage(webview);
		webview.reveal(vscode.ViewColumn.One);
		await ready2;

		// We should still have old state
		const secondResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(secondResponse.value, 1);
	});

	test('webviews should preserve their context when they are moved between view columns', async () => {
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

		// Open webview in same column
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true }));
		const ready = getMesssage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				let value = 0;
				window.addEventListener('message', (message) => {
					switch (message.data.type) {
						case 'get':
							vscode.postMessage({ value });
							break;

						case 'add':
							++value;;
							vscode.postMessage({ value });
							break;
					}
				});
				vscode.postMessage({ type: 'ready' });
			</script>`);
		await ready;

		const firstResponse = await sendRecieveMessage(webview, { type: 'add' });
		assert.strictEqual(firstResponse.value, 1);

		// Now move webview to new view column
		webview.reveal(vscode.ViewColumn.Two);

		// We should still have old state
		const secondResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(secondResponse.value, 1);
	});

	test('webviews with retainContextWhenHidden should preserve their context when they are hidden', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true, retainContextWhenHidden: true }));
		const ready = getMesssage(webview);

		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				let value = 0;
				window.addEventListener('message', (message) => {
					switch (message.data.type) {
						case 'get':
							vscode.postMessage({ value });
							break;

						case 'add':
							++value;;
							vscode.setState({ value });
							vscode.postMessage({ value });
							break;
					}
				});
				vscode.postMessage({ type: 'ready' });
			</script>`);
		await ready;

		const firstResponse = await sendRecieveMessage(webview, { type: 'add' });
		assert.strictEqual((await firstResponse).value, 1);

		// Swap away from the webview
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc);

		// And then back
		webview.reveal(vscode.ViewColumn.One);

		// We should still have old state
		const secondResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(secondResponse.value, 1);
	});

	test('webviews with retainContextWhenHidden should preserve their page position when hidden', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true, retainContextWhenHidden: true }));
		const ready = getMesssage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			${'<h1>Header</h1>'.repeat(200)}
			<script>
				const vscode = acquireVsCodeApi();

				setTimeout(() => {
					window.scroll(0, 100);
					vscode.postMessage({ value: window.scrollY });
				}, 500);

				window.addEventListener('message', (message) => {
					switch (message.data.type) {
						case 'get':
							vscode.postMessage({ value: window.scrollY });
							break;
					}
				});
				vscode.postMessage({ type: 'ready' });

			</script>`);
		await ready;

		const firstResponse = getMesssage(webview);

		assert.strictEqual((await firstResponse).value, 100);

		// Swap away from the webview
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc);

		// And then back
		webview.reveal(vscode.ViewColumn.One);

		// We should still have old scroll pos
		const secondResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(secondResponse.value, 100);
	});
});

function createHtmlDocumentWithBody(body: string): string {
	return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="X-UA-Compatible" content="ie=edge">
	<title>Document</title>
</head>
<body>
	${body}
</body>
</html>`;
}

function getMesssage<R = any>(webview: vscode.WebviewPanel): Promise<R> {
	return new Promise<R>(resolve => {
		const sub = webview.webview.onDidReceiveMessage(message => {
			sub.dispose();
			resolve(message);
		});
	});
}

function sendRecieveMessage<T = {}, R = any>(webview: vscode.WebviewPanel, message: T): Promise<R> {
	const p = getMesssage<R>(webview);
	webview.webview.postMessage(message);
	return p;
}
