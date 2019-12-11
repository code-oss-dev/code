/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/fileactions';
import * as nls from 'vs/nls';
import { isWindows, isWeb } from 'vs/base/common/platform';
import * as extpath from 'vs/base/common/extpath';
import { extname, basename } from 'vs/base/common/path';
import * as resources from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import * as strings from 'vs/base/common/strings';
import { Action } from 'vs/base/common/actions';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { VIEWLET_ID, IExplorerService, IFilesConfiguration } from 'vs/workbench/contrib/files/common/files';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IFileService } from 'vs/platform/files/common/files';
import { toResource, SideBySideEditor } from 'vs/workbench/common/editor';
import { ExplorerViewPaneContainer } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { IQuickOpenService } from 'vs/platform/quickOpen/common/quickOpen';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ITextModel } from 'vs/editor/common/model';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { REVEAL_IN_EXPLORER_COMMAND_ID, SAVE_ALL_COMMAND_ID, SAVE_ALL_LABEL, SAVE_ALL_IN_GROUP_COMMAND_ID } from 'vs/workbench/contrib/files/browser/fileCommands';
import { ITextModelService, ITextModelContentProvider } from 'vs/editor/common/services/resolverService';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { Schemas } from 'vs/base/common/network';
import { IDialogService, IConfirmationResult, getConfirmMessage, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Constants } from 'vs/base/common/uint';
import { CLOSE_EDITORS_AND_GROUP_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';
import { coalesce } from 'vs/base/common/arrays';
import { ExplorerItem, NewExplorerItem } from 'vs/workbench/contrib/files/common/explorerModel';
import { onUnexpectedError, getErrorMessage } from 'vs/base/common/errors';
import { asDomUri, triggerDownload } from 'vs/base/browser/dom';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IWorkingCopyService, IWorkingCopy } from 'vs/workbench/services/workingCopy/common/workingCopyService';

export const NEW_FILE_COMMAND_ID = 'explorer.newFile';
export const NEW_FILE_LABEL = nls.localize('newFile', "New File");

export const NEW_FOLDER_COMMAND_ID = 'explorer.newFolder';
export const NEW_FOLDER_LABEL = nls.localize('newFolder', "New Folder");

export const TRIGGER_RENAME_LABEL = nls.localize('rename', "Rename");

export const MOVE_FILE_TO_TRASH_LABEL = nls.localize('delete', "Delete");

export const COPY_FILE_LABEL = nls.localize('copyFile', "Copy");

export const PASTE_FILE_LABEL = nls.localize('pasteFile', "Paste");

export const FileCopiedContext = new RawContextKey<boolean>('fileCopied', false);

export const DOWNLOAD_LABEL = nls.localize('download', "Download");

const CONFIRM_DELETE_SETTING_KEY = 'explorer.confirmDelete';

function onError(notificationService: INotificationService, error: any): void {
	if (error.message === 'string') {
		error = error.message;
	}

	notificationService.error(toErrorMessage(error, false));
}

function refreshIfSeparator(value: string, explorerService: IExplorerService): void {
	if (value && ((value.indexOf('/') >= 0) || (value.indexOf('\\') >= 0))) {
		// New input contains separator, multiple resources will get created workaround for #68204
		explorerService.refresh();
	}
}

/* New File */
export class NewFileAction extends Action {
	static readonly ID = 'workbench.files.action.createFileFromExplorer';
	static readonly LABEL = nls.localize('createNewFile', "New File");

	constructor(
		@IExplorerService explorerService: IExplorerService,
		@ICommandService private commandService: ICommandService
	) {
		super('explorer.newFile', NEW_FILE_LABEL);
		this.class = 'explorer-action codicon-new-file';
		this._register(explorerService.onDidChangeEditable(e => {
			const elementIsBeingEdited = explorerService.isEditable(e);
			this.enabled = !elementIsBeingEdited;
		}));
	}

	run(): Promise<any> {
		return this.commandService.executeCommand(NEW_FILE_COMMAND_ID);
	}
}

/* New Folder */
export class NewFolderAction extends Action {
	static readonly ID = 'workbench.files.action.createFolderFromExplorer';
	static readonly LABEL = nls.localize('createNewFolder', "New Folder");

	constructor(
		@IExplorerService explorerService: IExplorerService,
		@ICommandService private commandService: ICommandService
	) {
		super('explorer.newFolder', NEW_FOLDER_LABEL);
		this.class = 'explorer-action codicon-new-folder';
		this._register(explorerService.onDidChangeEditable(e => {
			const elementIsBeingEdited = explorerService.isEditable(e);
			this.enabled = !elementIsBeingEdited;
		}));
	}

