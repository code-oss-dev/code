/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { assertIsDefined, withNullAsUndefined } from 'vs/base/common/types';
import { ITextFileService, ModelState, ITextFileEditorModel, ITextFileStreamContent, ILoadOptions, IResolvedTextFileEditorModel, ITextFileSaveOptions, LoadReason } from 'vs/workbench/services/textfile/common/textfiles';
import { EncodingMode, IRevertOptions, SaveReason } from 'vs/workbench/common/editor';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { IBackupFileService, IResolvedBackup } from 'vs/workbench/services/backup/common/backup';
import { IFileService, FileOperationError, FileOperationResult, FileChangesEvent, FileChangeType, IFileStatWithMetadata, ETAG_DISABLED, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { timeout, TaskSequentializer } from 'vs/base/common/async';
import { ITextBufferFactory, ITextModel } from 'vs/editor/common/model';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ILogService } from 'vs/platform/log/common/log';
import { basename } from 'vs/base/common/path';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IWorkingCopyService, IWorkingCopyBackup } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { ILabelService } from 'vs/platform/label/common/label';
import { CancellationTokenSource } from 'vs/base/common/cancellation';

interface IBackupMetaData {
	mtime: number;
	ctime: number;
	size: number;
	etag: string;
	orphaned: boolean;
}

/**
 * The text file editor model listens to changes to its underlying code editor model and saves these changes through the file service back to the disk.
 */
export class TextFileEditorModel extends BaseTextEditorModel implements ITextFileEditorModel {

	//#region Events

	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onDidLoad = this._register(new Emitter<LoadReason>());
	readonly onDidLoad = this._onDidLoad.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidSaveError = this._register(new Emitter<void>());
	readonly onDidSaveError = this._onDidSaveError.event;

	private readonly _onDidSave = this._register(new Emitter<SaveReason>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidRevert = this._register(new Emitter<void>());
	readonly onDidRevert = this._onDidRevert.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<void>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly _onDidChangeOrphaned = this._register(new Emitter<void>());
	readonly onDidChangeOrphaned = this._onDidChangeOrphaned.event;

	//#endregion

	readonly capabilities = 0;

	readonly name = basename(this.labelService.getUriLabel(this.resource));

	private contentEncoding: string | undefined; // encoding as reported from disk

	private versionId = 0;
	private bufferSavedVersionId: number | undefined;
	private ignoreDirtyOnModelContentChange = false;

	private lastResolvedFileStat: IFileStatWithMetadata | undefined;

	private readonly saveSequentializer = new TaskSequentializer();
	private lastSaveAttemptTime = 0;

	private dirty = false;
	private inConflictMode = false;
	private inOrphanMode = false;
	private inErrorMode = false;
	private disposed = false;

	constructor(
		public readonly resource: URI,
		private preferredEncoding: string | undefined,	// encoding as chosen by the user
		private preferredMode: string | undefined,		// mode as chosen by the user
		@INotificationService private readonly notificationService: INotificationService,
		@IModeService modeService: IModeService,
		@IModelService modelService: IModelService,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBackupFileService private readonly backupFileService: IBackupFileService,
		@ILogService private readonly logService: ILogService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@ILabelService private readonly labelService: ILabelService
	) {
		super(modelService, modeService);

		// Make known to working copy service
		this._register(this.workingCopyService.registerWorkingCopy(this));

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.fileService.onFileChanges(e => this.onFileChanges(e)));
		this._register(this.filesConfigurationService.onFilesAssociationChange(e => this.onFilesAssociationChange()));
	}

