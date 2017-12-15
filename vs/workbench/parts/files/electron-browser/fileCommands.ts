/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import nls = require('vs/nls');
import paths = require('vs/base/common/paths');
import severity from 'vs/base/common/severity';
import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { toResource, IEditorContext } from 'vs/workbench/common/editor';
import { IWindowsService } from 'vs/platform/windows/common/windows';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ExplorerViewlet } from 'vs/workbench/parts/files/electron-browser/explorerViewlet';
import { VIEWLET_ID, explorerItemToFileResource } from 'vs/workbench/parts/files/common/files';
import { FileStat, OpenEditor } from 'vs/workbench/parts/files/common/explorerModel';
import errors = require('vs/base/common/errors');
import { ITree } from 'vs/base/parts/tree/browser/tree';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IEditorGroupService } from 'vs/workbench/services/group/common/groupService';
import { IMessageService, Severity } from 'vs/platform/message/common/message';
import { getPathLabel } from 'vs/base/common/labels';
import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { basename } from 'vs/base/common/paths';
import { IListService } from 'vs/platform/list/browser/listService';
import { Tree } from 'vs/base/parts/tree/browser/treeImpl';
import { ICommandService } from 'vs/platform/commands/common/commands';

// Commands

registerFileCommands();
export const REVEAL_IN_OS_COMMAND_ID = 'workbench.command.files.revealInOS';
export const REVEAL_IN_EXPLORER_COMMAND_ID = 'workbench.command.files.revealInExplorer';
export const REVERT_FILE_COMMAND_ID = 'workbench.command.files.revert';
export const OPEN_TO_SIDE_COMMAND_ID = 'workbench.command.openToSide';
export const SELECT_FOR_COMPARE_COMMAND_ID = 'workbench.files.command.selectForCompare';
export const COMPARE_RESOURCE_COMMAND_ID = 'workbench.files.command.compareFiles';
export const COMPARE_WITH_SAVED_COMMAND_ID = 'workbench.files.command.compareWithSaved';
export const COMPARE_WITH_SAVED_SCHEMA = 'showModifications';
export const COPY_PATH_COMMAND_ID = 'workbench.command.files.copyPath';

export const openWindowCommand = (accessor: ServicesAccessor, paths: string[], forceNewWindow: boolean) => {
	const windowsService = accessor.get(IWindowsService);
	windowsService.openWindow(paths, { forceNewWindow });
};

function openFocusedFilesExplorerViewItem(accessor: ServicesAccessor, sideBySide: boolean): void {
	withFocusedFilesExplorerViewItem(accessor).then(res => {
		if (res) {

			// Directory: Toggle expansion
			if (res.item.isDirectory) {
				res.tree.toggleExpansion(res.item);
			}

			// File: Open
			else {
				const editorService = accessor.get(IWorkbenchEditorService);
				editorService.openEditor({ resource: res.item.resource }, sideBySide).done(null, errors.onUnexpectedError);
			}
		}
	});
}

function openFocusedOpenedEditorsViewItem(accessor: ServicesAccessor, sideBySide: boolean): void {
	withFocusedOpenEditorsViewItem(accessor).then(res => {
		if (res) {
			const editorService = accessor.get(IWorkbenchEditorService);

			editorService.openEditor(res.item.editorInput, null, sideBySide);
		}
	});
}

function runActionOnFocusedFilesExplorerViewItem(accessor: ServicesAccessor, id: string, context?: any): void {
	withFocusedFilesExplorerViewItem(accessor).then(res => {
		if (res) {
			res.explorer.getViewletState().actionProvider.runAction(res.tree, res.item, id, context).done(null, errors.onUnexpectedError);
		}
	});
}

function withVisibleExplorer(accessor: ServicesAccessor): TPromise<ExplorerViewlet> {
	const viewletService = accessor.get(IViewletService);

	const activeViewlet = viewletService.getActiveViewlet();
	if (!activeViewlet || activeViewlet.getId() !== VIEWLET_ID) {
		return TPromise.as(void 0); // Return early if the active viewlet is not the explorer
	}

	return viewletService.openViewlet(VIEWLET_ID, false) as TPromise<ExplorerViewlet>;
}

export function withFocusedFilesExplorerViewItem(accessor: ServicesAccessor): TPromise<{ explorer: ExplorerViewlet, tree: ITree, item: FileStat }> {
	return withFocusedFilesExplorer(accessor).then(res => {
		if (!res) {
			return void 0;
		}

		const { tree, explorer } = res;
		if (!tree || !tree.getFocus()) {
			return void 0;
		}

		return { explorer, tree, item: tree.getFocus() };
	});
}

