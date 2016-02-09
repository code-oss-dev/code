/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import assert = require('assert');
import foldStrategy = require('vs/editor/contrib/folding/common/indentFoldStrategy');
import {IFoldingRange} from 'vs/editor/contrib/folding/common/foldingRange';
import {Model} from 'vs/editor/common/model/model';

suite('Folding', () => {
	function assertRanges(lines: string[], tabSize: number, expected:IFoldingRange[]): void {
		let model = new Model(lines.join('\n'), null);
		let actual = foldStrategy.computeRanges(model, tabSize);
		actual.sort((r1, r2) => r1.startLineNumber - r2.startLineNumber);
		assert.deepEqual(actual, expected);
		model.dispose();
	}

	function r(startLineNumber: number, endLineNumber: number): IFoldingRange {
		return { startLineNumber, endLineNumber };
	}

	test('t1', () => {
		assertRanges([
			'A',
			'  A',
			'  A',
			'  A'
		], 4, [r(1, 4)]);
	});

	test('t2', () => {
		assertRanges([
			'A',
			'  A',
			'  A',
			'    A',
			'    A'
		], 4, [r(1, 5), r(3, 5)] );
	});

	test('t3', () => {
		assertRanges([
			'A',
			'  A',
			'    A',
			'      A',
			'A'
		], 4, [r(1, 4), r(2, 4), r(3, 4)] );
	});

	test('t4', () => {
		assertRanges([
			'    A',
			'  A',
			'A'
		], 4, [] );
	});

	test('Javadoc', () => {
		assertRanges([
			'/**',
			' * Comment',
			' */',
			'class A {',
			'  void foo() {',
			'  }',
			'}',
		], 4, [r(1, 3), r(4, 6)] );
	});


})