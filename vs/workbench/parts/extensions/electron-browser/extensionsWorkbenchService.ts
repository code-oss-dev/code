/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/extensionsViewlet';
import { localize } from 'vs/nls';
import Event, { Emitter, chain } from 'vs/base/common/event';
import { index } from 'vs/base/common/arrays';
import { LinkedMap as Map } from 'vs/base/common/map';
import { assign } from 'vs/base/common/objects';
import { isUUID } from 'vs/base/common/uuid';
import { ThrottledDelayer } from 'vs/base/common/async';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IPager, mapPager, singlePagePager } from 'vs/base/common/paging';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import {
	IExtensionManagementService, IExtensionGalleryService, ILocalExtension, IGalleryExtension, IQueryOptions, IExtensionManifest,
	InstallExtensionEvent, DidInstallExtensionEvent, LocalExtensionType, DidUninstallExtensionEvent
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { getGalleryExtensionTelemetryData, getLocalExtensionTelemetryData } from 'vs/platform/extensionManagement/common/extensionTelemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IMessageService } from 'vs/platform/message/common/message';
import Severity from 'vs/base/common/severity';
import * as semver from 'semver';
import * as path from 'path';
import URI from 'vs/base/common/uri';
import { readFile } from 'vs/base/node/pfs';
import { asText } from 'vs/base/node/request';
import { IExtension, IExtensionDependencies, ExtensionState, IExtensionsWorkbenchService, IExtensionsConfiguration, ConfigurationKey } from '../common/extensions';
import { UpdateAllAction } from './extensionsActions';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ReloadWindowAction } from 'vs/workbench/electron-browser/actions';
import { IURLService } from 'vs/platform/url/common/url';
import { ExtensionsInput } from './extensionsInput';
import { IExtensionsRuntimeService } from 'vs/platform/extensions/common/extensions';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';

interface IExtensionStateProvider {
	(extension: Extension): ExtensionState;
}

class Extension implements IExtension {

	public needsReload = false;

	constructor(
		private galleryService: IExtensionGalleryService,
		private stateProvider: IExtensionStateProvider,
		public local: ILocalExtension,
		public gallery: IGalleryExtension = null
	) { }

	get type(): LocalExtensionType {
		return this.local ? this.local.type : null;
	}

	get name(): string {
		return this.local ? this.local.manifest.name : this.gallery.name;
	}

	get displayName(): string {
		if (this.local) {
			return this.local.manifest.displayName || this.local.manifest.name;
		}

		return this.gallery.displayName || this.gallery.name;
	}

	get identifier(): string {
		return `${this.publisher}.${this.name}`;
	}

	get publisher(): string {
		return this.local ? this.local.manifest.publisher : this.gallery.publisher;
	}

	get publisherDisplayName(): string {
		if (this.local) {
			if (this.local.metadata && this.local.metadata.publisherDisplayName) {
				return this.local.metadata.publisherDisplayName;
			}

			return this.local.manifest.publisher;
		}

		return this.gallery.publisherDisplayName || this.gallery.publisher;
	}

	get version(): string {
		return this.local ? this.local.manifest.version : this.gallery.version;
	}

	get latestVersion(): string {
		return this.gallery ? this.gallery.version : this.local.manifest.version;
	}

	get description(): string {
		return this.local ? this.local.manifest.description : this.gallery.description;
	}

	private get readmeUrl(): string {
		if (this.local && this.local.readmeUrl) {
			return this.local.readmeUrl;
		}

		return this.gallery && this.gallery.assets.readme;
	}

	private get changelogUrl(): string {
		if (this.local && this.local.changelogUrl) {
			return this.local.changelogUrl;
		}

		return this.gallery && this.gallery.assets.changelog;
	}

	get iconUrl(): string {
		return this.localIconUrl || this.galleryIconUrl || this.defaultIconUrl;
	}

	get iconUrlFallback(): string {
		return this.localIconUrl || this.galleryIconUrlFallback || this.defaultIconUrl;
	}

	private get localIconUrl(): string {
		return this.local && this.local.manifest.icon
			&& URI.file(path.join(this.local.path, this.local.manifest.icon)).toString();
	}

	private get galleryIconUrl(): string {
		return this.gallery && this.gallery.assets.icon;
	}

	private get galleryIconUrlFallback(): string {
		return this.gallery && this.gallery.assets.iconFallback;
	}

