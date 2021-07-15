/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { isDefined } from 'vs/base/common/types';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { StoredValue } from 'vs/workbench/contrib/testing/common/storedValue';
import { ITestRunConfiguration, TestRunConfigurationBitset, testRunConfigurationBitsetList } from 'vs/workbench/contrib/testing/common/testCollection';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { IMainThreadTestController } from 'vs/workbench/contrib/testing/common/testService';

export const ITestConfigurationService = createDecorator<ITestConfigurationService>('testConfigurationService');

export interface ITestConfigurationService {
	readonly _serviceBrand: undefined;

	/**
	 * Fired when any configuration changes.
	 */
	readonly onDidChange: Event<void>;

	/**
	 * Publishes a new test configuration.
	 */
	addConfiguration(controller: IMainThreadTestController, config: ITestRunConfiguration): void;

	/**
	 * Updates an existing test run configuration
	 */
	updateConfiguration(controllerId: string, configId: number, update: Partial<ITestRunConfiguration>): void;

	/**
	 * Removes a configuration. If configId is not given, all configurations
	 * for the given controller will be removed.
	 */
	removeConfiguration(controllerId: string, configId?: number): void;

	/**
	 * Gets capabilities for the given controller by ID, indicating whether
	 * there's any configurations available for those groups.
	 * @returns a bitset to use with {@link TestRunConfigurationBitset}
	 */
	controllerCapabilities(controllerId: string): number;

	/**
	 * Configures a test configuration.
	 */
	configure(controllerId: string, configId: number): void;

	/**
	 * Gets all registered controllers, grouping by controller.
	 */
	all(): Iterable<Readonly<{
		capabilities: number,
		controller: IMainThreadTestController,
		configs: ITestRunConfiguration[],
	}>>;

	/**
	 * Gets the default configurations to be run for a given run group.
	 */
	getGroupDefaultConfigurations(group: TestRunConfigurationBitset): ITestRunConfiguration[];

	/**
	 * Sets the default configurations to be run for a given run group.
	 */
	setGroupDefaultConfigurations(group: TestRunConfigurationBitset, configs: ITestRunConfiguration[]): void;

	/**
	 * Gets the configurations for a controller, in priority order.
	 */
	getControllerConfigurations(controllerId: string): undefined | {
		controller: IMainThreadTestController;
		configs: ITestRunConfiguration[];
	};

	/**
	 * Gets the configurations for the group in a controller, in priorty order.
	 */
	getControllerGroupConfigurations(controllerId: string, group: TestRunConfigurationBitset): readonly ITestRunConfiguration[];
}

const sorter = (a: ITestRunConfiguration, b: ITestRunConfiguration) => {
	if (a.isDefault !== b.isDefault) {
		return a.isDefault ? -1 : 1;
	}

	return a.label.localeCompare(b.label);
};

/**
 * Given a capabilities bitset, returns a map of context keys representing
 * them.
 */
export const capabilityContextKeys = (capabilities: number): [key: string, value: boolean][] => [
	[TestingContextKeys.hasRunnableTests.key, (capabilities & TestRunConfigurationBitset.Run) !== 0],
	[TestingContextKeys.hasDebuggableTests.key, (capabilities & TestRunConfigurationBitset.Debug) !== 0],
	[TestingContextKeys.hasCoverableTests.key, (capabilities & TestRunConfigurationBitset.Coverage) !== 0],
];


export class TestConfigurationService implements ITestConfigurationService {
	declare readonly _serviceBrand: undefined;
	private readonly preferredDefaults: StoredValue<{ [K in TestRunConfigurationBitset]?: { controllerId: string; configId: number }[] }>;
	private readonly capabilitiesContexts: { [K in TestRunConfigurationBitset]: IContextKey<boolean> };
	private readonly changeEmitter = new Emitter<void>();
	private readonly controllerConfigs = new Map</* controller ID */string, {
		configs: ITestRunConfiguration[],
		controller: IMainThreadTestController,
		capabilities: number,
	}>();

