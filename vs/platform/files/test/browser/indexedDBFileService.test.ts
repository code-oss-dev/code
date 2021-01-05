/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FileService } from 'vs/platform/files/common/fileService';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { FileOperation, FileOperationError, FileOperationEvent, FileOperationResult, FileSystemProviderErrorCode, FileType } from 'vs/platform/files/common/files';
import { NullLogService } from 'vs/platform/log/common/log';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IIndexedDBFileSystemProvider, IndexedDB, INDEXEDDB_LOGS_OBJECT_STORE, INDEXEDDB_USERDATA_OBJECT_STORE } from 'vs/platform/files/browser/indexedDBFileSystemProvider';
import { assertIsDefined } from 'vs/base/common/types';
import { basename, joinPath } from 'vs/base/common/resources';
import { bufferToReadable, bufferToStream, VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';

suite('IndexedDB File Service', function () {

	const logSchema = 'logs';

	let service: FileService;
	let logFileProvider: IIndexedDBFileSystemProvider;
	let userdataFileProvider: IIndexedDBFileSystemProvider;
	const testDir = '/';

	const logfileURIFromPaths = (paths: string[]) => joinPath(URI.from({ scheme: logSchema, path: testDir }), ...paths);
	const userdataURIFromPaths = (paths: readonly string[]) => joinPath(URI.from({ scheme: Schemas.userData, path: testDir }), ...paths);

	const disposables = new DisposableStore();

	const initFixtures = async () => {
		await Promise.all(
			[['fixtures', 'resolver', 'examples'],
			['fixtures', 'resolver', 'other', 'deep'],
			['fixtures', 'service', 'deep'],
			['batched']]
				.map(path => userdataURIFromPaths(path))
				.map(uri => service.createFolder(uri)));
		await Promise.all(
			([
				[['fixtures', 'resolver', 'examples', 'company.js'], 'class company {}'],
				[['fixtures', 'resolver', 'examples', 'conway.js'], 'export function conway() {}'],
				[['fixtures', 'resolver', 'examples', 'employee.js'], 'export const employee = "jax"'],
				[['fixtures', 'resolver', 'examples', 'small.js'], ''],
				[['fixtures', 'resolver', 'other', 'deep', 'company.js'], 'class company {}'],
				[['fixtures', 'resolver', 'other', 'deep', 'conway.js'], 'export function conway() {}'],
				[['fixtures', 'resolver', 'other', 'deep', 'employee.js'], 'export const employee = "jax"'],
				[['fixtures', 'resolver', 'other', 'deep', 'small.js'], ''],
				[['fixtures', 'resolver', 'index.html'], '<p>p</p>'],
				[['fixtures', 'resolver', 'site.css'], '.p {color: red;}'],
				[['fixtures', 'service', 'deep', 'company.js'], 'class company {}'],
				[['fixtures', 'service', 'deep', 'conway.js'], 'export function conway() {}'],
				[['fixtures', 'service', 'deep', 'employee.js'], 'export const employee = "jax"'],
				[['fixtures', 'service', 'deep', 'small.js'], ''],
				[['fixtures', 'service', 'binary.txt'], '<p>p</p>'],
			] as const)
				.map(([path, contents]) => [userdataURIFromPaths(path), contents] as const)
				.map(([uri, contents]) => service.createFile(uri, VSBuffer.fromString(contents)))
		);
	};

	const reload = async () => {
		const logService = new NullLogService();

		service = new FileService(logService);
		disposables.add(service);

		logFileProvider = assertIsDefined(await new IndexedDB().createFileSystemProvider(Schemas.file, INDEXEDDB_LOGS_OBJECT_STORE));
		disposables.add(service.registerProvider(logSchema, logFileProvider));
		disposables.add(logFileProvider);

		userdataFileProvider = assertIsDefined(await new IndexedDB().createFileSystemProvider(logSchema, INDEXEDDB_USERDATA_OBJECT_STORE));
		disposables.add(service.registerProvider(Schemas.userData, userdataFileProvider));
		disposables.add(userdataFileProvider);
	};

	setup(async () => {
		await reload();
	});

	teardown(async () => {
		disposables.clear();
		await logFileProvider.delete(logfileURIFromPaths([]), { recursive: true, useTrash: false });
		await userdataFileProvider.delete(userdataURIFromPaths([]), { recursive: true, useTrash: false });
	});

	test('root is always present', async () => {
		assert.equal((await userdataFileProvider.stat(userdataURIFromPaths([]))).type, FileType.Directory);
		await userdataFileProvider.delete(userdataURIFromPaths([]), { recursive: true, useTrash: false });
		assert.equal((await userdataFileProvider.stat(userdataURIFromPaths([]))).type, FileType.Directory);
	});

	test('createFolder', async () => {
		let event: FileOperationEvent | undefined;
		disposables.add(service.onDidRunOperation(e => event = e));

		const parent = await service.resolve(userdataURIFromPaths([]));
		const newFolderResource = joinPath(parent.resource, 'newFolder');

		assert.equal((await userdataFileProvider.readdir(parent.resource)).length, 0);
		const newFolder = await service.createFolder(newFolderResource);
		assert.equal(newFolder.name, 'newFolder');
		assert.equal((await userdataFileProvider.readdir(parent.resource)).length, 1);
		assert.equal((await userdataFileProvider.stat(newFolderResource)).type, FileType.Directory);

		assert.ok(event);
		assert.equal(event!.resource.path, newFolderResource.path);
		assert.equal(event!.operation, FileOperation.CREATE);
		assert.equal(event!.target!.resource.path, newFolderResource.path);
		assert.equal(event!.target!.isDirectory, true);
	});

	test('createFolder: creating multiple folders at once', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const multiFolderPaths = ['a', 'couple', 'of', 'folders'];
		const parent = await service.resolve(userdataURIFromPaths([]));
		const newFolderResource = joinPath(parent.resource, ...multiFolderPaths);

		const newFolder = await service.createFolder(newFolderResource);

		const lastFolderName = multiFolderPaths[multiFolderPaths.length - 1];
		assert.equal(newFolder.name, lastFolderName);
		assert.equal((await userdataFileProvider.stat(newFolderResource)).type, FileType.Directory);

		assert.ok(event!);
		assert.equal(event!.resource.path, newFolderResource.path);
		assert.equal(event!.operation, FileOperation.CREATE);
		assert.equal(event!.target!.resource.path, newFolderResource.path);
		assert.equal(event!.target!.isDirectory, true);
	});

	test('exists', async () => {
		let exists = await service.exists(userdataURIFromPaths([]));
		assert.equal(exists, true);

		exists = await service.exists(userdataURIFromPaths(['hello']));
		assert.equal(exists, false);
	});

	test('resolve - file', async () => {
		await initFixtures();

		const resource = userdataURIFromPaths(['fixtures', 'resolver', 'index.html']);
		const resolved = await service.resolve(resource);

		assert.equal(resolved.name, 'index.html');
		assert.equal(resolved.isFile, true);
		assert.equal(resolved.isDirectory, false);
		assert.equal(resolved.isSymbolicLink, false);
		assert.equal(resolved.resource.toString(), resource.toString());
		assert.equal(resolved.children, undefined);
		assert.ok(resolved.size! > 0);
	});

	test('resolve - directory', async () => {
		await initFixtures();

		const testsElements = ['examples', 'other', 'index.html', 'site.css'];

		const resource = userdataURIFromPaths(['fixtures', 'resolver']);
		const result = await service.resolve(resource);

		assert.ok(result);
		assert.equal(result.resource.toString(), resource.toString());
		assert.equal(result.name, 'resolver');
		assert.ok(result.children);
		assert.ok(result.children!.length > 0);
		assert.ok(result!.isDirectory);
		assert.equal(result.children!.length, testsElements.length);

		assert.ok(result.children!.every(entry => {
			return testsElements.some(name => {
				return basename(entry.resource) === name;
			});
		}));

		result.children!.forEach(value => {
			assert.ok(basename(value.resource));
			if (['examples', 'other'].indexOf(basename(value.resource)) >= 0) {
				assert.ok(value.isDirectory);
				assert.equal(value.mtime, undefined);
				assert.equal(value.ctime, undefined);
			} else if (basename(value.resource) === 'index.html') {
				assert.ok(!value.isDirectory);
				assert.ok(!value.children);
				assert.equal(value.mtime, undefined);
				assert.equal(value.ctime, undefined);
			} else if (basename(value.resource) === 'site.css') {
				assert.ok(!value.isDirectory);
				assert.ok(!value.children);
				assert.equal(value.mtime, undefined);
				assert.equal(value.ctime, undefined);
			} else {
				assert.ok(!'Unexpected value ' + basename(value.resource));
			}
		});
	});

	test('createFile', async () => {
		return assertCreateFile(contents => VSBuffer.fromString(contents));
	});

	test('createFile (readable)', async () => {
		return assertCreateFile(contents => bufferToReadable(VSBuffer.fromString(contents)));
	});

	test('createFile (stream)', async () => {
		return assertCreateFile(contents => bufferToStream(VSBuffer.fromString(contents)));
	});

	async function assertCreateFile(converter: (content: string) => VSBuffer | VSBufferReadable | VSBufferReadableStream): Promise<void> {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const contents = 'Hello World';
		const resource = userdataURIFromPaths(['test.txt']);

		assert.equal(await service.canCreateFile(resource), true);
		const fileStat = await service.createFile(resource, converter(contents));
		assert.equal(fileStat.name, 'test.txt');
		assert.equal((await userdataFileProvider.stat(fileStat.resource)).type, FileType.File);
		assert.equal(new TextDecoder().decode(await userdataFileProvider.readFile(fileStat.resource)), contents);

		assert.ok(event!);
		assert.equal(event!.resource.path, resource.path);
		assert.equal(event!.operation, FileOperation.CREATE);
		assert.equal(event!.target!.resource.path, resource.path);
	}

	// This may be flakey on build machines. If so please disable and ping me (jackson) and we can try an alternative approach (probably exposing more internal state from the FSP)
	test('createFile (batched)', async () => {
		// Batched writes take approx .5ms/file, sequenced take approx 10ms/file.
		// Testing with 1000 files would take ~10s without batching (exceeds 5s timeout), or 500ms with (well winthin 5s timeout)
		const batch = Array.from({ length: 1000 }).map((_, i) => ({ contents: `Hello${i}`, resource: userdataURIFromPaths(['batched', `Hello${i}.txt`]) }));
		const stats = await Promise.all(batch.map(entry => service.createFile(entry.resource, VSBuffer.fromString(entry.contents))));
		for (let i = 0; i < stats.length; i++) {
			const entry = batch[i];
			const stat = stats[i];
			assert.equal(stat.name, `Hello${i}.txt`);
			assert.equal((await userdataFileProvider.stat(stat.resource)).type, FileType.File);
			assert.equal(new TextDecoder().decode(await userdataFileProvider.readFile(stat.resource)), entry.contents);
		}
		await service.del(userdataURIFromPaths(['batched']), { recursive: true, useTrash: false });
		await Promise.all(stats.map(async stat => {
			const newStat = await userdataFileProvider.stat(stat.resource).catch(e => e.code);
			assert.equal(newStat, FileSystemProviderErrorCode.FileNotFound);
		}));
	});

	test('deleteFile', async () => {
		await initFixtures();

		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const anotherResource = userdataURIFromPaths(['fixtures', 'service', 'deep', 'company.js']);
		const resource = userdataURIFromPaths(['fixtures', 'service', 'deep', 'conway.js']);
		const source = await service.resolve(resource);

		assert.equal(await service.canDelete(source.resource, { useTrash: false }), true);
		await service.del(source.resource, { useTrash: false });

		assert.equal(await service.exists(source.resource), false);
		assert.equal(await service.exists(anotherResource), true);

		assert.ok(event!);
		assert.equal(event!.resource.path, resource.path);
		assert.equal(event!.operation, FileOperation.DELETE);

		{
			let error: Error | undefined = undefined;
			try {
				await service.del(source.resource, { useTrash: false });
			} catch (e) {
				error = e;
			}

			assert.ok(error);
			assert.equal((<FileOperationError>error).fileOperationResult, FileOperationResult.FILE_NOT_FOUND);
		}
		await reload();
		{
			let error: Error | undefined = undefined;
			try {
				await service.del(source.resource, { useTrash: false });
			} catch (e) {
				error = e;
			}

			assert.ok(error);
			assert.equal((<FileOperationError>error).fileOperationResult, FileOperationResult.FILE_NOT_FOUND);
		}
	});

	test('deleteFolder (recursive)', async () => {
		await initFixtures();
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const resource = userdataURIFromPaths(['fixtures', 'service', 'deep']);
		const subResource1 = userdataURIFromPaths(['fixtures', 'service', 'deep', 'company.js']);
		const subResource2 = userdataURIFromPaths(['fixtures', 'service', 'deep', 'conway.js']);
		assert.equal(await service.exists(subResource1), true);
		assert.equal(await service.exists(subResource2), true);

		const source = await service.resolve(resource);

		assert.equal(await service.canDelete(source.resource, { recursive: true, useTrash: false }), true);
		await service.del(source.resource, { recursive: true, useTrash: false });

		assert.equal(await service.exists(source.resource), false);
		assert.equal(await service.exists(subResource1), false);
		assert.equal(await service.exists(subResource2), false);
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, resource.fsPath);
		assert.equal(event!.operation, FileOperation.DELETE);
	});


	test('deleteFolder (non recursive)', async () => {
		await initFixtures();
		const resource = userdataURIFromPaths(['fixtures', 'service', 'deep']);
		const source = await service.resolve(resource);

		assert.ok((await service.canDelete(source.resource)) instanceof Error);

		let error;
		try {
			await service.del(source.resource);
		} catch (e) {
			error = e;
		}
		assert.ok(error);
	});
});
