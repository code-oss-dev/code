/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { assertType } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { Selection } from 'vs/editor/common/core/selection';
import { TextModel } from 'vs/editor/common/model/textModel';
import * as modes from 'vs/editor/common/modes';
import { CodeActionModel, CodeActionsState } from 'vs/editor/contrib/codeAction/codeActionModel';
import { createTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { MarkerService } from 'vs/platform/markers/common/markerService';

const testProvider = {
	provideCodeActions(): modes.CodeActionList {
		return {
			actions: [
				{ title: 'test', command: { id: 'test-command', title: 'test', arguments: [] } }
			],
			dispose() { /* noop*/ }
		};
	}
};
suite('CodeActionModel', () => {

	const languageIdentifier = new modes.LanguageIdentifier('foo-lang', 3);
	let uri = URI.parse('untitled:path');
	let model: TextModel;
	let markerService: MarkerService;
	let editor: ICodeEditor;
	const disposables = new DisposableStore();

	setup(() => {
		disposables.clear();
		markerService = new MarkerService();
		model = TextModel.createFromString('foobar  foo bar\nfarboo far boo', undefined, languageIdentifier, uri);
		editor = createTestCodeEditor({ model: model });
		editor.setPosition({ lineNumber: 1, column: 1 });
	});

	teardown(() => {
		disposables.clear();
		editor.dispose();
		model.dispose();
		markerService.dispose();
	});

	test('Orcale -> marker added', done => {
		const reg = modes.CodeActionProviderRegistry.register(languageIdentifier.language, testProvider);
		disposables.add(reg);

		const contextKeys = new MockContextKeyService();
		const model = disposables.add(new CodeActionModel(editor, markerService, contextKeys, undefined));
		disposables.add(model.onDidChangeState((e: CodeActionsState.State) => {
			assertType(e.type === CodeActionsState.Type.Triggered);

			assert.strictEqual(e.trigger.type, 'auto');
			assert.ok(e.actions);

			e.actions.then(fixes => {
				model.dispose();
				assert.equal(fixes.actions.length, 1);
				done();
			}, done);
		}));

		// start here
		markerService.changeOne('fake', uri, [{
			startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6,
			message: 'error',
			severity: 1,
			code: '',
			source: ''
		}]);

	});

	test('Orcale -> position changed', () => {
		const reg = modes.CodeActionProviderRegistry.register(languageIdentifier.language, testProvider);
		disposables.add(reg);

		markerService.changeOne('fake', uri, [{
			startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6,
			message: 'error',
			severity: 1,
			code: '',
			source: ''
		}]);

		editor.setPosition({ lineNumber: 2, column: 1 });

		return new Promise((resolve, reject) => {
			const contextKeys = new MockContextKeyService();
			const model = disposables.add(new CodeActionModel(editor, markerService, contextKeys, undefined));
			disposables.add(model.onDidChangeState((e: CodeActionsState.State) => {
				assertType(e.type === CodeActionsState.Type.Triggered);

				assert.equal(e.trigger.type, 'auto');
				assert.ok(e.actions);
				e.actions.then(fixes => {
					model.dispose();
					assert.equal(fixes.actions.length, 1);
					resolve(undefined);
				}, reject);
			}));
			// start here
			editor.setPosition({ lineNumber: 1, column: 1 });
		});
	});

	test('Lightbulb is in the wrong place, #29933', async function () {
		const reg = modes.CodeActionProviderRegistry.register(languageIdentifier.language, {
			provideCodeActions(_doc, _range): modes.CodeActionList {
				return { actions: [], dispose() { /* noop*/ } };
			}
		});
		disposables.add(reg);

		editor.getModel()!.setValue('// @ts-check\n2\ncon\n');

		markerService.changeOne('fake', uri, [{
			startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4,
			message: 'error',
			severity: 1,
			code: '',
			source: ''
		}]);

		// case 1 - drag selection over multiple lines -> range of enclosed marker, position or marker
		await new Promise(resolve => {
			const contextKeys = new MockContextKeyService();
			const model = disposables.add(new CodeActionModel(editor, markerService, contextKeys, undefined));
			disposables.add(model.onDidChangeState((e: CodeActionsState.State) => {
				assertType(e.type === CodeActionsState.Type.Triggered);

				assert.equal(e.trigger.type, 'auto');
				const selection = <Selection>e.rangeOrSelection;
				assert.deepEqual(selection.selectionStartLineNumber, 1);
				assert.deepEqual(selection.selectionStartColumn, 1);
				assert.deepEqual(selection.endLineNumber, 4);
				assert.deepEqual(selection.endColumn, 1);
				assert.deepEqual(e.position, { lineNumber: 3, column: 1 });
				model.dispose();
				resolve(undefined);
			}, 5));

			editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 4, endColumn: 1 });
		});
	});

	test('Orcale -> should only auto trigger once for cursor and marker update right after each other', done => {
		const reg = modes.CodeActionProviderRegistry.register(languageIdentifier.language, testProvider);
		disposables.add(reg);

		let triggerCount = 0;
		const contextKeys = new MockContextKeyService();
		const model = disposables.add(new CodeActionModel(editor, markerService, contextKeys, undefined));
		disposables.add(model.onDidChangeState((e: CodeActionsState.State) => {
			assertType(e.type === CodeActionsState.Type.Triggered);

			assert.equal(e.trigger.type, 'auto');
			++triggerCount;

			// give time for second trigger before completing test
			setTimeout(() => {
				model.dispose();
				assert.strictEqual(triggerCount, 1);
				done();
			}, 50);
		}, 5 /*delay*/));

		markerService.changeOne('fake', uri, [{
			startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6,
			message: 'error',
			severity: 1,
			code: '',
			source: ''
		}]);

		editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 4, endColumn: 1 });
	});
});
