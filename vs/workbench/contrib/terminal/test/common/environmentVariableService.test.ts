/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { TestExtensionService, TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { EnvironmentVariableService } from 'vs/workbench/contrib/terminal/common/environmentVariableService';
import { EnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableCollection';
import { EnvironmentVariableMutatorType } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { Emitter } from 'vs/base/common/event';
import { IProcessEnvironment } from 'vs/base/common/platform';

class TestEnvironmentVariableService extends EnvironmentVariableService {
	persistCollections(): void { this._persistCollections(); }
	notifyCollectionUpdates(): void { this._notifyCollectionUpdates(); }
}

suite('EnvironmentVariable - EnvironmentVariableService', () => {
	let instantiationService: TestInstantiationService;
	let environmentVariableService: TestEnvironmentVariableService;
	let storageService: TestStorageService;
	let changeExtensionsEvent: Emitter<void>;

	setup(() => {
		changeExtensionsEvent = new Emitter<void>();

		instantiationService = new TestInstantiationService();
		instantiationService.stub(IExtensionService, TestExtensionService);
		storageService = new TestStorageService();
		instantiationService.stub(IStorageService, storageService);
		instantiationService.stub(IExtensionService, TestExtensionService);
		instantiationService.stub(IExtensionService, 'onDidChangeExtensions', changeExtensionsEvent.event);

		environmentVariableService = instantiationService.createInstance(TestEnvironmentVariableService);
	});

	test('should persist collections to the storage service and be able to restore from them', () => {
		const collection = new EnvironmentVariableCollection();
		collection.entries.set('A', { value: 'a', type: EnvironmentVariableMutatorType.Replace });
		collection.entries.set('B', { value: 'b', type: EnvironmentVariableMutatorType.Append });
		collection.entries.set('C', { value: 'c', type: EnvironmentVariableMutatorType.Prepend });
		environmentVariableService.set('ext', collection);
		deepStrictEqual([...environmentVariableService.mergedCollection.entries.entries()], [
			['A', { type: EnvironmentVariableMutatorType.Replace, value: 'a' }],
			['B', { type: EnvironmentVariableMutatorType.Append, value: 'b' }],
			['C', { type: EnvironmentVariableMutatorType.Prepend, value: 'c' }]
		]);

		// Persist with old service, create a new service with the same storage service to verify restore
		environmentVariableService.persistCollections();
		const service2: TestEnvironmentVariableService = instantiationService.createInstance(TestEnvironmentVariableService);
		deepStrictEqual([...service2.mergedCollection.entries.entries()], [
			['A', { type: EnvironmentVariableMutatorType.Replace, value: 'a' }],
			['B', { type: EnvironmentVariableMutatorType.Append, value: 'b' }],
			['C', { type: EnvironmentVariableMutatorType.Prepend, value: 'c' }]
		]);
	});

	suite('Merged collection', () => {
		test('should overwrite any other variable with the first extension that replaces', () => {
			const collection1 = new EnvironmentVariableCollection();
			const collection2 = new EnvironmentVariableCollection();
			const collection3 = new EnvironmentVariableCollection();
			collection1.entries.set('A', { value: 'a1', type: EnvironmentVariableMutatorType.Replace });
			collection1.entries.set('B', { value: 'b1', type: EnvironmentVariableMutatorType.Replace });
			collection2.entries.set('A', { value: 'a2', type: EnvironmentVariableMutatorType.Replace });
			collection2.entries.set('B', { value: 'b2', type: EnvironmentVariableMutatorType.Append });
			collection3.entries.set('A', { value: 'a3', type: EnvironmentVariableMutatorType.Prepend });
			collection3.entries.set('B', { value: 'b3', type: EnvironmentVariableMutatorType.Replace });
			environmentVariableService.set('ext1', collection1);
			environmentVariableService.set('ext2', collection2);
			environmentVariableService.set('ext3', collection3);
			deepStrictEqual([...environmentVariableService.mergedCollection.entries.entries()], [
				['A', { type: EnvironmentVariableMutatorType.Replace, value: 'a1' }],
				['B', { type: EnvironmentVariableMutatorType.Replace, value: 'b1' }]
			]);
		});

		test('should correctly apply the environment values from multiple extension contributions in the correct order', () => {
			const collection1 = new EnvironmentVariableCollection();
			const collection2 = new EnvironmentVariableCollection();
			const collection3 = new EnvironmentVariableCollection();
			collection1.entries.set('PATH', { value: ':a1', type: EnvironmentVariableMutatorType.Append });
			collection2.entries.set('PATH', { value: 'a2:', type: EnvironmentVariableMutatorType.Prepend });
			collection3.entries.set('PATH', { value: 'a3', type: EnvironmentVariableMutatorType.Replace });
			environmentVariableService.set('ext1', collection1);
			environmentVariableService.set('ext2', collection2);
			environmentVariableService.set('ext3', collection3);

			// The entries should be ordered in the order they are applied
			deepStrictEqual([...environmentVariableService.mergedCollection.entries.entries()], [
				['PATH', [
					{ type: EnvironmentVariableMutatorType.Replace, value: 'a3' },
					{ type: EnvironmentVariableMutatorType.Prepend, value: 'a2:' },
					{ type: EnvironmentVariableMutatorType.Append, value: ':a1' }
				]]
			]);

			// Verify the entries get applied to the environment as expected
			const env: IProcessEnvironment = { A: 'foo' };
			environmentVariableService.mergedCollection.applyToProcessEnvironment(env);
			deepStrictEqual(env, { A: 'a2:a3:a1' });
		});
	});
});
