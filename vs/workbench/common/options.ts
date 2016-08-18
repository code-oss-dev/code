/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {IResourceInput} from 'vs/platform/editor/common/editor';
import {IUserFriendlyKeybinding} from 'vs/platform/keybinding/common/keybinding';

export interface IGlobalSettings {
	settings: any;
	settingsParseErrors?: string[];
	keybindings: IUserFriendlyKeybinding[];
}

export interface IOptions {

	/**
	 * Instructs the workbench to open the provided files right after startup.
	 */
	filesToOpen?: IResourceInput[];

	/**
	 * Instructs the workbench to create and open the provided files right after startup.
	 */
	filesToCreate?: IResourceInput[];

	/**
	 * Instructs the workbench to open a diff of the provided files right after startup.
	 */
	filesToDiff?: IResourceInput[];

	/**
	 * Instructs the workbench to install the extensions from the provided local paths.
	 */
	extensionsToInstall?: string[];

	/**
	 * The global application settings if any.
	 */
	globalSettings?: IGlobalSettings;
}