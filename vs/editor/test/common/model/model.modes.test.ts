/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IDisposable } from 'vs/base/common/lifecycle';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { TextModel } from 'vs/editor/common/model/textModel';
import * as languages from 'vs/editor/common/languages';
import { NullState } from 'vs/editor/common/languages/nullTokenize';
import { createTextModel } from 'vs/editor/test/common/testTextModel';

// --------- utils

suite('Editor Model - Model Modes 1', () => {

	let calledFor: string[] = [];

	function checkAndClear(arr: string[]) {
		assert.deepStrictEqual(calledFor, arr);
		calledFor = [];
	}

	const tokenizationSupport: languages.ITokenizationSupport = {
		getInitialState: () => NullState,
		tokenize: undefined!,
		tokenizeEncoded: (line: string, hasEOL: boolean, state: languages.IState): languages.EncodedTokenizationResult => {
			calledFor.push(line.charAt(0));
			return new languages.EncodedTokenizationResult(new Uint32Array(0), state);
		}
	};

	let thisModel: TextModel;
	let languageRegistration: IDisposable;

	setup(() => {
		const TEXT =
			'1\r\n' +
			'2\n' +
			'3\n' +
			'4\r\n' +
			'5';
		const LANGUAGE_ID = 'modelModeTest1';
		calledFor = [];
		languageRegistration = languages.TokenizationRegistry.register(LANGUAGE_ID, tokenizationSupport);
		thisModel = createTextModel(TEXT, LANGUAGE_ID);
	});

	teardown(() => {
		thisModel.dispose();
		languageRegistration.dispose();
		calledFor = [];
	});

	test('model calls syntax highlighter 1', () => {
		thisModel.tokenization.forceTokenization(1);
		checkAndClear(['1']);
	});

	test('model calls syntax highlighter 2', () => {
		thisModel.tokenization.forceTokenization(2);
		checkAndClear(['1', '2']);

		thisModel.tokenization.forceTokenization(2);
		checkAndClear([]);
	});

	test('model caches states', () => {
		thisModel.tokenization.forceTokenization(1);
		checkAndClear(['1']);

		thisModel.tokenization.forceTokenization(2);
		checkAndClear(['2']);

		thisModel.tokenization.forceTokenization(3);
		checkAndClear(['3']);

		thisModel.tokenization.forceTokenization(4);
		checkAndClear(['4']);

		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['5']);

		thisModel.tokenization.forceTokenization(5);
		checkAndClear([]);
	});

	test('model invalidates states for one line insert', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['1', '2', '3', '4', '5']);

		thisModel.applyEdits([EditOperation.insert(new Position(1, 1), '-')]);
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['-']);

		thisModel.tokenization.forceTokenization(5);
		checkAndClear([]);
	});

	test('model invalidates states for many lines insert', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['1', '2', '3', '4', '5']);

		thisModel.applyEdits([EditOperation.insert(new Position(1, 1), '0\n-\n+')]);
		assert.strictEqual(thisModel.getLineCount(), 7);
		thisModel.tokenization.forceTokenization(7);
		checkAndClear(['0', '-', '+']);

		thisModel.tokenization.forceTokenization(7);
		checkAndClear([]);
	});

	test('model invalidates states for one new line', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['1', '2', '3', '4', '5']);

		thisModel.applyEdits([EditOperation.insert(new Position(1, 2), '\n')]);
		thisModel.applyEdits([EditOperation.insert(new Position(2, 1), 'a')]);
		thisModel.tokenization.forceTokenization(6);
		checkAndClear(['1', 'a']);
	});

	test('model invalidates states for one line delete', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['1', '2', '3', '4', '5']);

		thisModel.applyEdits([EditOperation.insert(new Position(1, 2), '-')]);
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['1']);

		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 1, 2))]);
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['-']);

		thisModel.tokenization.forceTokenization(5);
		checkAndClear([]);
	});

	test('model invalidates states for many lines delete', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['1', '2', '3', '4', '5']);

		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 3, 1))]);
		thisModel.tokenization.forceTokenization(3);
		checkAndClear(['3']);

		thisModel.tokenization.forceTokenization(3);
		checkAndClear([]);
	});
});

