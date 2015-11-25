/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import {setUnexpectedErrorHandler, errorHandler} from 'vs/base/common/errors';
import {create} from 'vs/base/common/types';
import URI from 'vs/base/common/uri';
import {URL} from 'vs/base/common/network';
import {TPromise} from 'vs/base/common/winjs.base';
import {PluginHostDocument} from 'vs/workbench/api/common/pluginHostDocuments';
import * as types from 'vs/workbench/api/common/pluginHostTypes';
import {Range as CodeEditorRange} from 'vs/editor/common/core/range';
import * as EditorCommon from 'vs/editor/common/editorCommon';
import {Model as EditorModel} from 'vs/editor/common/model/model';
import threadService from './testThreadService'
import {ExtHostLanguageFeatures, MainThreadLanguageFeatures} from 'vs/workbench/api/common/extHostLanguageFeatures';
import {PluginHostCommands, MainThreadCommands} from 'vs/workbench/api/common/pluginHostCommands';
import {PluginHostModelService} from 'vs/workbench/api/common/pluginHostDocuments';
import {SyncDescriptor0} from 'vs/platform/instantiation/common/descriptors';
import {LanguageSelector, ModelLike} from 'vs/editor/common/modes/languageSelector';
import {OutlineRegistry, getOutlineEntries} from 'vs/editor/contrib/quickOpen/common/quickOpen';
import {CodeLensRegistry, getCodeLensData} from 'vs/editor/contrib/codelens/common/codelens';
import {DeclarationRegistry, getDeclarationsAtPosition} from 'vs/editor/contrib/goToDeclaration/common/goToDeclaration';
import {ExtraInfoRegistry, getExtraInfoAtPosition} from 'vs/editor/contrib/hover/common/hover';
import {OccurrencesRegistry, getOccurrencesAtPosition} from 'vs/editor/contrib/wordHighlighter/common/wordHighlighter';


const defaultSelector = { scheme: 'far' };
const model: EditorCommon.IModel = new EditorModel(
	[
		'This is the first line',
		'This is the second line',
		'This is the third line',
	].join('\n'),
	undefined,
	URL.fromUri(URI.parse('far://testing/file.a')));

let extHost: ExtHostLanguageFeatures;
let mainThread: MainThreadLanguageFeatures;
let disposables: vscode.Disposable[] = [];
let originalErrorHandler: (e: any) => any;

