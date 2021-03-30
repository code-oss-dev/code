/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString } from 'vs/base/common/htmlContent';
import { URI } from 'vs/base/common/uri';
import { IRange, Range } from 'vs/editor/common/core/range';
import { ExtHostTestingResource } from 'vs/workbench/api/common/extHost.protocol';
import { TestMessageSeverity, TestResult } from 'vs/workbench/api/common/extHostTypes';

export interface TestIdWithSrc {
	testId: string;
	src: { provider: string; tree: number };
}

/**
 * Defines the path to a test, as a list of test IDs. The last element of the
 * array is the test ID, and the predecessors are its parents, in order.
 */
export type TestIdPath = string[];

/**
 * Request to the main thread to run a set of tests.
 */
export interface RunTestsRequest {
	tests: TestIdWithSrc[];
	exclude?: string[];
	debug: boolean;
	isAutoRun?: boolean;
}

/**
 * Request from the main thread to run tests for a single provider.
 */
export interface RunTestForProviderRequest {
	runId: string;
	excludeExtIds: string[];
	tests: TestIdWithSrc[];
	debug: boolean;
}

/**
 * Location with a fully-instantiated Range and URI.
 */
export interface IRichLocation {
	range: Range;
	uri: URI;
}

export interface ITestMessage {
	message: string | IMarkdownString;
	severity: TestMessageSeverity;
	expectedOutput: string | undefined;
	actualOutput: string | undefined;
	location: IRichLocation | undefined;
}

export interface ITestState {
	state: TestResult;
	duration: number | undefined;
	messages: ITestMessage[];
}

/**
 * The TestItem from .d.ts, as a plain object without children.
 */
export interface ITestItem {
	/** ID of the test given by the test provider */
	extId: string;
	label: string;
	children?: never;
	uri: URI;
	range: IRange | undefined;
	description: string | undefined;
	runnable: boolean;
	debuggable: boolean;
	expandable: boolean;
}

export const enum TestItemExpandState {
	NotExpandable,
	Expandable,
	BusyExpanding,
	Expanded,
}

/**
 * TestItem-like shape, butm with an ID and children as strings.
 */
export interface InternalTestItem {
	src: { provider: string; tree: number };
	expand: TestItemExpandState;
	parent: string | null;
	item: ITestItem;
}

/**
 * A partial update made to an existing InternalTestItem.
 */
export interface ITestItemUpdate {
	extId: string;
	expand?: TestItemExpandState;
	item?: Partial<ITestItem>;
}

export const applyTestItemUpdate = (internal: InternalTestItem | ITestItemUpdate, patch: ITestItemUpdate) => {
	if (patch.expand !== undefined) {
		internal.expand = patch.expand;
	}
	if (patch.item !== undefined) {
		Object.assign(internal.item, patch.item);
	}
};

/**
 * Test result item used in the main thread.
 */
export interface TestResultItem extends IncrementalTestCollectionItem {
	/** Current state of this test */
	state: ITestState;
	/** Computed state based on children */
	computedState: TestResult;
	/** True if the test is outdated */
	retired: boolean;
	/** True if the test was directly requested by the run (is not a child or parent) */
	direct?: boolean;
}

export type SerializedTestResultItem = Omit<TestResultItem, 'children' | 'expandable' | 'retired'>
	& { children: string[], retired: undefined };

/**
 * Test results serialized for transport and storage.
 */
export interface ISerializedTestResults {
	/** ID of these test results */
	id: string;
	/** Time the results were compelted */
	completedAt: number;
	/** Subset of test result items */
	items: SerializedTestResultItem[];
}

export const enum TestDiffOpType {
	/** Adds a new test (with children) */
	Add,
	/** Shallow-updates an existing test */
	Update,
	/** Removes a test (and all its children) */
	Remove,
	/** Changes the number of providers who are yet to publish their collection roots. */
	DeltaRootsComplete,
	/** Retires a test/result */
	Retire,
}

export type TestsDiffOp =
	| [op: TestDiffOpType.Add, item: InternalTestItem]
	| [op: TestDiffOpType.Update, item: ITestItemUpdate]
	| [op: TestDiffOpType.Remove, itemId: string]
	| [op: TestDiffOpType.Retire, itemId: string]
	| [op: TestDiffOpType.DeltaRootsComplete, amount: number];

/**
 * Utility function to get a unique string for a subscription to a resource,
 * useful to keep maps of document or workspace folder subscription info.
 */
export const getTestSubscriptionKey = (resource: ExtHostTestingResource, uri: URI) => `${resource}:${uri.toString()}`;

/**
 * Request from the ext host or main thread to indicate that tests have
 * changed. It's assumed that any item upserted *must* have its children
 * previously also upserted, or upserted as part of the same operation.
 * Children that no longer exist in an upserted item will be removed.
 */