	run(): Promise<any> {
		return this.commandService.executeCommand(NEW_FOLDER_COMMAND_ID);
	}
}

/* Create new file from anywhere: Open untitled */
export class GlobalNewUntitledFileAction extends Action {
	static readonly ID = 'workbench.action.files.newUntitledFile';
	static readonly LABEL = nls.localize('newUntitledFile', "New Untitled File");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(id, label);
	}

	run(): Promise<any> {
		return this.editorService.openEditor({ options: { pinned: true } }); // untitled are always pinned
	}
}

async function deleteFiles(textFileService: ITextFileService, dialogService: IDialogService, configurationService: IConfigurationService, elements: ExplorerItem[], useTrash: boolean, skipConfirm = false): Promise<void> {
	let primaryButton: string;
	if (useTrash) {
		primaryButton = isWindows ? nls.localize('deleteButtonLabelRecycleBin', "&&Move to Recycle Bin") : nls.localize({ key: 'deleteButtonLabelTrash', comment: ['&& denotes a mnemonic'] }, "&&Move to Trash");
	} else {
		primaryButton = nls.localize({ key: 'deleteButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Delete");
	}

	const distinctElements = resources.distinctParents(elements, e => e.resource);

	// Handle dirty
	let confirmed = true;
	const dirty = textFileService.getDirty().filter(d => distinctElements.some(e => resources.isEqualOrParent(d, e.resource)));
	if (dirty.length) {
		let message: string;
		if (distinctElements.length > 1) {
			message = nls.localize('dirtyMessageFilesDelete', "You are deleting files with unsaved changes. Do you want to continue?");
		} else if (distinctElements[0].isDirectory) {
			if (dirty.length === 1) {
				message = nls.localize('dirtyMessageFolderOneDelete', "You are deleting a folder with unsaved changes in 1 file. Do you want to continue?");
			} else {
				message = nls.localize('dirtyMessageFolderDelete', "You are deleting a folder with unsaved changes in {0} files. Do you want to continue?", dirty.length);
			}
		} else {
			message = nls.localize('dirtyMessageFileDelete', "You are deleting a file with unsaved changes. Do you want to continue?");
		}

		const response = await dialogService.confirm({
			message,
			type: 'warning',
			detail: nls.localize('dirtyWarning', "Your changes will be lost if you don't save them."),
			primaryButton
		});

		if (!response.confirmed) {
			confirmed = false;
		} else {
			skipConfirm = true;
			await textFileService.revertAll(dirty);
		}
	}

	// Check if file is dirty in editor and save it to avoid data loss
	if (!confirmed) {
		return;
	}

	let confirmDeletePromise: Promise<IConfirmationResult>;

	// Check if we need to ask for confirmation at all
	if (skipConfirm || (useTrash && configurationService.getValue<boolean>(CONFIRM_DELETE_SETTING_KEY) === false)) {
		confirmDeletePromise = Promise.resolve({ confirmed: true });
	}

	// Confirm for moving to trash
	else if (useTrash) {
		const message = getMoveToTrashMessage(distinctElements);

		confirmDeletePromise = dialogService.confirm({
			message,
			detail: isWindows ? nls.localize('undoBin', "You can restore from the Recycle Bin.") : nls.localize('undoTrash', "You can restore from the Trash."),
			primaryButton,
			checkbox: {
				label: nls.localize('doNotAskAgain', "Do not ask me again")
			},
			type: 'question'
		});
	}

	// Confirm for deleting permanently
	else {
		const message = getDeleteMessage(distinctElements);
		confirmDeletePromise = dialogService.confirm({
			message,
			detail: nls.localize('irreversible', "This action is irreversible!"),
			primaryButton,
			type: 'warning'
		});
	}

	return confirmDeletePromise.then(confirmation => {

		// Check for confirmation checkbox
		let updateConfirmSettingsPromise: Promise<void> = Promise.resolve(undefined);
		if (confirmation.confirmed && confirmation.checkboxChecked === true) {
			updateConfirmSettingsPromise = configurationService.updateValue(CONFIRM_DELETE_SETTING_KEY, false, ConfigurationTarget.USER);
		}

		return updateConfirmSettingsPromise.then(() => {

			// Check for confirmation
			if (!confirmation.confirmed) {
				return Promise.resolve(undefined);
			}

			// Call function
			const servicePromise = Promise.all(distinctElements.map(e => textFileService.delete(e.resource, { useTrash: useTrash, recursive: true })))
				.then(undefined, (error: any) => {
					// Handle error to delete file(s) from a modal confirmation dialog
					let errorMessage: string;
					let detailMessage: string | undefined;
					let primaryButton: string;
					if (useTrash) {
						errorMessage = isWindows ? nls.localize('binFailed', "Failed to delete using the Recycle Bin. Do you want to permanently delete instead?") : nls.localize('trashFailed', "Failed to delete using the Trash. Do you want to permanently delete instead?");
						detailMessage = nls.localize('irreversible', "This action is irreversible!");
						primaryButton = nls.localize({ key: 'deletePermanentlyButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Delete Permanently");
					} else {
						errorMessage = toErrorMessage(error, false);
						primaryButton = nls.localize({ key: 'retryButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Retry");
					}

					return dialogService.confirm({
						message: errorMessage,
						detail: detailMessage,
						type: 'warning',
						primaryButton
					}).then(res => {

						if (res.confirmed) {
							if (useTrash) {
								useTrash = false; // Delete Permanently
							}

							skipConfirm = true;

							return deleteFiles(textFileService, dialogService, configurationService, elements, useTrash, skipConfirm);
						}

						return Promise.resolve();
					});
				});

			return servicePromise.then(undefined);
		});
	});
}

function getMoveToTrashMessage(distinctElements: ExplorerItem[]): string {
	if (containsBothDirectoryAndFile(distinctElements)) {
		return getConfirmMessage(nls.localize('confirmMoveTrashMessageFilesAndDirectories', "Are you sure you want to delete the following {0} files/directories and their contents?", distinctElements.length), distinctElements.map(e => e.resource));
	}

	if (distinctElements.length > 1) {
		if (distinctElements[0].isDirectory) {
			return getConfirmMessage(nls.localize('confirmMoveTrashMessageMultipleDirectories', "Are you sure you want to delete the following {0} directories and their contents?", distinctElements.length), distinctElements.map(e => e.resource));
		}

		return getConfirmMessage(nls.localize('confirmMoveTrashMessageMultiple', "Are you sure you want to delete the following {0} files?", distinctElements.length), distinctElements.map(e => e.resource));
	}

	if (distinctElements[0].isDirectory) {
		return nls.localize('confirmMoveTrashMessageFolder', "Are you sure you want to delete '{0}' and its contents?", distinctElements[0].name);
	}

	return nls.localize('confirmMoveTrashMessageFile', "Are you sure you want to delete '{0}'?", distinctElements[0].name);
}

function getDeleteMessage(distinctElements: ExplorerItem[]): string {
	if (containsBothDirectoryAndFile(distinctElements)) {
		return getConfirmMessage(nls.localize('confirmDeleteMessageFilesAndDirectories', "Are you sure you want to permanently delete the following {0} files/directories and their contents?", distinctElements.length), distinctElements.map(e => e.resource));
	}

	if (distinctElements.length > 1) {
		if (distinctElements[0].isDirectory) {
			return getConfirmMessage(nls.localize('confirmDeleteMessageMultipleDirectories', "Are you sure you want to permanently delete the following {0} directories and their contents?", distinctElements.length), distinctElements.map(e => e.resource));
		}

		return getConfirmMessage(nls.localize('confirmDeleteMessageMultiple', "Are you sure you want to permanently delete the following {0} files?", distinctElements.length), distinctElements.map(e => e.resource));
	}

	if (distinctElements[0].isDirectory) {
		return nls.localize('confirmDeleteMessageFolder', "Are you sure you want to permanently delete '{0}' and its contents?", distinctElements[0].name);
	}

	return nls.localize('confirmDeleteMessageFile', "Are you sure you want to permanently delete '{0}'?", distinctElements[0].name);
}

function containsBothDirectoryAndFile(distinctElements: ExplorerItem[]): boolean {
	const directories = distinctElements.filter(element => element.isDirectory);
	const files = distinctElements.filter(element => !element.isDirectory);

	return directories.length > 0 && files.length > 0;
}


export function findValidPasteFileTarget(targetFolder: ExplorerItem, fileToPaste: { resource: URI, isDirectory?: boolean, allowOverwrite: boolean }, incrementalNaming: 'simple' | 'smart'): URI {
	let name = resources.basenameOrAuthority(fileToPaste.resource);

	let candidate = resources.joinPath(targetFolder.resource, name);
	while (true && !fileToPaste.allowOverwrite) {
		if (!targetFolder.root.find(candidate)) {
			break;
		}

		name = incrementFileName(name, !!fileToPaste.isDirectory, incrementalNaming);
		candidate = resources.joinPath(targetFolder.resource, name);
	}

	return candidate;
}

export function incrementFileName(name: string, isFolder: boolean, incrementalNaming: 'simple' | 'smart'): string {
	if (incrementalNaming === 'simple') {
		let namePrefix = name;
		let extSuffix = '';
		if (!isFolder) {
			extSuffix = extname(name);
			namePrefix = basename(name, extSuffix);
		}

		// name copy 5(.txt) => name copy 6(.txt)
		// name copy(.txt) => name copy 2(.txt)
		const suffixRegex = /^(.+ copy)( \d+)?$/;
		if (suffixRegex.test(namePrefix)) {
			return namePrefix.replace(suffixRegex, (match, g1?, g2?) => {
				let number = (g2 ? parseInt(g2) : 1);
				return number === 0
					? `${g1}`
					: (number < Constants.MAX_SAFE_SMALL_INTEGER
						? `${g1} ${number + 1}`
						: `${g1}${g2} copy`);
			}) + extSuffix;
		}

		// name(.txt) => name copy(.txt)
		return `${namePrefix} copy${extSuffix}`;
	}

	const separators = '[\\.\\-_]';
	const maxNumber = Constants.MAX_SAFE_SMALL_INTEGER;

	// file.1.txt=>file.2.txt
	let suffixFileRegex = RegExp('(.*' + separators + ')(\\d+)(\\..*)$');
	if (!isFolder && name.match(suffixFileRegex)) {
		return name.replace(suffixFileRegex, (match, g1?, g2?, g3?) => {
			let number = parseInt(g2);
			return number < maxNumber
				? g1 + strings.pad(number + 1, g2.length) + g3
				: strings.format('{0}{1}.1{2}', g1, g2, g3);
		});
	}

	// 1.file.txt=>2.file.txt
	let prefixFileRegex = RegExp('(\\d+)(' + separators + '.*)(\\..*)$');
	if (!isFolder && name.match(prefixFileRegex)) {
		return name.replace(prefixFileRegex, (match, g1?, g2?, g3?) => {
			let number = parseInt(g1);
			return number < maxNumber
				? strings.pad(number + 1, g1.length) + g2 + g3
				: strings.format('{0}{1}.1{2}', g1, g2, g3);
		});
	}

	// 1.txt=>2.txt
	let prefixFileNoNameRegex = RegExp('(\\d+)(\\..*)$');
	if (!isFolder && name.match(prefixFileNoNameRegex)) {
		return name.replace(prefixFileNoNameRegex, (match, g1?, g2?) => {
			let number = parseInt(g1);
			return number < maxNumber
				? strings.pad(number + 1, g1.length) + g2
				: strings.format('{0}.1{1}', g1, g2);
		});
	}

	// file.txt=>file.1.txt
	const lastIndexOfDot = name.lastIndexOf('.');
	if (!isFolder && lastIndexOfDot >= 0) {
		return strings.format('{0}.1{1}', name.substr(0, lastIndexOfDot), name.substr(lastIndexOfDot));
	}

	// folder.1=>folder.2
	if (isFolder && name.match(/(\d+)$/)) {
		return name.replace(/(\d+)$/, (match: string, ...groups: any[]) => {
			let number = parseInt(groups[0]);
			return number < maxNumber
				? strings.pad(number + 1, groups[0].length)
				: strings.format('{0}.1', groups[0]);
		});
	}

	// 1.folder=>2.folder
	if (isFolder && name.match(/^(\d+)/)) {
		return name.replace(/^(\d+)(.*)$/, (match: string, ...groups: any[]) => {
			let number = parseInt(groups[0]);
			return number < maxNumber
				? strings.pad(number + 1, groups[0].length) + groups[1]
				: strings.format('{0}{1}.1', groups[0], groups[1]);
		});
	}

	// file/folder=>file.1/folder.1
	return strings.format('{0}.1', name);
}

// Global Compare with
export class GlobalCompareResourcesAction extends Action {

	static readonly ID = 'workbench.files.action.compareFileWith';
	static readonly LABEL = nls.localize('globalCompareFile', "Compare Active File With...");

	constructor(
		id: string,
		label: string,
		@IQuickOpenService private readonly quickOpenService: IQuickOpenService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(id, label);
	}

	async run(): Promise<any> {
		const activeInput = this.editorService.activeEditor;
		const activeResource = activeInput ? activeInput.getResource() : undefined;
		if (activeResource) {

			// Compare with next editor that opens
			const toDispose = this.editorService.overrideOpenEditor(editor => {

				// Only once!
				toDispose.dispose();

				// Open editor as diff
				const resource = editor.getResource();
				if (resource) {
					return {
						override: this.editorService.openEditor({
							leftResource: activeResource,
							rightResource: resource
						})
					};
				}

				return undefined;
			});

			// Bring up quick open
			await this.quickOpenService.show('', { autoFocus: { autoFocusSecondEntry: true } });
			toDispose.dispose(); // make sure to unbind if quick open is closing
		} else {
			this.notificationService.info(nls.localize('openFileToCompare', "Open a file first to compare it with another file."));
		}
	}
}

export class ToggleAutoSaveAction extends Action {
	static readonly ID = 'workbench.action.toggleAutoSave';
	static readonly LABEL = nls.localize('toggleAutoSave', "Toggle Auto Save");

	constructor(
		id: string,
		label: string,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService
	) {
		super(id, label);
	}

	run(): Promise<any> {
		return this.filesConfigurationService.toggleAutoSave();
	}
}

export abstract class BaseSaveAllAction extends Action {
	private lastIsDirty: boolean;

	constructor(
		id: string,
		label: string,
		@ICommandService protected commandService: ICommandService,
		@INotificationService private notificationService: INotificationService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService
	) {
		super(id, label);

		this.lastIsDirty = this.workingCopyService.hasDirty;
		this.enabled = this.lastIsDirty;

		this.registerListeners();
	}

	protected abstract doRun(context: any): Promise<any>;

	private registerListeners(): void {

		// update enablement based on working copy changes
		this._register(this.workingCopyService.onDidChangeDirty(w => this.updateEnablement(w)));
	}

	private updateEnablement(workingCopy: IWorkingCopy): void {
		const hasDirty = workingCopy.isDirty() || this.workingCopyService.hasDirty;
		if (this.lastIsDirty !== hasDirty) {
			this.enabled = hasDirty;
			this.lastIsDirty = this.enabled;
		}
	}

	async run(context?: any): Promise<void> {
		try {
			await this.doRun(context);
		} catch (error) {
			onError(this.notificationService, error);
		}
	}
}

export class SaveAllAction extends BaseSaveAllAction {

	static readonly ID = 'workbench.action.files.saveAll';
	static readonly LABEL = SAVE_ALL_LABEL;

	get class(): string {
		return 'explorer-action codicon-save-all';
	}

	protected doRun(context: any): Promise<any> {
		return this.commandService.executeCommand(SAVE_ALL_COMMAND_ID);
	}
}

export class SaveAllInGroupAction extends BaseSaveAllAction {

	static readonly ID = 'workbench.files.action.saveAllInGroup';
	static readonly LABEL = nls.localize('saveAllInGroup', "Save All in Group");

	get class(): string {
		return 'explorer-action codicon-save-all';
	}

	protected doRun(context: any): Promise<any> {
		return this.commandService.executeCommand(SAVE_ALL_IN_GROUP_COMMAND_ID, {}, context);
	}
}

export class CloseGroupAction extends Action {

	static readonly ID = 'workbench.files.action.closeGroup';
	static readonly LABEL = nls.localize('closeGroup', "Close Group");

	constructor(id: string, label: string, @ICommandService private readonly commandService: ICommandService) {
		super(id, label, 'codicon-close-all');
	}

	run(context?: any): Promise<any> {
		return this.commandService.executeCommand(CLOSE_EDITORS_AND_GROUP_COMMAND_ID, {}, context);
	}
}

export class FocusFilesExplorer extends Action {

	static readonly ID = 'workbench.files.action.focusFilesExplorer';
	static readonly LABEL = nls.localize('focusFilesExplorer', "Focus on Files Explorer");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label);
	}

	run(): Promise<any> {
		return this.viewletService.openViewlet(VIEWLET_ID, true);
	}
}

export class ShowActiveFileInExplorer extends Action {

	static readonly ID = 'workbench.files.action.showActiveFileInExplorer';
	static readonly LABEL = nls.localize('showInExplorer', "Reveal Active File in Side Bar");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(id, label);
	}

	run(): Promise<any> {
		const resource = toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.MASTER });
		if (resource) {
			this.commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, resource);
		} else {
			this.notificationService.info(nls.localize('openFileToShow', "Open a file first to show it in the explorer"));
		}

		return Promise.resolve(true);
	}
}