	private async onFileChanges(e: FileChangesEvent): Promise<void> {
		let fileEventImpactsModel = false;
		let newInOrphanModeGuess: boolean | undefined;

		// If we are currently orphaned, we check if the model file was added back
		if (this.inOrphanMode) {
			const modelFileAdded = e.contains(this.resource, FileChangeType.ADDED);
			if (modelFileAdded) {
				newInOrphanModeGuess = false;
				fileEventImpactsModel = true;
			}
		}

		// Otherwise we check if the model file was deleted
		else {
			const modelFileDeleted = e.contains(this.resource, FileChangeType.DELETED);
			if (modelFileDeleted) {
				newInOrphanModeGuess = true;
				fileEventImpactsModel = true;
			}
		}

		if (fileEventImpactsModel && this.inOrphanMode !== newInOrphanModeGuess) {
			let newInOrphanModeValidated: boolean = false;
			if (newInOrphanModeGuess) {
				// We have received reports of users seeing delete events even though the file still
				// exists (network shares issue: https://github.com/Microsoft/vscode/issues/13665).
				// Since we do not want to mark the model as orphaned, we have to check if the
				// file is really gone and not just a faulty file event.
				await timeout(100);

				if (this.disposed) {
					newInOrphanModeValidated = true;
				} else {
					const exists = await this.fileService.exists(this.resource);
					newInOrphanModeValidated = !exists;
				}
			}

			if (this.inOrphanMode !== newInOrphanModeValidated && !this.disposed) {
				this.setOrphaned(newInOrphanModeValidated);
			}
		}
	}

	private setOrphaned(orphaned: boolean): void {
		if (this.inOrphanMode !== orphaned) {
			this.inOrphanMode = orphaned;
			this._onDidChangeOrphaned.fire();
		}
	}

	private onFilesAssociationChange(): void {
		if (!this.isResolved()) {
			return;
		}

		const firstLineText = this.getFirstLineText(this.textEditorModel);
		const languageSelection = this.getOrCreateMode(this.resource, this.modeService, this.preferredMode, firstLineText);

		this.modelService.setMode(this.textEditorModel, languageSelection);
	}

	setMode(mode: string): void {
		super.setMode(mode);

		this.preferredMode = mode;
	}

	//#region Backup

	async backup(): Promise<IWorkingCopyBackup> {

		// Fill in metadata if we are resolved
		let meta: IBackupMetaData | undefined = undefined;
		if (this.lastResolvedFileStat) {
			meta = {
				mtime: this.lastResolvedFileStat.mtime,
				ctime: this.lastResolvedFileStat.ctime,
				size: this.lastResolvedFileStat.size,
				etag: this.lastResolvedFileStat.etag,
				orphaned: this.inOrphanMode
			};
		}

		return { meta, content: withNullAsUndefined(this.createSnapshot()) };
	}

	//#endregion

	//#region Revert

	async revert(options?: IRevertOptions): Promise<boolean> {
		if (!this.isResolved()) {
			return false;
		}

		// Unset flags
		const wasDirty = this.dirty;
		const undo = this.doSetDirty(false);

		// Force read from disk unless reverting soft
		const softUndo = options?.soft;
		if (!softUndo) {
			try {
				await this.load({ forceReadFromDisk: true });
			} catch (error) {

				// FileNotFound means the file got deleted meanwhile, so ignore it
				if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {

					// Set flags back to previous values, we are still dirty if revert failed
					undo();

					throw error;
				}
			}
		}

		// Emit file change event
		this._onDidRevert.fire();

		// Emit dirty change event
		if (wasDirty) {
			this._onDidChangeDirty.fire();
		}

		return true;
	}

	//#endregion

	//#region Load

	async load(options?: ILoadOptions): Promise<ITextFileEditorModel> {
		this.logService.trace('[text file model] load() - enter', this.resource.toString());

		// It is very important to not reload the model when the model is dirty.
		// We also only want to reload the model from the disk if no save is pending
		// to avoid data loss.
		if (this.dirty || this.saveSequentializer.hasPending()) {
			this.logService.trace('[text file model] load() - exit - without loading because model is dirty or being saved', this.resource.toString());

			return this;
		}

		// Only for new models we support to load from backup
		if (!this.isResolved()) {
			const backup = await this.backupFileService.resolve<IBackupMetaData>(this.resource);

			if (this.isResolved()) {
				return this; // Make sure meanwhile someone else did not succeed in loading
			}

			if (backup) {
				try {
					return await this.loadFromBackup(backup, options);
				} catch (error) {
					this.logService.error('[text file model] load() from backup', error); // ignore error and continue to load as file below
				}
			}
		}

		// Otherwise load from file resource
		return this.loadFromFile(options);
	}

