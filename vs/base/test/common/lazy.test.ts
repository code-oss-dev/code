/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { lazy } from 'vs/base/common/lazy';

suite('Lazy', () => {

	test('lazy values should only be resolved once', () => {
		let counter = 0;
		const value = lazy(() => ++counter);

		assert.strictEqual(value.hasValue(), false);
		assert.strictEqual(value.getValue(), 1);
		assert.strictEqual(value.hasValue(), true);
		assert.strictEqual(value.getValue(), 1); // make sure we did not evaluate again
	});

	test('lazy values handle error case', () => {
		let counter = 0;
		const value = lazy(() => { throw ++counter; });

		assert.strictEqual(value.hasValue(), false);
		assert.throws(() => value.getValue(), 1);
		assert.strictEqual(value.hasValue(), true);
		assert.throws(() => value.getValue(), 1);
	});

	test('map should not cause lazy values to be re-resolved', () => {
		let outer = 0;
		let inner = 10;
		const outerLazy = lazy(() => ++outer);
		const innerLazy = outerLazy.map(x => [x, ++inner]);

		assert.strictEqual(outerLazy.hasValue(), false);
		assert.strictEqual(innerLazy.hasValue(), false);

		assert.deepEqual(innerLazy.getValue(), [1, 11]);
		assert.strictEqual(outerLazy.hasValue(), true);
		assert.strictEqual(innerLazy.hasValue(), true);
		assert.strictEqual(outerLazy.getValue(), 1);

		// make sure we did not evaluate again
		assert.strictEqual(outerLazy.getValue(), 1);
		assert.deepEqual(innerLazy.getValue(), [1, 11]);
	});

	test('map should should handle error values', () => {
		let outer = 0;
		let inner = 10;
		const outerLazy = lazy(() => { throw ++outer; });
		const innerLazy = outerLazy.map(x => { throw ++inner; });

		assert.strictEqual(outerLazy.hasValue(), false);
		assert.strictEqual(innerLazy.hasValue(), false);

		assert.throws(() => innerLazy.getValue(), 1); // we should get result from outer
		assert.strictEqual(outerLazy.hasValue(), true);
		assert.strictEqual(innerLazy.hasValue(), true);
		assert.throws(() => outerLazy.getValue(), 1);
	});
});
