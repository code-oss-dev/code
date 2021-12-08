/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import minimist = require('minimist');
import { join } from 'path';
import { Application } from '../../../../automation';
import { installCommonAfterHandlers, installCommonBeforeEachHandler, startApp } from '../../utils';

export function setup(args: minimist.ParsedArgs) {
	describe('Launch', () => {

		let app: Application | undefined;

		installCommonBeforeEachHandler();
		installCommonAfterHandlers(args, () => app);

		it(`verifies that application launches when user data directory has non-ascii characters`, async function () {
			const massagedOptions = { ...this.defaultOptions, userDataDir: join(this.defaultOptions.userDataDir, 'ø') };
			app = await startApp(args, massagedOptions);

			await app.stop();
			app = undefined;
		});
	});
}
