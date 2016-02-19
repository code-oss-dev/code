/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

// include these in the editor bundle because they are widely used by many languages
import 'vs/editor/common/languages.common';

import {WorkerServer} from 'vs/base/common/worker/workerServer';
import {SecondaryMarkerService} from 'vs/platform/markers/common/markerService';
import {WorkerThreadService} from 'vs/platform/thread/common/workerThreadService';
import InstantiationService = require('vs/platform/instantiation/common/instantiationService');
import {EventService} from 'vs/platform/event/common/eventService';
import {WorkerTelemetryService} from 'vs/platform/telemetry/common/workerTelemetryService';
import {TPromise} from 'vs/base/common/winjs.base';
import {ResourceService} from 'vs/editor/common/services/resourceServiceImpl';
import {BaseWorkspaceContextService} from 'vs/platform/workspace/common/baseWorkspaceContextService';
import {ModelServiceWorkerHelper} from 'vs/editor/common/services/modelServiceImpl';
import {IPluginDescription} from 'vs/platform/plugins/common/plugins';
import {BaseRequestService} from 'vs/platform/request/common/baseRequestService';
import {IWorkspace} from 'vs/platform/workspace/common/workspace';
import {AbstractPluginService, ActivatedPlugin} from 'vs/platform/plugins/common/abstractPluginService';
import {ModeServiceImpl,ModeServiceWorkerHelper} from 'vs/editor/common/services/modeServiceImpl';
import Severity from 'vs/base/common/severity';

export interface IInitData {
	contextService: {
		workspace:any;
		configuration:any;
		options:any;
	};
}

interface IWorkspaceWithTelemetry extends IWorkspace {
	telemetry?:string;
}

interface IWorkspaceWithSearch extends IWorkspace {
	search?:string;
}

export interface ICallback {
	(something:any):void;
}

class WorkerPluginService extends AbstractPluginService<ActivatedPlugin> {

	constructor() {
		super(true);
	}

	protected _showMessage(severity:Severity, msg:string): void {
		switch (severity) {
			case Severity.Error:
				console.error(msg);
				break;
			case Severity.Warning:
				console.warn(msg);
				break;
			case Severity.Info:
				console.info(msg);
				break;
			default:
				console.log(msg);
		}
	}

	public deactivate(pluginId:string): void {
		// nothing to do
	}

	protected _createFailedPlugin(): ActivatedPlugin {
		throw new Error('unexpected');
	}

	protected _actualActivatePlugin(pluginDescription: IPluginDescription): TPromise<ActivatedPlugin> {
		throw new Error('unexpected');
	}

}

export class EditorWorkerServer {

	private threadService:WorkerThreadService;

	constructor() {
	}

	public initialize(mainThread:WorkerServer, complete:ICallback, error:ICallback, progress:ICallback, initData:IInitData):void {

		var pluginService = new WorkerPluginService();

		var contextService = new BaseWorkspaceContextService(initData.contextService.workspace, initData.contextService.configuration, initData.contextService.options);

		this.threadService = new WorkerThreadService(mainThread.getRemoteCom());
		this.threadService.setInstantiationService(InstantiationService.create({ threadService: this.threadService }));

		var telemetryServiceInstance = new WorkerTelemetryService(this.threadService);

		var resourceService = new ResourceService();
		var markerService = new SecondaryMarkerService(this.threadService);

		var modeService = new ModeServiceImpl(this.threadService, pluginService);

		var requestService = new BaseRequestService(contextService, telemetryServiceInstance);

		var _services : any = {
			threadService: this.threadService,
			pluginService: pluginService,
			modeService: modeService,
			contextService: contextService,
			eventService: new EventService(),
			resourceService: resourceService,
			markerService: markerService,
			telemetryService: telemetryServiceInstance,
			requestService: requestService
		};

		var instantiationService = InstantiationService.create(_services);
		this.threadService.setInstantiationService(instantiationService);

		// Instantiate thread actors
		this.threadService.getRemotable(ModeServiceWorkerHelper);
		this.threadService.getRemotable(ModelServiceWorkerHelper);

		complete(undefined);
	}

	public request(mainThread:WorkerServer, complete:ICallback, error:ICallback, progress:ICallback, data:any):void {
		this.threadService.dispatch(data).then(complete, error, progress);
	}
}

export var value = new EditorWorkerServer();
