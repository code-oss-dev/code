/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { bufferToStream, newWriteableBufferStream, VSBuffer } from 'vs/base/common/buffer';
import { Lazy } from 'vs/base/common/lazy';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { NullLogService } from 'vs/platform/log/common/log';
import { SingleUseTestCollection } from 'vs/workbench/contrib/testing/common/ownedTestCollection';
import { ITestTaskState, ResolvedTestRunRequest, TestResultItem, TestResultState, TestRunProfileBitset } from 'vs/workbench/contrib/testing/common/testCollection';
import { TestProfileService } from 'vs/workbench/contrib/testing/common/testProfileService';
import { TestId } from 'vs/workbench/contrib/testing/common/testId';
import { HydratedTestResult, LiveOutputController, LiveTestResult, makeEmptyCounts, resultItemParents, TestResultItemChange, TestResultItemChangeReason } from 'vs/workbench/contrib/testing/common/testResult';
import { TestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { InMemoryResultStorage, ITestResultStorage } from 'vs/workbench/contrib/testing/common/testResultStorage';
import { Convert, getInitializedMainTestCollection, TestItemImpl, testStubs } from 'vs/workbench/contrib/testing/common/testStubs';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';

export const emptyOutputController = () => new LiveOutputController(
	new Lazy(() => [newWriteableBufferStream(), Promise.resolve()]),
	() => Promise.resolve(bufferToStream(VSBuffer.alloc(0))),
);

suite('Workbench - Test Results Service', () => {
	const getLabelsIn = (it: Iterable<TestResultItem>) => [...it].map(t => t.item.label).sort();
	const getChangeSummary = () => [...changed]
		.map(c => ({ reason: c.reason, label: c.item.item.label }))
		.sort((a, b) => a.label.localeCompare(b.label));

	let r: TestLiveTestResult;
	let changed = new Set<TestResultItemChange>();
	let tests: SingleUseTestCollection;

	const defaultOpts = (testIds: string[]): ResolvedTestRunRequest => ({
		targets: [{
			profileGroup: TestRunProfileBitset.Run,
			profileId: 0,
			controllerId: 'ctrlId',
			testIds,
		}]
	});

	class TestLiveTestResult extends LiveTestResult {
		public override setAllToState(state: TestResultState, taskId: string, when: (task: ITestTaskState, item: TestResultItem) => boolean) {
			super.setAllToState(state, taskId, when);
		}
	}

	setup(async () => {
		changed = new Set();
		r = new TestLiveTestResult(
			'foo',
			emptyOutputController(),
			true,
			defaultOpts(['id-a']),
		);

		r.onChange(e => changed.add(e));
		r.addTask({ id: 't', name: undefined, running: true });

		tests = testStubs.nested();
		const ok = await Promise.race([
			Promise.resolve(tests.expand(tests.root.id, Infinity)).then(() => true),
			timeout(1000).then(() => false),
		]);

		// todo@connor4312: debug for tests #137853:
		if (!ok) {
			throw new Error('timed out while expanding, diff: ' + JSON.stringify(tests.collectDiff()));
		}


		r.addTestChainToRun('ctrlId', [
			Convert.TestItem.from(tests.root),
			Convert.TestItem.from(tests.root.children.get('id-a') as TestItemImpl),
			Convert.TestItem.from(tests.root.children.get('id-a')!.children.get('id-aa') as TestItemImpl),
		]);

		r.addTestChainToRun('ctrlId', [
			Convert.TestItem.from(tests.root.children.get('id-a') as TestItemImpl),
			Convert.TestItem.from(tests.root.children.get('id-a')!.children.get('id-ab') as TestItemImpl),
		]);
	});

	suite('LiveTestResult', () => {
		test('is empty if no tests are yet present', async () => {
			assert.deepStrictEqual(getLabelsIn(new TestLiveTestResult(
				'foo',
				emptyOutputController(),
				false,
				defaultOpts(['id-a']),
			).tests), []);
		});

		test('initially queues with update', () => {
			assert.deepStrictEqual(getChangeSummary(), [
				{ label: 'a', reason: TestResultItemChangeReason.ComputedStateChange },
				{ label: 'aa', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'ab', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'root', reason: TestResultItemChangeReason.ComputedStateChange },
			]);
		});

		test('initializes with the subtree of requested tests', () => {
			assert.deepStrictEqual(getLabelsIn(r.tests), ['a', 'aa', 'ab', 'root']);
		});

		test('initializes with valid counts', () => {
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestResultState.Queued]: 2,
				[TestResultState.Unset]: 2,
			});
		});

		test('setAllToState', () => {
			changed.clear();
			r.setAllToState(TestResultState.Queued, 't', (_, t) => t.item.label !== 'root');
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestResultState.Unset]: 1,
				[TestResultState.Queued]: 3,
			});

			r.setAllToState(TestResultState.Failed, 't', (_, t) => t.item.label !== 'root');
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestResultState.Unset]: 1,
				[TestResultState.Failed]: 3,
			});

			assert.deepStrictEqual(r.getStateById(new TestId(['ctrlId', 'id-a']).toString())?.ownComputedState, TestResultState.Failed);
			assert.deepStrictEqual(r.getStateById(new TestId(['ctrlId', 'id-a']).toString())?.tasks[0].state, TestResultState.Failed);
			assert.deepStrictEqual(getChangeSummary(), [
				{ label: 'a', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'aa', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'ab', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'root', reason: TestResultItemChangeReason.ComputedStateChange },
			]);
		});

		test('updateState', () => {
			changed.clear();
			r.updateState(new TestId(['ctrlId', 'id-a', 'id-aa']).toString(), 't', TestResultState.Running);
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestResultState.Unset]: 2,
				[TestResultState.Running]: 1,
				[TestResultState.Queued]: 1,
			});
			assert.deepStrictEqual(r.getStateById(new TestId(['ctrlId', 'id-a', 'id-aa']).toString())?.ownComputedState, TestResultState.Running);
			// update computed state:
			assert.deepStrictEqual(r.getStateById(tests.root.id)?.computedState, TestResultState.Running);
			assert.deepStrictEqual(getChangeSummary(), [
				{ label: 'a', reason: TestResultItemChangeReason.ComputedStateChange },
				{ label: 'aa', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'root', reason: TestResultItemChangeReason.ComputedStateChange },
			]);
		});

		test('retire', () => {
			changed.clear();
			r.retire(new TestId(['ctrlId', 'id-a']).toString());
			assert.deepStrictEqual(getChangeSummary(), [
				{ label: 'a', reason: TestResultItemChangeReason.Retired },
				{ label: 'aa', reason: TestResultItemChangeReason.ParentRetired },
				{ label: 'ab', reason: TestResultItemChangeReason.ParentRetired },
			]);

			changed.clear();
			r.retire(new TestId(['ctrlId', 'id-a']).toString());
			assert.strictEqual(changed.size, 0);
		});

		test('ignores outside run', () => {
			changed.clear();
			r.updateState(new TestId(['ctrlId', 'id-b']).toString(), 't', TestResultState.Running);
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestResultState.Queued]: 2,
				[TestResultState.Unset]: 2,
			});
			assert.deepStrictEqual(r.getStateById(new TestId(['ctrlId', 'id-b']).toString()), undefined);
		});

		test('markComplete', () => {
			r.setAllToState(TestResultState.Queued, 't', () => true);
			r.updateState(new TestId(['ctrlId', 'id-a', 'id-aa']).toString(), 't', TestResultState.Passed);
			changed.clear();

			r.markComplete();

			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestResultState.Passed]: 1,
				[TestResultState.Unset]: 3,
			});

			assert.deepStrictEqual(r.getStateById(tests.root.id)?.ownComputedState, TestResultState.Unset);
			assert.deepStrictEqual(r.getStateById(new TestId(['ctrlId', 'id-a', 'id-aa']).toString())?.ownComputedState, TestResultState.Passed);
		});
	});

	suite('service', () => {
		let storage: ITestResultStorage;
		let results: TestResultService;

		class TestTestResultService extends TestResultService {
			override persistScheduler = { schedule: () => this.persistImmediately() } as any;
		}

		setup(() => {
			storage = new InMemoryResultStorage(new TestStorageService(), new NullLogService());
			results = new TestTestResultService(new MockContextKeyService(), storage, new TestProfileService(new MockContextKeyService(), new TestStorageService()));
		});

		test('pushes new result', () => {
			results.push(r);
			assert.deepStrictEqual(results.results, [r]);
		});

		test('serializes and re-hydrates', async () => {
			results.push(r);
			r.updateState(new TestId(['ctrlId', 'id-a', 'id-aa']).toString(), 't', TestResultState.Passed);
			r.markComplete();
			await timeout(10); // allow persistImmediately async to happen

			results = new TestResultService(
				new MockContextKeyService(),
				storage,
				new TestProfileService(new MockContextKeyService(), new TestStorageService()),
			);

			assert.strictEqual(0, results.results.length);
			await timeout(10); // allow load promise to resolve
			assert.strictEqual(1, results.results.length);

			const [rehydrated, actual] = results.getStateById(tests.root.id)!;
			const expected: any = { ...r.getStateById(tests.root.id)! };
			delete expected.tasks[0].duration; // delete undefined props that don't survive serialization
			delete expected.item.range;
			delete expected.item.description;
			expected.item.uri = actual.item.uri;

			assert.deepStrictEqual(actual, { ...expected, src: undefined, retired: true, children: [new TestId(['ctrlId', 'id-a']).toString()] });
			assert.deepStrictEqual(rehydrated.counts, r.counts);
			assert.strictEqual(typeof rehydrated.completedAt, 'number');
		});

		test('clears results but keeps ongoing tests', async () => {
			results.push(r);
			r.markComplete();

			const r2 = results.push(new LiveTestResult(
				'',
				emptyOutputController(),
				false,
				defaultOpts([]),
			));
			results.clear();

			assert.deepStrictEqual(results.results, [r2]);
		});

		test('keeps ongoing tests on top', async () => {
			results.push(r);
			const r2 = results.push(new LiveTestResult(
				'',
				emptyOutputController(),
				false,
				defaultOpts([]),
			));

			assert.deepStrictEqual(results.results, [r2, r]);
			r2.markComplete();
			assert.deepStrictEqual(results.results, [r, r2]);
			r.markComplete();
			assert.deepStrictEqual(results.results, [r, r2]);
		});

		const makeHydrated = async (completedAt = 42, state = TestResultState.Passed) => new HydratedTestResult({
			completedAt,
			id: 'some-id',
			tasks: [{ id: 't', messages: [], name: undefined }],
			name: 'hello world',
			request: defaultOpts([]),
			items: [{
				...(await getInitializedMainTestCollection()).getNodeById(new TestId(['ctrlId', 'id-a']).toString())!,
				tasks: [{ state, duration: 0, messages: [] }],
				computedState: state,
				ownComputedState: state,
				retired: undefined,
				children: [],
			}]
		}, () => Promise.resolve(bufferToStream(VSBuffer.alloc(0))));

		test('pushes hydrated results', async () => {
			results.push(r);
			const hydrated = await makeHydrated();
			results.push(hydrated);
			assert.deepStrictEqual(results.results, [r, hydrated]);
		});

		test('inserts in correct order', async () => {
			results.push(r);
			const hydrated1 = await makeHydrated();
			results.push(hydrated1);
			assert.deepStrictEqual(results.results, [r, hydrated1]);
		});

		test('inserts in correct order 2', async () => {
			results.push(r);
			const hydrated1 = await makeHydrated();
			results.push(hydrated1);
			const hydrated2 = await makeHydrated(30);
			results.push(hydrated2);
			assert.deepStrictEqual(results.results, [r, hydrated1, hydrated2]);
		});
	});

	test('resultItemParents', function () {
		assert.deepStrictEqual([...resultItemParents(r, r.getStateById(new TestId(['ctrlId', 'id-a', 'id-aa']).toString())!)], [
			r.getStateById(new TestId(['ctrlId', 'id-a', 'id-aa']).toString()),
			r.getStateById(new TestId(['ctrlId', 'id-a']).toString()),
			r.getStateById(new TestId(['ctrlId']).toString()),
		]);

		assert.deepStrictEqual([...resultItemParents(r, r.getStateById(tests.root.id)!)], [
			r.getStateById(tests.root.id),
		]);
	});
});
