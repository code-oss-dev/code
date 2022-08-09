/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Token = require('markdown-it/lib/token');
import { RequestType } from 'vscode-languageclient';
import type * as lsp from 'vscode-languageserver-types';
import type * as md from 'vscode-markdown-languageservice';

//#region From server
export const parse = new RequestType<{ uri: string }, Token[], any>('markdown/parse');

export const fs_readFile = new RequestType<{ uri: string }, number[], any>('markdown/fs/readFile');
export const fs_readDirectory = new RequestType<{ uri: string }, [string, { isDirectory: boolean }][], any>('markdown/fs/readDirectory');
export const fs_stat = new RequestType<{ uri: string }, { isDirectory: boolean } | undefined, any>('markdown/fs/stat');

export const fs_watcher_create = new RequestType<{ id: number; uri: string; options: md.FileWatcherOptions }, void, any>('markdown/fs/watcher/create');
export const fs_watcher_delete = new RequestType<{ id: number }, void, any>('markdown/fs/watcher/delete');

export const findMarkdownFilesInWorkspace = new RequestType<{}, string[], any>('markdown/findMarkdownFilesInWorkspace');
//#endregion

//#region To server
export const getReferencesToFileInWorkspace = new RequestType<{ uri: string }, lsp.Location[], any>('markdown/getReferencesToFileInWorkspace');
export const getEditForFileRenames = new RequestType<Array<{ oldUri: string; newUri: string }>, lsp.WorkspaceEdit, any>('markdown/getEditForFileRenames');

export const fs_watcher_onChange = new RequestType<{ id: number; uri: string; kind: 'create' | 'change' | 'delete' }, void, any>('markdown/fs/watcher/onChange');
//#endregion