	private get defaultIconUrl(): string {
		return require.toUrl('./media/defaultIcon.png');
	}

	get licenseUrl(): string {
		return this.gallery && this.gallery.assets.license;
	}

	get state(): ExtensionState {
		return this.stateProvider(this);
	}

	get installCount(): number {
		return this.gallery ? this.gallery.installCount : null;
	}

	get rating(): number {
		return this.gallery ? this.gallery.rating : null;
	}

	get ratingCount(): number {
		return this.gallery ? this.gallery.ratingCount : null;
	}

	get outdated(): boolean {
		return this.type === LocalExtensionType.User && semver.gt(this.latestVersion, this.version);
	}

	get reload(): boolean {
		return this.needsReload;
	}

	get telemetryData(): any {
		const { local, gallery } = this;

		if (gallery) {
			return getGalleryExtensionTelemetryData(gallery);
		} else {
			return getLocalExtensionTelemetryData(local);
		}
	}

	getManifest(): TPromise<IExtensionManifest> {
		if (this.local) {
			return TPromise.as(this.local.manifest);
		}

		return this.galleryService.getAsset(this.gallery.assets.manifest)
			.then(asText)
			.then(raw => JSON.parse(raw) as IExtensionManifest);
	}

	getReadme(): TPromise<string> {
		const readmeUrl = this.readmeUrl;

		if (!readmeUrl) {
			return TPromise.wrapError('not available');
		}

		const uri = URI.parse(readmeUrl);

		if (uri.scheme === 'file') {
			return readFile(uri.fsPath, 'utf8');
		}

		return this.galleryService.getAsset(readmeUrl).then(asText);
	}

	get hasChangelog(): boolean {
		return !!(this.changelogUrl);
	}

	getChangelog(): TPromise<string> {
		const changelogUrl = this.changelogUrl;

		if (!changelogUrl) {
			return TPromise.wrapError('not available');
		}

		const uri = URI.parse(changelogUrl);

		if (uri.scheme === 'file') {
			return readFile(uri.fsPath, 'utf8');
		}

		return TPromise.wrapError('not available');
	}

	get dependencies(): string[] {
		const { local, gallery } = this;
		if (gallery) {
			return gallery.properties.dependencies;
		}
		if (local) {
			return local.manifest.extensionDependencies && local.manifest.extensionDependencies;
		}
		return [];
	}
}

class ExtensionDependencies implements IExtensionDependencies {

	constructor(private _extension: IExtension, private _identifier: string, private _map: Map<string, Extension>, private _dependent: IExtensionDependencies = null) { }

	get hasDependencies(): boolean {
		return this._extension ? this._extension.dependencies.length > 0 : false;
	}

	get extension(): IExtension {
		return this._extension;
	}

	get identifier(): string {
		return this._identifier;
	}

	get dependent(): IExtensionDependencies {
		return this._dependent;
	}

	get dependencies(): IExtensionDependencies[] {
		return this._extension.dependencies.map(d => new ExtensionDependencies(this._map.get(d), d, this._map, this));
	}
}

function stripVersion(id: string): string {
	return id.replace(/-\d+\.\d+\.\d+$/, '');
}

enum Operation {
	Installing,
	Updating,
	Uninstalling
}

interface IActiveExtension {
	id: string;
	operation: Operation;
	extension: Extension;
	start: Date;
}

function toTelemetryEventName(operation: Operation) {
	switch (operation) {
		case Operation.Installing: return 'extensionGallery:install';
		case Operation.Updating: return 'extensionGallery:update';
		case Operation.Uninstalling: return 'extensionGallery:uninstall';
	}

	return '';
}

export class ExtensionsWorkbenchService implements IExtensionsWorkbenchService {

	private static SyncPeriod = 1000 * 60 * 60 * 12; // 12 hours

	_serviceBrand: any;
	private stateProvider: IExtensionStateProvider;
	private installing: IActiveExtension[] = [];
	private uninstalling: IActiveExtension[] = [];
	private installed: Extension[] = [];
	private syncDelayer: ThrottledDelayer<void>;
	private autoUpdateDelayer: ThrottledDelayer<void>;
	private disposables: IDisposable[] = [];

	// TODO: @sandy - Remove these when IExtensionsRuntimeService exposes sync API to get extensions.
	private newlyInstalled: Extension[] = [];
	private unInstalled: Extension[] = [];