suite('ExtHostLanguageFeatures', function() {

	suiteSetup(() => {

		originalErrorHandler = errorHandler.getUnexpectedErrorHandler();
		setUnexpectedErrorHandler(() => { });

		threadService.getRemotable(PluginHostModelService)._acceptModelAdd({
			isDirty: false,
			versionId: model.getVersionId(),
			modeId: model.getModeId(),
			url: model.getAssociatedResource(),
			value: {
				EOL: model.getEOL(),
				lines: model.getValue().split(model.getEOL()),
				BOM: '',
				length: -1
			},
		});

		threadService.getRemotable(PluginHostCommands);
		threadService.getRemotable(MainThreadCommands);
		mainThread = threadService.getRemotable(MainThreadLanguageFeatures);
		extHost = threadService.getRemotable(ExtHostLanguageFeatures);
	});

	suiteTeardown(() => {
		setUnexpectedErrorHandler(originalErrorHandler);
	});

	teardown(function(done) {
		while (disposables.length) {
			disposables.pop().dispose();
		}
		threadService.sync()
			.then(() => done(), err => done(err));
	});

	// --- outline

	test('DocumentSymbols, register/deregister', function(done) {
		assert.equal(OutlineRegistry.all(model).length, 0);
		let d1 = extHost.registerDocumentSymbolProvider(defaultSelector, <vscode.DocumentSymbolProvider>{
			provideDocumentSymbols() {
				return [];
			}
		});

		threadService.sync().then(() => {
			assert.equal(OutlineRegistry.all(model).length, 1);
			d1.dispose();
			threadService.sync().then(() => {
				done();
			});
		});

	});

	test('DocumentSymbols, evil provider', function(done) {
		disposables.push(extHost.registerDocumentSymbolProvider(defaultSelector, <vscode.DocumentSymbolProvider>{
			provideDocumentSymbols(): any {
				throw new Error('evil document symbol provider');
			}
		}));
		disposables.push(extHost.registerDocumentSymbolProvider(defaultSelector, <vscode.DocumentSymbolProvider>{
			provideDocumentSymbols(): any {
				return [new types.SymbolInformation('test', types.SymbolKind.Field, new types.Range(0, 0, 0, 0))];
			}
		}));

		threadService.sync().then(() => {

			getOutlineEntries(model).then(value => {
				assert.equal(value.entries.length, 1);
				done();
			}, err => {
				done(err);
			});
		});
	});

	test('DocumentSymbols, data conversion', function(done) {
		disposables.push(extHost.registerDocumentSymbolProvider(defaultSelector, <vscode.DocumentSymbolProvider>{
			provideDocumentSymbols(): any {
				return [new types.SymbolInformation('test', types.SymbolKind.Field, new types.Range(0, 0, 0, 0))];
			}
		}));

		threadService.sync().then(() => {

			getOutlineEntries(model).then(value => {
				assert.equal(value.entries.length, 1);

				let entry = value.entries[0];
				assert.equal(entry.label, 'test');
				assert.deepEqual(entry.range, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 });
				done();

			}, err => {
				done(err);
			});
		});
	});

	// --- code lens

	test('CodeLens, evil provider', function(done) {

		disposables.push(extHost.registerCodeLensProvider(defaultSelector, <vscode.CodeLensProvider>{
			provideCodeLenses():any {
				throw new Error('evil')
			}
		}));
		disposables.push(extHost.registerCodeLensProvider(defaultSelector, <vscode.CodeLensProvider>{
			provideCodeLenses() {
				return [new types.CodeLens(new types.Range(0, 0, 0, 0))];
			}
		}));

		threadService.sync().then(() => {
			getCodeLensData(model).then(value => {
				assert.equal(value.length, 1);
				done();
			});
		});
	});

	test('CodeLens, do not resolve a resolved lens', function(done) {

		disposables.push(extHost.registerCodeLensProvider(defaultSelector, <vscode.CodeLensProvider>{
			provideCodeLenses():any {
				return [new types.CodeLens(
					new types.Range(0, 0, 0, 0),
					{ command: 'id', title: 'Title' })];
			},
			resolveCodeLens():any {
				assert.ok(false, 'do not resolve');
			}
		}));

		threadService.sync().then(() => {

			getCodeLensData(model).then(value => {
				assert.equal(value.length, 1);
				let data = value[0];

				data.support.resolveCodeLensSymbol(model.getAssociatedResource(), data.symbol).then(command => {
					assert.equal(command.id, 'id');
					assert.equal(command.title, 'Title');
					done();
				});
			});
		});
	});

	test('CodeLens, missing command', function(done) {

		disposables.push(extHost.registerCodeLensProvider(defaultSelector, <vscode.CodeLensProvider>{
			provideCodeLenses() {
				return [new types.CodeLens(new types.Range(0, 0, 0, 0))];
			}
		}));

		threadService.sync().then(() => {

			getCodeLensData(model).then(value => {
				assert.equal(value.length, 1);

				let data = value[0];
				data.support.resolveCodeLensSymbol(model.getAssociatedResource(), data.symbol).then(command => {

					assert.equal(command.id, 'missing');
					assert.equal(command.title, '<<MISSING COMMAND>>');
					done();
				});
			});
		});
	});

	// --- definition

	test('Definition, data conversion', function(done) {

		disposables.push(extHost.registerDefinitionProvider(defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(): any {
				return [new types.Location(model.getAssociatedResource(), new types.Range(1, 2, 3, 4))];
			}
		}));

		threadService.sync().then(() => {

			getDeclarationsAtPosition(model, { lineNumber: 1, column: 1 }).then(value => {
				assert.equal(value.length, 1);
				let [entry] = value;
				assert.deepEqual(entry.range, { startLineNumber: 2, startColumn: 3, endLineNumber: 4, endColumn: 5 });
				assert.equal(entry.resource.toString(), model.getAssociatedResource().toString());
				done();
			}, err => {
				done(err);
			});
		});
	});

	test('Definition, one or many', function(done) {

		disposables.push(extHost.registerDefinitionProvider(defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(): any {
				return [new types.Location(model.getAssociatedResource(), new types.Range(1, 1, 1, 1))];
			}
		}));
		disposables.push(extHost.registerDefinitionProvider(defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(): any {
				return new types.Location(model.getAssociatedResource(), new types.Range(1, 1, 1, 1));
			}
		}));

		threadService.sync().then(() => {

			getDeclarationsAtPosition(model, { lineNumber: 1, column: 1 }).then(value => {
				assert.equal(value.length, 2);
				done();
			}, err => {
				done(err);
			});
		});
	});

	test('Definition, registration order', function(done) {

		disposables.push(extHost.registerDefinitionProvider(defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(): any {
				return [new types.Location(URI.parse('far://first'), new types.Range(2, 3, 4, 5))];
			}
		}));

		setTimeout(function() { // registration time matters
			disposables.push(extHost.registerDefinitionProvider(defaultSelector, <vscode.DefinitionProvider>{
				provideDefinition(): any {
					return new types.Location(URI.parse('far://second'), new types.Range(1, 2, 3, 4));
				}
			}));

			threadService.sync().then(() => {

				getDeclarationsAtPosition(model, { lineNumber: 1, column: 1 }).then(value => {
					assert.equal(value.length, 2);
					// let [first, second] = value;

					assert.equal(value[0].resource.authority, 'second');
					assert.equal(value[1].resource.authority, 'first');
					done();

				}, err => {
					done(err);
				});
			});
		}, 5);
	});

	test('Definition, evil provider', function(done) {

		disposables.push(extHost.registerDefinitionProvider(defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(): any {
				throw new Error('evil provider')
			}
		}));
		disposables.push(extHost.registerDefinitionProvider(defaultSelector, <vscode.DefinitionProvider>{
			provideDefinition(): any {
				return new types.Location(model.getAssociatedResource(), new types.Range(1, 1, 1, 1));
			}
		}));

		threadService.sync().then(() => {

			getDeclarationsAtPosition(model, { lineNumber: 1, column: 1 }).then(value => {
				assert.equal(value.length, 1);
				done();
			}, err => {
				done(err);
			});
		});
	});

	// --- extra info

	test('ExtraInfo, word range at pos', function(done) {

		disposables.push(extHost.registerHoverProvider(defaultSelector, <vscode.HoverProvider>{
			provideHover(): any {
				return new types.Hover('Hello')
			}
		}));

		threadService.sync().then(() => {

			getExtraInfoAtPosition(model, { lineNumber: 1, column: 1 }).then(value => {

				assert.equal(value.length, 1);
				let [entry] = value;
				assert.deepEqual(entry.range, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 });
				done();
			});
		});
	});

	test('ExtraInfo, given range', function(done) {

		disposables.push(extHost.registerHoverProvider(defaultSelector, <vscode.HoverProvider>{
			provideHover(): any {
				return new types.Hover('Hello', new types.Range(3, 0, 8, 7));
			}
		}));

		threadService.sync().then(() => {

			getExtraInfoAtPosition(model, { lineNumber: 1, column: 1 }).then(value => {
				assert.equal(value.length, 1);
				let [entry] = value;
				assert.deepEqual(entry.range, { startLineNumber: 4, startColumn: 1, endLineNumber: 9, endColumn: 8 });
				done();
			});
		});
	});

	test('ExtraInfo, registration order', function(done) {

		disposables.push(extHost.registerHoverProvider(defaultSelector, <vscode.HoverProvider>{
			provideHover(): any {
				return new types.Hover('registered first');
			}
		}));

		setTimeout(function() {
			disposables.push(extHost.registerHoverProvider(defaultSelector, <vscode.HoverProvider>{
				provideHover(): any {
					return new types.Hover('registered second');
				}
			}));

			threadService.sync().then(() => {

				getExtraInfoAtPosition(model, { lineNumber: 1, column: 1 }).then(value => {
					assert.equal(value.length, 2);
					let [first, second] = value;
					assert.equal(first.htmlContent[0].formattedText, 'registered second');
					assert.equal(second.htmlContent[0].formattedText, 'registered first');
					done();
				});
			});

		}, 5);

	});

	test('ExtraInfo, evil provider', function(done) {

		disposables.push(extHost.registerHoverProvider(defaultSelector, <vscode.HoverProvider>{
			provideHover(): any {
				throw new Error('evil')
			}
		}));
		disposables.push(extHost.registerHoverProvider(defaultSelector, <vscode.HoverProvider>{
			provideHover(): any {
				return new types.Hover('Hello')
			}
		}));

		threadService.sync().then(() => {

			getExtraInfoAtPosition(model, { lineNumber: 1, column: 1 }).then(value => {

				assert.equal(value.length, 1);
				done();
			});
		});
	});

	// --- occurrences

	test('Occurrences, data conversion', function(done) {

		disposables.push(extHost.registerDocumentHighlightProvider(defaultSelector, <vscode.DocumentHighlightProvider>{
			provideDocumentHighlights(): any {
				return [new types.DocumentHighlight(new types.Range(0, 0, 0, 4))]
			}
		}));

		threadService.sync().then(() => {

			getOccurrencesAtPosition(model, { lineNumber: 1, column: 2 }).then(value => {
				assert.equal(value.length, 1);
				let [entry] = value;
				assert.deepEqual(entry.range, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 });
				assert.equal(entry.kind, 'text');
				done();
			});
		});
	});

	test('Occurrences, order 1/2', function(done) {

		disposables.push(extHost.registerDocumentHighlightProvider(defaultSelector, <vscode.DocumentHighlightProvider>{
			provideDocumentHighlights(): any {
				return []
			}
		}));
		disposables.push(extHost.registerDocumentHighlightProvider('*', <vscode.DocumentHighlightProvider>{
			provideDocumentHighlights(): any {
				return [new types.DocumentHighlight(new types.Range(0, 0, 0, 4))]
			}
		}));

		threadService.sync().then(() => {

			getOccurrencesAtPosition(model, { lineNumber: 1, column: 2 }).then(value => {
				assert.equal(value.length, 1);
				let [entry] = value;
				assert.deepEqual(entry.range, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 });
				assert.equal(entry.kind, 'text');
				done();
			});
		});
	});

	test('Occurrences, order 2/2', function(done) {

		disposables.push(extHost.registerDocumentHighlightProvider(defaultSelector, <vscode.DocumentHighlightProvider>{
			provideDocumentHighlights(): any {
				return [new types.DocumentHighlight(new types.Range(0, 0, 0, 2))]
			}
		}));
		disposables.push(extHost.registerDocumentHighlightProvider('*', <vscode.DocumentHighlightProvider>{
			provideDocumentHighlights(): any {
				return [new types.DocumentHighlight(new types.Range(0, 0, 0, 4))]
			}
		}));

		threadService.sync().then(() => {

			getOccurrencesAtPosition(model, { lineNumber: 1, column: 2 }).then(value => {
				assert.equal(value.length, 1);
				let [entry] = value;
				assert.deepEqual(entry.range, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 });
				assert.equal(entry.kind, 'text');
				done();
			});
		});
	});

	test('Occurrences, evil provider', function(done) {

		disposables.push(extHost.registerDocumentHighlightProvider(defaultSelector, <vscode.DocumentHighlightProvider>{
			provideDocumentHighlights(): any {
				throw new Error('evil');
			}
		}));

		disposables.push(extHost.registerDocumentHighlightProvider(defaultSelector, <vscode.DocumentHighlightProvider>{
			provideDocumentHighlights(): any {
				return [new types.DocumentHighlight(new types.Range(0, 0, 0, 4))]
			}
		}));

		threadService.sync().then(() => {

			getOccurrencesAtPosition(model, { lineNumber: 1, column: 2 }).then(value => {
				assert.equal(value.length, 1);
				done();
			});
		});
	});
});