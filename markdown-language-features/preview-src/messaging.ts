/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSettings } from './settings';

declare var vscode: any;

/**
 * Post a message to the markdown extension
 */
export function postMessage(type: string, body: object) {
	vscode.postMessage({
		type,
		source: getSettings().source,
		body
	});
}

/**
 * Post a command to be executed to the markdown extension
 */
export function postCommand(command: string, args: any[]) {
	postMessage('command', { command, args });
}