	private _onChange: Emitter<void> = new Emitter<void>();
	get onChange(): Event<void> { return this._onChange.event; }

	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService,
		@IExtensionManagementService private extensionService: IExtensionManagementService,
		@IExtensionGalleryService private galleryService: IExtensionGalleryService,
		@IConfigurationService private configurationService: IConfigurationService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@IMessageService private messageService: IMessageService,
		@IURLService urlService: IURLService,
		@IExtensionsRuntimeService private extensionsRuntimeService: IExtensionsRuntimeService,
		@IWorkspaceContextService private workspaceContextService: IWorkspaceContextService,
	) {
		this.stateProvider = ext => this.getExtensionState(ext);

		extensionService.onInstallExtension(this.onInstallExtension, this, this.disposables);
		extensionService.onDidInstallExtension(this.onDidInstallExtension, this, this.disposables);
		extensionService.onUninstallExtension(this.onUninstallExtension, this, this.disposables);
		extensionService.onDidUninstallExtension(this.onDidUninstallExtension, this, this.disposables);

		this.syncDelayer = new ThrottledDelayer<void>(ExtensionsWorkbenchService.SyncPeriod);
		this.autoUpdateDelayer = new ThrottledDelayer<void>(1000);

		chain(urlService.onOpenURL)
			.filter(uri => /^extension/.test(uri.path))
			.on(this.onOpenExtensionUrl, this, this.disposables);

		this.queryLocal().done(() => this.eventuallySyncWithGallery(true));
	}

	get local(): IExtension[] {
		const installing = this.installing
			.filter(e => !this.installed.some(installed => stripVersion(installed.local.id) === e.id))
			.map(e => e.extension);

		return [...this.installed, ...installing];
	}

	queryLocal(): TPromise<IExtension[]> {
		return this.extensionService.getInstalled().then(result => {
			const installedById = index(this.installed, e => e.local.id);

			this.installed = result.map(local => {
				const extension = installedById[local.id] || new Extension(this.galleryService, this.stateProvider, local);
				extension.local = local;
				return extension;
			});

			this._onChange.fire();
			return this.local;
		});
	}

	queryGallery(options: IQueryOptions = {}): TPromise<IPager<IExtension>> {
		return this.galleryService.query(options)
			.then(result => mapPager(result, gallery => this.fromGallery(gallery)))
			.then(null, err => {
				if (/No extension gallery service configured/.test(err.message)) {
					return TPromise.as(singlePagePager([]));
				}

				return TPromise.wrapError(err);
			});
	}

	loadDependencies(extension: IExtension): TPromise<IExtensionDependencies> {
		if (!extension.dependencies.length) {
			return TPromise.wrap(null);
		}

		return this.galleryService.getAllDependencies((<Extension>extension).gallery)
			.then(galleryExtensions => galleryExtensions.map(galleryExtension => this.fromGallery(galleryExtension)))
			.then(extensions => {
				const map = new Map<string, Extension>();
				for (const extension of extensions) {
					map.set(`${extension.publisher}.${extension.name}`, extension);
				}
				return new ExtensionDependencies(extension, extension.identifier, map);
			});
	}

	open(extension: IExtension, sideByside: boolean = false): TPromise<any> {
		return this.editorService.openEditor(this.instantiationService.createInstance(ExtensionsInput, extension), null, sideByside);
	}

	private fromGallery(gallery: IGalleryExtension): Extension {
		const installedByGalleryId = index(this.installed, e => e.local.metadata ? e.local.metadata.id : '');
		const id = gallery.id;
		const installed = installedByGalleryId[id];

		if (installed) {
			// Loading the compatible version only there is an engine property
			// Otherwise falling back to old way so that we will not make many roundtrips
			if (gallery.properties.engine) {
				this.galleryService.loadCompatibleVersion(gallery).then(compatible => this.syncLocalWithGalleryExtension(installed, compatible));
			} else {
				this.syncLocalWithGalleryExtension(installed, gallery);
			}
			return installed;
		}

		return new Extension(this.galleryService, this.stateProvider, null, gallery);
	}

	private syncLocalWithGalleryExtension(local: Extension, gallery: IGalleryExtension) {
		local.gallery = gallery;
		this._onChange.fire();
		this.eventuallyAutoUpdateExtensions();
	}

	private eventuallySyncWithGallery(immediate = false): void {
		const loop = () => this.syncWithGallery().then(() => this.eventuallySyncWithGallery());
		const delay = immediate ? 0 : ExtensionsWorkbenchService.SyncPeriod;

		this.syncDelayer.trigger(loop, delay)
			.done(null, err => null);
	}

	private syncWithGallery(): TPromise<void> {
		const ids = this.installed
			.filter(e => !!(e.local && e.local.metadata))
			.map(e => e.local.metadata.id)
			.filter(id => isUUID(id));

		if (ids.length === 0) {
			return TPromise.as(null);
		}

		return this.queryGallery({ ids, pageSize: ids.length }) as TPromise<any>;
	}

	private eventuallyAutoUpdateExtensions(): void {
		this.autoUpdateDelayer.trigger(() => this.autoUpdateExtensions())
			.done(null, err => null);
	}

	private autoUpdateExtensions(): TPromise<void> {
		const config = this.configurationService.getConfiguration<IExtensionsConfiguration>(ConfigurationKey);

		if (!config.autoUpdate) {
			return TPromise.as(null);
		}

		const action = this.instantiationService.createInstance(UpdateAllAction, UpdateAllAction.ID, UpdateAllAction.LABEL);

		if (!action.enabled) {
			return TPromise.as(null);
		}

		return action.run(false);
	}

	canInstall(extension: IExtension): boolean {
		if (!(extension instanceof Extension)) {
			return;
		}

		return !!(extension as Extension).gallery;
	}

	install(extension: string | IExtension, promptToInstallDependencies: boolean = true): TPromise<void> {
		if (typeof extension === 'string') {
			return this.extensionService.install(extension);
		}

		if (!(extension instanceof Extension)) {
			return;
		}

		const ext = extension as Extension;
		const gallery = ext.gallery;

		if (!gallery) {
			return TPromise.wrapError<void>(new Error('Missing gallery'));
		}

		return this.extensionService.installFromGallery(gallery, promptToInstallDependencies);
	}

	setEnablement(extension: IExtension, enable: boolean, workspace: boolean = false): TPromise<any> {
		if (extension.type === LocalExtensionType.System) {
			return TPromise.wrap(null);
		}

		return this.doSetEnablement(extension, enable, workspace).then(reload => {
			(<Extension>extension).needsReload = reload;
			this.telemetryService.publicLog(enable ? 'extension:enable' : 'extension:disable', extension.telemetryData);
			this._onChange.fire();
		});
	}

	uninstall(extension: IExtension): TPromise<void> {
		if (!(extension instanceof Extension)) {
			return;
		}

		const ext = extension as Extension;
		const local = ext.local || this.installed.filter(e => e.local.metadata && ext.gallery && e.local.metadata.id === ext.gallery.id)[0].local;

		if (!local) {
			return TPromise.wrapError<void>(new Error('Missing local'));
		}

		return this.extensionService.uninstall(local);
	}

	private doSetEnablement(extension: IExtension, enable: boolean, workspace: boolean): TPromise<boolean> {
		if (workspace) {
			return this.extensionsRuntimeService.setEnablement(extension.identifier, enable, workspace);
		}

		const globalElablement = this.extensionsRuntimeService.setEnablement(extension.identifier, enable, false);
		if (!this.workspaceContextService.getWorkspace()) {
			return globalElablement;
		}
		return TPromise.join([globalElablement, this.extensionsRuntimeService.setEnablement(extension.identifier, enable, true)])
			.then(values => values[0] || values[1]);
	}

	private onInstallExtension(event: InstallExtensionEvent): void {
		const { id, gallery } = event;

		if (!gallery) {
			return;
		}

		let extension = this.installed.filter(e => (e.local && e.local.metadata && e.local.metadata.id) === gallery.id)[0];

		if (!extension) {
			extension = new Extension(this.galleryService, this.stateProvider, null, gallery);
		}

		extension.gallery = gallery;

		const start = new Date();
		const operation = Operation.Installing;
		this.installing.push({ id: stripVersion(id), operation, extension, start });

		this._onChange.fire();
	}

	private onDidInstallExtension(event: DidInstallExtensionEvent): void {
		const { local, zipPath, error } = event;
		const id = stripVersion(event.id);
		const installing = this.installing.filter(e => e.id === id)[0];

		if (!installing) {
			if (zipPath) {
				this.messageService.show(
					Severity.Info,
					{
						message: localize('successSingle', "'{0}' was successfully installed. Restart to enable it.", id),
						actions: [this.instantiationService.createInstance(ReloadWindowAction, ReloadWindowAction.ID, localize('reloadNow', "Restart Now"))]
					}
				);
			}

			return;
		}

		const extension = installing.extension;
		this.installing = this.installing.filter(e => e.id !== id);

		if (!error) {
			this.newlyInstalled.push(extension);
			extension.local = local;
			extension.needsReload = true;

			const galleryId = local.metadata && local.metadata.id;
			const installed = this.installed.filter(e => (e.local && e.local.metadata && e.local.metadata.id) === galleryId)[0];

			if (galleryId && installed) {
				installing.operation = Operation.Updating;
				installed.local = local;
			} else {
				this.installed.push(extension);
			}
		}

		this.reportTelemetry(installing, !error);
		this._onChange.fire();
	}

	private onUninstallExtension(id: string): void {
		const extension = this.installed.filter(e => e.local.id === id)[0];
		const newLength = this.installed.filter(e => e.local.id !== id).length;
		// TODO: Ask @Joao why is this?
		if (newLength === this.installed.length) {
			return;
		}

		const start = new Date();
		const operation = Operation.Uninstalling;
		const uninstalling = this.uninstalling.filter(e => e.id === id)[0] || { id, operation, extension, start };
		this.uninstalling = [uninstalling, ...this.uninstalling.filter(e => e.id !== id)];

		this._onChange.fire();
	}

	private onDidUninstallExtension({id, error}: DidUninstallExtensionEvent): void {
		let newlyInstalled = false;
		if (!error) {
			newlyInstalled = this.newlyInstalled.filter(e => e.local.id === id).length > 0;
			this.newlyInstalled = this.newlyInstalled.filter(e => e.local.id !== id);
			this.installed = this.installed.filter(e => e.local.id !== id);
		}

		const uninstalling = this.uninstalling.filter(e => e.id === id)[0];
		this.uninstalling = this.uninstalling.filter(e => e.id !== id);
		if (!uninstalling) {
			return;
		}

		if (!error) {
			this.unInstalled.push(uninstalling.extension);
			uninstalling.extension.needsReload = !newlyInstalled;
			this.reportTelemetry(uninstalling, true);
		}

		this._onChange.fire();
	}

	private getExtensionState(extension: Extension): ExtensionState {
		if (extension.gallery && this.installing.some(e => e.extension.gallery.id === extension.gallery.id)) {
			return ExtensionState.Installing;
		}

		if (extension.gallery && this.uninstalling.some(e => e.extension.gallery.id === extension.gallery.id)) {
			return ExtensionState.Uninstalling;
		}

		const local = this.installed.filter(e => e === extension || (e.gallery && extension.gallery && e.gallery.id === extension.gallery.id))[0];

		if (local) {
			if (this.newlyInstalled.some(e => e.gallery && extension.gallery && e.gallery.id === extension.gallery.id)) {
				return ExtensionState.Installed;
			}
			return this.extensionsRuntimeService.isDisabled(extension.identifier) ? ExtensionState.Disabled : ExtensionState.Enabled;
		}

		return ExtensionState.Uninstalled;
	}

	private reportTelemetry(active: IActiveExtension, success: boolean): void {
		const data = active.extension.telemetryData;
		const duration = new Date().getTime() - active.start.getTime();
		const eventName = toTelemetryEventName(active.operation);

		this.telemetryService.publicLog(eventName, assign(data, { success, duration }));
	}

	private onError(err: any): void {
		if (isPromiseCanceledError(err)) {
			return;
		}

		const message = err && err.message || '';

		if (/getaddrinfo ENOTFOUND|getaddrinfo ENOENT|connect EACCES|connect ECONNREFUSED/.test(message)) {
			return;
		}

		this.messageService.show(Severity.Error, err);
	}

	private onOpenExtensionUrl(uri: URI): void {
		const match = /^extension\/([^/]+)$/.exec(uri.path);

		if (!match) {
			return;
		}

		const extensionId = match[1];

		this.queryGallery({ names: [extensionId] })
			.done(result => {
				if (result.total < 1) {
					return;
				}

				const extension = result.firstPage[0];
				this.open(extension).done(null, error => this.onError(error));
			});
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}