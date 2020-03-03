/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Iterator, Iterable } from 'vs/base/common/iterator';

suite('Iterator', () => {
	test('concat', () => {
		const first = Iterator.fromArray([1, 2, 3]);
		const second = Iterator.fromArray([4, 5, 6]);
		const third = Iterator.fromArray([7, 8, 9]);
		const actualIterator = Iterator.concat(first, second, third);
		const actual = Iterator.collect(actualIterator);

		assert.deepEqual(actual, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});
});

suite('Iterable', function () {

	const customIterable = new class {

		*[Symbol.iterator]() {
			yield 'one';
			yield 'two';
			yield 'three';
		}
	};

	test('first', function () {

		assert.equal(Iterable.first([]), undefined);
		assert.equal(Iterable.first([1]), 1);
		assert.equal(Iterable.first(customIterable), 'one');
		assert.equal(Iterable.first(customIterable), 'one'); // fresh
	});

});
