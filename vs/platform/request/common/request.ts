/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { localize } from 'vs/nls';
import http = require('vs/base/common/http');
import { TPromise } from 'vs/base/common/winjs.base';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IRequestOptions, IRequestContext } from 'vs/base/node/request';
import { IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/platform';

export const IRequestService = createDecorator<IRequestService>('requestService');

export interface IRequestService {
	_serviceBrand: any;

	/**
	 * Wraps the call into WinJS.XHR to allow for mocking and telemetry. Use this instead
	 * of calling WinJS.XHR directly.
	 */
	makeRequest(options: http.IXHROptions): TPromise<http.IXHRResponse>;
}

export const IRequestService2 = createDecorator<IRequestService>('requestService2');

export interface IRequestService2 {
	_serviceBrand: any;

	request(options: IRequestOptions): TPromise<IRequestContext>;
}

export interface IHTTPConfiguration {
	http?: {
		proxy?: string;
		proxyStrictSSL?: boolean;
	};
}

Registry.as<IConfigurationRegistry>(Extensions.Configuration)
	.registerConfiguration({
		id: 'http',
		order: 15,
		title: localize('httpConfigurationTitle', "HTTP"),
		type: 'object',
		properties: {
			'http.proxy': {
				type: 'string',
				pattern: '^https?://([^:]*(:[^@]*)?@)?([^:]+)(:\\d+)?/?$|^$',
				description: localize('proxy', "The proxy setting to use. If not set will be taken from the http_proxy and https_proxy environment variables")
			},
			'http.proxyStrictSSL': {
				type: 'boolean',
				default: true,
				description: localize('strictSSL', "Whether the proxy server certificate should be verified against the list of supplied CAs.")
			}
		}
	});