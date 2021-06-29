/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { groupBy } from 'vs/base/common/arrays';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust';
import { MainThreadTestCollection } from 'vs/workbench/contrib/testing/common/mainThreadTestCollection';
import { ITestIdWithSrc, ResolvedTestRunRequest, TestDiffOpType, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';
import { ITestConfigurationService } from 'vs/workbench/contrib/testing/common/testConfigurationService';
import { TestExclusions } from 'vs/workbench/contrib/testing/common/testExclusions';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { ITestResult } from 'vs/workbench/contrib/testing/common/testResult';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { AmbiguousRunTestsRequest, ITestService, MainTestController } from 'vs/workbench/contrib/testing/common/testService';

export class TestService extends Disposable implements ITestService {
	declare readonly _serviceBrand: undefined;
	private testControllers = new Map<string, MainTestController>();

	private readonly cancelExtensionTestRunEmitter = new Emitter<{ runId: string | undefined }>();
	private readonly processDiffEmitter = new Emitter<TestsDiff>();
	private readonly providerCount: IContextKey<number>;
	/**
	 * Cancellation for runs requested by the user being managed by the UI.
	 * Test runs initiated by extensions are not included here.
	 */
	private readonly uiRunningTests = new Map<string /* run ID */, CancellationTokenSource>();

	/**
	 * @inheritdoc
	 */
	public readonly onDidProcessDiff = this.processDiffEmitter.event;

	/**
	 * @inheritdoc
	 */
	public readonly onDidCancelTestRun = this.cancelExtensionTestRunEmitter.event;

	/**
	 * @inheritdoc
	 */
	public readonly collection = new MainThreadTestCollection(this.expandTest.bind(this));

	/**
	 * @inheritdoc
	 */
	public readonly excluded: TestExclusions;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITestConfigurationService private readonly testConfigurationService: ITestConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITestResultService private readonly testResults: ITestResultService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
	) {
		super();
		this.excluded = instantiationService.createInstance(TestExclusions);
		this.providerCount = TestingContextKeys.providerCount.bindTo(contextKeyService);
	}

	/**
	 * @inheritdoc
	 */
	public async expandTest(test: ITestIdWithSrc, levels: number) {
		await this.testControllers.get(test.controllerId)?.expandTest(test, levels);
	}

	/**
	 * @inheritdoc
	 */
	public cancelTestRun(runId?: string) {
		this.cancelExtensionTestRunEmitter.fire({ runId });

		if (runId === undefined) {
			for (const runCts of this.uiRunningTests.values()) {
				runCts.cancel();
			}
		} else {
			this.uiRunningTests.get(runId)?.cancel();
		}
	}

	/**
	 * @inheritdoc
	 */
	public async runTests(req: AmbiguousRunTestsRequest, token = CancellationToken.None): Promise<ITestResult> {
		const resolved: ResolvedTestRunRequest = { targets: [], exclude: req.exclude, isAutoRun: req.isAutoRun };
		for (const byController of groupBy(req.tests, (a, b) => a.controllerId === b.controllerId ? 0 : 1)) {
			const groups = this.testConfigurationService.controllerGroupConfigurations(byController[0].controllerId, req.group);
			const group = req.preferGroupLabel ? (groups.find(g => g.label === req.preferGroupLabel) || groups[0]) : groups[0];
			if (group) {
				resolved.targets.push({
					testIds: byController.map(t => t.testId),
					configLabel: group.label,
					configGroup: group.group,
					configId: group.configId,
					controllerId: group.controllerId,
				});
			}
		}

		return this.runResolvedTests(resolved, token);
	}

	/**
	 * @inheritdoc
	 */
	public async runResolvedTests(req: ResolvedTestRunRequest, token = CancellationToken.None) {
		if (!req.exclude) {
			req.exclude = [...this.excluded.all];
		}

		const result = this.testResults.createLiveResult(req);
		const trust = await this.workspaceTrustRequestService.requestWorkspaceTrust({
			message: localize('testTrust', "Running tests may execute code in your workspace."),
		});

		if (!trust) {
			result.markComplete();
			return result;
		}

		try {
			const cancelSource = new CancellationTokenSource(token);
			this.uiRunningTests.set(result.id, cancelSource);

			const requests = req.targets.map(
				group => this.testControllers.get(group.controllerId)?.runTests(
					{
						runId: result.id,
						excludeExtIds: req.exclude!.filter(t => t.controllerId === group.controllerId).map(t => t.testId),
						configId: group.configId,
						controllerId: group.controllerId,
						testIds: group.testIds,
					},
					cancelSource.token,
				).catch(err => {
					this.notificationService.error(localize('testError', 'An error occurred attempting to run tests: {0}', err.message));
				})
			);

			await Promise.all(requests);
			return result;
		} finally {
			this.uiRunningTests.delete(result.id);
			result.markComplete();
		}
	}

	/**
	 * @inheritdoc
	 */
	public resubscribeToAllTests() {
		// todo
	}

	/**
	 * @inheritdoc
	 */
	public publishDiff(_controllerId: string, diff: TestsDiff) {
		this.collection.apply(diff);
		this.processDiffEmitter.fire(diff);
	}

	/**
	 * @inheritdoc
	 */
	public registerTestController(id: string, controller: MainTestController): IDisposable {
		this.testControllers.set(id, controller);
		this.providerCount.set(this.testControllers.size);

		return toDisposable(() => {
			const diff: TestsDiff = [];
			for (const root of this.collection.rootItems) {
				if (root.controllerId === id) {
					diff.push([TestDiffOpType.Remove, root.item.extId]);
				}
			}

			this.publishDiff(id, diff);

			if (this.testControllers.delete(id)) {
				this.providerCount.set(this.testControllers.size);
			}
		});
	}
}


