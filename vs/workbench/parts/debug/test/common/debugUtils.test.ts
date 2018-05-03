/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { formatPII } from 'vs/workbench/parts/debug/common/debugUtils';

suite('Debug - Utils', () => {
	test('formatPII', () => {
		assert.strictEqual(formatPII('Foo Bar', false, {}), 'Foo Bar');
		assert.strictEqual(formatPII('Foo {key} Bar', false, {}), 'Foo {key} Bar');
		assert.strictEqual(formatPII('Foo {key} Bar', false, { 'key': 'yes' }), 'Foo yes Bar');
		assert.strictEqual(formatPII('Foo {_0} Bar {_0}', true, { '_0': 'yes' }), 'Foo yes Bar yes');
		assert.strictEqual(formatPII('Foo {0} Bar {1}{2}', false, { '0': 'yes' }), 'Foo yes Bar {1}{2}');
		assert.strictEqual(formatPII('Foo {0} Bar {1}{2}', false, { '0': 'yes', '1': 'undefined' }), 'Foo yes Bar undefined{2}');
		assert.strictEqual(formatPII('Foo {_key0} Bar {key1}{key2}', true, { '_key0': 'yes', 'key1': '5', 'key2': 'false' }), 'Foo yes Bar {key1}{key2}');
		assert.strictEqual(formatPII('Foo {_key0} Bar {key1}{key2}', false, { '_key0': 'yes', 'key1': '5', 'key2': 'false' }), 'Foo yes Bar 5false');
	});
});
