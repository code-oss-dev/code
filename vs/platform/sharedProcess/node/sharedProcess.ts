/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { LogLevel } from 'vs/platform/log/common/log';

export interface ISharedProcess {

	/**
	 * Signals the shared process has finished initialization.
	 */
	whenReady(): Promise<void>;

	/**
	 * Toggles the visibility of the otherwise hidden
	 * shared process window.
	 */
	toggle(): void;
}

export interface ISharedProcessConfiguration {
	readonly machineId: string;
	readonly windowId: number;

	readonly appRoot: string;

	readonly userEnv: NodeJS.ProcessEnv;

	readonly sharedIPCHandle: string;

	readonly args: NativeParsedArgs;

	readonly logLevel: LogLevel;

	readonly nodeCachedDataDir?: string;
	readonly backupWorkspacesPath: string;
}