	private async loadFromBackup(backup: IResolvedBackup<IBackupMetaData>, options?: ILoadOptions): Promise<TextFileEditorModel> {

		// Load with backup
		this.loadFromContent({
			resource: this.resource,
			name: this.name,
			mtime: backup.meta ? backup.meta.mtime : Date.now(),
			ctime: backup.meta ? backup.meta.ctime : Date.now(),
			size: backup.meta ? backup.meta.size : 0,
			etag: backup.meta ? backup.meta.etag : ETAG_DISABLED, // etag disabled if unknown!
			value: backup.value,
			encoding: this.textFileService.encoding.getPreferredWriteEncoding(this.resource, this.preferredEncoding).encoding
		}, options, true /* from backup */);

		// Restore orphaned flag based on state
		if (backup.meta && backup.meta.orphaned) {
			this.setOrphaned(true);
		}

		return this;
	}

	private async loadFromFile(options?: ILoadOptions): Promise<TextFileEditorModel> {
		const forceReadFromDisk = options?.forceReadFromDisk;
		const allowBinary = this.isResolved() /* always allow if we resolved previously */ || options?.allowBinary;

		// Decide on etag
		let etag: string | undefined;
		if (forceReadFromDisk) {
			etag = ETAG_DISABLED; // disable ETag if we enforce to read from disk
		} else if (this.lastResolvedFileStat) {
			etag = this.lastResolvedFileStat.etag; // otherwise respect etag to support caching
		}

		// Ensure to track the versionId before doing a long running operation
		// to make sure the model was not changed in the meantime which would
		// indicate that the user or program has made edits. If we would ignore
		// this, we could potentially loose the changes that were made because
		// after resolving the content we update the model and reset the dirty
		// flag.
		const currentVersionId = this.versionId;

		// Resolve Content
		try {
			const content = await this.textFileService.readStream(this.resource, { acceptTextOnly: !allowBinary, etag, encoding: this.preferredEncoding });

			// Clear orphaned state when loading was successful
			this.setOrphaned(false);

			if (currentVersionId !== this.versionId) {
				return this; // Make sure meanwhile someone else did not succeed loading
			}

			return this.loadFromContent(content, options);
		} catch (error) {
			const result = error.fileOperationResult;

			// Apply orphaned state based on error code
			this.setOrphaned(result === FileOperationResult.FILE_NOT_FOUND);

			// NotModified status is expected and can be handled gracefully
			if (result === FileOperationResult.FILE_NOT_MODIFIED_SINCE) {
				return this;
			}

			// Ignore when a model has been resolved once and the file was deleted meanwhile. Since
			// we already have the model loaded, we can return to this state and update the orphaned
			// flag to indicate that this model has no version on disk anymore.
			if (this.isResolved() && result === FileOperationResult.FILE_NOT_FOUND) {
				return this;
			}

			// Otherwise bubble up the error
			throw error;
		}
	}

	private loadFromContent(content: ITextFileStreamContent, options?: ILoadOptions, fromBackup?: boolean): TextFileEditorModel {
		this.logService.trace('[text file model] load() - resolved content', this.resource.toString());

		// Update our resolved disk stat model
		this.updateLastResolvedFileStat({
			resource: this.resource,
			name: content.name,
			mtime: content.mtime,
			ctime: content.ctime,
			size: content.size,
			etag: content.etag,
			isFile: true,
			isDirectory: false,
			isSymbolicLink: false
		});

		// Keep the original encoding to not loose it when saving
		const oldEncoding = this.contentEncoding;
		this.contentEncoding = content.encoding;

		// Handle events if encoding changed
		if (this.preferredEncoding) {
			this.updatePreferredEncoding(this.contentEncoding); // make sure to reflect the real encoding of the file (never out of sync)
		} else if (oldEncoding !== this.contentEncoding) {
			this._onDidChangeEncoding.fire();
		}

		// Update Existing Model
		if (this.textEditorModel) {
			this.doUpdateTextModel(content.value);
		}

		// Create New Model
		else {
			this.doCreateTextModel(content.resource, content.value, !!fromBackup);
		}

		// Emit as event
		this._onDidLoad.fire(options?.reason ?? LoadReason.OTHER);

		return this;
	}

	private doCreateTextModel(resource: URI, value: ITextBufferFactory, fromBackup: boolean): void {
		this.logService.trace('[text file model] load() - created text editor model', this.resource.toString());

		// Create model
		const textModel = this.createTextEditorModel(value, resource, this.preferredMode);

		// We restored a backup so we have to set the model as being dirty
		if (fromBackup) {
			this.setDirty(true);
		}

		// Model Listeners
		this.installModelListeners(textModel);
	}

