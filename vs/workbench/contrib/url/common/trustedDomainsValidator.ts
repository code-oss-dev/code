/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import Severity from 'vs/base/common/severity';
import { equalsIgnoreCase } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IProductService } from 'vs/platform/product/common/product';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { configureOpenerTrustedDomainsHandler } from 'vs/workbench/contrib/url/common/trustedDomains';

export class OpenerValidatorContributions implements IWorkbenchContribution {
	constructor(
		@IOpenerService private readonly _openerService: IOpenerService,
		@IStorageService private readonly _storageService: IStorageService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IProductService private readonly _productService: IProductService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService
	) {
		this._openerService.registerValidator({ shouldOpen: r => this.validateLink(r) });
	}

	async validateLink(resource: URI): Promise<boolean> {
		const { scheme, authority } = resource;

		if (!equalsIgnoreCase(scheme, Schemas.http) && !equalsIgnoreCase(scheme, Schemas.https)) {
			return true;
		}

		const domainToOpen = `${scheme}://${authority}`;
		const trustedDomains = readTrustedDomains(this._storageService, this._productService);

		if (isURLDomainTrusted(resource, trustedDomains)) {
			return true;
		} else {
			const { choice } = await this._dialogService.show(
				Severity.Info,
				localize(
					'openExternalLinkAt',
					'Do you want {0} to open the external website?\n{1}',
					this._productService.nameShort,
					resource.toString(true)
				),
				[
					localize('openLink', 'Open Link'),
					localize('cancel', 'Cancel'),
					localize('configureTrustedDomains', 'Configure Trusted Domains')
				],
				{
					cancelId: 1
				}
			);

			// Open Link
			if (choice === 0) {
				return true;
			}
			// Configure Trusted Domains
			else if (choice === 2) {
				const pickedDomains = await configureOpenerTrustedDomainsHandler(
					trustedDomains,
					domainToOpen,
					this._quickInputService,
					this._storageService
				);
				// Trust all domains
				if (pickedDomains.indexOf('*') !== -1) {
					return true;
				}
				// Trust current domain
				if (pickedDomains.indexOf(domainToOpen) !== -1) {
					return true;
				}
				return false;
			}

			return false;
		}
	}
}

function readTrustedDomains(storageService: IStorageService, productService: IProductService) {
	let trustedDomains: string[] = productService.linkProtectionTrustedDomains
		? [...productService.linkProtectionTrustedDomains]
		: [];

	try {
		const trustedDomainsSrc = storageService.get('http.linkProtectionTrustedDomains', StorageScope.GLOBAL);
		if (trustedDomainsSrc) {
			trustedDomains = JSON.parse(trustedDomainsSrc);
		}
	} catch (err) { }

	return trustedDomains;
}

const rLocalhost = /^localhost(:\d+)?$/i;
const r127 = /^127.0.0.1(:\d+)?$/;

function isLocalhostAuthority(authority: string) {
	return rLocalhost.test(authority) || r127.test(authority);
}

/**
 * Check whether a domain like https://www.microsoft.com matches
 * the list of trusted domains.
 *
 * - Schemes must match
 * - There's no subdomain matching. For example https://microsoft.com doesn't match https://www.microsoft.com
 * - Star matches all. For example https://*.microsoft.com matches https://www.microsoft.com
 */
export function isURLDomainTrusted(url: URI, trustedDomains: string[]) {
	if (isLocalhostAuthority(url.authority)) {
		return true;
	}

	const domain = `${url.scheme}://${url.authority}`;

	for (let i = 0; i < trustedDomains.length; i++) {
		if (trustedDomains[i] === '*') {
			return true;
		}

		if (trustedDomains[i] === domain) {
			return true;
		}

		if (trustedDomains[i].indexOf('*') !== -1) {
			const parsedTrustedDomain = URI.parse(trustedDomains[i]);
			if (url.scheme === parsedTrustedDomain.scheme) {
				const authoritySegments = url.authority.split('.');
				const trustedDomainAuthoritySegments = parsedTrustedDomain.authority.split('.');

				if (authoritySegments.length === trustedDomainAuthoritySegments.length) {
					if (
						authoritySegments.every(
							(val, i) => trustedDomainAuthoritySegments[i] === '*' || val === trustedDomainAuthoritySegments[i]
						)
					) {
						return true;
					}
				}
			}
		}
	}

	return false;
}