export class CollapseExplorerView extends Action {

	static readonly ID = 'workbench.files.action.collapseExplorerFolders';
	static readonly LABEL = nls.localize('collapseExplorerFolders', "Collapse Folders in Explorer");

	constructor(id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService,
		@IExplorerService readonly explorerService: IExplorerService
	) {
		super(id, label, 'explorer-action codicon-collapse-all');
		this._register(explorerService.onDidChangeEditable(e => {
			const elementIsBeingEdited = explorerService.isEditable(e);
			this.enabled = !elementIsBeingEdited;
		}));
	}

	async run(): Promise<any> {
		const explorerViewlet = (await this.viewletService.openViewlet(VIEWLET_ID))?.getViewPaneContainer() as ExplorerViewPaneContainer;
		const explorerView = explorerViewlet.getExplorerView();
		if (explorerView) {
			explorerView.collapseAll();
		}
	}
}

export class RefreshExplorerView extends Action {

	static readonly ID = 'workbench.files.action.refreshFilesExplorer';
	static readonly LABEL = nls.localize('refreshExplorer', "Refresh Explorer");


	constructor(
		id: string, label: string,
		@IViewletService private readonly viewletService: IViewletService,
		@IExplorerService private readonly explorerService: IExplorerService
	) {
		super(id, label, 'explorer-action codicon-refresh');
		this._register(explorerService.onDidChangeEditable(e => {
			const elementIsBeingEdited = explorerService.isEditable(e);
			this.enabled = !elementIsBeingEdited;
		}));
	}