export function withFocusedFilesExplorer(accessor: ServicesAccessor): TPromise<{ explorer: ExplorerViewlet, tree: ITree }> {
	return withVisibleExplorer(accessor).then(explorer => {
		if (!explorer || !explorer.getExplorerView()) {
			return void 0; // empty folder or hidden explorer
		}

		const tree = explorer.getExplorerView().getViewer();

		// Ignore if in highlight mode or not focused
		if (tree.getHighlight() || !tree.isDOMFocused()) {
			return void 0;
		}

		return { explorer, tree };
	});
}

function withFocusedOpenEditorsViewItem(accessor: ServicesAccessor): TPromise<{ explorer: ExplorerViewlet, item: OpenEditor }> {
	return withVisibleExplorer(accessor).then(explorer => {
		if (!explorer || !explorer.getOpenEditorsView() || !explorer.getOpenEditorsView().getList()) {
			return void 0; // empty folder or hidden explorer
		}

		const list = explorer.getOpenEditorsView().getList();

		// Ignore if in highlight mode or not focused
		const focused = list.getFocusedElements();
		const focus = focused.length ? focused[0] : undefined;
		if (!list.isDOMFocused() || !(focus instanceof OpenEditor)) {
			return void 0;
		}

		return { explorer, item: focus };
	});
}

function withFocusedExplorerItem(accessor: ServicesAccessor): TPromise<FileStat | OpenEditor> {
	return withFocusedFilesExplorerViewItem(accessor).then(res => {
		if (res) {
			return res.item;
		}

		return withFocusedOpenEditorsViewItem(accessor).then(res => {
			if (res) {
				return res.item as FileStat | OpenEditor;
			}

			return void 0;
		});
	});
}

export const renameFocusedFilesExplorerViewItemCommand = (accessor: ServicesAccessor) => {
	runActionOnFocusedFilesExplorerViewItem(accessor, 'renameFile');
};

export const deleteFocusedFilesExplorerViewItemCommand = (accessor: ServicesAccessor) => {
	runActionOnFocusedFilesExplorerViewItem(accessor, 'moveFileToTrash', { useTrash: false });
};

export const moveFocusedFilesExplorerViewItemToTrashCommand = (accessor: ServicesAccessor) => {
	runActionOnFocusedFilesExplorerViewItem(accessor, 'moveFileToTrash', { useTrash: true });
};

export const copyFocusedFilesExplorerViewItem = (accessor: ServicesAccessor) => {
	runActionOnFocusedFilesExplorerViewItem(accessor, 'filesExplorer.copy');
};

export const copyPathOfFocusedExplorerItem = (accessor: ServicesAccessor) => {
	withFocusedExplorerItem(accessor).then(item => {
		const file = explorerItemToFileResource(item);
		if (!file) {
			return TPromise.as(undefined);
		}

		const commandService = accessor.get(ICommandService);
		return commandService.executeCommand(COPY_PATH_COMMAND_ID, { resource: file.resource });
	});
};

export const openFocusedExplorerItemSideBySideCommand = (accessor: ServicesAccessor) => {
	withFocusedExplorerItem(accessor).then(item => {
		if (item instanceof FileStat) {
			openFocusedFilesExplorerViewItem(accessor, true);
		} else {
			openFocusedOpenedEditorsViewItem(accessor, true);
		}
	});
};

export const revealInOSFocusedFilesExplorerItem = (accessor: ServicesAccessor) => {
	withFocusedExplorerItem(accessor).then(item => {
		const file = explorerItemToFileResource(item);
		if (!file) {
			return TPromise.as(undefined);
		}

		const commandService = accessor.get(ICommandService);
		return commandService.executeCommand(REVEAL_IN_OS_COMMAND_ID, { resource: file.resource });
	});
};

export let globalResourceToCompare: URI;

