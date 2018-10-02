/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, EventMultiplexer } from 'vs/base/common/event';
import {
	IExtensionManagementService, ILocalExtension, IGalleryExtension, LocalExtensionType, InstallExtensionEvent, DidInstallExtensionEvent, IExtensionIdentifier, DidUninstallExtensionEvent, IReportedExtension, IGalleryMetadata,
	IExtensionManagementServerService, IExtensionManagementServer, IExtensionGalleryService
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { flatten } from 'vs/base/common/arrays';
import { isWorkspaceExtension, areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { URI } from 'vs/base/common/uri';
import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CancellationToken } from 'vs/base/common/cancellation';

export class MulitExtensionManagementService extends Disposable implements IExtensionManagementService {

	_serviceBrand: any;

	readonly onInstallExtension: Event<InstallExtensionEvent>;
	readonly onDidInstallExtension: Event<DidInstallExtensionEvent>;
	readonly onUninstallExtension: Event<IExtensionIdentifier>;
	readonly onDidUninstallExtension: Event<DidUninstallExtensionEvent>;

	private readonly servers: IExtensionManagementServer[];
	private readonly localServer: IExtensionManagementServer;
	private readonly otherServers: IExtensionManagementServer[];

	constructor(
		@IExtensionManagementServerService private extensionManagementServerService: IExtensionManagementServerService,
		@IExtensionGalleryService private extensionGalleryService: IExtensionGalleryService,
		@IConfigurationService private configurationService: IConfigurationService
	) {
		super();
		this.servers = this.extensionManagementServerService.extensionManagementServers;
		this.localServer = this.extensionManagementServerService.getLocalExtensionManagementServer();
		this.otherServers = this.servers.filter(s => s !== this.localServer);

		this.onInstallExtension = this._register(this.servers.reduce((emitter: EventMultiplexer<InstallExtensionEvent>, server) => { emitter.add(server.extensionManagementService.onInstallExtension); return emitter; }, new EventMultiplexer<InstallExtensionEvent>())).event;
		this.onDidInstallExtension = this._register(this.servers.reduce((emitter: EventMultiplexer<DidInstallExtensionEvent>, server) => { emitter.add(server.extensionManagementService.onDidInstallExtension); return emitter; }, new EventMultiplexer<DidInstallExtensionEvent>())).event;
		this.onUninstallExtension = this._register(this.servers.reduce((emitter: EventMultiplexer<IExtensionIdentifier>, server) => { emitter.add(server.extensionManagementService.onUninstallExtension); return emitter; }, new EventMultiplexer<IExtensionIdentifier>())).event;
		this.onDidUninstallExtension = this._register(this.servers.reduce((emitter: EventMultiplexer<DidUninstallExtensionEvent>, server) => { emitter.add(server.extensionManagementService.onDidUninstallExtension); return emitter; }, new EventMultiplexer<DidUninstallExtensionEvent>())).event;
	}

	getInstalled(type?: LocalExtensionType): Promise<ILocalExtension[]> {
		return Promise.all(this.servers.map(({ extensionManagementService }) => extensionManagementService.getInstalled(type)))
			.then(result => flatten(result));
	}

	uninstall(extension: ILocalExtension, force?: boolean): Promise<void> {
		return this.getServer(extension).extensionManagementService.uninstall(extension, force);
	}

	reinstallFromGallery(extension: ILocalExtension): Promise<void> {
		return this.getServer(extension).extensionManagementService.reinstallFromGallery(extension);
	}

	updateMetadata(extension: ILocalExtension, metadata: IGalleryMetadata): Promise<ILocalExtension> {
		return this.getServer(extension).extensionManagementService.updateMetadata(extension, metadata);
	}

	zip(extension: ILocalExtension): Promise<URI> {
		throw new Error('Not Supported');
	}

	unzip(zipLocation: URI, type: LocalExtensionType): Promise<IExtensionIdentifier> {
		return Promise.all(this.servers.map(({ extensionManagementService }) => extensionManagementService.unzip(zipLocation, type))).then(() => null);
	}

	install(vsix: URI): Promise<IExtensionIdentifier> {
		return this.localServer.extensionManagementService.install(vsix)
			.then(extensionIdentifer => this.localServer.extensionManagementService.getInstalled(LocalExtensionType.User)
				.then(installed => {
					const extension = installed.filter(i => areSameExtensions(i.identifier, extensionIdentifer))[0];
					if (this.otherServers.length && extension && isWorkspaceExtension(extension.manifest, this.configurationService)) {
						return Promise.all(this.otherServers.map(server => server.extensionManagementService.install(vsix)))
							.then(() => extensionIdentifer);
					}
					return extensionIdentifer;
				}));
	}

	installFromGallery(gallery: IGalleryExtension): Promise<void> {
		if (this.otherServers.length === 0) {
			return this.localServer.extensionManagementService.installFromGallery(gallery);
		}
		return this.extensionGalleryService.getManifest(gallery, CancellationToken.None)
			.then(manifest => {
				const servers = isWorkspaceExtension(manifest, this.configurationService) ? this.servers : [this.localServer];
				return Promise.all(servers.map(server => server.extensionManagementService.installFromGallery(gallery)))
					.then(() => null);
			});
	}

	getExtensionsReport(): Promise<IReportedExtension[]> {
		return this.extensionManagementServerService.getLocalExtensionManagementServer().extensionManagementService.getExtensionsReport();
	}

	private getServer(extension: ILocalExtension): IExtensionManagementServer {
		return this.extensionManagementServerService.getExtensionManagementServer(extension.location);
	}
}