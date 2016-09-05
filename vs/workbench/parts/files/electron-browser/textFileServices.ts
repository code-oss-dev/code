/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import nls = require('vs/nls');
import {TPromise} from 'vs/base/common/winjs.base';
import paths = require('vs/base/common/paths');
import strings = require('vs/base/common/strings');
import {isWindows, isLinux} from 'vs/base/common/platform';
import URI from 'vs/base/common/uri';
import {ConfirmResult} from 'vs/workbench/common/editor';
import {IEventService} from 'vs/platform/event/common/event';
import {TextFileService as AbstractTextFileService} from 'vs/workbench/parts/files/common/textFileServices';
import {AutoSaveMode, IRawTextContent} from 'vs/workbench/parts/files/common/files';
import {IUntitledEditorService} from 'vs/workbench/services/untitled/common/untitledEditorService';
import {IFileService, IResolveContentOptions} from 'vs/platform/files/common/files';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IWorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import {ILifecycleService} from 'vs/platform/lifecycle/common/lifecycle';
import {ITelemetryService} from 'vs/platform/telemetry/common/telemetry';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {IModeService} from 'vs/editor/common/services/modeService';
import {IWorkbenchEditorService} from 'vs/workbench/services/editor/common/editorService';
import {IWindowService} from 'vs/workbench/services/window/electron-browser/windowService';
import {IEditorGroupService} from 'vs/workbench/services/group/common/groupService';
import {IModelService} from 'vs/editor/common/services/modelService';
import {ModelBuilder} from 'vs/editor/node/model/modelBuilder';
import product from 'vs/platform/product';
import {IEnvironmentService} from 'vs/platform/environment/common/environment';

export class TextFileService extends AbstractTextFileService {

	private static MAX_CONFIRM_FILES = 10;

	constructor(
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IFileService fileService: IFileService,
		@IUntitledEditorService untitledEditorService: IUntitledEditorService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEventService eventService: IEventService,
		@IModeService private modeService: IModeService,
		@IWorkbenchEditorService editorService: IWorkbenchEditorService,
		@IEditorGroupService editorGroupService: IEditorGroupService,
		@IWindowService private windowService: IWindowService,
		@IModelService modelService: IModelService,
		@IEnvironmentService private environmentService: IEnvironmentService
	) {
		super(lifecycleService, contextService, instantiationService, configurationService, telemetryService, editorGroupService, editorService, eventService, fileService, modelService, untitledEditorService);
	}

	protected registerListeners(): void {
		super.registerListeners();

		// Lifecycle
		this.lifecycleService.onWillShutdown(event => event.veto(this.beforeShutdown()));
		this.lifecycleService.onShutdown(this.onShutdown, this);
	}

	public resolveTextContent(resource: URI, options?: IResolveContentOptions): TPromise<IRawTextContent> {
		return this.fileService.resolveStreamContent(resource, options).then(streamContent => {
			return ModelBuilder.fromStringStream(streamContent.value, this.modelService.getCreationOptions()).then(res => {
				const r: IRawTextContent = {
					resource: streamContent.resource,
					name: streamContent.name,
					mtime: streamContent.mtime,
					etag: streamContent.etag,
					mime: streamContent.mime,
					encoding: streamContent.encoding,
					value: res.rawText,
					valueLogicalHash: res.hash
				};
				return r;
			});
		});
	}

	public beforeShutdown(): boolean | TPromise<boolean> {

		// Dirty files need treatment on shutdown
		if (this.getDirty().length) {

			// If auto save is enabled, save all files and then check again for dirty files
			if (this.getAutoSaveMode() !== AutoSaveMode.OFF) {
				return this.saveAll(false /* files only */).then(() => {
					if (this.getDirty().length) {
						return this.confirmBeforeShutdown(); // we still have dirty files around, so confirm normally
					}

					return false; // all good, no veto
				});
			}

			// Otherwise just confirm what to do
			return this.confirmBeforeShutdown();
		}

		return false; // no veto
	}

	private confirmBeforeShutdown(): boolean | TPromise<boolean> {
		const confirm = this.confirmSave();

		// Save
		if (confirm === ConfirmResult.SAVE) {
			return this.saveAll(true /* includeUntitled */).then(result => {
				if (result.results.some(r => !r.success)) {
					return true; // veto if some saves failed
				}

				return false; // no veto
			});
		}

		// Don't Save
		else if (confirm === ConfirmResult.DONT_SAVE) {
			return false; // no veto
		}

		// Cancel
		else if (confirm === ConfirmResult.CANCEL) {
			return true; // veto
		}
	}

	private onShutdown(): void {
		super.dispose();
	}

