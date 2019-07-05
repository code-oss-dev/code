/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mark } from 'vs/base/common/performance';
import { domContentLoaded, addDisposableListener, EventType } from 'vs/base/browser/dom';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable } from 'vs/base/common/lifecycle';
import { SimpleLogService } from 'vs/workbench/browser/web.simpleservices';
import { BrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
import { Workbench } from 'vs/workbench/browser/workbench';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { REMOTE_FILE_SYSTEM_CHANNEL_NAME, RemoteExtensionsFileSystemProvider } from 'vs/platform/remote/common/remoteAgentFileSystemChannel';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IProductService } from 'vs/platform/product/common/product';
import { RemoteAgentService } from 'vs/workbench/services/remote/browser/remoteAgentServiceImpl';
import { RemoteAuthorityResolverService } from 'vs/platform/remote/browser/remoteAuthorityResolverService';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IFileService, IFileSystemProvider } from 'vs/platform/files/common/files';
import { FileService } from 'vs/workbench/services/files/common/fileService';
import { Schemas } from 'vs/base/common/network';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { onUnexpectedError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { IWorkspaceInitializationPayload } from 'vs/platform/workspaces/common/workspaces';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { ConfigurationCache } from 'vs/workbench/services/configuration/browser/configurationCache';
import { ISignService } from 'vs/platform/sign/common/sign';
import { SignService } from 'vs/platform/sign/browser/signService';
import { hash } from 'vs/base/common/hash';
import { IWorkbenchConstructionOptions } from 'vs/workbench/workbench.web.api';
import { ProductService } from 'vs/platform/product/browser/productService';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { BACKUPS } from 'vs/platform/environment/common/environment';
import { joinPath } from 'vs/base/common/resources';
import { BrowserStorageService } from 'vs/platform/storage/browser/storageService';
import { IStorageService } from 'vs/platform/storage/common/storage';

class CodeRendererMain extends Disposable {

	private workbench: Workbench;

	constructor(
		private readonly domElement: HTMLElement,
		private readonly configuration: IWorkbenchConstructionOptions
	) {
		super();
	}

	async open(): Promise<void> {
		const services = await this.initServices();

		await domContentLoaded();
		mark('willStartWorkbench');

		// Create Workbench
		this.workbench = new Workbench(
			this.domElement,
			services.serviceCollection,
			services.logService
		);

		// Layout
		this._register(addDisposableListener(window, EventType.RESIZE, () => this.workbench.layout()));

		// Workbench Lifecycle
		this._register(this.workbench.onShutdown(() => this.dispose()));

		// Startup
		this.workbench.startup();
	}

	private async initServices(): Promise<{ serviceCollection: ServiceCollection, logService: ILogService }> {
		const serviceCollection = new ServiceCollection();

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		// NOTE: DO NOT ADD ANY OTHER SERVICE INTO THE COLLECTION HERE.
		// CONTRIBUTE IT VIA WORKBENCH.MAIN.TS AND registerSingleton().
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

		// Log
		const logService = new SimpleLogService();
		serviceCollection.set(ILogService, logService);

		const payload = await this.resolveWorkspaceInitializationPayload();

		// Environment
		const environmentService = new BrowserWorkbenchEnvironmentService({
			workspaceId: payload.id,
			remoteAuthority: this.configuration.remoteAuthority,
			webviewEndpoint: this.configuration.webviewEndpoint
		});
		serviceCollection.set(IWorkbenchEnvironmentService, environmentService);

		// Product
		const productService = new ProductService();
		serviceCollection.set(IProductService, productService);

		// Remote
		const remoteAuthorityResolverService = new RemoteAuthorityResolverService();
		serviceCollection.set(IRemoteAuthorityResolverService, remoteAuthorityResolverService);

		// Signing
		const signService = new SignService();
		serviceCollection.set(ISignService, signService);

		// Remote Agent
		const remoteAgentService = this._register(new RemoteAgentService(environmentService, productService, remoteAuthorityResolverService, signService));
		serviceCollection.set(IRemoteAgentService, remoteAgentService);

		// Files
		const fileService = this._register(new FileService(logService));
		serviceCollection.set(IFileService, fileService);

		let userDataProvider: IFileSystemProvider | undefined = this.configuration.userDataProvider;
		const connection = remoteAgentService.getConnection();
		if (connection) {
			const channel = connection.getChannel<IChannel>(REMOTE_FILE_SYSTEM_CHANNEL_NAME);
			const remoteFileSystemProvider = this._register(new RemoteExtensionsFileSystemProvider(channel, remoteAgentService.getEnvironment()));

			fileService.registerProvider(Schemas.vscodeRemote, remoteFileSystemProvider);

			if (!userDataProvider) {
				const remoteUserDataUri = this.getRemoteUserDataUri();
				if (remoteUserDataUri) {
					userDataProvider = this._register(new FileUserDataProvider(remoteUserDataUri, joinPath(remoteUserDataUri, BACKUPS), remoteFileSystemProvider, environmentService));
				}
			}
		}

		// User Data Provider
		if (userDataProvider) {
			fileService.registerProvider(Schemas.userData, userDataProvider);
		}

		await Promise.all([
			this.createWorkspaceService(payload, environmentService, fileService, remoteAgentService, logService).then(service => {

				// Workspace
				serviceCollection.set(IWorkspaceContextService, service);

				// Configuration
				serviceCollection.set(IConfigurationService, service);

				return service;
			}),

			this.createStorageService(payload, environmentService, fileService, logService).then(service => {

				// Storage
				serviceCollection.set(IStorageService, service);

				return service;
			})
		]);

		return { serviceCollection, logService };
	}

	private async createStorageService(payload: IWorkspaceInitializationPayload, environmentService: IWorkbenchEnvironmentService, fileService: IFileService, logService: ILogService): Promise<IStorageService> {
		const storageService = new BrowserStorageService(environmentService, fileService);

		try {
			await storageService.initialize(payload);

			return storageService;
		} catch (error) {
			onUnexpectedError(error);
			logService.error(error);

			return storageService;
		}
	}

	private async createWorkspaceService(payload: IWorkspaceInitializationPayload, environmentService: IWorkbenchEnvironmentService, fileService: FileService, remoteAgentService: IRemoteAgentService, logService: ILogService): Promise<WorkspaceService> {
		const workspaceService = new WorkspaceService({ remoteAuthority: this.configuration.remoteAuthority, configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService);

		try {
			await workspaceService.initialize(payload);

			return workspaceService;
		} catch (error) {
			onUnexpectedError(error);
			logService.error(error);

			return workspaceService;
		}
	}

	private resolveWorkspaceInitializationPayload(): IWorkspaceInitializationPayload {

		// Multi-root workspace
		if (this.configuration.workspaceUri) {
			return { id: hash(URI.revive(this.configuration.workspaceUri).toString()).toString(16), configPath: URI.revive(this.configuration.workspaceUri) };
		}

		// Single-folder workspace
		if (this.configuration.folderUri) {
			return { id: hash(URI.revive(this.configuration.folderUri).toString()).toString(16), folder: URI.revive(this.configuration.folderUri) };
		}

		return { id: 'empty-window' };
	}

	private getRemoteUserDataUri(): URI | null {
		const element = document.getElementById('vscode-remote-user-data-uri');
		if (element) {
			const remoteUserDataPath = element.getAttribute('data-settings');
			if (remoteUserDataPath) {
				return joinPath(URI.revive(JSON.parse(remoteUserDataPath)), 'User');
			}
		}
		return null;
	}
}

export function main(domElement: HTMLElement, options: IWorkbenchConstructionOptions): Promise<void> {
	const renderer = new CodeRendererMain(domElement, options);

	return renderer.open();
}