	private doUpdateTextModel(value: ITextBufferFactory): void {
		this.logService.trace('[text file model] load() - updated text editor model', this.resource.toString());

		// Update model value in a block that ignores content change events for dirty tracking
		this.ignoreDirtyOnModelContentChange = true;
		try {
			this.updateTextEditorModel(value, this.preferredMode);
		} finally {
			this.ignoreDirtyOnModelContentChange = false;
		}

		// Ensure we track the latest saved version ID given that the contents changed
		this.updateSavedVersionId();
	}

	private installModelListeners(model: ITextModel): void {

		// See https://github.com/Microsoft/vscode/issues/30189
		// This code has been extracted to a different method because it caused a memory leak
		// where `value` was captured in the content change listener closure scope.

		// Content Change
		this._register(model.onDidChangeContent(() => this.onModelContentChanged(model)));
	}

	private onModelContentChanged(model: ITextModel): void {
		this.logService.trace(`[text file model] onModelContentChanged() - enter`, this.resource.toString());

		// In any case increment the version id because it tracks the textual content state of the model at all times
		this.versionId++;
		this.logService.trace(`[text file model] onModelContentChanged() - new versionId ${this.versionId}`, this.resource.toString());

		// We mark check for a dirty-state change upon model content change, unless:
		// - explicitly instructed to ignore it (e.g. from model.load())
		// - the model is readonly (in that case we never assume the change was done by the user)
		if (!this.ignoreDirtyOnModelContentChange && !this.isReadonly()) {

			// The contents changed as a matter of Undo and the version reached matches the saved one
			// In this case we clear the dirty flag and emit a SAVED event to indicate this state.
			if (model.getAlternativeVersionId() === this.bufferSavedVersionId) {
				this.logService.trace('[text file model] onModelContentChanged() - model content changed back to last saved version', this.resource.toString());

				// Clear flags
				const wasDirty = this.dirty;
				this.setDirty(false);

				// Emit revert event if we were dirty
				if (wasDirty) {
					this._onDidRevert.fire();
				}
			}

			// Otherwise the content has changed and we signal this as becoming dirty
			else {
				this.logService.trace('[text file model] onModelContentChanged() - model content changed and marked as dirty', this.resource.toString());

				// Mark as dirty
				this.setDirty(true);
			}
		}

		// Emit as event
		this._onDidChangeContent.fire();
	}

	//#endregion

	//#region Dirty

	isDirty(): this is IResolvedTextFileEditorModel {
		return this.dirty;
	}

	setDirty(dirty: boolean): void {
		if (!this.isResolved()) {
			return; // only resolved models can be marked dirty
		}

		// Track dirty state and version id
		const wasDirty = this.dirty;
		this.doSetDirty(dirty);

		// Emit as Event if dirty changed
		if (dirty !== wasDirty) {
			this._onDidChangeDirty.fire();
		}
	}

	private doSetDirty(dirty: boolean): () => void {
		const wasDirty = this.dirty;
		const wasInConflictMode = this.inConflictMode;
		const wasInErrorMode = this.inErrorMode;
		const oldBufferSavedVersionId = this.bufferSavedVersionId;

		if (!dirty) {
			this.dirty = false;
			this.inConflictMode = false;
			this.inErrorMode = false;
			this.updateSavedVersionId();
		} else {
			this.dirty = true;
		}

		// Return function to revert this call
		return () => {
			this.dirty = wasDirty;
			this.inConflictMode = wasInConflictMode;
			this.inErrorMode = wasInErrorMode;
			this.bufferSavedVersionId = oldBufferSavedVersionId;
		};
	}

	//#endregion

	//#region Save