	public confirmSave(resources?: URI[]): ConfirmResult {
		if (!!this.environmentService.extensionDevelopmentPath) {
			return ConfirmResult.DONT_SAVE; // no veto when we are in extension dev mode because we cannot assum we run interactive (e.g. tests)
		}

		const resourcesToConfirm = this.getDirty(resources);
		if (resourcesToConfirm.length === 0) {
			return ConfirmResult.DONT_SAVE;
		}

		const message = [
			resourcesToConfirm.length === 1 ? nls.localize('saveChangesMessage', "Do you want to save the changes you made to {0}?", paths.basename(resourcesToConfirm[0].fsPath)) : nls.localize('saveChangesMessages', "Do you want to save the changes to the following {0} files?", resourcesToConfirm.length)
		];

		if (resourcesToConfirm.length > 1) {
			message.push('');
			message.push(...resourcesToConfirm.slice(0, TextFileService.MAX_CONFIRM_FILES).map(r => paths.basename(r.fsPath)));

			if (resourcesToConfirm.length > TextFileService.MAX_CONFIRM_FILES) {
				if (resourcesToConfirm.length - TextFileService.MAX_CONFIRM_FILES === 1) {
					message.push(nls.localize('moreFile', "...1 additional file not shown"));
				} else {
					message.push(nls.localize('moreFiles', "...{0} additional files not shown", resourcesToConfirm.length - TextFileService.MAX_CONFIRM_FILES));
				}
			}

			message.push('');
		}

		// Button order
		// Windows: Save | Don't Save | Cancel
		// Mac: Save | Cancel | Don't Save
		// Linux: Don't Save | Cancel | Save

		const save = { label: resourcesToConfirm.length > 1 ? this.mnemonicLabel(nls.localize({ key: 'saveAll', comment: ['&& denotes a mnemonic'] }, "&&Save All")) : this.mnemonicLabel(nls.localize({ key: 'save', comment: ['&& denotes a mnemonic'] }, "&&Save")), result: ConfirmResult.SAVE };
		const dontSave = { label: this.mnemonicLabel(nls.localize({ key: 'dontSave', comment: ['&& denotes a mnemonic'] }, "Do&&n't Save")), result: ConfirmResult.DONT_SAVE };
		const cancel = { label: nls.localize('cancel', "Cancel"), result: ConfirmResult.CANCEL };

		const buttons = [];
		if (isWindows) {
			buttons.push(save, dontSave, cancel);
		} else if (isLinux) {
			buttons.push(dontSave, cancel, save);
		} else {
			buttons.push(save, cancel, dontSave);
		}

		const opts: Electron.ShowMessageBoxOptions = {
			title: product.nameLong,
			message: message.join('\n'),
			type: 'warning',
			detail: nls.localize('saveChangesDetail', "Your changes will be lost if you don't save them."),
			buttons: buttons.map(b => b.label),
			noLink: true,
			cancelId: buttons.indexOf(cancel)
		};

		if (isLinux) {
			opts.defaultId = 2;
		}

		const choice = this.windowService.getWindow().showMessageBox(opts);

		return buttons[choice].result;
	}

	private mnemonicLabel(label: string): string {
		if (!isWindows) {
			return label.replace(/\(&&\w\)|&&/g, ''); // no mnemonic support on mac/linux
		}

		return label.replace(/&&/g, '&');
	}

	public promptForPath(defaultPath?: string): string {
		return this.windowService.getWindow().showSaveDialog(this.getSaveDialogOptions(defaultPath ? paths.normalize(defaultPath, true) : void 0));
	}

	private getSaveDialogOptions(defaultPath?: string): Electron.SaveDialogOptions {
		const options: Electron.SaveDialogOptions = {
			defaultPath: defaultPath
		};

		// Filters are working flaky in Electron and there are bugs. On Windows they are working
		// somewhat but we see issues:
		// - https://github.com/electron/electron/issues/3556
		// - https://github.com/Microsoft/vscode/issues/451
		// - Bug on Windows: When "All Files" is picked, the path gets an extra ".*"
		// - Bug on Windows: Cannot save file without extension
		// - Bug on Windows: Untitled files get just the first extension of the list
		// Until these issues are resolved, we disable the dialog file extension filtering.
		const disable = true; // Simply using if (true) flags the code afterwards as not reachable.
		if (disable) {
			return options;
		}

		interface IFilter { name: string; extensions: string[]; }

		// Build the file filter by using our known languages
		const ext: string = paths.extname(defaultPath);
		let matchingFilter: IFilter;
		const filters: IFilter[] = this.modeService.getRegisteredLanguageNames().map(languageName => {
			const extensions = this.modeService.getExtensions(languageName);
			if (!extensions || !extensions.length) {
				return null;
			}

			const filter: IFilter = { name: languageName, extensions: extensions.map(e => strings.trim(e, '.')) };

			if (ext && extensions.indexOf(ext) >= 0) {
				matchingFilter = filter;

				return null; // matching filter will be added last to the top
			}

			return filter;
		}).filter(f => !!f);

		// Filters are a bit weird on Windows, based on having a match or not:
		// Match: we put the matching filter first so that it shows up selected and the all files last
		// No match: we put the all files filter first
		const allFilesFilter = { name: nls.localize('allFiles', "All Files"), extensions: ['*'] };
		if (matchingFilter) {
			filters.unshift(matchingFilter);
			filters.push(allFilesFilter);
		} else {
			filters.unshift(allFilesFilter);
		}

		options.filters = filters;

		return options;
	}
}