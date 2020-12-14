/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { groupBy } from 'vs/base/common/arrays';
import { Emitter } from 'vs/base/common/event';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { isDefined } from 'vs/base/common/types';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ExtHostTestingResource } from 'vs/workbench/api/common/extHost.protocol';
import { AbstractIncrementalTestCollection, collectTestResults, getTestSubscriptionKey, IncrementalTestCollectionItem, InternalTestItem, RunTestsRequest, RunTestsResult, TestDiffOpType, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { ITestService, MainTestController, TestDiffListener } from 'vs/workbench/contrib/testing/common/testService';

export class TestService extends Disposable implements ITestService {
	declare readonly _serviceBrand: undefined;
	private testControllers = new Map<string, MainTestController>();
	private readonly testSubscriptions = new Map<string, {
		collection: MainThreadTestCollection;
		ident: { resource: ExtHostTestingResource, uri: URI };
		onDiff: Emitter<TestsDiff>;
		listeners: number;
	}>();

	private readonly subscribeEmitter = new Emitter<{ resource: ExtHostTestingResource, uri: URI }>();
	private readonly unsubscribeEmitter = new Emitter<{ resource: ExtHostTestingResource, uri: URI }>();
	private readonly changeProvidersEmitter = new Emitter<{ delta: number }>();
	private readonly providerCount: IContextKey<number>;
	private readonly runStartedEmitter = new Emitter<RunTestsRequest>();
	private readonly runCompletedEmitter = new Emitter<{ req: RunTestsRequest, result: RunTestsResult }>();

	public readonly testRuns = new Set<RunTestsRequest>();
	public readonly onTestRunStarted = this.runStartedEmitter.event;
	public readonly onTestRunCompleted = this.runCompletedEmitter.event;

	constructor(@IContextKeyService contextKeyService: IContextKeyService) {
		super();
		this.providerCount = TestingContextKeys.providerCount.bindTo(contextKeyService);
	}

	/**
	 * Gets the current provider count.
	 */
	public get providers() {
		return this.providerCount.get() || 0;
	}

	/**
	 * Fired when extension hosts should pull events from their test factories.
	 */
	public readonly onShouldSubscribe = this.subscribeEmitter.event;

	/**
	 * Fired when extension hosts should stop pulling events from their test factories.
	 */
	public readonly onShouldUnsubscribe = this.unsubscribeEmitter.event;

	/**
	 * Fired when the number of providers change.
	 */
	public readonly onDidChangeProviders = this.changeProvidersEmitter.event;

	/**
	 * @inheritdoc
	 */
	public get subscriptions() {
		return [...this.testSubscriptions].map(([, s]) => s.ident);
	}

	/**
	 * @inheritdoc
	 */
	async runTests(req: RunTestsRequest): Promise<RunTestsResult> {
		const tests = groupBy(req.tests, (a, b) => a.providerId === b.providerId ? 0 : 1);
		const requests = tests.map(group => {
			const providerId = group[0].providerId;
			const controller = this.testControllers.get(providerId);
			return controller?.runTests({ providerId, debug: req.debug, ids: group.map(t => t.testId) });
		}).filter(isDefined);

		this.testRuns.add(req);
		this.runStartedEmitter.fire(req);
		const result = await collectTestResults(await Promise.all(requests));
		this.testRuns.delete(req);
		this.runCompletedEmitter.fire({ req, result });

		return result;
	}

	/**
	 * @inheritdoc
	 */
	public subscribeToDiffs(resource: ExtHostTestingResource, uri: URI, acceptDiff: TestDiffListener) {
		const subscriptionKey = getTestSubscriptionKey(resource, uri);
		let subscription = this.testSubscriptions.get(subscriptionKey);
		if (!subscription) {
			subscription = { ident: { resource, uri }, collection: new MainThreadTestCollection(), listeners: 0, onDiff: new Emitter() };
			this.subscribeEmitter.fire({ resource, uri });
			this.testSubscriptions.set(subscriptionKey, subscription);
		}

		subscription.listeners++;

		const revive = subscription.collection.getReviverDiff();
		if (revive.length) {
			acceptDiff(revive);
		}

		const listener = subscription.onDiff.event(acceptDiff);
		return toDisposable(() => {
			listener.dispose();

			if (!--subscription!.listeners) {
				this.unsubscribeEmitter.fire({ resource, uri });
				this.testSubscriptions.delete(subscriptionKey);
			}
		});
	}

	/**
	 * @inheritdoc
	 */
	public publishDiff(resource: ExtHostTestingResource, uri: UriComponents, diff: TestsDiff) {
		const sub = this.testSubscriptions.get(getTestSubscriptionKey(resource, URI.revive(uri)));
		if (sub) {
			sub.collection.apply(diff);
			sub.onDiff.fire(diff);
		}
	}

	/**
	 * @inheritdoc
	 */
	public registerTestController(id: string, controller: MainTestController): void {
		this.testControllers.set(id, controller);
		this.providerCount.set(this.testControllers.size);
		this.changeProvidersEmitter.fire({ delta: 1 });
	}

	/**
	 * @inheritdoc
	 */
	public unregisterTestController(id: string): void {
		this.testControllers.delete(id);
		this.providerCount.set(this.testControllers.size);
		this.changeProvidersEmitter.fire({ delta: -1 });
	}
}

class MainThreadTestCollection extends AbstractIncrementalTestCollection<IncrementalTestCollectionItem> {
	/**
	 * Gets a diff that adds all items currently in the tree to a new collection,
	 * allowing it to fully hydrate.
	 */
	public getReviverDiff() {
		const ops: TestsDiff = [];
		const queue = [this.roots];
		while (queue.length) {
			for (const child of queue.pop()!) {
				const item = this.items.get(child)!;
				ops.push([TestDiffOpType.Add, { id: item.id, providerId: item.providerId, item: item.item, parent: item.parent }]);
				queue.push(item.children);
			}
		}

		return ops;
	}

	protected createItem(internal: InternalTestItem): IncrementalTestCollectionItem {
		return { ...internal, children: new Set() };
	}
}