	async run(): Promise<any> {
		await this.viewletService.openViewlet(VIEWLET_ID);
		this.explorerService.refresh();
	}
}

export class ShowOpenedFileInNewWindow extends Action {

	static readonly ID = 'workbench.action.files.showOpenedFileInNewWindow';
	static readonly LABEL = nls.localize('openFileInNewWindow', "Open Active File in New Window");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
		@IHostService private readonly hostService: IHostService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService
	) {
		super(id, label);
	}

	run(): Promise<any> {
		const fileResource = toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.MASTER });
		if (fileResource) {
			if (this.fileService.canHandleResource(fileResource)) {
				this.hostService.openWindow([{ fileUri: fileResource }], { forceNewWindow: true });
			} else {
				this.notificationService.info(nls.localize('openFileToShowInNewWindow.unsupportedschema', "The active editor must contain an openable resource."));
			}
		} else {
			this.notificationService.info(nls.localize('openFileToShowInNewWindow.nofile', "Open a file first to open in new window"));
		}

		return Promise.resolve(true);
	}
}

export function validateFileName(item: ExplorerItem, name: string): string | null {
	// Produce a well formed file name
	name = getWellFormedFileName(name);

	// Name not provided
	if (!name || name.length === 0 || /^\s+$/.test(name)) {
		return nls.localize('emptyFileNameError', "A file or folder name must be provided.");
	}

	// Relative paths only
	if (name[0] === '/' || name[0] === '\\') {
		return nls.localize('fileNameStartsWithSlashError', "A file or folder name cannot start with a slash.");
	}

	const names = coalesce(name.split(/[\\/]/));
	const parent = item.parent;

	if (name !== item.name) {
		// Do not allow to overwrite existing file
		const child = parent?.getChild(name);
		if (child && child !== item) {
			return nls.localize('fileNameExistsError', "A file or folder **{0}** already exists at this location. Please choose a different name.", name);
		}
	}

	// Invalid File name
	const windowsBasenameValidity = item.resource.scheme === Schemas.file && isWindows;
	if (names.some((folderName) => !extpath.isValidBasename(folderName, windowsBasenameValidity))) {
		return nls.localize('invalidFileNameError', "The name **{0}** is not valid as a file or folder name. Please choose a different name.", trimLongName(name));
	}

	return null;
}

