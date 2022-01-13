/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TerminalCapability } from 'vs/platform/terminal/common/terminal';
import { ICommandDetectionCapability } from 'vs/workbench/contrib/terminal/common/terminal';

export class CommandDetectionCapability implements ICommandDetectionCapability {
	readonly type = TerminalCapability.CommandDetection;
}
