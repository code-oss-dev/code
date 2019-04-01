/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FileService2 } from 'vs/workbench/services/files2/common/fileService2';
import { URI } from 'vs/base/common/uri';
import { IFileSystemProviderRegistrationEvent, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { NullFileSystemProvider } from 'vs/workbench/test/workbenchTestServices';
import { NullLogService } from 'vs/platform/log/common/log';
import { timeout } from 'vs/base/common/async';

suite('File Service 2', () => {

	test('provider registration', async () => {
		const service = new FileService2(new NullLogService());
		const resource = URI.parse('test://foo/bar');

		assert.equal(service.canHandleResource(resource), false);

		const registrations: IFileSystemProviderRegistrationEvent[] = [];
		service.onDidChangeFileSystemProviderRegistrations(e => {
			registrations.push(e);
		});

		let registrationDisposable: IDisposable | undefined = undefined;
		let callCount = 0;
		service.onWillActivateFileSystemProvider(e => {
			callCount++;

			if (e.scheme === 'test' && callCount === 1) {
				e.join(new Promise(resolve => {
					registrationDisposable = service.registerProvider('test', new NullFileSystemProvider());

					resolve();
				}));
			}
		});

		await service.activateProvider('test');

		assert.equal(service.canHandleResource(resource), true);

		assert.equal(registrations.length, 1);
		assert.equal(registrations[0].scheme, 'test');
		assert.equal(registrations[0].added, true);
		assert.ok(registrationDisposable);

		await service.activateProvider('test');
		assert.equal(callCount, 2); // activation is called again

		assert.equal(await service.hasCapability(resource, FileSystemProviderCapabilities.Readonly), true);
		assert.equal(await service.hasCapability(resource, FileSystemProviderCapabilities.FileOpenReadWriteClose), false);

		registrationDisposable!.dispose();

		assert.equal(service.canHandleResource(resource), false);

		assert.equal(registrations.length, 2);
		assert.equal(registrations[1].scheme, 'test');
		assert.equal(registrations[1].added, false);
	});

	test('watch', async () => {
		const service = new FileService2(new NullLogService());

		let disposeCounter = 0;
		service.registerProvider('test', new NullFileSystemProvider(() => {
			return toDisposable(() => {
				disposeCounter++;
			});
		}));
		await service.activateProvider('test');

		const resource1 = URI.parse('test://foo/bar1');
		const watcher1Disposable = service.watch(resource1);

		await timeout(0); // service.watch() is async
		assert.equal(disposeCounter, 0);
		watcher1Disposable.dispose();
		assert.equal(disposeCounter, 1);

		disposeCounter = 0;
		const resource2 = URI.parse('test://foo/bar2');
		const watcher2Disposable1 = service.watch(resource2);
		const watcher2Disposable2 = service.watch(resource2);
		const watcher2Disposable3 = service.watch(resource2);

		await timeout(0); // service.watch() is async
		assert.equal(disposeCounter, 0);
		watcher2Disposable1.dispose();
		assert.equal(disposeCounter, 0);
		watcher2Disposable2.dispose();
		assert.equal(disposeCounter, 0);
		watcher2Disposable3.dispose();
		assert.equal(disposeCounter, 1);

		disposeCounter = 0;
		const resource3 = URI.parse('test://foo/bar3');
		const watcher3Disposable1 = service.watch(resource3);
		const watcher3Disposable2 = service.watch(resource3, { recursive: true, excludes: [] });

		await timeout(0); // service.watch() is async
		assert.equal(disposeCounter, 0);
		watcher3Disposable1.dispose();
		assert.equal(disposeCounter, 1);
		watcher3Disposable2.dispose();
		assert.equal(disposeCounter, 2);
	});
});