function trimLongName(name: string): string {
	if (name?.length > 255) {
		return `${name.substr(0, 255)}...`;
	}

	return name;
}

export function getWellFormedFileName(filename: string): string {
	if (!filename) {
		return filename;
	}

	// Trim tabs
	filename = strings.trim(filename, '\t');

	// Remove trailing dots, slashes, and spaces
	filename = strings.rtrim(filename, '.');
	filename = strings.rtrim(filename, '/');
	filename = strings.rtrim(filename, '\\');

	return filename;
}

export class CompareWithClipboardAction extends Action {

	static readonly ID = 'workbench.files.action.compareWithClipboard';
	static readonly LABEL = nls.localize('compareWithClipboard', "Compare Active File with Clipboard");

	private static readonly SCHEME = 'clipboardCompare';

	private registrationDisposal: IDisposable | undefined;

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IFileService private readonly fileService: IFileService
	) {
		super(id, label);

		this.enabled = true;
	}

	run(): Promise<any> {
		const resource = toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.MASTER });
		if (resource && (this.fileService.canHandleResource(resource) || resource.scheme === Schemas.untitled)) {
			if (!this.registrationDisposal) {
				const provider = this.instantiationService.createInstance(ClipboardContentProvider);
				this.registrationDisposal = this.textModelService.registerTextModelContentProvider(CompareWithClipboardAction.SCHEME, provider);
			}

			const name = resources.basename(resource);
			const editorLabel = nls.localize('clipboardComparisonLabel', "Clipboard ↔ {0}", name);

			return this.editorService.openEditor({ leftResource: resource.with({ scheme: CompareWithClipboardAction.SCHEME }), rightResource: resource, label: editorLabel }).finally(() => {
				dispose(this.registrationDisposal);
				this.registrationDisposal = undefined;
			});
		}

		return Promise.resolve(true);
	}

	dispose(): void {
		super.dispose();

		dispose(this.registrationDisposal);
		this.registrationDisposal = undefined;
	}
}

