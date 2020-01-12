/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { guessMimeTypes } from 'vs/base/common/mime';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { URI } from 'vs/base/common/uri';
import { assertIsDefined } from 'vs/base/common/types';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ITextFileService, ModelState, ITextFileEditorModel, ISaveErrorHandler, ISaveParticipant, StateChange, ITextFileStreamContent, ILoadOptions, LoadReason, IResolvedTextFileEditorModel, ITextFileSaveOptions } from 'vs/workbench/services/textfile/common/textfiles';
import { EncodingMode, IRevertOptions, SaveReason } from 'vs/workbench/common/editor';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { IFileService, FileOperationError, FileOperationResult, FileChangesEvent, FileChangeType, IFileStatWithMetadata, ETAG_DISABLED, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { timeout } from 'vs/base/common/async';
import { ITextBufferFactory } from 'vs/editor/common/model';
import { hash } from 'vs/base/common/hash';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ILogService } from 'vs/platform/log/common/log';
import { isEqual, isEqualOrParent, extname, basename, joinPath } from 'vs/base/common/resources';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Schemas } from 'vs/base/common/network';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';

export interface IBackupMetaData {
	mtime: number;
	ctime: number;
	size: number;
	etag: string;
	orphaned: boolean;
}

type FileTelemetryDataFragment = {
	mimeType: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	ext: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	path: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	reason?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	whitelistedjson?: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

type TelemetryData = {
	mimeType: string;
	ext: string;
	path: number;
	reason?: number;
	whitelistedjson?: string;
};

/**
 * The text file editor model listens to changes to its underlying code editor model and saves these changes through the file service back to the disk.
 */
export class TextFileEditorModel extends BaseTextEditorModel implements ITextFileEditorModel {

	static WHITELIST_JSON = ['package.json', 'package-lock.json', 'tsconfig.json', 'jsconfig.json', 'bower.json', '.eslintrc.json', 'tslint.json', 'composer.json'];
	static WHITELIST_WORKSPACE_JSON = ['settings.json', 'extensions.json', 'tasks.json', 'launch.json'];

	private static saveErrorHandler: ISaveErrorHandler;
	static setSaveErrorHandler(handler: ISaveErrorHandler): void { TextFileEditorModel.saveErrorHandler = handler; }

	private static saveParticipant: ISaveParticipant | null;
	static setSaveParticipant(handler: ISaveParticipant | null): void { TextFileEditorModel.saveParticipant = handler; }

	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onDidChangeState = this._register(new Emitter<StateChange>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	readonly capabilities = 0;

	private contentEncoding: string | undefined; // encoding as reported from disk

	private versionId = 0;
	private bufferSavedVersionId: number | undefined;
	private blockModelContentChange = false;

	private lastResolvedFileStat: IFileStatWithMetadata | undefined;

	private readonly saveSequentializer = new SaveSequentializer();
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
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBackupFileService private readonly backupFileService: IBackupFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService
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
			this._onDidChangeState.fire(StateChange.ORPHANED_CHANGE);
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

	async backup(target = this.resource): Promise<void> {
		if (this.isResolved()) {

			// Only fill in model metadata if resource matches
			let meta: IBackupMetaData | undefined = undefined;
			if (isEqual(target, this.resource) && this.lastResolvedFileStat) {
				meta = {
					mtime: this.lastResolvedFileStat.mtime,
					ctime: this.lastResolvedFileStat.ctime,
					size: this.lastResolvedFileStat.size,
					etag: this.lastResolvedFileStat.etag,
					orphaned: this.inOrphanMode
				};
			}

			return this.backupFileService.backupResource<IBackupMetaData>(target, this.createSnapshot(), this.versionId, meta);
		}
	}

	hasBackup(): boolean {
		return this.backupFileService.hasBackupSync(this.resource, this.versionId);
	}

	async revert(options?: IRevertOptions): Promise<boolean> {
		if (!this.isResolved()) {
			return false;
		}

		// Unset flags
		const wasDirty = this.dirty;
		const undo = this.setDirty(false);

		// Force read from disk unless reverting soft
		const softUndo = options?.soft;
		if (!softUndo) {
			try {
				await this.load({ forceReadFromDisk: true });
			} catch (error) {

				// Set flags back to previous values, we are still dirty if revert failed
				undo();

				throw error;
			}
		}

		// Emit file change event
		this._onDidChangeState.fire(StateChange.REVERTED);

		// Emit dirty change event
		if (wasDirty) {
			this._onDidChangeDirty.fire();
		}

		return true;
	}

	async load(options?: ILoadOptions): Promise<ITextFileEditorModel> {
		this.logService.trace('[text file model] load() - enter', this.resource.toString());

		// It is very important to not reload the model when the model is dirty.
		// We also only want to reload the model from the disk if no save is pending
		// to avoid data loss.
		if (this.dirty || this.saveSequentializer.hasPendingSave()) {
			this.logService.trace('[text file model] load() - exit - without loading because model is dirty or being saved', this.resource.toString());

			return this;
		}

		// Only for new models we support to load from backup
		if (!this.isResolved()) {
			const backup = await this.backupFileService.loadBackupResource(this.resource);

			if (this.isResolved()) {
				return this; // Make sure meanwhile someone else did not suceed in loading
			}

			if (backup) {
				try {
					return await this.loadFromBackup(backup, options);
				} catch (error) {
					this.logService.error('[text file model] load()', error); // ignore error and continue to load as file below
				}
			}
		}

		// Otherwise load from file resource
		return this.loadFromFile(options);
	}

	private async loadFromBackup(backup: URI, options?: ILoadOptions): Promise<TextFileEditorModel> {

		// Resolve actual backup contents
		const resolvedBackup = await this.backupFileService.resolveBackupContent<IBackupMetaData>(backup);

		if (this.isResolved()) {
			return this; // Make sure meanwhile someone else did not suceed in loading
		}

		// Load with backup
		this.loadFromContent({
			resource: this.resource,
			name: basename(this.resource),
			mtime: resolvedBackup.meta ? resolvedBackup.meta.mtime : Date.now(),
			ctime: resolvedBackup.meta ? resolvedBackup.meta.ctime : Date.now(),
			size: resolvedBackup.meta ? resolvedBackup.meta.size : 0,
			etag: resolvedBackup.meta ? resolvedBackup.meta.etag : ETAG_DISABLED, // etag disabled if unknown!
			value: resolvedBackup.value,
			encoding: this.textFileService.encoding.getPreferredWriteEncoding(this.resource, this.preferredEncoding).encoding
		}, options, true /* from backup */);

		// Restore orphaned flag based on state
		if (resolvedBackup.meta && resolvedBackup.meta.orphaned) {
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
				return this; // Make sure meanwhile someone else did not suceed loading
			}

			return this.loadFromContent(content, options);
		} catch (error) {
			const result = error.fileOperationResult;

			// Apply orphaned state based on error code
			this.setOrphaned(result === FileOperationResult.FILE_NOT_FOUND);

			// NotModified status is expected and can be handled gracefully
			if (result === FileOperationResult.FILE_NOT_MODIFIED_SINCE) {

				// Guard against the model having changed in the meantime
				if (currentVersionId === this.versionId) {
					this.setDirty(false); // Ensure we are not tracking a stale state
				}

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
			this._onDidChangeState.fire(StateChange.ENCODING);
		}

		// Update Existing Model
		if (this.isResolved()) {
			this.doUpdateTextModel(content.value);
		}

		// Create New Model
		else {
			this.doCreateTextModel(content.resource, content.value, !!fromBackup);
		}

		// Telemetry: We log the fileGet telemetry event after the model has been loaded to ensure a good mimetype
		const settingsType = this.getTypeIfSettings();
		if (settingsType) {
			type SettingsReadClassification = {
				settingsType: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			};

			this.telemetryService.publicLog2<{ settingsType: string }, SettingsReadClassification>('settingsRead', { settingsType }); // Do not log read to user settings.json and .vscode folder as a fileGet event as it ruins our JSON usage data
		} else {
			type FileGetClassification = {} & FileTelemetryDataFragment;

			this.telemetryService.publicLog2<TelemetryData, FileGetClassification>('fileGet', this.getTelemetryData(options?.reason ?? LoadReason.OTHER));
		}

		return this;
	}

	private doCreateTextModel(resource: URI, value: ITextBufferFactory, fromBackup: boolean): void {
		this.logService.trace('[text file model] load() - created text editor model', this.resource.toString());

		// Create model
		this.createTextEditorModel(value, resource, this.preferredMode);

		// We restored a backup so we have to set the model as being dirty
		if (fromBackup) {
			this.doMakeDirty();
		}

		// Ensure we are not tracking a stale state
		else {
			this.setDirty(false);
		}

		// Model Listeners
		this.installModelListeners();
	}

	private doUpdateTextModel(value: ITextBufferFactory): void {
		this.logService.trace('[text file model] load() - updated text editor model', this.resource.toString());

		// Ensure we are not tracking a stale state
		this.setDirty(false);

		// Update model value in a block that ignores model content change events
		this.blockModelContentChange = true;
		try {
			this.updateTextEditorModel(value, this.preferredMode);
		} finally {
			this.blockModelContentChange = false;
		}

		// Ensure we track the latest saved version ID given that the contents changed
		this.updateSavedVersionId();
	}

	private installModelListeners(): void {

		// See https://github.com/Microsoft/vscode/issues/30189
		// This code has been extracted to a different method because it caused a memory leak
		// where `value` was captured in the content change listener closure scope.

		// Content Change
		if (this.isResolved()) {
			this._register(this.textEditorModel.onDidChangeContent(() => this.onModelContentChanged()));
		}
	}

	private onModelContentChanged(): void {
		this.logService.trace(`[text file model] onModelContentChanged() - enter`, this.resource.toString());

		// In any case increment the version id because it tracks the textual content state of the model at all times
		this.versionId++;
		this.logService.trace(`[text file model] onModelContentChanged() - new versionId ${this.versionId}`, this.resource.toString());

		// Ignore if blocking model changes
		if (this.blockModelContentChange) {
			return;
		}

		// The contents changed as a matter of Undo and the version reached matches the saved one
		// In this case we clear the dirty flag and emit a SAVED event to indicate this state.
		if (this.isResolved() && this.textEditorModel.getAlternativeVersionId() === this.bufferSavedVersionId) {
			this.logService.trace('[text file model] onModelContentChanged() - model content changed back to last saved version', this.resource.toString());

			// Clear flags
			const wasDirty = this.dirty;
			this.setDirty(false);

			// Emit event
			if (wasDirty) {
				this._onDidChangeState.fire(StateChange.REVERTED);
				this._onDidChangeDirty.fire();
			}
		} else {
			this.logService.trace('[text file model] onModelContentChanged() - model content changed and marked as dirty', this.resource.toString());

			// Mark as dirty
			this.doMakeDirty();
		}

		// Emit as event
		this._onDidChangeContent.fire();
	}

	makeDirty(): void {
		if (!this.isResolved()) {
			return; // only resolved models can be marked dirty
		}

		this.doMakeDirty();
	}

	private doMakeDirty(): void {

		// Track dirty state and version id
		const wasDirty = this.dirty;
		this.setDirty(true);

		// Emit as Event if we turned dirty
		if (!wasDirty) {
			this._onDidChangeState.fire(StateChange.DIRTY);
			this._onDidChangeDirty.fire();
		}
	}

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
		if (this.saveSequentializer.hasPendingSave(versionId)) {
			this.logService.trace(`[text file model] doSave(${versionId}) - exit - found a pending save for versionId ${versionId}`, this.resource.toString());

			return this.saveSequentializer.pendingSave || Promise.resolve();
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
		if (this.saveSequentializer.hasPendingSave()) {
			this.logService.trace(`[text file model] doSave(${versionId}) - exit - because busy saving`, this.resource.toString());

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
		// Save participants can also be skipped through API.
		let saveParticipantPromise: Promise<number> = Promise.resolve(versionId);
		if (TextFileEditorModel.saveParticipant && !options.skipSaveParticipants) {
			const onCompleteOrError = () => {
				this.blockModelContentChange = false;

				return this.versionId;
			};

			this.blockModelContentChange = true;
			saveParticipantPromise = TextFileEditorModel.saveParticipant.participate(this as IResolvedTextFileEditorModel, { reason: options.reason }).then(onCompleteOrError, onCompleteOrError);
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
				return this.doTouch(newVersionId);
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
			}).then(stat => {
				this.logService.trace(`[text file model] doSave(${versionId}) - after write()`, this.resource.toString());

				// Update dirty state unless model has changed meanwhile
				if (versionId === this.versionId) {
					this.logService.trace(`[text file model] doSave(${versionId}) - setting dirty to false because versionId did not change`, this.resource.toString());
					this.setDirty(false);
				} else {
					this.logService.trace(`[text file model] doSave(${versionId}) - not setting dirty to false because versionId did change meanwhile`, this.resource.toString());
				}

				// Updated resolved stat with updated stat
				this.updateLastResolvedFileStat(stat);

				// Emit Events
				this._onDidChangeState.fire(StateChange.SAVED);
				this._onDidChangeDirty.fire();

				// Telemetry
				const settingsType = this.getTypeIfSettings();
				if (settingsType) {
					type SettingsWrittenClassification = {
						settingsType: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
					};
					this.telemetryService.publicLog2<{ settingsType: string }, SettingsWrittenClassification>('settingsWritten', { settingsType }); // Do not log write to user settings.json and .vscode folder as a filePUT event as it ruins our JSON usage data
				} else {
					type FilePutClassfication = {} & FileTelemetryDataFragment;
					this.telemetryService.publicLog2<TelemetryData, FilePutClassfication>('filePUT', this.getTelemetryData(options.reason));
				}
			}, error => {
				this.logService.error(`[text file model] doSave(${versionId}) - exit - resulted in a save error: ${error.toString()}`, this.resource.toString());

				// Flag as error state in the model
				this.inErrorMode = true;

				// Look out for a save conflict
				if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
					this.inConflictMode = true;
				}

				// Show to user
				this.onSaveError(error);

				// Emit as event
				this._onDidChangeState.fire(StateChange.SAVE_ERROR);
			}));
		}));
	}

	private getTypeIfSettings(): string {
		if (extname(this.resource) !== '.json') {
			return '';
		}

		// Check for global settings file
		if (isEqual(this.resource, this.environmentService.settingsResource)) {
			return 'global-settings';
		}

		// Check for keybindings file
		if (isEqual(this.resource, this.environmentService.keybindingsResource)) {
			return 'keybindings';
		}

		// Check for snippets
		if (isEqualOrParent(this.resource, joinPath(this.environmentService.userRoamingDataHome, 'snippets'))) {
			return 'snippets';
		}

		// Check for workspace settings file
		const folders = this.contextService.getWorkspace().folders;
		for (const folder of folders) {
			if (isEqualOrParent(this.resource, folder.toResource('.vscode'))) {
				const filename = basename(this.resource);
				if (TextFileEditorModel.WHITELIST_WORKSPACE_JSON.indexOf(filename) > -1) {
					return `.vscode/${filename}`;
				}
			}
		}

		return '';
	}

	private getTelemetryData(reason: number | undefined): TelemetryData {
		const ext = extname(this.resource);
		const fileName = basename(this.resource);
		const path = this.resource.scheme === Schemas.file ? this.resource.fsPath : this.resource.path;
		const telemetryData = {
			mimeType: guessMimeTypes(this.resource).join(', '),
			ext,
			path: hash(path),
			reason,
			whitelistedjson: undefined as string | undefined
		};

		if (ext === '.json' && TextFileEditorModel.WHITELIST_JSON.indexOf(fileName) > -1) {
			telemetryData['whitelistedjson'] = fileName;
		}

		return telemetryData;
	}

	private doTouch(versionId: number): Promise<void> {
		if (!this.isResolved()) {
			return Promise.resolve();
		}

		const lastResolvedFileStat = assertIsDefined(this.lastResolvedFileStat);
		return this.saveSequentializer.setPending(versionId, this.textFileService.write(lastResolvedFileStat.resource, this.createSnapshot(), {
			mtime: lastResolvedFileStat.mtime,
			encoding: this.getEncoding(),
			etag: lastResolvedFileStat.etag
		}).then(stat => {

			// Updated resolved stat with updated stat since touching it might have changed mtime
			this.updateLastResolvedFileStat(stat);

			// Emit File Saved Event
			this._onDidChangeState.fire(StateChange.SAVED);

		}, error => onUnexpectedError(error) /* just log any error but do not notify the user since the file was not dirty */));
	}

	private setDirty(dirty: boolean): () => void {
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

	private onSaveError(error: Error): void {

		// Prepare handler
		if (!TextFileEditorModel.saveErrorHandler) {
			TextFileEditorModel.setSaveErrorHandler(this.instantiationService.createInstance(DefaultSaveErrorHandler));
		}

		// Handle
		TextFileEditorModel.saveErrorHandler.onSaveError(error, this);
	}

	isDirty(): this is IResolvedTextFileEditorModel {
		return this.dirty;
	}

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
				return this.saveSequentializer.hasPendingSave();
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
				this.makeDirty();
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
		this._onDidChangeState.fire(StateChange.ENCODING);
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

interface IPendingSave {
	versionId: number;
	promise: Promise<void>;
}

interface ISaveOperation {
	promise: Promise<void>;
	promiseResolve: () => void;
	promiseReject: (error: Error) => void;
	run: () => Promise<void>;
}

export class SaveSequentializer {
	private _pendingSave?: IPendingSave;
	private _nextSave?: ISaveOperation;

	hasPendingSave(versionId?: number): boolean {
		if (!this._pendingSave) {
			return false;
		}

		if (typeof versionId === 'number') {
			return this._pendingSave.versionId === versionId;
		}

		return !!this._pendingSave;
	}

	get pendingSave(): Promise<void> | undefined {
		return this._pendingSave ? this._pendingSave.promise : undefined;
	}

	setPending(versionId: number, promise: Promise<void>): Promise<void> {
		this._pendingSave = { versionId, promise };

		promise.then(() => this.donePending(versionId), () => this.donePending(versionId));

		return promise;
	}

	private donePending(versionId: number): void {
		if (this._pendingSave && versionId === this._pendingSave.versionId) {

			// only set pending to done if the promise finished that is associated with that versionId
			this._pendingSave = undefined;

			// schedule the next save now that we are free if we have any
			this.triggerNextSave();
		}
	}

	private triggerNextSave(): void {
		if (this._nextSave) {
			const saveOperation = this._nextSave;
			this._nextSave = undefined;

			// Run next save and complete on the associated promise
			saveOperation.run().then(saveOperation.promiseResolve, saveOperation.promiseReject);
		}
	}

	setNext(run: () => Promise<void>): Promise<void> {

		// this is our first next save, so we create associated promise with it
		// so that we can return a promise that completes when the save operation
		// has completed.
		if (!this._nextSave) {
			let promiseResolve: () => void;
			let promiseReject: (error: Error) => void;
			const promise = new Promise<void>((resolve, reject) => {
				promiseResolve = resolve;
				promiseReject = reject;
			});

			this._nextSave = {
				run,
				promise,
				promiseResolve: promiseResolve!,
				promiseReject: promiseReject!
			};
		}

		// we have a previous next save, just overwrite it
		else {
			this._nextSave.run = run;
		}

		return this._nextSave.promise;
	}
}

class DefaultSaveErrorHandler implements ISaveErrorHandler {

	constructor(@INotificationService private readonly notificationService: INotificationService) { }

	onSaveError(error: Error, model: TextFileEditorModel): void {
		this.notificationService.error(nls.localize('genericSaveError', "Failed to save '{0}': {1}", basename(model.resource), toErrorMessage(error, false)));
	}
}
