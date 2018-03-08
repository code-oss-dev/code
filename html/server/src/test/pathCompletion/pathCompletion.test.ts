/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import * as path from 'path';
import { providePathSuggestions } from '../../modes/pathCompletion';
import { CompletionItemKind, Range, Position, CompletionItem, TextEdit } from 'vscode-languageserver-types';

const fixtureRoot = path.resolve(__dirname, '../../../test/pathCompletionFixtures');

function toRange(line: number, startChar: number, endChar: number) {
	return Range.create(Position.create(line, startChar), Position.create(line, endChar));
}

interface PathSuggestion {
	label?: string;
	kind?: CompletionItemKind;
	textEdit?: TextEdit;
}

function assertSuggestions( actual: CompletionItem[], expected: PathSuggestion[]) {
	assert.equal(actual.length, expected.length, 'Suggestions should have expected length');

	for (let i = 0; i < expected.length; i++) {
		if (expected[i].label) {
			assert.equal(actual[i].label, expected[i].label, `Suggestion ${actual[i].label} should have label ${expected[i].label}`);
		}
		if (expected[i].kind) {
			assert.equal(actual[i].kind, expected[i].kind, `Suggestion ${actual[i].label} has type ${CompletionItemKind[actual[i].kind]} but should have label ${CompletionItemKind[expected[i].kind]}`);
		}
		if (expected[i].textEdit) {
			assert.equal(actual[i].textEdit.newText, expected[i].textEdit.newText);
			assert.deepEqual(actual[i].textEdit.range, expected[i].textEdit.range);
		}
	}
}

suite('Path Completion - Relative Path', () => {
	const mockRange = Range.create(Position.create(0, 3), Position.create(0, 5));

	test('Current Folder', () => {
		const value = './';
		const activeFileFsPath = path.resolve(fixtureRoot, 'index.html');
		const suggestions = providePathSuggestions(value, mockRange, activeFileFsPath);

		assertSuggestions(suggestions, [
			{ label: 'about', kind: CompletionItemKind.Folder },
			{ label: 'index.html', kind: CompletionItemKind.File },
			{ label: 'src', kind: CompletionItemKind.Folder }
		]);
	});

	test('Parent Folder', () => {
		const value = '../';
		const activeFileFsPath = path.resolve(fixtureRoot, 'about/about.html');
		const suggestions = providePathSuggestions(value, mockRange, activeFileFsPath);

		assertSuggestions(suggestions, [
			{ label: 'about', kind: CompletionItemKind.Folder },
			{ label: 'index.html', kind: CompletionItemKind.File },
			{ label: 'src', kind: CompletionItemKind.Folder }
		]);
	});

	test('Adjacent Folder', () => {
		const value = '../src/';
		const activeFileFsPath = path.resolve(fixtureRoot, 'about/about.html');
		const suggestions = providePathSuggestions(value, mockRange, activeFileFsPath);

		assertSuggestions(suggestions, [
			{ label: 'feature.js', kind: CompletionItemKind.File },
			{ label: 'test.js', kind: CompletionItemKind.File }
		]);
	});
});

suite('Path Completion - Absolute Path', () => {
	const mockRange = Range.create(Position.create(0, 3), Position.create(0, 5));

	test('Root', () => {
		const value = '/';
		const activeFileFsPath1 = path.resolve(fixtureRoot, 'index.html');
		const activeFileFsPath2 = path.resolve(fixtureRoot, 'about/index.html');

		const suggestions1 = providePathSuggestions(value, mockRange, activeFileFsPath1, fixtureRoot); 
		const suggestions2 = providePathSuggestions(value, mockRange, activeFileFsPath2, fixtureRoot); 

		const verify = (suggestions) => {
			assertSuggestions(suggestions, [
				{ label: 'about', kind: CompletionItemKind.Folder },
				{ label: 'index.html', kind: CompletionItemKind.File },
				{ label: 'src', kind: CompletionItemKind.Folder }
			]);
		};

		verify(suggestions1);
		verify(suggestions2);
	});

	test('Sub Folder', () => {
		const value = '/src/';
		const activeFileFsPath = path.resolve(fixtureRoot, 'about/about.html');
		const suggestions = providePathSuggestions(value, mockRange, activeFileFsPath, fixtureRoot);

		assertSuggestions(suggestions, [
			{ label: 'feature.js', kind: CompletionItemKind.File },
			{ label: 'test.js', kind: CompletionItemKind.File }
		]);
	});
});

suite('Path Completion - Incomplete Path at End', () => {
	const mockRange = Range.create(Position.create(0, 3), Position.create(0, 5));

	test('Incomplete Path that starts with slash', () => {
		const value = '/src/f';
		const activeFileFsPath = path.resolve(fixtureRoot, 'about/about.html');
		const suggestions = providePathSuggestions(value, mockRange, activeFileFsPath, fixtureRoot);

		assertSuggestions(suggestions, [
			{ label: 'feature.js', kind: CompletionItemKind.File },
			{ label: 'test.js', kind: CompletionItemKind.File }
		]);
	}); 

	test('Incomplete Path that does not start with slash', () => {
		const value = '../src/f';
		const activeFileFsPath = path.resolve(fixtureRoot, 'about/about.html');
		const suggestions = providePathSuggestions(value, mockRange, activeFileFsPath, fixtureRoot);

		assertSuggestions(suggestions, [
			{ label: 'feature.js', kind: CompletionItemKind.File },
			{ label: 'test.js', kind: CompletionItemKind.File }
		]);
	}); 
});

suite('Path Completion - TextEdit', () => {
	test('TextEdit has correct replace text and range', () => {
		const value = './';
		const activeFileFsPath = path.resolve(fixtureRoot, 'index.html');
		const range = toRange(0, 3, 5);
		const expectedReplaceRange = toRange(0, 4, 4);

		const suggestions = providePathSuggestions(value, range, activeFileFsPath); 

		assertSuggestions(suggestions, [
			{ textEdit: TextEdit.replace(expectedReplaceRange, 'about') },
			{ textEdit: TextEdit.replace(expectedReplaceRange, 'index.html') },
			{ textEdit: TextEdit.replace(expectedReplaceRange, 'src') },
		]);
	});
});