	async save(options: ITextFileSaveOptions = Object.create(null)): Promise<boolean> {
		if (!this.isResolved()) {
			return false;
		}

		if (this.isReadonly()) {
			this.logService.trace('[text file model] save() - ignoring request for readonly resource', this.resource.toString());

			return false; // if model is readonly we do not attempt to save at all
		}

		if (
			(this.hasState(ModelState.CONFLICT) || this.hasState(ModelState.ERROR)) &&
			(options.reason === SaveReason.AUTO || options.reason === SaveReason.FOCUS_CHANGE || options.reason === SaveReason.WINDOW_CHANGE)
		) {
			this.logService.trace('[text file model] save() - ignoring auto save request for model that is in conflict or error', this.resource.toString());

			return false; // if model is in save conflict or error, do not save unless save reason is explicit
		}

		this.logService.trace('[text file model] save() - enter', this.resource.toString());

		await this.doSave(options);

		this.logService.trace('[text file model] save() - exit', this.resource.toString());

		return true;
	}

	private doSave(options: ITextFileSaveOptions): Promise<void> {
		if (typeof options.reason !== 'number') {
			options.reason = SaveReason.EXPLICIT;
		}

		let versionId = this.versionId;
		this.logService.trace(`[text file model] doSave(${versionId}) - enter with versionId ${versionId}`, this.resource.toString());

		// Lookup any running pending save for this versionId and return it if found
		//
		// Scenario: user invoked the save action multiple times quickly for the same contents
		//           while the save was not yet finished to disk
		//
		if (this.saveSequentializer.hasPending(versionId)) {
			this.logService.trace(`[text file model] doSave(${versionId}) - exit - found a pending save for versionId ${versionId}`, this.resource.toString());

			return this.saveSequentializer.pending;
		}

		// Return early if not dirty (unless forced)
		//
		// Scenario: user invoked save action even though the model is not dirty
		if (!options.force && !this.dirty) {
			this.logService.trace(`[text file model] doSave(${versionId}) - exit - because not dirty and/or versionId is different (this.isDirty: ${this.dirty}, this.versionId: ${this.versionId})`, this.resource.toString());

			return Promise.resolve();
		}

		// Return if currently saving by storing this save request as the next save that should happen.
		// Never ever must 2 saves execute at the same time because this can lead to dirty writes and race conditions.
		//
		// Scenario A: auto save was triggered and is currently busy saving to disk. this takes long enough that another auto save
		//             kicks in.
		// Scenario B: save is very slow (e.g. network share) and the user manages to change the buffer and trigger another save
		//             while the first save has not returned yet.
		//
		if (this.saveSequentializer.hasPending()) {
			this.logService.trace(`[text file model] doSave(${versionId}) - exit - because busy saving`, this.resource.toString());

			// Indicate to the save sequentializer that we want to
			// cancel the pending operation so that ours can run
			// before the pending one finishes.
			// Currently this will try to cancel pending save
			// participants but never a pending save.
			this.saveSequentializer.cancelPending();

			// Register this as the next upcoming save and return
			return this.saveSequentializer.setNext(() => this.doSave(options));
		}

		// Push all edit operations to the undo stack so that the user has a chance to
		// Ctrl+Z back to the saved version.
		if (this.isResolved()) {
			this.textEditorModel.pushStackElement();
		}

		// A save participant can still change the model now and since we are so close to saving
		// we do not want to trigger another auto save or similar, so we block this
		// In addition we update our version right after in case it changed because of a model change
		//
		// Save participants can also be skipped through API.
		const saveParticipantCancellation = new CancellationTokenSource();
		let saveParticipantPromise: Promise<number> = Promise.resolve(versionId);
		if (this.isResolved() && this.textFileService.saveParticipant && !options.skipSaveParticipants) {
			const onCompleteOrError = () => {
				this.ignoreDirtyOnModelContentChange = false;

				return this.versionId;
			};

			this.ignoreDirtyOnModelContentChange = true;
			saveParticipantPromise = this.textFileService.saveParticipant.participate(this, { reason: options.reason }, saveParticipantCancellation.token).then(onCompleteOrError, onCompleteOrError);
		}

		// mark the save participant as current pending save operation
		return this.saveSequentializer.setPending(versionId, saveParticipantPromise.then(newVersionId => {

			// We have to protect against being disposed at this point. It could be that the save() operation
			// was triggerd followed by a dispose() operation right after without waiting. Typically we cannot
			// be disposed if we are dirty, but if we are not dirty, save() and dispose() can still be triggered
			// one after the other without waiting for the save() to complete. If we are disposed(), we risk
			// saving contents to disk that are stale (see https://github.com/Microsoft/vscode/issues/50942).
			// To fix this issue, we will not store the contents to disk when we got disposed.
			if (this.disposed) {
				return;
			}

			// We require a resolved model from this point on, since we are about to write data to disk.
			if (!this.isResolved()) {
				return;
			}

			// Under certain conditions we do a short-cut of flushing contents to disk when we can assume that
			// the file has not changed and as such was not dirty before.
			// The conditions are all of:
			// - a forced, explicit save (Ctrl+S)
			// - the model is not dirty (otherwise we know there are changed which needs to go to the file)
			// - the model is not in orphan mode (because in that case we know the file does not exist on disk)
			// - the model version did not change due to save participants running
			if (options.force && !this.dirty && !this.inOrphanMode && options.reason === SaveReason.EXPLICIT && versionId === newVersionId) {
				return this.doTouch(newVersionId, options.reason);
			}

			// update versionId with its new value (if pre-save changes happened)
			versionId = newVersionId;

			// Clear error flag since we are trying to save again
			this.inErrorMode = false;

			// Remember when this model was saved last
			this.lastSaveAttemptTime = Date.now();

			// Save to Disk
			// mark the save operation as currently pending with the versionId (it might have changed from a save participant triggering)
			this.logService.trace(`[text file model] doSave(${versionId}) - before write()`, this.resource.toString());
			const lastResolvedFileStat = assertIsDefined(this.lastResolvedFileStat);
			return this.saveSequentializer.setPending(newVersionId, this.textFileService.write(lastResolvedFileStat.resource, this.createSnapshot(), {
				overwriteReadonly: options.overwriteReadonly,
				overwriteEncoding: options.overwriteEncoding,
				mtime: lastResolvedFileStat.mtime,
				encoding: this.getEncoding(),
				etag: (options.ignoreModifiedSince || !this.filesConfigurationService.preventSaveConflicts(lastResolvedFileStat.resource, this.getMode())) ? ETAG_DISABLED : lastResolvedFileStat.etag,
				writeElevated: options.writeElevated
			}).then(stat => this.handleSaveSuccess(stat, versionId, options), error => this.handleSaveError(error, versionId, options)));
		}), () => saveParticipantCancellation.cancel());
	}

