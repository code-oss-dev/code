/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import os = require('os');
import path = require('path');
import extfs = require('vs/base/node/extfs');
import { getRandomTestPath } from 'vs/workbench/test/workbenchTestServices';
import { writeFileAndFlushSync, mkdirp } from 'vs/base/node/extfs';
import { FileStorage } from 'vs/platform/storage/node/storage';

suite('StorageService', () => {
	const parentDir = getRandomTestPath(os.tmpdir(), 'vsctests', 'storageservice');
	const storageFile = path.join(parentDir, 'storage.json');

	teardown(done => {
		extfs.del(storageFile, os.tmpdir(), done);
	});

	test('Basics', done => {
		return mkdirp(parentDir).then(() => {
			writeFileAndFlushSync(storageFile, '');

			let service = new FileStorage(storageFile);

			service.setItem('some.key', 'some.value');
			assert.equal(service.getItem('some.key'), 'some.value');

			service.removeItem('some.key');
			assert.equal(service.getItem('some.key', 'some.default'), 'some.default');

			assert.ok(!service.getItem('some.unknonw.key'));

			service.setItem('some.other.key', 'some.other.value');

			service = new FileStorage(storageFile);

			assert.equal(service.getItem('some.other.key'), 'some.other.value');

			service.setItem('some.other.key', 'some.other.value');
			assert.equal(service.getItem('some.other.key'), 'some.other.value');

			done();
		});
	});
});