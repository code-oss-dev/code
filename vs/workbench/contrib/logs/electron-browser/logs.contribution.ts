/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchActionRegistry, Extensions as WorkbenchActionExtensions } from 'vs/workbench/common/actions';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { OpenLogsFolderAction } from 'vs/workbench/contrib/logs/electron-browser/logsActions';

const workbenchActionsRegistry = Registry.as<IWorkbenchActionRegistry>(WorkbenchActionExtensions.WorkbenchActions);
const devCategory = nls.localize('developer', "Developer");
workbenchActionsRegistry.registerWorkbenchAction(new SyncActionDescriptor(OpenLogsFolderAction, OpenLogsFolderAction.ID, OpenLogsFolderAction.LABEL), 'Developer: Open Logs Folder', devCategory);
