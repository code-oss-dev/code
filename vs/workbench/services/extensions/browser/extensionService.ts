/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IFileService } from 'vs/platform/files/common/files';
import { IProductService } from 'vs/platform/product/common/productService';
import { AbstractExtensionService } from 'vs/workbench/services/extensions/common/abstractExtensionService';
import { ExtensionHostProcessManager } from 'vs/workbench/services/extensions/common/extensionHostProcessManager';
import { RemoteExtensionHostClient, IInitDataProvider } from 'vs/workbench/services/extensions/common/remoteExtensionHostClient';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { WebWorkerExtensionHostStarter } from 'vs/workbench/services/extensions/browser/webWorkerExtensionHostStarter';
import { URI } from 'vs/base/common/uri';
import { canExecuteOnWeb } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { FetchFileSystemProvider } from 'vs/workbench/services/extensions/browser/webWorkerFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IStaticExtensionsService } from 'vs/workbench/services/extensions/common/staticExtensions';
import { DeltaExtensionsResult } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';

export class ExtensionService extends AbstractExtensionService implements IExtensionService {

	private _disposables = new DisposableStore();
	private _remoteExtensionsEnvironmentData: IRemoteAgentEnvironment | null = null;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchExtensionEnablementService extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IRemoteAuthorityResolverService private readonly _remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IStaticExtensionsService private readonly _staticExtensions: IStaticExtensionsService,
	) {
		super(
			instantiationService,
			notificationService,
			environmentService,
			telemetryService,
			extensionEnablementService,
			fileService,
			productService,
		);

		this._initialize();
		this._initFetchFileSystem();
	}

	dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}

	private _initFetchFileSystem(): void {
		const provider = new FetchFileSystemProvider();
		this._disposables.add(this._fileService.registerProvider(Schemas.http, provider));
		this._disposables.add(this._fileService.registerProvider(Schemas.https, provider));
	}

	private _createProvider(remoteAuthority: string): IInitDataProvider {
		return {
			remoteAuthority: remoteAuthority,
			getInitData: async () => {
				await this.whenInstalledExtensionsRegistered();
				const connectionData = this._remoteAuthorityResolverService.getConnectionData(remoteAuthority) || undefined;
				const remoteEnvironment = this._remoteExtensionsEnvironmentData!;
				return { connectionData, remoteEnvironment };
			}
		};
	}

	protected _createExtensionHosts(_isInitialStart: boolean, initialActivationEvents: string[]): ExtensionHostProcessManager[] {
		const result: ExtensionHostProcessManager[] = [];

		const webExtensions = this.getExtensions().then(extensions => extensions.filter(ext => canExecuteOnWeb(ext, this._productService, this._configService)));
		const webHostProcessWorker = this._instantiationService.createInstance(WebWorkerExtensionHostStarter, true, webExtensions, URI.file(this._environmentService.logsPath).with({ scheme: this._environmentService.logFile.scheme }));
		const webHostProcessManager = this._instantiationService.createInstance(ExtensionHostProcessManager, false, webHostProcessWorker, null, initialActivationEvents);
		result.push(webHostProcessManager);

		const remoteAgentConnection = this._remoteAgentService.getConnection();
		if (remoteAgentConnection) {
			const remoteExtensions = this.getExtensions().then(extensions => extensions.filter(ext => !canExecuteOnWeb(ext, this._productService, this._configService)));
			const remoteExtHostProcessWorker = this._instantiationService.createInstance(RemoteExtensionHostClient, remoteExtensions, this._createProvider(remoteAgentConnection.remoteAuthority), this._remoteAgentService.socketFactory);
			const remoteExtHostProcessManager = this._instantiationService.createInstance(ExtensionHostProcessManager, false, remoteExtHostProcessWorker, remoteAgentConnection.remoteAuthority, initialActivationEvents);
			result.push(remoteExtHostProcessManager);
		}

		return result;
	}

	protected async _scanAndHandleExtensions(): Promise<void> {
		// fetch the remote environment
		let [remoteEnv, localExtensions] = await Promise.all([
			this._remoteAgentService.getEnvironment(),
			this._staticExtensions.getExtensions()
		]);

		let result: DeltaExtensionsResult;

		// local: only enabled and web'ish extension
		localExtensions = localExtensions!.filter(ext => this._isEnabled(ext) && canExecuteOnWeb(ext, this._productService, this._configService));
		this._checkEnableProposedApi(localExtensions);

		if (!remoteEnv) {
			result = this._registry.deltaExtensions(localExtensions, []);

		} else {
			// remote: only enabled and none-web'ish extension
			remoteEnv.extensions = remoteEnv.extensions.filter(extension => this._isEnabled(extension) && !canExecuteOnWeb(extension, this._productService, this._configService));
			this._checkEnableProposedApi(remoteEnv.extensions);

			// in case of overlap, the remote wins
			const isRemoteExtension = new Set<string>();
			remoteEnv.extensions.forEach(extension => isRemoteExtension.add(ExtensionIdentifier.toKey(extension.identifier)));
			localExtensions = localExtensions.filter(extension => !isRemoteExtension.has(ExtensionIdentifier.toKey(extension.identifier)));

			// save for remote extension's init data
			this._remoteExtensionsEnvironmentData = remoteEnv;

			result = this._registry.deltaExtensions(remoteEnv.extensions.concat(localExtensions), []);
		}

		if (result.removedDueToLooping.length > 0) {
			this._logOrShowMessage(Severity.Error, nls.localize('looping', "The following extensions contain dependency loops and have been disabled: {0}", result.removedDueToLooping.map(e => `'${e.identifier.value}'`).join(', ')));
		}
		this._doHandleExtensionPoints(this._registry.getAllExtensionDescriptions());
	}

	public _onExtensionHostExit(code: number): void {
		// We log the exit code to the console. Do NOT remove this
		// code as the automated integration tests in browser rely
		// on this message to exit properly.
		console.log(`vscode:exit ${code}`);
	}
}

registerSingleton(IExtensionService, ExtensionService);