	private handleSaveSuccess(stat: IFileStatWithMetadata, versionId: number, options: ITextFileSaveOptions): void {
		this.logService.trace(`[text file model] doSave(${versionId}) - after write()`, this.resource.toString());

		// Updated resolved stat with updated stat
		this.updateLastResolvedFileStat(stat);

		// Update dirty state unless model has changed meanwhile
		if (versionId === this.versionId) {
			this.logService.trace(`[text file model] handleSaveSuccess(${versionId}) - setting dirty to false because versionId did not change`, this.resource.toString());
			this.setDirty(false);
		} else {
			this.logService.trace(`[text file model] handleSaveSuccess(${versionId}) - not setting dirty to false because versionId did change meanwhile`, this.resource.toString());
		}

		// Emit Save Event
		this._onDidSave.fire(options.reason ?? SaveReason.EXPLICIT);
	}

	private handleSaveError(error: Error, versionId: number, options: ITextFileSaveOptions): void {
		this.logService.error(`[text file model] handleSaveError(${versionId}) - exit - resulted in a save error: ${error.toString()}`, this.resource.toString());

		// Return early if the save() call was made asking to
		// handle the save error itself.
		if (options.ignoreErrorHandler) {
			throw error;
		}

		// Flag as error state in the model
		this.inErrorMode = true;

		// Look out for a save conflict
		if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
			this.inConflictMode = true;
		}

		// Show to user
		this.textFileService.saveErrorHandler.onSaveError(error, this);