class ClipboardContentProvider implements ITextModelContentProvider {
	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IModeService private readonly modeService: IModeService,
		@IModelService private readonly modelService: IModelService
	) { }

	async provideTextContent(resource: URI): Promise<ITextModel> {
		const model = this.modelService.createModel(await this.clipboardService.readText(), this.modeService.createByFilepathOrFirstLine(resource), resource);

		return model;
	}
}

function onErrorWithRetry(notificationService: INotificationService, error: any, retry: () => Promise<any>): void {
	notificationService.prompt(Severity.Error, toErrorMessage(error, false),
		[{
			label: nls.localize('retry', "Retry"),
			run: () => retry()
		}]
	);
}

async function openExplorerAndCreate(accessor: ServicesAccessor, isFolder: boolean): Promise<void> {
	const explorerService = accessor.get(IExplorerService);
	const fileService = accessor.get(IFileService);
	const textFileService = accessor.get(ITextFileService);
	const editorService = accessor.get(IEditorService);
	const viewletService = accessor.get(IViewletService);
	const notificationService = accessor.get(INotificationService);

	await viewletService.openViewlet(VIEWLET_ID, true);

	const stats = explorerService.getContext(false);
	const stat = stats.length > 0 ? stats[0] : undefined;
	let folder: ExplorerItem;
	if (stat) {
		folder = stat.isDirectory ? stat : (stat.parent || explorerService.roots[0]);
	} else {
		folder = explorerService.roots[0];
	}

	if (folder.isReadonly) {
		throw new Error('Parent folder is readonly.');
	}

	const newStat = new NewExplorerItem(folder, isFolder);
	await folder.fetchChildren(fileService, explorerService);

	folder.addChild(newStat);

	const onSuccess = (value: string): Promise<void> => {
		const createPromise = isFolder ? fileService.createFolder(resources.joinPath(folder.resource, value)) : textFileService.create(resources.joinPath(folder.resource, value));
		return createPromise.then(created => {
			refreshIfSeparator(value, explorerService);
			return isFolder ? explorerService.select(created.resource, true)
				: editorService.openEditor({ resource: created.resource, options: { pinned: true } }).then(() => undefined);
		}, error => {
			onErrorWithRetry(notificationService, error, () => onSuccess(value));
		});
	};

	explorerService.setEditable(newStat, {
		validationMessage: value => validateFileName(newStat, value),
		onFinish: (value, success) => {
			folder.removeChild(newStat);
			explorerService.setEditable(newStat, null);
			if (success) {
				onSuccess(value);
			}
		}
	});
}

