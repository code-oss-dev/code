/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { URI } from 'vs/base/common/uri';

const TRUSTED_DOMAINS_URI = URI.parse('trustedDomains:/Trusted Domains');

export const configureTrustedDomainSettingsCommand = {
	id: 'workbench.action.configureTrustedDomain',
	description: {
		description: localize('trustedDomain.configureTrustedDomain', 'Configure Trusted Domains'),
		args: []
	},
	handler: async (accessor: ServicesAccessor) => {
		const editorService = accessor.get(IEditorService);
		editorService.openEditor({ resource: TRUSTED_DOMAINS_URI, mode: 'jsonc' });
		return;
	}
};

export async function configureOpenerTrustedDomainsHandler(
	trustedDomains: string[],
	domainToConfigure: string,
	quickInputService: IQuickInputService,
	storageService: IStorageService,
	editorService: IEditorService
) {
	const openAllLinksItem: IQuickPickItem = {
		type: 'item',
		label: localize('trustedDomain.trustAllAndOpenLink', 'Disable Link Protection and open link'),
		id: '*',
		picked: trustedDomains.indexOf('*') !== -1
	};
	const trustDomainAndOpenLinkItem: IQuickPickItem = {
		type: 'item',
		label: localize('trustedDomain.trustDomainAndOpenLink', 'Trust {0} and open link', domainToConfigure),
		id: domainToConfigure,
		picked: true
	};
	const configureTrustedDomainItem: IQuickPickItem = {
		type: 'item',
		label: localize('trustedDomain.configureTrustedDomains', 'Configure Trusted Domains'),
		id: 'configure'
	};

	const pickedResult = await quickInputService.pick([openAllLinksItem, trustDomainAndOpenLinkItem, configureTrustedDomainItem], {
		activeItem: trustDomainAndOpenLinkItem
	});

	if (pickedResult) {
		if (pickedResult.id === 'configure') {
			editorService.openEditor({
				resource: TRUSTED_DOMAINS_URI,
				mode: 'jsonc'
			});
			return trustedDomains;
		}
		if (pickedResult.id && trustedDomains.indexOf(pickedResult.id) === -1) {
			storageService.store(
				'http.linkProtectionTrustedDomains',
				JSON.stringify([...trustedDomains, pickedResult.id]),
				StorageScope.GLOBAL
			);

			return [...trustedDomains, pickedResult.id];
		}
	}

	return [];
}
