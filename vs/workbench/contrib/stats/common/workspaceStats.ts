/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkbenchState, IWorkspace } from 'vs/platform/workspace/common/workspace';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export type Tags = { [index: string]: boolean | number | string | undefined };

export const IWorkspaceStatsService = createDecorator<IWorkspaceStatsService>('workspaceStatsService');

export interface IWorkspaceStatsService {
	_serviceBrand: any;

	getTags(): Promise<Tags>;

	/**
	 * Returns an id for the workspace, different from the id returned by the context service. A hash based
	 * on the folder uri or workspace configuration, not time-based, and undefined for empty workspaces.
	 */
	getTelemetryWorkspaceId(workspace: IWorkspace, state: WorkbenchState): string | undefined;
}
