/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/extensionsViewlet';
import Event, { Emitter } from 'vs/base/common/event';
import { index } from 'vs/base/common/arrays';
import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IPager, mapPager } from 'vs/base/common/paging';
import { IExtensionManagementService, IExtensionGalleryService, ILocalExtension, IGalleryExtension, IQueryOptions } from 'vs/platform/extensionManagement/common/extensionManagement';

export enum ExtensionState {
	Installing,
	Installed,
	// Uninstalling,
	Uninstalled
}

export interface IExtension {
	state: ExtensionState;
	name: string;
	displayName: string;
	publisher: string;
	publisherDisplayName: string;
	version: string;
	description: string;
	readmeUrl: string;
	iconUrl: string;
	installCount: number;
	rating: number;
	ratingCount: number;
}

interface IExtensionStateProvider {
	(extension: Extension): ExtensionState;
}

class Extension implements IExtension {

	constructor(
		private stateProvider: IExtensionStateProvider,
		public local: ILocalExtension,
		public gallery: IGalleryExtension = null
	) {}

	get name(): string {
		return this.local ? this.local.manifest.name : this.gallery.name;
	}

	get displayName(): string {
		if (this.local) {
			return this.local.manifest.displayName || this.local.manifest.name;
		}

		return this.gallery.displayName || this.gallery.name;
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
		return this.local ? this.local.manifest.version : this.gallery.versions[0].version;
	}

	get description(): string {
		return this.local ? this.local.manifest.description : this.gallery.description;
	}

	get readmeUrl(): string {
		if (this.local && this.local.readmeUrl) {
			return this.local.readmeUrl;
		}

		if (this.gallery && this.gallery.versions[0].readmeUrl) {
			return this.gallery.versions[0].readmeUrl;
		}

		return null;
	}

	get iconUrl(): string {
		if (this.local && this.local.manifest.icon) {
			return `file://${ this.local.path }/${ this.local.manifest.icon }`;
		}

		if (this.gallery && this.gallery.versions[0].iconUrl) {
			return this.gallery.versions[0].iconUrl;
		}

		return require.toUrl('./media/defaultIcon.png');
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
}

export class ExtensionsModel {

	private disposables: IDisposable[] = [];

	private stateProvider: IExtensionStateProvider;
	private installing: { id: string; extension: Extension; }[] = [];
	private installed: Extension[] = [];

	private _onChange: Emitter<void> = new Emitter<void>();
	get onChange(): Event<void> { return this._onChange.event; }

	constructor(
		@IExtensionManagementService private extensionService: IExtensionManagementService,
		@IExtensionGalleryService private galleryService: IExtensionGalleryService
	) {
		this.stateProvider = ext => this.getExtensionState(ext);
		this.disposables.push(extensionService.onInstallExtension(({ id, gallery }) => this.onInstallExtension(id, gallery)));
		this.disposables.push(extensionService.onDidInstallExtension(({ id, local, error }) => this.onDidInstallExtension(id, local, error)));
		this.disposables.push(extensionService.onUninstallExtension((id) => this.onUninstallExtension(id)));
	}

	getLocal(): TPromise<IExtension[]> {
		return this.extensionService.getInstalled().then(result => {
			const installedById = index(this.installed, e => e.local.id);

			this.installed = result.map(local => {
				const extension = installedById[local.id] || new Extension(this.stateProvider, local);
				extension.local = local;
				return extension;
			});

			const installing = this.installing
				.filter(e => !this.installed.some(installed => installed.local.id === e.id))
				.map(e => e.extension);

			return [...this.installed, ...installing];
		});
	}

	queryGallery(options: IQueryOptions = {}): TPromise<IPager<IExtension>> {
		return this.galleryService.query(options).then(result => {
			const installedByGalleryId = index(this.installed, e => e.local.metadata ? e.local.metadata.id : '');

			return mapPager(result, gallery => {
				const id = gallery.id;
				const installed = installedByGalleryId[id];

				if (installed) {
					installed.gallery = gallery;
					return installed;
				}

				return new Extension(this.stateProvider, null, gallery);
			});
		});
	}

	canInstall(extension: IExtension): boolean {
		if (!(extension instanceof Extension)) {
			return;
		}

		return !!(extension as Extension).gallery;
	}

	install(extension: IExtension): TPromise<void> {
		if (!(extension instanceof Extension)) {
			return;
		}

		const ext = extension as Extension;
		const gallery = ext.gallery;

		if (!gallery) {
			return TPromise.wrapError<void>(new Error('Missing gallery'));
		}

		return this.extensionService.install(gallery);
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

	private onInstallExtension(id: string, gallery: IGalleryExtension): void {
		if (!gallery) {
			return;
		}

		let extension = this.installed.filter(e => (e.local.metadata && e.local.metadata.id) === gallery.id)[0];

		if (!extension) {
			extension = new Extension(this.stateProvider, null, gallery);
		}

		extension.gallery = gallery;
		this.installing.push({ id, extension });

		this._onChange.fire();
	}

	private onDidInstallExtension(id: string, local: ILocalExtension, error: Error): void {
		const installing = this.installing.filter(e => e.id === id)[0];

		if (!installing) {
			return;
		}

		const extension = installing.extension;
		extension.local = local;

		this.installing = this.installing.filter(e => e.id !== id);

		const galleryId = local.metadata && local.metadata.id;
		const installed = this.installed.filter(e => (e.local.metadata && e.local.metadata.id) === galleryId)[0];

		if (galleryId && installed) {
			installed.local = local;
		} else {
			this.installed.push(extension);
		}

		this._onChange.fire();
	}

	private onUninstallExtension(id: string): void {
		const previousLength = this.installed.length;
		this.installed = this.installed.filter(e => e.local.id !== id);

		if (previousLength === this.installed.length) {
			return;
		}

		this._onChange.fire();
	}

	private getExtensionState(extension: Extension): ExtensionState {
		if (this.installed.some(e => e === extension || (e.gallery && extension.gallery && e.gallery.id === extension.gallery.id))) {
			return ExtensionState.Installed;
		}

		if (extension.gallery && this.installing.some(e => e.extension.gallery.id === extension.gallery.id)) {
			return ExtensionState.Installing;
		}

		return ExtensionState.Uninstalled;
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}
