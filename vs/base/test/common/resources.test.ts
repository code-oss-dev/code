/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import URI from 'vs/base/common/uri';
import { distinctParents } from 'vs/base/common/resources';

suite('Resources', () => {

	test('distinctParents', () => {

		// Basic
		let resources = [
			URI.file('/some/folderA/file.txt'),
			URI.file('/some/folderB/file.txt'),
			URI.file('/some/folderC/file.txt')
		];

		let distinct = distinctParents(resources, r => r);
		assert.equal(distinct.length, 3);
		assert.equal(distinct[0].toString(), resources[0].toString());
		assert.equal(distinct[1].toString(), resources[1].toString());
		assert.equal(distinct[2].toString(), resources[2].toString());

		// Parent / Child
		resources = [
			URI.file('/some/folderA'),
			URI.file('/some/folderA/file.txt'),
			URI.file('/some/folderA/child/file.txt'),
			URI.file('/some/folderA2/file.txt'),
			URI.file('/some/file.txt')
		];

		distinct = distinctParents(resources, r => r);
		assert.equal(distinct.length, 3);
		assert.equal(distinct[0].toString(), resources[0].toString());
		assert.equal(distinct[1].toString(), resources[3].toString());
		assert.equal(distinct[2].toString(), resources[4].toString());
	});
});