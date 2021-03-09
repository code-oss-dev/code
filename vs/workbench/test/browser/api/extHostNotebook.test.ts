/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { NullLogService } from 'vs/platform/log/common/log';
import { mock } from 'vs/base/test/common/mock';
import { IModelAddedData, MainContext, MainThreadCommandsShape, MainThreadNotebookShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { ExtHostNotebookDocument } from 'vs/workbench/api/common/extHostNotebookDocument';
import { CellKind, CellUri, NotebookCellsChangeType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { URI } from 'vs/base/common/uri';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { nullExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { isEqual } from 'vs/base/common/resources';
import { IExtensionStoragePaths } from 'vs/workbench/api/common/extHostStoragePaths';
import { generateUuid } from 'vs/base/common/uuid';
import { Event } from 'vs/base/common/event';

suite('NotebookCell#Document', function () {


	let rpcProtocol: TestRPCProtocol;
	let notebook: ExtHostNotebookDocument;
	let extHostDocumentsAndEditors: ExtHostDocumentsAndEditors;
	let extHostDocuments: ExtHostDocuments;
	let extHostNotebooks: ExtHostNotebookController;
	const notebookUri = URI.parse('test:///notebook.file');
	const disposables = new DisposableStore();

	teardown(function () {
		disposables.clear();
	});

	setup(async function () {
		rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(MainContext.MainThreadCommands, new class extends mock<MainThreadCommandsShape>() {
			$registerCommand() { }
		});
		rpcProtocol.set(MainContext.MainThreadNotebook, new class extends mock<MainThreadNotebookShape>() {
			async $registerNotebookProvider() { }
			async $unregisterNotebookProvider() { }
		});
		extHostDocumentsAndEditors = new ExtHostDocumentsAndEditors(rpcProtocol, new NullLogService());
		extHostDocuments = new ExtHostDocuments(rpcProtocol, extHostDocumentsAndEditors);
		const extHostStoragePaths = new class extends mock<IExtensionStoragePaths>() {
			workspaceValue() {
				return URI.from({ scheme: 'test', path: generateUuid() });
			}
		};
		extHostNotebooks = new ExtHostNotebookController(rpcProtocol, new ExtHostCommands(rpcProtocol, new NullLogService()), extHostDocumentsAndEditors, { isExtensionDevelopmentDebug: false, webviewCspSource: '', webviewResourceRoot: '' }, new NullLogService(), extHostStoragePaths);
		let reg = extHostNotebooks.registerNotebookContentProvider(nullExtensionDescription, 'test', new class extends mock<vscode.NotebookContentProvider>() {
			// async openNotebook() { }
		});
		extHostNotebooks.$acceptDocumentAndEditorsDelta({
			addedDocuments: [{
				uri: notebookUri,
				viewType: 'test',
				versionId: 0,
				cells: [{
					handle: 0,
					uri: CellUri.generate(notebookUri, 0),
					source: ['### Heading'],
					eol: '\n',
					language: 'markdown',
					cellKind: CellKind.Markdown,
					outputs: [],
				}, {
					handle: 1,
					uri: CellUri.generate(notebookUri, 1),
					source: ['console.log("aaa")', 'console.log("bbb")'],
					eol: '\n',
					language: 'javascript',
					cellKind: CellKind.Code,
					outputs: [],
				}],
				contentOptions: { transientMetadata: {}, transientOutputs: false }
			}],
			addedEditors: [{
				documentUri: notebookUri,
				id: '_notebook_editor_0',
				selections: [{ start: 0, end: 1 }],
				visibleRanges: []
			}]
		});
		extHostNotebooks.$acceptDocumentAndEditorsDelta({ newActiveEditor: '_notebook_editor_0' });

		notebook = extHostNotebooks.notebookDocuments[0]!;

		disposables.add(reg);
		disposables.add(notebook);
		disposables.add(extHostDocuments);
	});


	test('cell document is vscode.TextDocument', async function () {

		assert.strictEqual(notebook.notebookDocument.cells.length, 2);

		const [c1, c2] = notebook.notebookDocument.cells;
		const d1 = extHostDocuments.getDocument(c1.uri);

		assert.ok(d1);
		assert.strictEqual(d1.languageId, c1.language);
		assert.strictEqual(d1.version, 1);
		assert.ok(d1.notebook === notebook.notebookDocument);

		const d2 = extHostDocuments.getDocument(c2.uri);
		assert.ok(d2);
		assert.strictEqual(d2.languageId, c2.language);
		assert.strictEqual(d2.version, 1);
		assert.ok(d2.notebook === notebook.notebookDocument);
	});

	test('cell document goes when notebook closes', async function () {
		const cellUris: string[] = [];
		for (let cell of notebook.notebookDocument.cells) {
			assert.ok(extHostDocuments.getDocument(cell.uri));
			cellUris.push(cell.uri.toString());
		}

		const removedCellUris: string[] = [];
		const reg = extHostDocuments.onDidRemoveDocument(doc => {
			removedCellUris.push(doc.uri.toString());
		});

		extHostNotebooks.$acceptDocumentAndEditorsDelta({ removedDocuments: [notebook.uri] });
		reg.dispose();

		assert.strictEqual(removedCellUris.length, 2);
		assert.deepStrictEqual(removedCellUris.sort(), cellUris.sort());
	});

	test('cell document is vscode.TextDocument after changing it', async function () {

		const p = new Promise<void>((resolve, reject) => {
			extHostNotebooks.onDidChangeNotebookCells(e => {
				try {
					assert.strictEqual(e.changes.length, 1);
					assert.strictEqual(e.changes[0].items.length, 2);

					const [first, second] = e.changes[0].items;

					const doc1 = extHostDocuments.getAllDocumentData().find(data => isEqual(data.document.uri, first.uri));
					assert.ok(doc1);
					assert.strictEqual(doc1?.document === first.document, true);

					const doc2 = extHostDocuments.getAllDocumentData().find(data => isEqual(data.document.uri, second.uri));
					assert.ok(doc2);
					assert.strictEqual(doc2?.document === second.document, true);

					resolve();

				} catch (err) {
					reject(err);
				}
			});
		});

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.notebookDocument.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 2,
						uri: CellUri.generate(notebookUri, 2),
						source: ['Hello', 'World', 'Hello World!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}, {
						handle: 3,
						uri: CellUri.generate(notebookUri, 3),
						source: ['Hallo', 'Welt', 'Hallo Welt!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);

		await p;

	});

	test('cell document stays open when notebook is still open', async function () {

		const docs: vscode.TextDocument[] = [];
		const addData: IModelAddedData[] = [];
		for (let cell of notebook.notebookDocument.cells) {
			const doc = extHostDocuments.getDocument(cell.uri);
			assert.ok(doc);
			assert.strictEqual(extHostDocuments.getDocument(cell.uri).isClosed, false);
			docs.push(doc);
			addData.push({
				EOL: '\n',
				isDirty: doc.isDirty,
				lines: doc.getText().split('\n'),
				modeId: doc.languageId,
				uri: doc.uri,
				versionId: doc.version
			});
		}

		// this call happens when opening a document on the main side
		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({ addedDocuments: addData });

		// this call happens when closing a document from the main side
		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({ removedDocuments: docs.map(d => d.uri) });

		// notebook is still open -> cell documents stay open
		for (let cell of notebook.notebookDocument.cells) {
			assert.ok(extHostDocuments.getDocument(cell.uri));
			assert.strictEqual(extHostDocuments.getDocument(cell.uri).isClosed, false);
		}

		// close notebook -> docs are closed
		extHostNotebooks.$acceptDocumentAndEditorsDelta({ removedDocuments: [notebook.uri] });
		for (let cell of notebook.notebookDocument.cells) {
			assert.throws(() => extHostDocuments.getDocument(cell.uri));
		}
		for (let doc of docs) {
			assert.strictEqual(doc.isClosed, true);
		}
	});

	test('cell document goes when cell is removed', async function () {

		assert.strictEqual(notebook.notebookDocument.cells.length, 2);
		const [cell1, cell2] = notebook.notebookDocument.cells;

		extHostNotebooks.$acceptModelChanged(notebook.uri, {
			versionId: 2,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 1, []]]
				}
			]
		}, false);

		assert.strictEqual(notebook.notebookDocument.cells.length, 1);
		assert.strictEqual(cell1.document.isClosed, true); // ref still alive!
		assert.strictEqual(cell2.document.isClosed, false);

		assert.throws(() => extHostDocuments.getDocument(cell1.uri));
	});

	test('cell document knows notebook', function () {
		for (let cells of notebook.notebookDocument.cells) {
			assert.strictEqual(cells.document.notebook === notebook.notebookDocument, true);
		}
	});

	test('cell#index', function () {

		assert.strictEqual(notebook.notebookDocument.cells.length, 2);
		const [first, second] = notebook.notebookDocument.cells;
		assert.strictEqual(first.index, 0);
		assert.strictEqual(second.index, 1);

		// remove first cell
		extHostNotebooks.$acceptModelChanged(notebook.uri, {
			versionId: notebook.notebookDocument.version + 1,
			rawEvents: [{
				kind: NotebookCellsChangeType.ModelChange,
				changes: [[0, 1, []]]
			}]
		}, false);

		assert.strictEqual(notebook.notebookDocument.cells.length, 1);
		assert.strictEqual(second.index, 0);

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.notebookDocument.version + 1,
			rawEvents: [{
				kind: NotebookCellsChangeType.ModelChange,
				changes: [[0, 0, [{
					handle: 2,
					uri: CellUri.generate(notebookUri, 2),
					source: ['Hello', 'World', 'Hello World!'],
					eol: '\n',
					language: 'test',
					cellKind: CellKind.Code,
					outputs: [],
				}, {
					handle: 3,
					uri: CellUri.generate(notebookUri, 3),
					source: ['Hallo', 'Welt', 'Hallo Welt!'],
					eol: '\n',
					language: 'test',
					cellKind: CellKind.Code,
					outputs: [],
				}]]]
			}]
		}, false);

		assert.strictEqual(notebook.notebookDocument.cells.length, 3);
		assert.strictEqual(second.index, 2);
	});

	test('ERR MISSING extHostDocument for notebook cell: #116711', async function () {

		const p = Event.toPromise(extHostNotebooks.onDidChangeNotebookCells);

		// DON'T call this, make sure the cell-documents have not been created yet
		// assert.strictEqual(notebook.notebookDocument.cells.length, 2);

		extHostNotebooks.$acceptModelChanged(notebook.uri, {
			versionId: 100,
			rawEvents: [{
				kind: NotebookCellsChangeType.ModelChange,
				changes: [[0, 2, [{
					handle: 3,
					uri: CellUri.generate(notebookUri, 3),
					source: ['### Heading'],
					eol: '\n',
					language: 'markdown',
					cellKind: CellKind.Markdown,
					outputs: [],
				}, {
					handle: 4,
					uri: CellUri.generate(notebookUri, 4),
					source: ['console.log("aaa")', 'console.log("bbb")'],
					eol: '\n',
					language: 'javascript',
					cellKind: CellKind.Code,
					outputs: [],
				}]]]
			}]
		}, false);

		assert.strictEqual(notebook.notebookDocument.cells.length, 2);

		const event = await p;

		assert.strictEqual(event.document === notebook.notebookDocument, true);
		assert.strictEqual(event.changes.length, 1);
		assert.strictEqual(event.changes[0].deletedCount, 2);
		assert.strictEqual(event.changes[0].deletedItems[0].document.isClosed, true);
		assert.strictEqual(event.changes[0].deletedItems[1].document.isClosed, true);
		assert.strictEqual(event.changes[0].items.length, 2);
		assert.strictEqual(event.changes[0].items[0].document.isClosed, false);
		assert.strictEqual(event.changes[0].items[1].document.isClosed, false);
	});


	test('Opening a notebook results in VS Code firing the event onDidChangeActiveNotebookEditor twice #118470', function () {
		let count = 0;
		extHostNotebooks.onDidChangeActiveNotebookEditor(() => count += 1);

		extHostNotebooks.$acceptDocumentAndEditorsDelta({
			addedEditors: [{
				documentUri: notebookUri,
				id: '_notebook_editor_2',
				selections: [{ start: 0, end: 1 }],
				visibleRanges: []
			}]
		});

		extHostNotebooks.$acceptDocumentAndEditorsDelta({
			newActiveEditor: '_notebook_editor_2'
		});

		assert.strictEqual(count, 1);
	});

	test('unset active notebook editor', function () {

		const editor = extHostNotebooks.activeNotebookEditor;
		assert.ok(editor !== undefined);

		extHostNotebooks.$acceptDocumentAndEditorsDelta({ newActiveEditor: undefined });
		assert.ok(extHostNotebooks.activeNotebookEditor === editor);

		extHostNotebooks.$acceptDocumentAndEditorsDelta({});
		assert.ok(extHostNotebooks.activeNotebookEditor === editor);

		extHostNotebooks.$acceptDocumentAndEditorsDelta({ newActiveEditor: null });
		assert.ok(extHostNotebooks.activeNotebookEditor === undefined);
	});
});
