/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'http-proxy-agent' {

	class HttpProxyAgent {
		constructor(proxy: string);
	}
	export = HttpProxyAgent;
}