	/** @inheritdoc */
	public readonly onDidChange = this.changeEmitter.event;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService storageService: IStorageService,
	) {
		this.preferredDefaults = new StoredValue({
			key: 'testingPreferredConfigs',
			scope: StorageScope.WORKSPACE,
			target: StorageTarget.USER,
		}, storageService);

		this.capabilitiesContexts = {
			[TestRunConfigurationBitset.Run]: TestingContextKeys.hasRunnableTests.bindTo(contextKeyService),
			[TestRunConfigurationBitset.Debug]: TestingContextKeys.hasDebuggableTests.bindTo(contextKeyService),
			[TestRunConfigurationBitset.Coverage]: TestingContextKeys.hasCoverableTests.bindTo(contextKeyService),
			[TestRunConfigurationBitset.HasNonDefaultConfig]: TestingContextKeys.hasNonDefaultProfile.bindTo(contextKeyService),
			[TestRunConfigurationBitset.HasConfigurable]: TestingContextKeys.hasConfigurableConfig.bindTo(contextKeyService),
		};

		this.refreshContextKeys();
	}

	/** @inheritdoc */
	public addConfiguration(controller: IMainThreadTestController, config: ITestRunConfiguration): void {
		let record = this.controllerConfigs.get(config.controllerId);
		if (record) {
			record.configs.push(config);
			record.configs.sort(sorter);
			record.capabilities |= config.group;
		} else {
			record = {
				configs: [config],
				controller,
				capabilities: config.group
			};
			this.controllerConfigs.set(config.controllerId, record);
		}

		if (!config.isDefault) {
			record.capabilities |= TestRunConfigurationBitset.HasNonDefaultConfig;
		}

		this.refreshContextKeys();
		this.changeEmitter.fire();
	}

	/** @inheritdoc */
	public updateConfiguration(controllerId: string, configId: number, update: Partial<ITestRunConfiguration>): void {
		const ctrl = this.controllerConfigs.get(controllerId);
		if (!ctrl) {
			return;
		}

		const config = ctrl.configs.find(c => c.controllerId === controllerId && c.profileId === configId);
		if (!config) {
			return;
		}

		Object.assign(config, update);
		ctrl.configs.sort(sorter);
		this.changeEmitter.fire();
	}

	/** @inheritdoc */
	public configure(controllerId: string, configId: number) {
		this.controllerConfigs.get(controllerId)?.controller.configureRunConfig(configId);
	}

	/** @inheritdoc */
	public removeConfiguration(controllerId: string, configId?: number): void {
		const ctrl = this.controllerConfigs.get(controllerId);
		if (!ctrl) {
			return;
		}

		if (!configId) {
			this.controllerConfigs.delete(controllerId);
			this.changeEmitter.fire();
			return;
		}

		const index = ctrl.configs.findIndex(c => c.profileId === configId);
		if (index === -1) {
			return;
		}

		ctrl.configs.splice(index, 1);
		ctrl.capabilities = 0;
		for (const { group } of ctrl.configs) {
			ctrl.capabilities |= group;
		}

		this.refreshContextKeys();
		this.changeEmitter.fire();
	}

	/** @inheritdoc */
	public controllerCapabilities(controllerId: string) {
		return this.controllerConfigs.get(controllerId)?.capabilities || 0;
	}

	/** @inheritdoc */
	public all() {
		return this.controllerConfigs.values();
	}

	/** @inheritdoc */
	public getControllerConfigurations(controllerId: string) {
		return this.controllerConfigs.get(controllerId);
	}

	/** @inheritdoc */
	public getControllerGroupConfigurations(controllerId: string, group: TestRunConfigurationBitset) {
		return this.controllerConfigs.get(controllerId)?.configs.filter(c => c.group === group) ?? [];
	}

	/** @inheritdoc */
	public getGroupDefaultConfigurations(group: TestRunConfigurationBitset) {
		const preferred = this.preferredDefaults.get();
		if (!preferred) {
			return this.getBaseDefaults(group);
		}

		const configs = preferred[group]
			?.map(p => this.controllerConfigs.get(p.controllerId)?.configs.find(
				c => c.profileId === p.configId && c.group === group))
			.filter(isDefined);

		return configs?.length ? configs : this.getBaseDefaults(group);
	}

	/** @inheritdoc */
	public setGroupDefaultConfigurations(group: TestRunConfigurationBitset, configs: ITestRunConfiguration[]) {
		this.preferredDefaults.store({
			...this.preferredDefaults.get(),
			[group]: configs.map(c => ({ configId: c.profileId, controllerId: c.controllerId })),
		});

		this.changeEmitter.fire();
	}

	private getBaseDefaults(group: TestRunConfigurationBitset) {
		const defaults: ITestRunConfiguration[] = [];
		for (const { configs } of this.controllerConfigs.values()) {
			const config = configs.find(c => c.group === group);
			if (config) {
				defaults.push(config);
			}
		}

		return defaults;
	}

	private refreshContextKeys() {
		let allCapabilities = 0;
		for (const { capabilities } of this.controllerConfigs.values()) {
			allCapabilities |= capabilities;
		}

		for (const group of testRunConfigurationBitsetList) {
			this.capabilitiesContexts[group].set((allCapabilities & group) !== 0);
		}
	}
}
