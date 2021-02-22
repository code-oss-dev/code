/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation'; import * as platform from 'vs/base/common/platform';
import type { IKeyValueStorage, IExperimentationTelemetry, IExperimentationFilterProvider, ExperimentationService as TASClient } from 'tas-client-umd';
import { MementoObject, Memento } from 'vs/workbench/common/memento';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryData } from 'vs/base/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import product from 'vs/platform/product/common/product';

export const ITASExperimentService = createDecorator<ITASExperimentService>('TASExperimentService');

export interface ITASExperimentService {
	readonly _serviceBrand: undefined;
	getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined>;
	getCurrentExperiments(): Promise<string[] | undefined>;
}

const storageKey = 'VSCode.ABExp.FeatureData';
const refetchInterval = 0; // no polling

class MementoKeyValueStorage implements IKeyValueStorage {
	constructor(private mementoObj: MementoObject) { }

	async getValue<T>(key: string, defaultValue?: T | undefined): Promise<T | undefined> {
		const value = await this.mementoObj[key];
		return value || defaultValue;
	}

	setValue<T>(key: string, value: T): void {
		this.mementoObj[key] = value;
	}
}

class ExperimentServiceTelemetry implements IExperimentationTelemetry {
	private _lastAssignmentContext: string | undefined;
	constructor(private telemetryService: ITelemetryService) { }

	get assignmentContext(): string[] | undefined {
		return this._lastAssignmentContext?.split(';');
	}

	// __GDPR__COMMON__ "VSCode.ABExp.Features" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	// __GDPR__COMMON__ "abexp.assignmentcontext" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	setSharedProperty(name: string, value: string): void {
		if (name === product.tasConfig?.assignmentContextTelemetryPropertyName) {
			this._lastAssignmentContext = value;
		}

