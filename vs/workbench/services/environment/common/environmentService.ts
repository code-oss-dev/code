/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { refineServiceDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPath } from 'vs/platform/windows/common/windows';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { URI } from 'vs/base/common/uri';

export const IWorkbenchEnvironmentService = refineServiceDecorator<IEnvironmentService, IWorkbenchEnvironmentService>(IEnvironmentService);

/**
 * A workbench specific environment service that is only present in workbench
 * layer.
 */
export interface IWorkbenchEnvironmentService extends IEnvironmentService {

	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
	// NOTE: KEEP THIS INTERFACE AS SMALL AS POSSIBLE. AS SUCH:
	//       PUT NON-WEB PROPERTIES INTO THE NATIVE WORKBENCH
	//       ENVIRONMENT SERVICE
	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

	// --- Paths
	readonly logFile: URI;
	readonly extHostLogsPath: URI;

	// --- Extensions
	readonly extensionEnabledProposedApi?: string[];

	// --- Config
	readonly remoteAuthority?: string;
	readonly skipReleaseNotes: boolean;
	readonly skipWelcome: boolean;
	readonly disableWorkspaceTrust: boolean;
	readonly webviewExternalEndpoint: string;

	// --- Development
	readonly debugRenderer: boolean;
	readonly logExtensionHostCommunication?: boolean;

	// --- Editors to open
	readonly filesToOpenOrCreate?: IPath[] | undefined;
	readonly filesToDiff?: IPath[] | undefined;

	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
	// NOTE: KEEP THIS INTERFACE AS SMALL AS POSSIBLE. AS SUCH:
	//       - PUT NON-WEB PROPERTIES INTO NATIVE WB ENV SERVICE
	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
}
