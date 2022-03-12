/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { flakySuite } from 'vs/base/test/common/testUtils';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { TestNativePathService, TestNativeWindowConfiguration } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { TestContextService, TestProductService, TestWorkingCopy } from 'vs/workbench/test/common/workbenchTestServices';
import { WorkingCopyHistoryService } from 'vs/workbench/services/workingCopy/common/workingCopyHistoryService';
import { NullLogService } from 'vs/platform/log/common/log';
import { FileService } from 'vs/platform/files/common/fileService';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { tmpdir } from 'os';
import { join } from 'vs/base/common/path';
import { Promises } from 'vs/base/node/pfs';
import { URI } from 'vs/base/common/uri';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { TestRemoteAgentService } from 'vs/workbench/services/remote/test/common/testServices';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { IWorkingCopyHistoryEntry, IWorkingCopyHistoryEvent } from 'vs/workbench/services/workingCopy/common/workingCopyHistory';
import { IFileService } from 'vs/platform/files/common/files';
import { UriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentityService';
import { LabelService } from 'vs/workbench/services/label/common/labelService';
import { TestLifecycleService, TestWillShutdownEvent } from 'vs/workbench/test/browser/workbenchTestServices';
import { dirname } from 'path';

class TestWorkbenchEnvironmentService extends NativeWorkbenchEnvironmentService {

	constructor(testDir: string) {
		super({ ...TestNativeWindowConfiguration, 'user-data-dir': testDir }, TestProductService);
	}
}

export class TestWorkingCopyHistoryService extends WorkingCopyHistoryService {

	readonly _fileService: IFileService;
	readonly _lifecycleService: TestLifecycleService;

	constructor(testDir: string) {
		const environmentService = new TestWorkbenchEnvironmentService(testDir);
		const logService = new NullLogService();
		const fileService = new FileService(logService);

		const diskFileSystemProvider = new DiskFileSystemProvider(logService);
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		const remoteAgentService = new TestRemoteAgentService();

		const uriIdentityService = new UriIdentityService(fileService);

		const labelService = new LabelService(environmentService, new TestContextService(), new TestNativePathService());

		const lifecycleService = new TestLifecycleService();

		super(fileService, remoteAgentService, environmentService, uriIdentityService, labelService, lifecycleService, logService);

		this._fileService = fileService;
		this._lifecycleService = lifecycleService;
	}
}

flakySuite('WorkingCopyHistoryService', () => {

	let testDir: string;
	let historyHome: string;
	let service: TestWorkingCopyHistoryService;

	let testFile1Path: string;
	let testFile2Path: string;

	const testFile1PathContents = 'Hello Foo';
	const testFile2PathContents = [
		'Lorem ipsum ',
		'dolor öäü sit amet ',
		'adipiscing ßß elit',
		'consectetur '
	].join('');

	setup(async () => {
		testDir = getRandomTestPath(tmpdir(), 'vsctests', 'workingcopyhistoryservice');
		historyHome = join(testDir, 'User', 'History');

		service = new TestWorkingCopyHistoryService(testDir);

		await Promises.mkdir(historyHome, { recursive: true });

		testFile1Path = join(testDir, 'foo.txt');
		testFile2Path = join(testDir, 'bar.txt');

		await Promises.writeFile(testFile1Path, testFile1PathContents);
		await Promises.writeFile(testFile2Path, testFile2PathContents);
	});

	teardown(() => {
		service.dispose();

		return Promises.rm(testDir);
	});

	test('addEntry', async () => {
		let addEvents: IWorkingCopyHistoryEvent[] = [];
		service.onDidAddEntry(e => addEvents.push(e));

		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));
		const workingCopy2 = new TestWorkingCopy(URI.file(testFile2Path));

		// Add Entry works

		const entry1A = await service.addEntry({ workingCopy: workingCopy1 }, CancellationToken.None);
		const entry2A = await service.addEntry({ workingCopy: workingCopy2, source: 'My Source' }, CancellationToken.None);

		assert.ok(entry1A);
		assert.ok(entry2A);

		assert.strictEqual(readFileSync(entry1A.location.fsPath).toString(), testFile1PathContents);
		assert.strictEqual(readFileSync(entry2A.location.fsPath).toString(), testFile2PathContents);

		assert.strictEqual(addEvents.length, 2);
		assert.strictEqual(addEvents[0].entry.workingCopy.resource.toString(), workingCopy1.resource.toString());
		assert.strictEqual(addEvents[1].entry.workingCopy.resource.toString(), workingCopy2.resource.toString());
		assert.strictEqual(addEvents[1].entry.source, 'My Source');

		const entry1B = await service.addEntry({ workingCopy: workingCopy1 }, CancellationToken.None);
		const entry2B = await service.addEntry({ workingCopy: workingCopy2 }, CancellationToken.None);

		assert.ok(entry1B);
		assert.ok(entry2B);

		assert.strictEqual(readFileSync(entry1B.location.fsPath).toString(), testFile1PathContents);
		assert.strictEqual(readFileSync(entry2B.location.fsPath).toString(), testFile2PathContents);

		assert.strictEqual(addEvents.length, 4);
		assert.strictEqual(addEvents[2].entry.workingCopy.resource.toString(), workingCopy1.resource.toString());
		assert.strictEqual(addEvents[3].entry.workingCopy.resource.toString(), workingCopy2.resource.toString());

		// Cancellation works

		const cts = new CancellationTokenSource();
		const entry1CPromise = service.addEntry({ workingCopy: workingCopy1 }, cts.token);
		cts.dispose(true);

		const entry1C = await entry1CPromise;
		assert.ok(!entry1C);

		assert.strictEqual(addEvents.length, 4);

		// Invalid working copies are ignored

		const workingCopy3 = new TestWorkingCopy(URI.file(testFile2Path).with({ scheme: 'unsupported' }));
		const entry3A = await service.addEntry({ workingCopy: workingCopy3 }, CancellationToken.None);
		assert.ok(!entry3A);

		assert.strictEqual(addEvents.length, 4);
	});

	test('getEntries - simple', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));
		const workingCopy2 = new TestWorkingCopy(URI.file(testFile2Path));

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 0);

		const entry1 = await service.addEntry({ workingCopy: workingCopy1, source: 'test-source' }, CancellationToken.None);
		assert.ok(entry1);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry1);

		const entry2 = await service.addEntry({ workingCopy: workingCopy1, source: 'test-source' }, CancellationToken.None);
		assert.ok(entry2);

		entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 2);
		assertEntryEqual(entries[1], entry2);

		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 0);

		const entry3 = await service.addEntry({ workingCopy: workingCopy2, source: 'other-test-source' }, CancellationToken.None);
		assert.ok(entry3);

		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry3);
	});

	test('getEntries - metadata preserved between shutdown', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));
		const workingCopy2 = new TestWorkingCopy(URI.file(testFile2Path));

		const entry1 = await service.addEntry({ workingCopy: workingCopy1, source: 'test-source' }, CancellationToken.None);
		assert.ok(entry1);

		const entry2 = await service.addEntry({ workingCopy: workingCopy2 }, CancellationToken.None);
		assert.ok(entry2);

		const entry3 = await service.addEntry({ workingCopy: workingCopy2, source: 'other-source' }, CancellationToken.None);
		assert.ok(entry3);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry1);

		entries = await service.getEntries(workingCopy2.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 2);
		assertEntryEqual(entries[0], entry2);
		assertEntryEqual(entries[1], entry3);
	});

	test('getEntries - corrupt meta.json is no problem', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		const entry1 = await service.addEntry({ workingCopy: workingCopy1 }, CancellationToken.None);
		assert.ok(entry1);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		const metaFile = join(dirname(entry1.location.fsPath), 'entries.json');
		assert.ok(existsSync(metaFile));
		unlinkSync(metaFile);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry1, false /* skip timestamp that is unreliable when entries.json is gone */);
	});

	test('getEntries - missing entries from meta.json is no problem', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		const entry1 = await service.addEntry({ workingCopy: workingCopy1 }, CancellationToken.None);
		assert.ok(entry1);

		const entry2 = await service.addEntry({ workingCopy: workingCopy1 }, CancellationToken.None);
		assert.ok(entry2);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		unlinkSync(entry1.location.fsPath);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 1);
		assertEntryEqual(entries[0], entry2);
	});

	test('getEntries - in-memory and on-disk entries are merged', async () => {
		const workingCopy1 = new TestWorkingCopy(URI.file(testFile1Path));

		const entry1 = await service.addEntry({ workingCopy: workingCopy1, source: 'test-source' }, CancellationToken.None);
		assert.ok(entry1);

		const entry2 = await service.addEntry({ workingCopy: workingCopy1, source: 'other-source' }, CancellationToken.None);
		assert.ok(entry2);

		// Simulate shutdown
		const event = new TestWillShutdownEvent();
		service._lifecycleService.fireWillShutdown(event);
		await Promise.allSettled(event.value);

		// Resolve from disk fresh and verify again

		service.dispose();
		service = new TestWorkingCopyHistoryService(testDir);

		const entry3 = await service.addEntry({ workingCopy: workingCopy1, source: 'test-source' }, CancellationToken.None);
		assert.ok(entry3);

		const entry4 = await service.addEntry({ workingCopy: workingCopy1, source: 'other-source' }, CancellationToken.None);
		assert.ok(entry4);

		let entries = await service.getEntries(workingCopy1.resource, CancellationToken.None);
		assert.strictEqual(entries.length, 4);
		assertEntryEqual(entries[0], entry1);
		assertEntryEqual(entries[1], entry2);
		assertEntryEqual(entries[2], entry3);
		assertEntryEqual(entries[3], entry4);
	});

	function assertEntryEqual(entryA: IWorkingCopyHistoryEntry, entryB: IWorkingCopyHistoryEntry, assertTimestamp = true): void {
		assert.strictEqual(entryA.id, entryB.id);
		assert.strictEqual(entryA.label, entryB.label);
		assert.strictEqual(entryA.location.toString(), entryB.location.toString());
		if (assertTimestamp) {
			assert.strictEqual(entryA.timestamp, entryB.timestamp);
		}
		assert.strictEqual(entryA.source, entryB.source);
		assert.strictEqual(entryA.workingCopy.name, entryB.workingCopy.name);
		assert.strictEqual(entryA.workingCopy.resource.toString(), entryB.workingCopy.resource.toString());
	}
});
