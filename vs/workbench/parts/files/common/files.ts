/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import { IEditorOptions } from 'vs/editor/common/editorCommon';
import { IWorkbenchEditorConfiguration } from 'vs/workbench/common/editor';
import { IFilesConfiguration } from 'vs/platform/files/common/files';
import { FileStat, OpenEditor } from 'vs/workbench/parts/files/common/explorerViewModel';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

/**
 * Explorer viewlet id.
 */
export const VIEWLET_ID = 'workbench.view.explorer';

/**
 * Context Keys to use with keybindings for the Explorer and Open Editors view
 */
export const ExplorerViewletVisibleContext = new RawContextKey<boolean>('explorerViewletVisible', true);
export const ExplorerFolderContext = new RawContextKey<boolean>('explorerResourceIsFolder', false);
export const FilesExplorerFocussedContext = new RawContextKey<boolean>('filesExplorerFocus', false);
export const OpenEditorsFocussedContext = new RawContextKey<boolean>('openEditorsFocus', false);
export const ExplorerFocussedContext = new RawContextKey<boolean>('explorerFocus', false);

/**
 * File editor input id.
 */
export const FILE_EDITOR_INPUT_ID = 'workbench.editors.files.fileEditorInput';

/**
 * Text file editor id.
 */
export const TEXT_FILE_EDITOR_ID = 'workbench.editors.files.textFileEditor';

/**
 * Binary file editor id.
 */
export const BINARY_FILE_EDITOR_ID = 'workbench.editors.files.binaryFileEditor';

export interface IFilesConfiguration extends IFilesConfiguration, IWorkbenchEditorConfiguration {
	explorer: {
		openEditors: {
			visible: number;
			dynamicHeight: boolean;
		};
		autoReveal: boolean;
		enableDragAndDrop: boolean;
	};
	editor: IEditorOptions;
}

export interface IFileResource {
	resource: URI;
	isDirectory?: boolean;
}

/**
 * Helper to get an explorer item from an object.
 */
export function explorerItemToFileResource(obj: any): IFileResource {
	if (obj instanceof FileStat) {
		const stat = obj as FileStat;

		return {
			resource: stat.resource,
			isDirectory: stat.isDirectory
		};
	}

	if (obj instanceof OpenEditor) {
		const editor = obj as OpenEditor;
		const resource = editor.getResource();
		if (resource && resource.scheme === 'file') {
			return {
				resource: editor.getResource()
			};
		}
	}

	return null;
}