		this.telemetryService.setExperimentProperty(name, value);
	}

	postEvent(eventName: string, props: Map<string, string>): void {
		const data: ITelemetryData = {};
		for (const [key, value] of props.entries()) {
			data[key] = value;
		}

		/* __GDPR__
			"query-expfeature" : {
				"ABExp.queriedFeature": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		this.telemetryService.publicLog(eventName, data);
	}
}

class ExperimentServiceFilterProvider implements IExperimentationFilterProvider {
	constructor(
		private version: string,
		private appName: string,
		private machineId: string,
		private targetPopulation: TargetPopulation
	) { }

	getFilterValue(filter: string): string | null {
		switch (filter) {
			case Filters.ApplicationVersion:
				return this.version; // productService.version
			case Filters.Build:
				return this.appName; // productService.nameLong
			case Filters.ClientId:
				return this.machineId;
			case Filters.Language:
				return platform.language;
			case Filters.ExtensionName:
				return 'vscode-core'; // always return vscode-core for exp service
			case Filters.TargetPopulation:
				return this.targetPopulation;
			default:
				return '';
		}
	}

	getFilters(): Map<string, any> {
		let filters: Map<string, any> = new Map<string, any>();
		let filterValues = Object.values(Filters);
		for (let value of filterValues) {
			filters.set(value, this.getFilterValue(value));
		}

		return filters;
	}
}

/*
Based upon the official VSCode currently existing filters in the
ExP backend for the VSCode cluster.
https://experimentation.visualstudio.com/Analysis%20and%20Experimentation/_git/AnE.ExP.TAS.TachyonHost.Configuration?path=%2FConfigurations%2Fvscode%2Fvscode.json&version=GBmaster
"X-MSEdge-Market": "detection.market",
"X-FD-Corpnet": "detection.corpnet",
"X-VSCode–AppVersion": "appversion",
"X-VSCode-Build": "build",
"X-MSEdge-ClientId": "clientid",
"X-VSCode-ExtensionName": "extensionname",
"X-VSCode-TargetPopulation": "targetpopulation",
"X-VSCode-Language": "language"
*/

enum Filters {
	/**
	 * The market in which the extension is distributed.
	 */
	Market = 'X-MSEdge-Market',

	/**
	 * The corporation network.
	 */
	CorpNet = 'X-FD-Corpnet',

	/**
	 * Version of the application which uses experimentation service.
	 */
	ApplicationVersion = 'X-VSCode-AppVersion',

	/**
	 * Insiders vs Stable.
	 */
	Build = 'X-VSCode-Build',

	/**
	 * Client Id which is used as primary unit for the experimentation.
	 */
	ClientId = 'X-MSEdge-ClientId',

	/**
	 * Extension header.
	 */
	ExtensionName = 'X-VSCode-ExtensionName',

	/**
	 * The language in use by VS Code
	 */
	Language = 'X-VSCode-Language',

	/**
	 * The target population.
	 * This is used to separate internal, early preview, GA, etc.
	 */
	TargetPopulation = 'X-VSCode-TargetPopulation',
}

enum TargetPopulation {
	Team = 'team',
	Internal = 'internal',
	Insiders = 'insider',
	Public = 'public',
}

export class ExperimentService implements ITASExperimentService {
	_serviceBrand: undefined;
	private tasClient: Promise<TASClient> | undefined;
	private telemetry: ExperimentServiceTelemetry | undefined;
	private static MEMENTO_ID = 'experiment.service.memento';

	private get experimentsEnabled(): boolean {
		return this.configurationService.getValue('workbench.enableExperiments') === true;
	}

	constructor(
		@ITelemetryService private telemetryService: ITelemetryService,
		@IStorageService private storageService: IStorageService,
		@IConfigurationService private configurationService: IConfigurationService,
	) {

		if (product.tasConfig && this.experimentsEnabled && this.telemetryService.isOptedIn) {
			this.tasClient = this.setupTASClient();
		}
	}

	async getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined> {
		const startSetup = Date.now();

		if (!this.tasClient) {
			return undefined;
		}

		if (!this.experimentsEnabled) {
			return undefined;
		}

		const result = (await this.tasClient).getTreatmentVariable<T>('vscode', name);

		type TAASClientReadTreatmentData = {
			treatmentName: string;
			treatmentValue: string;
			readTime: number;
		};

		type TAASClientReadTreatmentCalssification = {
			treatmentValue: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', };
			treatmentName: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', };
			readTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
		};
		this.telemetryService.publicLog2<TAASClientReadTreatmentData, TAASClientReadTreatmentCalssification>('tasClientReadTreatmentComplete',
			{ readTime: Date.now() - startSetup, treatmentName: name, treatmentValue: JSON.stringify(result) });

		return result;
	}

	async getCurrentExperiments(): Promise<string[] | undefined> {
		if (!this.tasClient) {
			return undefined;
		}

		if (!this.experimentsEnabled) {
			return undefined;
		}

		await this.tasClient;

		return this.telemetry?.assignmentContext;
	}

	private async setupTASClient(): Promise<TASClient> {
		const startSetup = Date.now();
		const telemetryInfo = await this.telemetryService.getTelemetryInfo();
		const targetPopulation = telemetryInfo.msftInternal ? TargetPopulation.Internal : (product.quality === 'stable' ? TargetPopulation.Public : TargetPopulation.Insiders);
		const machineId = telemetryInfo.machineId;
		const filterProvider = new ExperimentServiceFilterProvider(
			product.version,
			product.nameLong,
			machineId,
			targetPopulation
		);

		const memento = new Memento(ExperimentService.MEMENTO_ID, this.storageService);
		const keyValueStorage = new MementoKeyValueStorage(memento.getMemento(StorageScope.GLOBAL, StorageTarget.MACHINE));

		this.telemetry = new ExperimentServiceTelemetry(this.telemetryService);

		const tasConfig = product.tasConfig!;
		const tasClient = new (await import('tas-client-umd')).ExperimentationService({
			filterProviders: [filterProvider],
			telemetry: this.telemetry,
			storageKey: storageKey,
			keyValueStorage: keyValueStorage,
			featuresTelemetryPropertyName: tasConfig.featuresTelemetryPropertyName,
			assignmentContextTelemetryPropertyName: tasConfig.assignmentContextTelemetryPropertyName,
			telemetryEventName: tasConfig.telemetryEventName,
			endpoint: tasConfig.endpoint,
			refetchInterval: refetchInterval,
		});

		await tasClient.initializePromise;

		type TAASClientSetupData = { setupTime: number; };
		type TAASClientSetupCalssification = { setupTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' }; };
		this.telemetryService.publicLog2<TAASClientSetupData, TAASClientSetupCalssification>('tasClientSetupComplete', { setupTime: Date.now() - startSetup });

		return tasClient;
	}
}

registerSingleton(ITASExperimentService, ExperimentService, false);
