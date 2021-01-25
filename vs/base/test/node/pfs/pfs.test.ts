/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'vs/base/common/path';
import { generateUuid } from 'vs/base/common/uuid';
import { copy, exists, mkdirp, move, readdir, readDirsInDir, readdirWithFileTypes, readFile, renameIgnoreError, rimraf, RimRafMode, rimrafSync, statLink, writeFile, writeFileSync } from 'vs/base/node/pfs';
import { timeout } from 'vs/base/common/async';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { isWindows } from 'vs/base/common/platform';
import { canNormalize } from 'vs/base/common/normalization';
import { VSBuffer } from 'vs/base/common/buffer';
import { flakySuite, getRandomTestPath } from 'vs/base/test/node/testUtils';

flakySuite('PFS', function () {

	let testDir: string;

	setup(() => {
		testDir = getRandomTestPath(tmpdir(), 'vsctests', 'pfs');

		return mkdirp(testDir, 493);
	});

	teardown(() => {
		return rimraf(testDir);
	});

	test('writeFile', async () => {
		const testFile = join(testDir, 'writefile.txt');

		assert.ok(!(await exists(testFile)));

		await writeFile(testFile, 'Hello World', (null!));

		assert.strictEqual((await readFile(testFile)).toString(), 'Hello World');
	});

	test('writeFile - parallel write on different files works', async () => {
		const testFile1 = join(testDir, 'writefile1.txt');
		const testFile2 = join(testDir, 'writefile2.txt');
		const testFile3 = join(testDir, 'writefile3.txt');
		const testFile4 = join(testDir, 'writefile4.txt');
		const testFile5 = join(testDir, 'writefile5.txt');

		await Promise.all([
			writeFile(testFile1, 'Hello World 1', (null!)),
			writeFile(testFile2, 'Hello World 2', (null!)),
			writeFile(testFile3, 'Hello World 3', (null!)),
			writeFile(testFile4, 'Hello World 4', (null!)),
			writeFile(testFile5, 'Hello World 5', (null!))
		]);
		assert.strictEqual(fs.readFileSync(testFile1).toString(), 'Hello World 1');
		assert.strictEqual(fs.readFileSync(testFile2).toString(), 'Hello World 2');
		assert.strictEqual(fs.readFileSync(testFile3).toString(), 'Hello World 3');
		assert.strictEqual(fs.readFileSync(testFile4).toString(), 'Hello World 4');
		assert.strictEqual(fs.readFileSync(testFile5).toString(), 'Hello World 5');
	});

	test('writeFile - parallel write on same files works and is sequentalized', async () => {
		const testFile = join(testDir, 'writefile.txt');

		await Promise.all([
			writeFile(testFile, 'Hello World 1', undefined),
			writeFile(testFile, 'Hello World 2', undefined),
			timeout(10).then(() => writeFile(testFile, 'Hello World 3', undefined)),
			writeFile(testFile, 'Hello World 4', undefined),
			timeout(10).then(() => writeFile(testFile, 'Hello World 5', undefined))
		]);
		assert.strictEqual(fs.readFileSync(testFile).toString(), 'Hello World 5');
	});

	test('rimraf - simple - unlink', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		await rimraf(testDir);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - simple - move', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		await rimraf(testDir, RimRafMode.MOVE);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - recursive folder structure - unlink', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');
		fs.mkdirSync(join(testDir, 'somefolder'));
		fs.writeFileSync(join(testDir, 'somefolder', 'somefile.txt'), 'Contents');

		await rimraf(testDir);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - recursive folder structure - move', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');
		fs.mkdirSync(join(testDir, 'somefolder'));
		fs.writeFileSync(join(testDir, 'somefolder', 'somefile.txt'), 'Contents');

		await rimraf(testDir, RimRafMode.MOVE);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - simple ends with dot - move', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		await rimraf(testDir, RimRafMode.MOVE);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - simple ends with dot slash/backslash - move', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		await rimraf(`${testDir}${sep}`, RimRafMode.MOVE);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimrafSync - swallows file not found error', function () {
		const nonExistingDir = join(testDir, 'not-existing');
		rimrafSync(nonExistingDir);

		assert.ok(!fs.existsSync(nonExistingDir));
	});

	test('rimrafSync - simple', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		rimrafSync(testDir);

		assert.ok(!fs.existsSync(testDir));
	});

	test('rimrafSync - recursive folder structure', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		fs.mkdirSync(join(testDir, 'somefolder'));
		fs.writeFileSync(join(testDir, 'somefolder', 'somefile.txt'), 'Contents');

		rimrafSync(testDir);

		assert.ok(!fs.existsSync(testDir));
	});

	test('moveIgnoreError', () => {
		return renameIgnoreError(join(testDir, 'foo'), join(testDir, 'bar'));
	});

	test('copy, move and delete', async () => {
		const id = generateUuid();
		const id2 = generateUuid();
		const sourceDir = getPathFromAmdModule(require, './fixtures');
		const parentDir = join(tmpdir(), 'vsctests', 'pfs');
		const targetDir = join(parentDir, id);
		const targetDir2 = join(parentDir, id2);

		await copy(sourceDir, targetDir);

		assert.ok(fs.existsSync(targetDir));
		assert.ok(fs.existsSync(join(targetDir, 'index.html')));
		assert.ok(fs.existsSync(join(targetDir, 'site.css')));
		assert.ok(fs.existsSync(join(targetDir, 'examples')));
		assert.ok(fs.statSync(join(targetDir, 'examples')).isDirectory());
		assert.ok(fs.existsSync(join(targetDir, 'examples', 'small.jxs')));

		await move(targetDir, targetDir2);

		assert.ok(!fs.existsSync(targetDir));
		assert.ok(fs.existsSync(targetDir2));
		assert.ok(fs.existsSync(join(targetDir2, 'index.html')));
		assert.ok(fs.existsSync(join(targetDir2, 'site.css')));
		assert.ok(fs.existsSync(join(targetDir2, 'examples')));
		assert.ok(fs.statSync(join(targetDir2, 'examples')).isDirectory());
		assert.ok(fs.existsSync(join(targetDir2, 'examples', 'small.jxs')));

		await move(join(targetDir2, 'index.html'), join(targetDir2, 'index_moved.html'));

		assert.ok(!fs.existsSync(join(targetDir2, 'index.html')));
		assert.ok(fs.existsSync(join(targetDir2, 'index_moved.html')));

		await rimraf(parentDir);

		assert.ok(!fs.existsSync(parentDir));
	});

	(isWindows ? test.skip : test)('copy skips over dangling symbolic links', async () => { // Symlinks are not the same on win, and we can not create them programmatically without admin privileges
		const id1 = generateUuid();
		const symbolicLinkTarget = join(testDir, id1);

		const id2 = generateUuid();
		const symbolicLink = join(testDir, id2);

		const id3 = generateUuid();
		const copyTarget = join(testDir, id3);

		await mkdirp(symbolicLinkTarget, 493);

		fs.symlinkSync(symbolicLinkTarget, symbolicLink);

		await rimraf(symbolicLinkTarget);

		await copy(symbolicLink, copyTarget); // this should not throw

		assert.ok(!fs.existsSync(copyTarget));
	});

	test('mkdirp', async () => {
		const newDir = join(testDir, generateUuid());

		await mkdirp(newDir, 493);

		assert.ok(fs.existsSync(newDir));
	});

	test('readDirsInDir', async () => {
		fs.mkdirSync(join(testDir, 'somefolder1'));
		fs.mkdirSync(join(testDir, 'somefolder2'));
		fs.mkdirSync(join(testDir, 'somefolder3'));
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		const result = await readDirsInDir(testDir);
		assert.strictEqual(result.length, 3);
		assert.ok(result.indexOf('somefolder1') !== -1);
		assert.ok(result.indexOf('somefolder2') !== -1);
		assert.ok(result.indexOf('somefolder3') !== -1);
	});

	(isWindows ? test.skip : test)('stat link', async () => { // Symlinks are not the same on win, and we can not create them programmatically without admin privileges
		const id1 = generateUuid();
		const directory = join(testDir, id1);

		const id2 = generateUuid();
		const symbolicLink = join(testDir, id2);

		await mkdirp(directory, 493);

		fs.symlinkSync(directory, symbolicLink);

		let statAndIsLink = await statLink(directory);
		assert.ok(!statAndIsLink?.symbolicLink);

		statAndIsLink = await statLink(symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink);
		assert.ok(!statAndIsLink?.symbolicLink?.dangling);
	});

	(isWindows ? test.skip : test)('stat link (non existing target)', async () => { // Symlinks are not the same on win, and we can not create them programmatically without admin privileges
		const id1 = generateUuid();
		const directory = join(testDir, id1);

		const id2 = generateUuid();
		const symbolicLink = join(testDir, id2);

		await mkdirp(directory, 493);

		fs.symlinkSync(directory, symbolicLink);

		await rimraf(directory);

		const statAndIsLink = await statLink(symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink?.dangling);
	});

	test('readdir', async () => {
		if (canNormalize && typeof process.versions['electron'] !== 'undefined' /* needs electron */) {
			const id = generateUuid();
			const newDir = join(testDir, 'pfs', id, 'öäü');

			await mkdirp(newDir, 493);

			assert.ok(fs.existsSync(newDir));

			const children = await readdir(join(testDir, 'pfs', id));
			assert.strictEqual(children.some(n => n === 'öäü'), true); // Mac always converts to NFD, so
		}
	});

	test('readdirWithFileTypes', async () => {
		if (canNormalize && typeof process.versions['electron'] !== 'undefined' /* needs electron */) {
			const newDir = join(testDir, 'öäü');
			await mkdirp(newDir, 493);

			await writeFile(join(testDir, 'somefile.txt'), 'contents');

			assert.ok(fs.existsSync(newDir));

			const children = await readdirWithFileTypes(testDir);

			assert.strictEqual(children.some(n => n.name === 'öäü'), true); // Mac always converts to NFD, so
			assert.strictEqual(children.some(n => n.isDirectory()), true);

			assert.strictEqual(children.some(n => n.name === 'somefile.txt'), true);
			assert.strictEqual(children.some(n => n.isFile()), true);
		}
	});

	test('writeFile (string)', async () => {
		const smallData = 'Hello World';
		const bigData = (new Array(100 * 1024)).join('Large String\n');

		return testWriteFileAndFlush(smallData, smallData, bigData, bigData);
	});

	test('writeFile (Buffer)', async () => {
		const smallData = 'Hello World';
		const bigData = (new Array(100 * 1024)).join('Large String\n');

		return testWriteFileAndFlush(Buffer.from(smallData), smallData, Buffer.from(bigData), bigData);
	});

	test('writeFile (UInt8Array)', async () => {
		const smallData = 'Hello World';
		const bigData = (new Array(100 * 1024)).join('Large String\n');

		return testWriteFileAndFlush(VSBuffer.fromString(smallData).buffer, smallData, VSBuffer.fromString(bigData).buffer, bigData);
	});

	async function testWriteFileAndFlush(
		smallData: string | Buffer | Uint8Array,
		smallDataValue: string,
		bigData: string | Buffer | Uint8Array,
		bigDataValue: string
	): Promise<void> {
		const testFile = join(testDir, 'flushed.txt');

		assert.ok(fs.existsSync(testDir));

		await writeFile(testFile, smallData);
		assert.strictEqual(fs.readFileSync(testFile).toString(), smallDataValue);

		await writeFile(testFile, bigData);
		assert.strictEqual(fs.readFileSync(testFile).toString(), bigDataValue);
	}

	test('writeFile (string, error handling)', async () => {
		const testFile = join(testDir, 'flushed.txt');

		fs.mkdirSync(testFile); // this will trigger an error later because testFile is now a directory!

		let expectedError: Error | undefined;
		try {
			await writeFile(testFile, 'Hello World');
		} catch (error) {
			expectedError = error;
		}

		assert.ok(expectedError);
	});

	test('writeFileSync', async () => {
		const testFile = join(testDir, 'flushed.txt');

		writeFileSync(testFile, 'Hello World');
		assert.strictEqual(fs.readFileSync(testFile).toString(), 'Hello World');

		const largeString = (new Array(100 * 1024)).join('Large String\n');

		writeFileSync(testFile, largeString);
		assert.strictEqual(fs.readFileSync(testFile).toString(), largeString);
	});
});
