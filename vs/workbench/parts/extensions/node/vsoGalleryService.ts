/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { assign } from 'vs/base/common/objects';
import { TPromise } from 'vs/base/common/winjs.base';
import { IGalleryService, IExtension } from 'vs/workbench/parts/extensions/common/extensions';
import { IXHRResponse } from 'vs/base/common/http';
import { IRequestService } from 'vs/platform/request/common/request';
import { IWorkspaceContextService } from 'vs/workbench/services/workspace/common/contextService';

import { nfcall } from 'vs/base/common/async';
import * as fs from 'fs';

export interface IGalleryExtensionFile {
	assetType: string;
}

export interface IGalleryExtensionVersion {
	version: string;
	lastUpdated: string;
	assetUri: string;
	files: IGalleryExtensionFile[];
}

export interface IGalleryExtension {
	extensionId: string;
	extensionName: string;
	displayName: string;
	shortDescription: string;
	publisher: { displayName: string, publisherId: string, publisherName: string; };
	versions: IGalleryExtensionVersion[];
	galleryApiUrl: string;
	statistics: IGalleryExtensionStatistics[];
}

export interface IGalleryExtensionStatistics {
	statisticName: string;
	value: number;
}

function getInstallCount(statistics: IGalleryExtensionStatistics[]): number {
	if (!statistics) {
		return 0;
	}

	const result = statistics.filter(s => s.statisticName === 'install')[0];
	return result ? result.value : 0;
}

const FIVE_MINUTES = 1000 * 60 * 5;

export class GalleryService implements IGalleryService {

	serviceId = IGalleryService;

	private extensionsGalleryUrl: string;
	private extensionsCacheUrl: string;

	constructor(
		@IRequestService private requestService: IRequestService,
		@IWorkspaceContextService contextService: IWorkspaceContextService
	) {
		const config = contextService.getConfiguration().env.extensionsGallery;
		this.extensionsGalleryUrl = config && config.serviceUrl;
		this.extensionsCacheUrl = config && config.cacheUrl;
	}

	private api(path = ''): string {
		return `${ this.extensionsGalleryUrl }${ path }`;
	}

	isEnabled(): boolean {
		return !!this.extensionsGalleryUrl;
	}

	query(): TPromise<IExtension[]> {
		if (!this.isEnabled()) {
			return TPromise.wrapError(new Error('No extension gallery service configured.'));
		}

		const gallery = this.queryGallery();
		const cache = this.queryCache().then(r => {
			const rawLastModified = r.getResponseHeader('last-modified');

			if (!rawLastModified) {
				return gallery;
			}

			const lastModified = new Date(rawLastModified).getTime();
			const now = new Date().getTime();
			const diff = now - lastModified;

			if (diff > FIVE_MINUTES) {
				return gallery;
			}

			gallery.cancel();
			return TPromise.as(r);
		}, err => gallery);

		return cache
			.then<IGalleryExtension[]>(r => JSON.parse(r.responseText).results[0].extensions || [])
			.then<IExtension[]>(extensions => {
				return extensions.map(extension => ({
					name: extension.extensionName,
					displayName: extension.displayName || extension.extensionName,
					publisher: extension.publisher.publisherName,
					version: extension.versions[0].version,
					description: extension.shortDescription || '',
					galleryInformation: {
						galleryApiUrl: this.extensionsGalleryUrl,
						id: extension.extensionId,
						downloadUrl: `${ extension.versions[0].assetUri }/Microsoft.VisualStudio.Services.VSIXPackage?install=true`,
						publisherId: extension.publisher.publisherId,
						publisherDisplayName: extension.publisher.displayName,
						installCount: getInstallCount(extension.statistics),
						date: extension.versions[0].lastUpdated,
					}
				}));
			});
	}

	private queryCache(): TPromise<IXHRResponse> {
		const url = this.extensionsCacheUrl;
		return this.requestService.makeRequest({ url });
	}

	private queryGallery(): TPromise<IXHRResponse> {
		const data = JSON.stringify({
			filters: [{
				criteria:[{
					filterType: 1,
					value: 'vscode'
				}]
			}],
			flags: 0x1 | 0x4 | 0x80 | 0x100
		});

		const request = {
			type: 'POST',
			url: this.api('/extensionquery'),
			data: data,
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json;api-version=3.0-preview.1',
				'Content-Length': data.length
			}
		};

		return this.requestService.makeRequest(request);
	}
}