/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// #######################################################################
// ###                                                                 ###
// ### !!! PLEASE ADD COMMON IMPORTS INTO WORKBENCH.COMMON.MAIN.TS !!! ###
// ###                                                                 ###
// #######################################################################

//#region --- workbench common

import 'vs/workbench/workbench.common.main';

//#endregion


//#region --- workbench services

import 'vs/workbench/services/workspaces/electron-sandbox/workspacesService';
import 'vs/workbench/services/userDataSync/electron-sandbox/storageKeysSyncRegistryService';
import 'vs/workbench/services/menubar/electron-sandbox/menubarService';
import 'vs/workbench/services/issue/electron-sandbox/issueService';
import 'vs/workbench/services/update/electron-sandbox/updateService';
import 'vs/workbench/services/url/electron-sandbox/urlService';
import 'vs/workbench/services/lifecycle/electron-sandbox/lifecycleService';
import 'vs/workbench/services/title/electron-sandbox/titleService.ts';
import 'vs/workbench/services/host/electron-sandbox/desktopHostService';
import 'vs/workbench/services/request/electron-sandbox/requestService';
import 'vs/workbench/services/extensionResourceLoader/electron-sandbox/extensionResourceLoaderService';

//#endregion


//#region --- workbench contributions

// Desktop
import 'vs/workbench/electron-sandbox/desktop.contribution';

// Explorer
import 'vs/workbench/contrib/files/electron-sandbox/fileActions.contribution';

// Backup
import 'vs/workbench/contrib/backup/electron-sandbox/backup.contribution';

// CodeEditor Contributions
import 'vs/workbench/contrib/codeEditor/electron-sandbox/codeEditor.contribution';

// Debug
import 'vs/workbench/contrib/debug/electron-sandbox/extensionHostDebugService';

//#endregion
