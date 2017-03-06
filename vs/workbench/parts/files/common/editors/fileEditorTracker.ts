/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import errors = require('vs/base/common/errors');
import URI from 'vs/base/common/uri';
import paths = require('vs/base/common/paths');
import { IEditor, IEditorViewState, isCommonCodeEditor } from 'vs/editor/common/editorCommon';
import { toResource, IEditorStacksModel, SideBySideEditorInput, IEditorGroup, IWorkbenchEditorConfiguration } from 'vs/workbench/common/editor';
import { BINARY_FILE_EDITOR_ID } from 'vs/workbench/parts/files/common/files';
import { ITextFileService, ModelState, ITextFileEditorModel } from 'vs/workbench/services/textfile/common/textfiles';
import { FileOperationEvent, FileOperation, IFileService, FileChangeType, FileChangesEvent, isEqual, indexOf, isParent } from 'vs/platform/files/common/files';
import { FileEditorInput } from 'vs/workbench/parts/files/common/editors/fileEditorInput';
import { IEditorGroupService } from 'vs/workbench/services/group/common/groupService';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { distinct } from 'vs/base/common/arrays';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { once } from 'vs/base/common/event';

export class FileEditorTracker implements IWorkbenchContribution {
	private stacks: IEditorStacksModel;
	private toUnbind: IDisposable[];
	protected closeOnExternalFileDelete: boolean;
	private mapResourceToUndoDirtyFromExternalDelete: { [resource: string]: () => void };

	constructor(
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService,
		@ITextFileService private textFileService: ITextFileService,
		@ILifecycleService private lifecycleService: ILifecycleService,
		@IEditorGroupService private editorGroupService: IEditorGroupService,
		@IFileService private fileService: IFileService,
		@IEnvironmentService private environmentService: IEnvironmentService,
		@IConfigurationService private configurationService: IConfigurationService
	) {
		this.toUnbind = [];
		this.stacks = editorGroupService.getStacksModel();
		this.mapResourceToUndoDirtyFromExternalDelete = Object.create(null);

		this.onConfigurationUpdated(configurationService.getConfiguration<IWorkbenchEditorConfiguration>());

		this.registerListeners();
	}

	public getId(): string {
		return 'vs.files.fileEditorTracker';
	}

	private registerListeners(): void {

		// Update editors from operation changes
		this.toUnbind.push(this.fileService.onAfterOperation(e => this.onFileOperation(e)));

		// Update editors from disk changes
		this.toUnbind.push(this.fileService.onFileChanges(e => this.onFileChanges(e)));

		// Lifecycle
		this.lifecycleService.onShutdown(this.dispose, this);

		// Configuration
		this.toUnbind.push(this.configurationService.onDidUpdateConfiguration(e => this.onConfigurationUpdated(e.config)));
	}

	private onConfigurationUpdated(configuration: IWorkbenchEditorConfiguration): void {
		if (configuration.workbench && configuration.workbench.editor && typeof configuration.workbench.editor.closeOnExternalFileDelete === 'boolean') {
			this.closeOnExternalFileDelete = configuration.workbench.editor.closeOnExternalFileDelete;
		} else {
			this.closeOnExternalFileDelete = true; // default
		}
	}

	// Note: there is some duplication with the other file event handler below. Since we cannot always rely on the disk events
	// carrying all necessary data in all environments, we also use the file operation events to make sure operations are handled.
	// In any case there is no guarantee if the local event is fired first or the disk one. Thus, code must handle the case
	// that the event ordering is random as well as might not carry all information needed.
	private onFileOperation(e: FileOperationEvent): void {

		// Handle moves specially when file is opened
		if (e.operation === FileOperation.MOVE) {
			this.handleMovedFileInOpenedEditors(e.resource, e.target.resource);
		}

		// Handle deletes
		if (e.operation === FileOperation.DELETE || e.operation === FileOperation.MOVE) {
			this.handleDeletes(e.resource, false, e.target ? e.target.resource : void 0);
		}
	}

	private onFileChanges(e: FileChangesEvent): void {

		// Handle added
		if (e.gotAdded()) {
			this.handleAdded(e);
		}

		// Handle updates
		this.handleUpdates(e);

		// Handle deletes
		if (e.gotDeleted()) {
			this.handleDeletes(e, true);
		}
	}

