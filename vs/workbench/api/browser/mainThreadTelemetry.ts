/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService, TelemetryLevel, TELEMETRY_OLD_SETTING_ID, TELEMETRY_SETTING_ID } from 'vs/platform/telemetry/common/telemetry';
import { MainThreadTelemetryShape, MainContext, ExtHostTelemetryShape, ExtHostContext } from '../common/extHost.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { ClassifiedEvent, StrictPropertyCheck, GDPRClassification } from 'vs/platform/telemetry/common/gdprTypings';
import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IProductService } from 'vs/platform/product/common/productService';
import { getTelemetryLevel, supportsTelemetry } from 'vs/platform/telemetry/common/telemetryUtils';

@extHostNamedCustomer(MainContext.MainThreadTelemetry)
export class MainThreadTelemetry extends Disposable implements MainThreadTelemetryShape {
	private readonly _proxy: ExtHostTelemetryShape;

	private static readonly _name = 'pluginHostTelemetry';

	constructor(
		extHostContext: IExtHostContext,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		@IProductService private readonly _productService: IProductService
	) {
		super();

		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostTelemetry);

		if (supportsTelemetry(this._productService, this._environmentService)) {
			this._register(this._configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(TELEMETRY_SETTING_ID) || e.affectsConfiguration(TELEMETRY_OLD_SETTING_ID)) {
					this._proxy.$onDidChangeTelemetryLevel(this.telemetryLevel);
				}
			}));
		}

		this._proxy.$initializeTelemetryLevel(this.telemetryLevel);
	}

	private get telemetryLevel(): TelemetryLevel {
		if (!supportsTelemetry(this._productService, this._environmentService)) {
			return TelemetryLevel.NONE;
		}

		return getTelemetryLevel(this._configurationService);
	}

	$publicLog(eventName: string, data: any = Object.create(null)): void {
		// __GDPR__COMMON__ "pluginHostTelemetry" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
		data[MainThreadTelemetry._name] = true;
		this._telemetryService.publicLog(eventName, data);
	}

	$publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data: StrictPropertyCheck<T, E>): void {
		this.$publicLog(eventName, data as any);
	}
}


