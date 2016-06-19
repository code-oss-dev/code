/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/extensionsViewlet';
import Event, { Emitter } from 'vs/base/common/event';
import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IPager, mapPager } from 'vs/base/common/paging';
import { IExtensionManagementService, IExtensionGalleryService, ILocalExtension, IGalleryExtension, IQueryOptions } from 'vs/platform/extensionManagement/common/extensionManagement';

export enum ExtensionState {
	Installing,
	Installed,
	Uninstalling,
	Uninstalled
}

export interface IExtension {
	name: string;
	displayName: string;
	publisher: string;
	publisherDisplayName: string;
	version: string;
	description: string;
	iconUrl: string;
}

class Extension implements IExtension {

	constructor(
		public local: ILocalExtension,
		public gallery: IGalleryExtension = null
	) {

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

	get iconUrl(): string {
		if (this.local && this.local.manifest.icon) {
			return `file://${ this.local.path }/${ this.local.manifest.icon }`;
		}

		if (this.gallery && this.gallery.versions[0].iconUrl) {
			return this.gallery.versions[0].iconUrl;
		}

		return require.toUrl('./media/defaultIcon.png');
	}
}

export class ExtensionsModel {

	private disposables: IDisposable[] = [];

	// private installing: Extension[];
	// private installed: Extension[];

	private _onChange: Emitter<void>;
	get onChange(): Event<void> { return this._onChange.event; }

	constructor(
		@IExtensionManagementService private extensionService: IExtensionManagementService,
		@IExtensionGalleryService private galleryService: IExtensionGalleryService
	) {
		// todo
	}

	getInstalled(): TPromise<IExtension[]> {
		return this.extensionService.getInstalled()
			.then(result => result.map(local => new Extension(local)));
	}

	queryGallery(options: IQueryOptions = {}): TPromise<IPager<IExtension>> {
		return this.galleryService.query(options)
			.then(result => mapPager(result, gallery => new Extension(null, gallery)));
	}

	getState(extension: IExtension): ExtensionState {
		throw new Error('not implemented');
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}