suite('Editor Model - Model Modes 2', () => {

	class ModelState2 implements languages.IState {
		prevLineContent: string;

		constructor(prevLineContent: string) {
			this.prevLineContent = prevLineContent;
		}

		clone(): languages.IState {
			return new ModelState2(this.prevLineContent);
		}

		equals(other: languages.IState): boolean {
			return (other instanceof ModelState2) && other.prevLineContent === this.prevLineContent;
		}
	}

	let calledFor: string[] = [];

	function checkAndClear(arr: string[]): void {
		assert.deepStrictEqual(calledFor, arr);
		calledFor = [];
	}

	const tokenizationSupport: languages.ITokenizationSupport = {
		getInitialState: () => new ModelState2(''),
		tokenize: undefined!,
		tokenizeEncoded: (line: string, hasEOL: boolean, state: languages.IState): languages.EncodedTokenizationResult => {
			calledFor.push(line);
			(<ModelState2>state).prevLineContent = line;
			return new languages.EncodedTokenizationResult(new Uint32Array(0), state);
		}
	};

	let thisModel: TextModel;
	let languageRegistration: IDisposable;

	setup(() => {
		const TEXT =
			'Line1' + '\r\n' +
			'Line2' + '\n' +
			'Line3' + '\n' +
			'Line4' + '\r\n' +
			'Line5';
		const LANGUAGE_ID = 'modelModeTest2';
		languageRegistration = languages.TokenizationRegistry.register(LANGUAGE_ID, tokenizationSupport);
		thisModel = createTextModel(TEXT, LANGUAGE_ID);
	});

	teardown(() => {
		thisModel.dispose();
		languageRegistration.dispose();
	});

	test('getTokensForInvalidLines one text insert', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['Line1', 'Line2', 'Line3', 'Line4', 'Line5']);
		thisModel.applyEdits([EditOperation.insert(new Position(1, 6), '-')]);
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['Line1-', 'Line2']);
	});

	test('getTokensForInvalidLines two text insert', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['Line1', 'Line2', 'Line3', 'Line4', 'Line5']);
		thisModel.applyEdits([
			EditOperation.insert(new Position(1, 6), '-'),
			EditOperation.insert(new Position(3, 6), '-')
		]);

		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['Line1-', 'Line2', 'Line3-', 'Line4']);
	});

	test('getTokensForInvalidLines one multi-line text insert, one small text insert', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['Line1', 'Line2', 'Line3', 'Line4', 'Line5']);
		thisModel.applyEdits([EditOperation.insert(new Position(1, 6), '\nNew line\nAnother new line')]);
		thisModel.applyEdits([EditOperation.insert(new Position(5, 6), '-')]);
		thisModel.tokenization.forceTokenization(7);
		checkAndClear(['Line1', 'New line', 'Another new line', 'Line2', 'Line3-', 'Line4']);
	});

	test('getTokensForInvalidLines one delete text', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['Line1', 'Line2', 'Line3', 'Line4', 'Line5']);
		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 1, 5))]);
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['1', 'Line2']);
	});

	test('getTokensForInvalidLines one line delete text', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['Line1', 'Line2', 'Line3', 'Line4', 'Line5']);
		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 2, 1))]);
		thisModel.tokenization.forceTokenization(4);
		checkAndClear(['Line2']);
	});

	test('getTokensForInvalidLines multiple lines delete text', () => {
		thisModel.tokenization.forceTokenization(5);
		checkAndClear(['Line1', 'Line2', 'Line3', 'Line4', 'Line5']);
		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 3, 3))]);
		thisModel.tokenization.forceTokenization(3);
		checkAndClear(['ne3', 'Line4']);
	});
});