CommandsRegistry.registerCommand({
	id: NEW_FILE_COMMAND_ID,
	handler: async (accessor) => {
		await openExplorerAndCreate(accessor, false);
	}
});

CommandsRegistry.registerCommand({
	id: NEW_FOLDER_COMMAND_ID,
	handler: async (accessor) => {
		await openExplorerAndCreate(accessor, true);
	}
});

export const renameHandler = (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const textFileService = accessor.get(ITextFileService);

	const stats = explorerService.getContext(false);
	const stat = stats.length > 0 ? stats[0] : undefined;
	if (!stat) {
		return;
	}

	explorerService.setEditable(stat, {
		validationMessage: value => validateFileName(stat, value),
		onFinish: (value, success) => {
			if (success) {
				const parentResource = stat.parent!.resource;
				const targetResource = resources.joinPath(parentResource, value);
				if (stat.resource.toString() !== targetResource.toString()) {
					textFileService.move(stat.resource, targetResource).then(() => refreshIfSeparator(value, explorerService), onUnexpectedError);
				}
			}
			explorerService.setEditable(stat, null);
		}
	});
};

export const moveFileToTrashHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true).filter(s => !s.isRoot);
	if (stats.length) {
		await deleteFiles(accessor.get(ITextFileService), accessor.get(IDialogService), accessor.get(IConfigurationService), stats, true);
	}
};