export type TestsDiff = TestsDiffOp[];

/**
 * @private
 */
export interface IncrementalTestCollectionItem extends InternalTestItem {
	children: Set<string>;
}

/**
 * The IncrementalChangeCollector is used in the IncrementalTestCollection
 * and called with diff changes as they're applied. This is used in the
 * ext host to create a cohesive change event from a diff.
 */
export class IncrementalChangeCollector<T> {
	/**
	 * A node was added.
	 */
	public add(node: T): void { }

	/**
	 * A node in the collection was updated.
	 */
	public update(node: T): void { }

	/**
	 * A node was removed.
	 */
	public remove(node: T, isNestedOperation: boolean): void { }

	/**
	 * Called when the diff has been applied.
	 */
	public complete(): void { }
}

/**
 * Maintains tests in this extension host sent from the main thread.
 */
export abstract class AbstractIncrementalTestCollection<T extends IncrementalTestCollectionItem>  {
	/**
	 * Map of item IDs to test item objects.
	 */
	protected readonly items = new Map<string, T>();

	/**
	 * ID of test root items.
	 */
	protected readonly roots = new Set<string>();

	/**
	 * Number of 'busy' providers.
	 */
	protected busyProviderCount = 0;

	/**
	 * Number of pending roots.
	 */
	protected pendingRootCount = 0;

	/**
	 * Applies the diff to the collection.
	 */
	public apply(diff: TestsDiff) {
		const changes = this.createChangeCollector();

		for (const op of diff) {
			switch (op[0]) {
				case TestDiffOpType.Add: {
					const internalTest = op[1];
					if (!internalTest.parent) {
						this.roots.add(internalTest.item.extId);
						const created = this.createItem(internalTest);
						this.items.set(internalTest.item.extId, created);
						changes.add(created);
					} else if (this.items.has(internalTest.parent)) {
						const parent = this.items.get(internalTest.parent)!;
						parent.children.add(internalTest.item.extId);
						const created = this.createItem(internalTest, parent);
						this.items.set(internalTest.item.extId, created);
						changes.add(created);
					}

					if (internalTest.expand === TestItemExpandState.BusyExpanding) {
						this.updateBusyProviders(1);
					}
					break;
				}

				case TestDiffOpType.Update: {
					const patch = op[1];
					const existing = this.items.get(patch.extId);
					if (!existing) {
						break;
					}

					applyTestItemUpdate(existing, patch);
					changes.update(existing);
					if (patch.expand !== undefined && existing.expand === TestItemExpandState.BusyExpanding && patch.expand !== TestItemExpandState.BusyExpanding) {
						this.updateBusyProviders(-1);
					}
					break;
				}

				case TestDiffOpType.Remove: {
					const toRemove = this.items.get(op[1]);
					if (!toRemove) {
						break;
					}

					if (toRemove.parent) {
						const parent = this.items.get(toRemove.parent)!;
						parent.children.delete(toRemove.item.extId);
					} else {
						this.roots.delete(toRemove.item.extId);
					}

					const queue: Iterable<string>[] = [[op[1]]];
					while (queue.length) {
						for (const itemId of queue.pop()!) {
							const existing = this.items.get(itemId);
							if (existing) {
								queue.push(existing.children);
								this.items.delete(itemId);
								changes.remove(existing, existing !== toRemove);

								if (existing.expand === TestItemExpandState.BusyExpanding) {
									this.updateBusyProviders(-1);
								}
							}
						}
					}
					break;
				}

				case TestDiffOpType.Retire:
					this.retireTest(op[1]);
					break;

				case TestDiffOpType.DeltaRootsComplete:
					this.updatePendingRoots(op[1]);
					break;
			}
		}

		changes.complete();
	}

	/**
	 * Called when the extension signals a test result should be retired.
	 */
	protected retireTest(testId: string) {
		// no-op
	}

	/**
	 * Updates the number of providers who are still discovering items.
	 */
	protected updateBusyProviders(delta: number) {
		this.busyProviderCount += delta;
	}

	/**
	 * Updates the number of test root sources who are yet to report. When
	 * the total pending test roots reaches 0, the roots for all providers
	 * will exist in the collection.
	 */
	public updatePendingRoots(delta: number) {
		this.pendingRootCount += delta;
	}

	/**
	 * Called before a diff is applied to create a new change collector.
	 */
	protected createChangeCollector() {
		return new IncrementalChangeCollector<T>();
	}

	/**
	 * Creates a new item for the collection from the internal test item.
	 */
	protected abstract createItem(internal: InternalTestItem, parent?: T): T;
}