		// Emit as event
		this._onDidSaveError.fire();
	}

	private doTouch(this: TextFileEditorModel & IResolvedTextFileEditorModel, versionId: number, reason: SaveReason): Promise<void> {
		const lastResolvedFileStat = assertIsDefined(this.lastResolvedFileStat);
		return this.saveSequentializer.setPending(versionId, this.textFileService.write(lastResolvedFileStat.resource, this.createSnapshot(), {
			mtime: lastResolvedFileStat.mtime,
			encoding: this.getEncoding(),
			etag: lastResolvedFileStat.etag
		}).then(stat => {

			// Updated resolved stat with updated stat since touching it might have changed mtime
			this.updateLastResolvedFileStat(stat);

			// Emit File Saved Event
			this._onDidSave.fire(reason);

		}, error => onUnexpectedError(error) /* just log any error but do not notify the user since the file was not dirty */));
	}

	private updateSavedVersionId(): void {
		// we remember the models alternate version id to remember when the version
		// of the model matches with the saved version on disk. we need to keep this
		// in order to find out if the model changed back to a saved version (e.g.
		// when undoing long enough to reach to a version that is saved and then to
		// clear the dirty flag)
		if (this.isResolved()) {
			this.bufferSavedVersionId = this.textEditorModel.getAlternativeVersionId();
		}
	}

	private updateLastResolvedFileStat(newFileStat: IFileStatWithMetadata): void {

		// First resolve - just take
		if (!this.lastResolvedFileStat) {
			this.lastResolvedFileStat = newFileStat;
		}

		// Subsequent resolve - make sure that we only assign it if the mtime is equal or has advanced.
		// This prevents race conditions from loading and saving. If a save comes in late after a revert
		// was called, the mtime could be out of sync.
		else if (this.lastResolvedFileStat.mtime <= newFileStat.mtime) {
			this.lastResolvedFileStat = newFileStat;
		}
	}

	//#endregion

	getLastSaveAttemptTime(): number {
		return this.lastSaveAttemptTime;
	}

	hasState(state: ModelState): boolean {
		switch (state) {
			case ModelState.CONFLICT:
				return this.inConflictMode;
			case ModelState.DIRTY:
				return this.dirty;
			case ModelState.ERROR:
				return this.inErrorMode;
			case ModelState.ORPHAN:
				return this.inOrphanMode;
			case ModelState.PENDING_SAVE:
				return this.saveSequentializer.hasPending();
			case ModelState.SAVED:
				return !this.dirty;
		}
	}

	getMode(this: IResolvedTextFileEditorModel): string;
	getMode(): string | undefined;
	getMode(): string | undefined {
		if (this.textEditorModel) {
			return this.textEditorModel.getModeId();
		}

		return this.preferredMode;
	}

	//#region Encoding

	getEncoding(): string | undefined {
		return this.preferredEncoding || this.contentEncoding;
	}

	setEncoding(encoding: string, mode: EncodingMode): void {
		if (!this.isNewEncoding(encoding)) {
			return; // return early if the encoding is already the same
		}

		// Encode: Save with encoding
		if (mode === EncodingMode.Encode) {
			this.updatePreferredEncoding(encoding);

			// Save
			if (!this.isDirty()) {
				this.versionId++; // needs to increment because we change the model potentially
				this.setDirty(true);
			}

			if (!this.inConflictMode) {
				this.save({ overwriteEncoding: true });
			}
		}

		// Decode: Load with encoding
		else {
			if (this.isDirty()) {
				this.notificationService.info(nls.localize('saveFileFirst', "The file is dirty. Please save it first before reopening it with another encoding."));

				return;
			}

			this.updatePreferredEncoding(encoding);

			// Load
			this.load({
				forceReadFromDisk: true	// because encoding has changed
			});
		}
	}

	updatePreferredEncoding(encoding: string | undefined): void {
		if (!this.isNewEncoding(encoding)) {
			return;
		}

		this.preferredEncoding = encoding;

		// Emit
		this._onDidChangeEncoding.fire();
	}

	private isNewEncoding(encoding: string | undefined): boolean {
		if (this.preferredEncoding === encoding) {
			return false; // return early if the encoding is already the same
		}

		if (!this.preferredEncoding && this.contentEncoding === encoding) {
			return false; // also return if we don't have a preferred encoding but the content encoding is already the same
		}

		return true;
	}

	//#endregion

	isResolved(): this is IResolvedTextFileEditorModel {
		return !!this.textEditorModel;
	}

	isReadonly(): boolean {
		return this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.Readonly);
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	getStat(): IFileStatWithMetadata | undefined {
		return this.lastResolvedFileStat;
	}

	dispose(): void {
		this.disposed = true;
		this.inConflictMode = false;
		this.inOrphanMode = false;
		this.inErrorMode = false;

		super.dispose();
	}
}
