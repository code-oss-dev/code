/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { IDownloadService } from 'vs/platform/download/common/download';
import { TPromise } from 'vs/base/common/winjs.base';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { copy } from 'vs/base/node/pfs';
import { IRequestService } from 'vs/platform/request/node/request';
import { asText, download } from 'vs/base/node/request';
import { CancellationToken } from 'vs/base/common/cancellation';

export class DownloadService implements IDownloadService {

	_serviceBrand: any;

	constructor(
		@IRequestService private requestService: IRequestService
	) { }

	download(uri: URI, target: string, cancellationToken: CancellationToken = CancellationToken.None): TPromise<void> {
		if (uri.scheme === Schemas.file) {
			return copy(uri.fsPath, target);
		}
		const options = { type: 'GET', url: uri.toString() };
		return this.requestService.request(options, cancellationToken)
			.then(context => {
				if (context.res.statusCode === 200) {
					return download(target, context);
				}
				return asText(context)
					.then(message => TPromise.wrapError(new Error(`Expected 200, got back ${context.res.statusCode} instead.\n\n${message}`)));
			});
	}
}