function registerFileCommands(): void {

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: REVERT_FILE_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: undefined,
		primary: undefined,
		handler: (accessor, args: IEditorContext) => {
			let resource: URI;
			const editorService = accessor.get(IWorkbenchEditorService);
			const textFileService = accessor.get(ITextFileService);
			const messageService = accessor.get(IMessageService);

			if (args && args.resource) {
				resource = args.resource;
			} else {
				resource = toResource(editorService.getActiveEditorInput(), { supportSideBySide: true, filter: 'file' });
			}

			if (resource && resource.scheme !== 'untitled') {
				return textFileService.revert(resource, { force: true }).then(null, error => {
					messageService.show(Severity.Error, nls.localize('genericRevertError', "Failed to revert '{0}': {1}", basename(resource.fsPath), toErrorMessage(error, false)));
				});
			}

			return TPromise.as(true);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: OPEN_TO_SIDE_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: undefined,
		primary: undefined,
		handler: (accessor, args: IEditorContext) => {
			const editorService = accessor.get(IWorkbenchEditorService);
			const listService = accessor.get(IListService);
			const tree = listService.lastFocusedList;
			// Remove highlight
			if (tree instanceof Tree) {
				tree.clearHighlight();
			}

			// Set side input
			return editorService.openEditor({
				resource: args.resource,
				options: {
					preserveFocus: false
				}
			}, true);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: COMPARE_WITH_SAVED_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: undefined,
		primary: undefined,
		handler: (accessor, args: IEditorContext) => {
			const editorService = accessor.get(IWorkbenchEditorService);
			let resource: URI;
			if (args.resource) {
				resource = args.resource;
			} else {
				resource = toResource(editorService.getActiveEditorInput(), { supportSideBySide: true, filter: 'file' });
			}

			if (resource && resource.scheme === 'file') {
				const name = paths.basename(resource.fsPath);
				const editorLabel = nls.localize('modifiedLabel', "{0} (on disk) ↔ {1}", name, name);

				return editorService.openEditor({ leftResource: URI.from({ scheme: COMPARE_WITH_SAVED_SCHEMA, path: resource.fsPath }), rightResource: resource, label: editorLabel });
			}

			return TPromise.as(true);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: SELECT_FOR_COMPARE_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: undefined,
		primary: undefined,
		handler: (accessor, args: IEditorContext) => {
			const listService = accessor.get(IListService);
			const tree = listService.lastFocusedList;
			// Remove highlight
			if (tree instanceof Tree) {
				tree.clearHighlight();
				tree.DOMFocus();
			}

			globalResourceToCompare = args.resource;
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: COMPARE_RESOURCE_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: undefined,
		primary: undefined,
		handler: (accessor, args: IEditorContext) => {
			const editorService = accessor.get(IWorkbenchEditorService);
			const listService = accessor.get(IListService);
			const tree = listService.lastFocusedList;
			// Remove highlight
			if (tree instanceof Tree) {
				tree.clearHighlight();
			}

			return editorService.openEditor({
				leftResource: globalResourceToCompare,
				rightResource: args.resource
			});
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: REVEAL_IN_OS_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: undefined,
		primary: undefined,
		handler: (accessor, args: IEditorContext) => {
			// Without resource, try to look at the active editor
			let resource = args.resource;
			if (!resource) {
				const editorService = accessor.get(IWorkbenchEditorService);
				resource = toResource(editorService.getActiveEditorInput(), { supportSideBySide: true, filter: 'file' });
			}

			if (resource) {
				const windowsService = accessor.get(IWindowsService);
				windowsService.showItemInFolder(paths.normalize(resource.fsPath, true));
			} else {
				const messageService = accessor.get(IMessageService);
				messageService.show(severity.Info, nls.localize('openFileToReveal', "Open a file first to reveal"));
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: COPY_PATH_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: undefined,
		primary: undefined,
		handler: (accessor, args: IEditorContext) => {
			let resource = args.resource;
			// Without resource, try to look at the active editor
			if (!resource) {
				const editorGroupService = accessor.get(IEditorGroupService);
				const editorService = accessor.get(IWorkbenchEditorService);
				const activeEditor = editorService.getActiveEditor();

				resource = activeEditor ? toResource(activeEditor.input, { supportSideBySide: true }) : void 0;
				if (activeEditor) {
					editorGroupService.focusGroup(activeEditor.position); // focus back to active editor group
				}
			}

			if (resource) {
				const clipboardService = accessor.get(IClipboardService);
				clipboardService.writeText(resource.scheme === 'file' ? getPathLabel(resource) : resource.toString());
			} else {
				const messageService = accessor.get(IMessageService);
				messageService.show(severity.Info, nls.localize('openFileToCopy', "Open a file first to copy its path"));
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: REVEAL_IN_EXPLORER_COMMAND_ID,
		weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
		when: undefined,
		primary: undefined,
		handler: (accessor, args: IEditorContext) => {
			const viewletService = accessor.get(IViewletService);
			const contextService = accessor.get(IWorkspaceContextService);

			viewletService.openViewlet(VIEWLET_ID, false).then((viewlet: ExplorerViewlet) => {
				const isInsideWorkspace = contextService.isInsideWorkspace(args.resource);
				if (isInsideWorkspace) {
					const explorerView = viewlet.getExplorerView();
					if (explorerView) {
						explorerView.setExpanded(true);
						explorerView.select(args.resource, true);
					}
				} else {
					const openEditorsView = viewlet.getOpenEditorsView();
					if (openEditorsView) {
						openEditorsView.setExpanded(true);
					}
				}
			});
		}
	});
}