	private handleAdded(e: FileChangesEvent): void {

		// Flag models as saved that are identical to disk contents
		// (only if we do not dispose from external deletes and caused them to be dirty)
		if (!this.closeOnExternalFileDelete) {
			const dirtyFileEditors = this.getOpenedFileEditors(true /* dirty only */);
			dirtyFileEditors.forEach(editor => {
				const resource = editor.getResource();

				// See if we have a stored undo operation for this editor
				const undo = this.mapResourceToUndoDirtyFromExternalDelete[resource.toString()];
				if (undo) {

					// file showing in editor was added
					if (e.contains(resource, FileChangeType.ADDED)) {
						undo();
						this.mapResourceToUndoDirtyFromExternalDelete[resource.toString()] = void 0;
					}
				}
			});
		}
	}

	private handleDeletes(arg1: URI | FileChangesEvent, isExternal: boolean, movedTo?: URI): void {
		const nonDirtyFileEditors = this.getOpenedFileEditors(false /* non dirty only */);
		nonDirtyFileEditors.forEach(editor => {
			const resource = editor.getResource();

			// Special case: a resource was renamed to the same path with different casing. Since our paths
			// API is treating the paths as equal (they are on disk), we end up disposing the input we just
			// renamed. The workaround is to detect that we do not dispose any input we are moving the file to
			if (movedTo && movedTo.fsPath === resource.fsPath) {
				return;
			}

			let matches = false;
			if (arg1 instanceof FileChangesEvent) {
				matches = arg1.contains(resource, FileChangeType.DELETED);
			} else {
				matches = isEqual(resource.fsPath, arg1.fsPath) || isParent(resource.fsPath, arg1.fsPath);
			}

			if (!matches) {
				return;
			}

			// Handle deletes in opened editors depending on:
			// - the user has not disabled the setting closeOnExternalFileDelete
			// - the file change is local or external
			// - the input is not resolved (we need to dispose because we cannot restore otherwise since we do not have the contents)
			if (this.closeOnExternalFileDelete || !isExternal || !editor.isResolved()) {

				// We have received reports of users seeing delete events even though the file still
				// exists (network shares issue: https://github.com/Microsoft/vscode/issues/13665).
				// Since we do not want to close an editor without reason, we have to check if the
				// file is really gone and not just a faulty file event (TODO@Ben revisit when we
				// have a more stable file watcher in place for this scenario).
				// This only applies to external file events, so we need to check for the isExternal
				// flag.
				let checkExists: TPromise<boolean>;
				if (isExternal) {
					checkExists = TPromise.timeout(100).then(() => this.fileService.existsFile(resource));
				} else {
					checkExists = TPromise.as(false);
				}

				checkExists.done(exists => {
					if (!exists && !editor.isDisposed()) {
						editor.dispose();
					} else if (this.environmentService.verbose) {
						console.warn(`File exists even though we received a delete event: ${resource.toString()}`);
					}
				});
			}

			// Otherwise we want to keep the editor open and mark it as dirty since its underlying resource was deleted
			else {
				const model = this.textFileService.models.get(resource);
				if (model && model.getState() === ModelState.SAVED) {
					const undo = model.setOrphaned();
					this.mapResourceToUndoDirtyFromExternalDelete[resource.toString()] = undo;
					once(model.onDispose)(() => {
						this.mapResourceToUndoDirtyFromExternalDelete[resource.toString()] = void 0;
					});
				}
			}
		});
	}

	private getOpenedFileEditors(dirtyState: boolean): FileEditorInput[] {
		const editors: FileEditorInput[] = [];

		const stacks = this.editorGroupService.getStacksModel();
		stacks.groups.forEach(group => {
			group.getEditors().forEach(editor => {
				if (editor instanceof FileEditorInput) {
					if (!!editor.isDirty() === dirtyState) {
						editors.push(editor);
					}
				} else if (editor instanceof SideBySideEditorInput) {
					const master = editor.master;
					const details = editor.details;

					if (master instanceof FileEditorInput) {
						if (!!master.isDirty() === dirtyState) {
							editors.push(master);
						}
					}

					if (details instanceof FileEditorInput) {
						if (!!details.isDirty() === dirtyState) {
							editors.push(details);
						}
					}
				}
			});
		});

		return editors;
	}

