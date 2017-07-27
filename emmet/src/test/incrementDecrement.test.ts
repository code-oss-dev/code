/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Selection } from 'vscode';
import { withRandomFileEditor, closeAllEditors } from './testUtils';
import { incrementDecrement } from '../incrementDecrement';

suite('Tests for Increment/Decrement Emmet Commands', () => {
	teardown(closeAllEditors);

	const contents = `
	hello 123.43 there
	hello 999.9 there
	hello 100 there
	`;

	test('incrementNumberByOne', function (): any {
		return withRandomFileEditor(contents, 'txt', (editor, doc) => {
			editor.selections = [new Selection(1, 7, 1, 10), new Selection(2, 7, 2, 10)];
			return incrementDecrement(1).then(() => {
				assert.equal(doc.getText(), contents.replace('123', '124').replace('999', '1000'));
				return Promise.resolve();
			});
		});
	});

	test('incrementNumberByTen', function (): any {
		return withRandomFileEditor(contents, 'txt', (editor, doc) => {
			editor.selections = [new Selection(1, 7, 1, 10), new Selection(2, 7, 2, 10)];
			return incrementDecrement(10).then(() => {
				assert.equal(doc.getText(), contents.replace('123', '133').replace('999', '1009'));
				return Promise.resolve();
			});
		});
	});

	test('incrementNumberByOneTenth', function (): any {
		return withRandomFileEditor(contents, 'txt', (editor, doc) => {
			editor.selections = [new Selection(1, 7, 1, 13), new Selection(2, 7, 2, 12)];
			return incrementDecrement(0.1).then(() => {
				assert.equal(doc.getText(), contents.replace('123.43', '123.53').replace('999.9', '1000'));
				return Promise.resolve();
			});
		});
	});

	test('decrementNumberByOne', function (): any {
		return withRandomFileEditor(contents, 'txt', (editor, doc) => {
			editor.selections = [new Selection(1, 7, 1, 10), new Selection(3, 7, 3, 10)];
			return incrementDecrement(-1).then(() => {
				assert.equal(doc.getText(), contents.replace('123', '122').replace('100', '99'));
				return Promise.resolve();
			});
		});
	});

	test('decrementNumberByTen', function (): any {
		return withRandomFileEditor(contents, 'txt', (editor, doc) => {
			editor.selections = [new Selection(1, 7, 1, 10), new Selection(3, 7, 3, 10)];
			return incrementDecrement(-10).then(() => {
				assert.equal(doc.getText(), contents.replace('123', '113').replace('100', '90'));
				return Promise.resolve();
			});
		});
	});

	test('decrementNumberByOneTenth', function (): any {
		return withRandomFileEditor(contents, 'txt', (editor, doc) => {
			editor.selections = [new Selection(1, 7, 1, 13), new Selection(3, 7, 3, 10)];
			return incrementDecrement(-0.1).then(() => {
				assert.equal(doc.getText(), contents.replace('123.43', '123.33').replace('100', '99.9'));
				return Promise.resolve();
			});
		});
	});
});