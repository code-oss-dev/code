/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { IExtension, IExtensionManifest, IExtensionManagementService, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { TPromise } from 'vs/base/common/winjs.base';
import * as semver from 'semver';

export function getExtensionId(extension: IExtension): string {
	return `${ extension.publisher }.${ extension.name }`;
}

export function extensionEquals(one: IExtensionManifest, other: IExtensionManifest): boolean {
	return one.publisher === other.publisher && one.name === other.name;
}

export function getTelemetryData(extension: any): any {
	return {};
	// TODO
	// return {
	// 	id: getExtensionId(extension),
	// 	name: extension.name,
	// 	galleryId: extension.galleryInformation ? extension.galleryInformation.id : null,
	// 	publisherId: extension.galleryInformation ? extension.galleryInformation.publisherId : null,
	// 	publisherName: extension.publisher,
	// 	publisherDisplayName: extension.galleryInformation ? extension.galleryInformation.publisherDisplayName : null
	// };
}

export function getOutdatedExtensions(extensionsService: IExtensionManagementService, galleryService: IExtensionGalleryService): TPromise<IExtension[]> {
	if (!galleryService.isEnabled()) {
		return TPromise.as([]);
	}

	return extensionsService.getInstalled().then(installed => {
		const ids = installed.map(getExtensionId);

		return galleryService.query({ ids, pageSize: 1000 }).then(result => {
			const available = result.firstPage;

			return available.map(extension => {
				const local = installed.filter(local => extensionEquals(local, extension.manifest))[0];
				if (local && semver.lt(local.version, extension.manifest.version)) {
					return local;
				} else {
					return null;
				}
			}).filter(e => !!e);
		});
	});
}