export const deleteFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true).filter(s => !s.isRoot);

	if (stats.length) {
		await deleteFiles(accessor.get(ITextFileService), accessor.get(IDialogService), accessor.get(IConfigurationService), stats, false);
	}
};

let pasteShouldMove = false;
export const copyFileHandler = (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);
	if (stats.length > 0) {
		explorerService.setToCopy(stats, false);
		pasteShouldMove = false;
	}
};

export const cutFileHandler = (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);
	if (stats.length > 0) {
		explorerService.setToCopy(stats, true);
		pasteShouldMove = true;
	}
};

export const DOWNLOAD_COMMAND_ID = 'explorer.download';
const downloadFileHandler = (accessor: ServicesAccessor) => {
	const textFileService = accessor.get(ITextFileService);
	const fileDialogService = accessor.get(IFileDialogService);
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);

	let canceled = false;
	stats.forEach(async s => {
		if (canceled) {
			return;
		}

		if (isWeb) {
			if (!s.isDirectory) {
				triggerDownload(asDomUri(s.resource), s.name);
			}
		} else {
			let defaultUri = s.isDirectory ? fileDialogService.defaultFolderPath() : fileDialogService.defaultFilePath();
			if (defaultUri && !s.isDirectory) {
				defaultUri = resources.joinPath(defaultUri, s.name);
			}

			const destination = await fileDialogService.showSaveDialog({
				availableFileSystems: [Schemas.file],
				saveLabel: mnemonicButtonLabel(nls.localize('download', "Download")),
				title: s.isDirectory ? nls.localize('downloadFolder', "Download Folder") : nls.localize('downloadFile', "Download File"),
				defaultUri
			});
			if (destination) {
				await textFileService.copy(s.resource, destination);
			} else {
				// User canceled a download. In case there were multiple files selected we should cancel the remainder of the prompts #86100
				canceled = true;
			}
		}
	});
};

CommandsRegistry.registerCommand({
	id: DOWNLOAD_COMMAND_ID,
	handler: downloadFileHandler
});

export const pasteFileHandler = async (accessor: ServicesAccessor) => {
	const clipboardService = accessor.get(IClipboardService);
	const explorerService = accessor.get(IExplorerService);
	const fileService = accessor.get(IFileService);
	const textFileService = accessor.get(ITextFileService);
	const notificationService = accessor.get(INotificationService);
	const editorService = accessor.get(IEditorService);
	const configurationService = accessor.get(IConfigurationService);

	const context = explorerService.getContext(true);
	const toPaste = resources.distinctParents(clipboardService.readResources(), r => r);
	const element = context.length ? context[0] : explorerService.roots[0];

	// Check if target is ancestor of pasted folder
	const stats = await Promise.all(toPaste.map(async fileToPaste => {

		if (element.resource.toString() !== fileToPaste.toString() && resources.isEqualOrParent(element.resource, fileToPaste)) {
			throw new Error(nls.localize('fileIsAncestor', "File to paste is an ancestor of the destination folder"));
		}

		try {
			const fileToPasteStat = await fileService.resolve(fileToPaste);

			// Find target
			let target: ExplorerItem;
			if (element.resource.toString() === fileToPaste.toString()) {
				target = element.parent!;
			} else {
				target = element.isDirectory ? element : element.parent!;
			}

			const incrementalNaming = configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
			const targetFile = findValidPasteFileTarget(target, { resource: fileToPaste, isDirectory: fileToPasteStat.isDirectory, allowOverwrite: pasteShouldMove }, incrementalNaming);

			// Move/Copy File
			if (pasteShouldMove) {
				return await textFileService.move(fileToPaste, targetFile);
			} else {
				return await textFileService.copy(fileToPaste, targetFile);
			}
		} catch (e) {
			onError(notificationService, new Error(nls.localize('fileDeleted', "The file to paste has been deleted or moved since you copied it. {0}", getErrorMessage(e))));
			return undefined;
		}
	}));

	if (pasteShouldMove) {
		// Cut is done. Make sure to clear cut state.
		explorerService.setToCopy([], false);
	}
	if (stats.length >= 1) {
		const stat = stats[0];
		if (stat && !stat.isDirectory && stats.length === 1) {
			await editorService.openEditor({ resource: stat.resource, options: { pinned: true, preserveFocus: true } });
		}
		if (stat) {
			await explorerService.select(stat.resource);
		}
	}
};

export const openFilePreserveFocusHandler = async (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);

	await editorService.openEditors(stats.filter(s => !s.isDirectory).map(s => ({
		resource: s.resource,
		options: { preserveFocus: true }
	})));
};