	private handleMovedFileInOpenedEditors(oldResource: URI, newResource: URI): void {
		const stacks = this.editorGroupService.getStacksModel();
		stacks.groups.forEach(group => {
			group.getEditors().forEach(input => {
				if (input instanceof FileEditorInput) {
					const resource = input.getResource();

					// Update Editor if file (or any parent of the input) got renamed or moved
					if (isEqual(resource.fsPath, oldResource.fsPath) || isParent(resource.fsPath, oldResource.fsPath)) {
						let reopenFileResource: URI;
						if (oldResource.toString() === resource.toString()) {
							reopenFileResource = newResource; // file got moved
						} else {
							const index = indexOf(resource.fsPath, oldResource.fsPath);
							reopenFileResource = URI.file(paths.join(newResource.fsPath, resource.fsPath.substr(index + oldResource.fsPath.length + 1))); // parent folder got moved
						}

						// Reopen
						this.editorService.openEditor({
							resource: reopenFileResource,
							options: {
								preserveFocus: true,
								pinned: group.isPinned(input),
								index: group.indexOf(input),
								inactive: !group.isActive(input),
								viewState: this.getViewStateFor(oldResource, group)
							}
						}, stacks.positionOfGroup(group)).done(null, errors.onUnexpectedError);
					}
				}
			});
		});
	}

	private getViewStateFor(resource: URI, group: IEditorGroup): IEditorViewState {
		const stacks = this.editorGroupService.getStacksModel();
		const editors = this.editorService.getVisibleEditors();

		for (let i = 0; i < editors.length; i++) {
			const editor = editors[i];
			if (editor && editor.position === stacks.positionOfGroup(group)) {
				const resource = toResource(editor.input, { filter: 'file' });
				if (resource && isEqual(resource.fsPath, resource.fsPath)) {
					const control = editor.getControl();
					if (isCommonCodeEditor(control)) {
						return control.saveViewState();
					}
				}
			}
		}

		return void 0;
	}

	private handleUpdates(e: FileChangesEvent): void {

		// Collect distinct (saved) models to update.
		//
		// Note: we also consider the added event because it could be that a file was added
		// and updated right after.
		const modelsToUpdate = distinct([...e.getUpdated(), ...e.getAdded()]
			.map(u => this.textFileService.models.get(u.resource))
			.filter(model => model && model.getState() === ModelState.SAVED), m => m.getResource().toString());

		// Handle updates to visible editors specially to preserve view state
		const visibleModels = this.handleUpdatesToVisibleEditors(e);

		// Handle updates to remaining models that are not visible
		modelsToUpdate.forEach(model => {
			if (visibleModels.indexOf(model) >= 0) {
				return; // already updated
			}

			// Load model to update
			model.load().done(null, errors.onUnexpectedError);
		});
	}

	private handleUpdatesToVisibleEditors(e: FileChangesEvent): ITextFileEditorModel[] {
		const updatedModels: ITextFileEditorModel[] = [];

		const editors = this.editorService.getVisibleEditors();
		editors.forEach(editor => {
			const fileResource = toResource(editor.input, { filter: 'file', supportSideBySide: true });

			// File Editor
			if (fileResource) {

				// File got added or updated, so check for model and update
				// Note: we also consider the added event because it could be that a file was added
				// and updated right after.
				if (e.contains(fileResource, FileChangeType.UPDATED) || e.contains(fileResource, FileChangeType.ADDED)) {

					// Text file: check for last save time
					const textModel = this.textFileService.models.get(fileResource);
					if (textModel) {

						// We only ever update models that are in good saved state
						if (textModel.getState() === ModelState.SAVED) {
							const codeEditor = editor.getControl() as IEditor;
							const viewState = codeEditor.saveViewState();
							const lastKnownEtag = textModel.getETag();

							textModel.load().done(() => {

								// only restore the view state if the model changed and the editor is still showing it
								if (textModel.getETag() !== lastKnownEtag && codeEditor.getModel() === textModel.textEditorModel) {
									codeEditor.restoreViewState(viewState);
								}
							}, errors.onUnexpectedError);

							updatedModels.push(textModel);
						}
					}

					// Binary file: always update
					else if (editor.getId() === BINARY_FILE_EDITOR_ID) {
						this.editorService.openEditor(editor.input, { forceOpen: true, preserveFocus: true }, editor.position).done(null, errors.onUnexpectedError);
					}
				}
			}
		});

		return updatedModels;
	}

	public dispose(): void {
		this.toUnbind = dispose(this.toUnbind);
	}
}