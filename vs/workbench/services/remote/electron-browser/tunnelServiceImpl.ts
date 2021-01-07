/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from 'vs/platform/log/common/log';
import { IProductService } from 'vs/platform/product/common/productService';
import { ISignService } from 'vs/platform/sign/common/sign';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { BaseTunnelService } from 'vs/platform/remote/node/tunnelService';
import { nodeSocketFactory } from 'vs/platform/remote/node/nodeSocketFactory';

export class TunnelService extends BaseTunnelService {
	public constructor(
		@ILogService logService: ILogService,
		@ISignService signService: ISignService,
		@IProductService productService: IProductService,
		@IRemoteAgentService _remoteAgentService: IRemoteAgentService
	) {
		super(nodeSocketFactory, logService, signService, productService);
	}
}
