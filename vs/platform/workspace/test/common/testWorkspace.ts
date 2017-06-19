/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import URI from 'vs/base/common/uri';
import { Workspace } from "vs/platform/workspace/common/workspace";

const wsUri = URI.file('C:\\testWorkspace');
export const TestWorkspace = new Workspace(
	wsUri.toString(),
	wsUri.fsPath,
	[wsUri]
);
