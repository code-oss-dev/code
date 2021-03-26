/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { CellEditType, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { TestCell, withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';

suite('Notebook Undo/Redo', () => {
	test('Basics', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['body', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				const textModelService = accessor.get(ITextModelService);
				const viewModel = editor.viewModel;
				assert.strictEqual(viewModel.length, 2);
				assert.strictEqual(viewModel.getVersionId(), 0);
				assert.strictEqual(viewModel.getAlternativeId(), 0);

				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);
				assert.strictEqual(viewModel.length, 0);
				assert.strictEqual(viewModel.getVersionId(), 1);
				assert.strictEqual(viewModel.getAlternativeId(), 1);

				await viewModel.undo();
				assert.strictEqual(viewModel.length, 2);
				assert.strictEqual(viewModel.getVersionId(), 2);
				assert.strictEqual(viewModel.getAlternativeId(), 0);

				await viewModel.redo();
				assert.strictEqual(viewModel.length, 0);
				assert.strictEqual(viewModel.getVersionId(), 3);
				assert.strictEqual(viewModel.getAlternativeId(), 1);

				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 0, cells: [
						new TestCell(viewModel.viewType, 3, '# header 2', 'markdown', CellKind.Code, [], textModelService),
					]
				}], true, undefined, () => undefined, undefined, true);
				assert.strictEqual(viewModel.getVersionId(), 4);
				assert.strictEqual(viewModel.getAlternativeId(), 4);

				await viewModel.undo();
				assert.strictEqual(viewModel.getVersionId(), 5);
				assert.strictEqual(viewModel.getAlternativeId(), 1);
			}
		);
	});

	test.skip('Invalid replace count should not throw', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['body', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				const textModelService = accessor.get(ITextModelService);
				const viewModel = editor.viewModel;
				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);

				assert.doesNotThrow(() => {
					viewModel.notebookDocument.applyEdits([{
						editType: CellEditType.Replace, index: 0, count: 2, cells: [
							new TestCell(viewModel.viewType, 3, '# header 2', 'markdown', CellKind.Code, [], textModelService),
						]
					}], true, undefined, () => undefined, undefined, true);
				});
			}
		);
	});

	test.skip('Replace beyond length', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['body', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				const viewModel = editor.viewModel;
				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 1, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);

				assert.deepStrictEqual(viewModel.length, 1);
				viewModel.undo();
				assert.deepStrictEqual(viewModel.length, 2);
			}
		);
	});

	test.skip('Invalid replace count should not throw', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['body', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				const textModelService = accessor.get(ITextModelService);
				const viewModel = editor.viewModel;
				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);

				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 2, cells: [
						new TestCell(viewModel.viewType, 3, '# header 2', 'markdown', CellKind.Code, [], textModelService),
					]
				}], true, undefined, () => undefined, undefined, true);

				assert.deepStrictEqual(viewModel.length, 1);

				viewModel.undo();
				viewModel.undo();

				assert.deepStrictEqual(viewModel.length, 2);
				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 1, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);
				assert.deepStrictEqual(viewModel.length, 1);
			}
		);
	});
});
