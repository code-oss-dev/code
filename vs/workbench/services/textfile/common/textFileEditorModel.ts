/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import nls = require('vs/nls');
import Event, { Emitter } from 'vs/base/common/event';
import { TPromise, TValueCallback, ErrorCallback } from 'vs/base/common/winjs.base';
import { onUnexpectedError } from 'vs/base/common/errors';
import { guessMimeTypes } from 'vs/base/common/mime';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import URI from 'vs/base/common/uri';
import * as assert from 'vs/base/common/assert';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import paths = require('vs/base/common/paths');
import diagnostics = require('vs/base/common/diagnostics');
import types = require('vs/base/common/types');
import { IModelContentChangedEvent } from 'vs/editor/common/editorCommon';
import { IMode } from 'vs/editor/common/modes';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { ITextFileService, IAutoSaveConfiguration, ModelState, ITextFileEditorModel, IModelSaveOptions, ISaveErrorHandler, ISaveParticipant, StateChange, SaveReason, IRawTextContent } from 'vs/workbench/services/textfile/common/textfiles';
import { EncodingMode, EditorModel } from 'vs/workbench/common/editor';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { IBackupFileService, BACKUP_FILE_RESOLVE_OPTIONS } from 'vs/workbench/services/backup/common/backup';
import { IFileService, IFileStat, IFileOperationResult, FileOperationResult, IContent, CONTENT_CHANGE_EVENT_BUFFER_DELAY } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMessageService, Severity } from 'vs/platform/message/common/message';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService, IRawTextProvider } from 'vs/editor/common/services/modelService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { anonymize } from 'vs/platform/telemetry/common/telemetryUtils';
import { RunOnceScheduler } from 'vs/base/common/async';

/**
 * The text file editor model listens to changes to its underlying code editor model and saves these changes through the file service back to the disk.
 */
export class TextFileEditorModel extends BaseTextEditorModel implements ITextFileEditorModel {

	public static ID = 'workbench.editors.files.textFileEditorModel';

	public static DEFAULT_CONTENT_CHANGE_BUFFER_DELAY = CONTENT_CHANGE_EVENT_BUFFER_DELAY;

	private static saveErrorHandler: ISaveErrorHandler;
	private static saveParticipant: ISaveParticipant;

	private resource: URI;
	private contentEncoding: string; 			// encoding as reported from disk
	private preferredEncoding: string;			// encoding as chosen by the user
	private dirty: boolean;
	private versionId: number;
	private bufferSavedVersionId: number;
	private versionOnDiskStat: IFileStat;
	private toDispose: IDisposable[];
	private blockModelContentChange: boolean;
	private autoSaveAfterMillies: number;
	private autoSaveAfterMilliesEnabled: boolean;
	private autoSavePromise: TPromise<void>;
	private contentChangeEventScheduler: RunOnceScheduler;
	private saveSequentializer: SaveSequentializer;
	private disposed: boolean;
	private inConflictResolutionMode: boolean;
	private inErrorMode: boolean;
	private lastSaveAttemptTime: number;
	private createTextEditorModelPromise: TPromise<TextFileEditorModel>;
	private _onDidContentChange: Emitter<StateChange>;
	private _onDidStateChange: Emitter<StateChange>;

	constructor(
		resource: URI,
		preferredEncoding: string,
		@IMessageService private messageService: IMessageService,
		@IModeService modeService: IModeService,
		@IModelService modelService: IModelService,
		@IFileService private fileService: IFileService,
		@ILifecycleService private lifecycleService: ILifecycleService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@ITextFileService private textFileService: ITextFileService,
		@IBackupFileService private backupFileService: IBackupFileService
	) {
		super(modelService, modeService);

		assert.ok(resource.scheme === 'file', 'TextFileEditorModel can only handle file:// resources.');

		this.resource = resource;
		this.toDispose = [];
		this._onDidContentChange = new Emitter<StateChange>();
		this._onDidStateChange = new Emitter<StateChange>();
		this.toDispose.push(this._onDidContentChange);
		this.toDispose.push(this._onDidStateChange);
		this.preferredEncoding = preferredEncoding;
		this.dirty = false;
		this.versionId = 0;
		this.lastSaveAttemptTime = 0;
		this.saveSequentializer = new SaveSequentializer();

		this.contentChangeEventScheduler = new RunOnceScheduler(() => this._onDidContentChange.fire(StateChange.CONTENT_CHANGE), TextFileEditorModel.DEFAULT_CONTENT_CHANGE_BUFFER_DELAY);
		this.toDispose.push(this.contentChangeEventScheduler);

		this.updateAutoSaveConfiguration(textFileService.getAutoSaveConfiguration());

		this.registerListeners();
	}

	private registerListeners(): void {
		this.toDispose.push(this.textFileService.onAutoSaveConfigurationChange(config => this.updateAutoSaveConfiguration(config)));
		this.toDispose.push(this.textFileService.onFilesAssociationChange(e => this.onFilesAssociationChange()));
		this.toDispose.push(this.onDidStateChange(e => {
			if (e === StateChange.REVERTED) {

				// Cancel any content change event promises as they are no longer valid.
				this.contentChangeEventScheduler.cancel();

				// Refire state change reverted events as content change events
				this._onDidContentChange.fire(StateChange.REVERTED);
			}
		}));
	}

	private updateAutoSaveConfiguration(config: IAutoSaveConfiguration): void {
		if (typeof config.autoSaveDelay === 'number' && config.autoSaveDelay > 0) {
			this.autoSaveAfterMillies = config.autoSaveDelay;
			this.autoSaveAfterMilliesEnabled = true;
		} else {
			this.autoSaveAfterMillies = void 0;
			this.autoSaveAfterMilliesEnabled = false;
		}
	}

	private onFilesAssociationChange(): void {
		this.updateTextEditorModelMode();
	}

	private updateTextEditorModelMode(modeId?: string): void {
		if (!this.textEditorModel) {
			return;
		}

		const firstLineText = this.getFirstLineText(this.textEditorModel.getValue());
		const mode = this.getOrCreateMode(this.modeService, modeId, firstLineText);

		this.modelService.setMode(this.textEditorModel, mode);
	}

	public get onDidContentChange(): Event<StateChange> {
		return this._onDidContentChange.event;
	}

	public get onDidStateChange(): Event<StateChange> {
		return this._onDidStateChange.event;
	}

	/**
	 * The current version id of the model.
	 */
	public getVersionId(): number {
		return this.versionId;
	}

	/**
	 * Set a save error handler to install code that executes when save errors occur.
	 */
	public static setSaveErrorHandler(handler: ISaveErrorHandler): void {
		TextFileEditorModel.saveErrorHandler = handler;
	}

	/**
	 * Set a save participant handler to react on models getting saved.
	 */
	public static setSaveParticipant(handler: ISaveParticipant): void {
		TextFileEditorModel.saveParticipant = handler;
	}

	/**
	 * When set, will disable any saving (including auto save) until the model is loaded again. This allows to resolve save conflicts
	 * without running into subsequent save errors when editing the model.
	 */
	public setConflictResolutionMode(): void {
		diag('setConflictResolutionMode() - enabled conflict resolution mode', this.resource, new Date());

		this.inConflictResolutionMode = true;
	}

	/**
	 * Answers if this model is currently in conflic resolution mode or not.
	 */
	public isInConflictResolutionMode(): boolean {
		return this.inConflictResolutionMode;
	}

	/**
	 * Discards any local changes and replaces the model with the contents of the version on disk.
	 *
	 * @param if the parameter soft is true, will not attempt to load the contents from disk.
	 */
	public revert(soft?: boolean): TPromise<void> {
		if (!this.isResolved()) {
			return TPromise.as<void>(null);
		}

		// Cancel any running auto-save
		this.cancelAutoSavePromise();

		// Unset flags
		const undo = this.setDirty(false);

		let loadPromise: TPromise<EditorModel>;
		if (soft) {
			loadPromise = TPromise.as(this);
		} else {
			loadPromise = this.load(true /* force */);
		}

		return loadPromise.then(() => {

			// Emit file change event
			this._onDidStateChange.fire(StateChange.REVERTED);
		}, error => {

			// FileNotFound means the file got deleted meanwhile, so emit revert event because thats ok
			if ((<IFileOperationResult>error).fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				this._onDidStateChange.fire(StateChange.REVERTED);
			}

			// Set flags back to previous values, we are still dirty if revert failed
			else {
				undo();
			}

			return TPromise.wrapError(error);
		});
	}

	public load(force?: boolean /* bypass any caches and really go to disk */): TPromise<EditorModel> {
		diag('load() - enter', this.resource, new Date());

		// It is very important to not reload the model when the model is dirty. We only want to reload the model from the disk
		// if no save is pending to avoid data loss. This might cause a save conflict in case the file has been modified on the disk
		// meanwhile, but this is a very low risk.
		if (this.dirty) {
			diag('load() - exit - without loading because model is dirty', this.resource, new Date());

			return TPromise.as(this);
		}

		// Only for new models we support to load from backup
		if (!this.textEditorModel && !this.createTextEditorModelPromise) {
			return this.loadWithBackup(force);
		}

		// Otherwise load from file resource
		return this.loadFromFile(force);
	}

	private loadWithBackup(force: boolean): TPromise<EditorModel> {
		return this.backupFileService.loadBackupResource(this.resource).then(backup => {

			// Make sure meanwhile someone else did not suceed or start loading
			if (this.createTextEditorModelPromise || this.textEditorModel) {
				return this.createTextEditorModelPromise || TPromise.as(this);
			}

			// If we have a backup, continue loading with it
			if (!!backup) {
				const content: IContent = {
					resource: this.resource,
					name: paths.basename(this.resource.fsPath),
					mtime: Date.now(),
					etag: void 0,
					value: '', /* will be filled later from backup */
					encoding: this.fileService.getEncoding(this.resource)
				};

				return this.loadWithContent(content, backup);
			}

			// Otherwise load from file
			return this.loadFromFile(force);
		});
	}

	private loadFromFile(force: boolean): TPromise<EditorModel> {

		// Decide on etag
		let etag: string;
		if (force) {
			etag = void 0; // bypass cache if force loading is true
		} else if (this.versionOnDiskStat) {
			etag = this.versionOnDiskStat.etag; // otherwise respect etag to support caching
		}

		// Resolve Content
		return this.textFileService
			.resolveTextContent(this.resource, { acceptTextOnly: true, etag, encoding: this.preferredEncoding })
			.then(content => this.loadWithContent(content), (error: IFileOperationResult) => this.handleLoadError(error));
	}

	private handleLoadError(error: IFileOperationResult): TPromise<EditorModel> {
		const result = error.fileOperationResult;

		// NotModified status is expected and can be handled gracefully
		if (result === FileOperationResult.FILE_NOT_MODIFIED_SINCE) {
			this.setDirty(false); // Ensure we are not tracking a stale state

			return TPromise.as<EditorModel>(this);
		}

		// Otherwise bubble up the error
		return TPromise.wrapError(error);
	}

	private loadWithContent(content: IRawTextContent | IContent, backup?: URI): TPromise<EditorModel> {
		diag('load() - resolved content', this.resource, new Date());

		// Telemetry
		this.telemetryService.publicLog('fileGet', { mimeType: guessMimeTypes(this.resource.fsPath).join(', '), ext: paths.extname(this.resource.fsPath), path: anonymize(this.resource.fsPath) });

		// Update our resolved disk stat model
		const resolvedStat: IFileStat = {
			resource: this.resource,
			name: content.name,
			mtime: content.mtime,
			etag: content.etag,
			isDirectory: false,
			hasChildren: false,
			children: void 0,
		};
		this.updateVersionOnDiskStat(resolvedStat);

		// Keep the original encoding to not loose it when saving
		const oldEncoding = this.contentEncoding;
		this.contentEncoding = content.encoding;

		// Handle events if encoding changed
		if (this.preferredEncoding) {
			this.updatePreferredEncoding(this.contentEncoding); // make sure to reflect the real encoding of the file (never out of sync)
		} else if (oldEncoding !== this.contentEncoding) {
			this._onDidStateChange.fire(StateChange.ENCODING);
		}

		// Update Existing Model
		if (this.textEditorModel) {
			return this.doUpdateTextModel(content.value);
		}

		// Join an existing request to create the editor model to avoid race conditions
		else if (this.createTextEditorModelPromise) {
			diag('load() - join existing text editor model promise', this.resource, new Date());

			return this.createTextEditorModelPromise;
		}

		// Create New Model
		return this.doCreateTextModel(content.resource, content.value, backup);
	}

	private doUpdateTextModel(value: string | IRawTextProvider): TPromise<EditorModel> {
		diag('load() - updated text editor model', this.resource, new Date());

		this.setDirty(false); // Ensure we are not tracking a stale state

		this.blockModelContentChange = true;
		try {
			this.updateTextEditorModel(value);
		} finally {
			this.blockModelContentChange = false;
		}

		return TPromise.as<EditorModel>(this);
	}

	private doCreateTextModel(resource: URI, value: string | IRawTextProvider, backup: URI): TPromise<EditorModel> {
		diag('load() - created text editor model', this.resource, new Date());

		this.createTextEditorModelPromise = this.doLoadBackup(backup).then(backupContent => {
			const hasBackupContent = (typeof backupContent === 'string');

			return this.createTextEditorModel(hasBackupContent ? backupContent : value, resource).then(() => {
				this.createTextEditorModelPromise = null;

				// We restored a backup so we have to set the model as being dirty
				// We also want to trigger auto save if it is enabled to simulate the exact same behaviour
				// you would get if manually making the model dirty (fixes https://github.com/Microsoft/vscode/issues/16977)
				if (hasBackupContent) {
					this.makeDirty();
					if (this.autoSaveAfterMilliesEnabled) {
						this.doAutoSave(this.versionId);
					}
				}

				// Ensure we are not tracking a stale state
				else {
					this.setDirty(false);
				}

				this.toDispose.push(this.textEditorModel.onDidChangeRawContent((e: IModelContentChangedEvent) => this.onModelContentChanged(e)));

				return this;
			}, error => {
				this.createTextEditorModelPromise = null;

				return TPromise.wrapError(error);
			});
		});

		return this.createTextEditorModelPromise;
	}

	private doLoadBackup(backup: URI): TPromise<string> {
		if (!backup) {
			return TPromise.as(null);
		}

		return this.textFileService.resolveTextContent(backup, BACKUP_FILE_RESOLVE_OPTIONS).then(backup => {
			return this.backupFileService.parseBackupContent(backup.value);
		}, error => null /* ignore errors */);
	}

	protected getOrCreateMode(modeService: IModeService, preferredModeIds: string, firstLineText?: string): TPromise<IMode> {
		return modeService.getOrCreateModeByFilenameOrFirstLine(this.resource.fsPath, firstLineText);
	}

	private onModelContentChanged(e: IModelContentChangedEvent): void {
		diag(`onModelContentChanged(${e.changeType}) - enter`, this.resource, new Date());

		// In any case increment the version id because it tracks the textual content state of the model at all times
		this.versionId++;
		diag(`onModelContentChanged() - new versionId ${this.versionId}`, this.resource, new Date());

		// Ignore if blocking model changes
		if (this.blockModelContentChange) {
			return;
		}

		// The contents changed as a matter of Undo and the version reached matches the saved one
		// In this case we clear the dirty flag and emit a SAVED event to indicate this state.
		// Note: we currently only do this check when auto-save is turned off because there you see
		// a dirty indicator that you want to get rid of when undoing to the saved version.
		if (!this.autoSaveAfterMilliesEnabled && this.textEditorModel.getAlternativeVersionId() === this.bufferSavedVersionId) {
			diag('onModelContentChanged() - model content changed back to last saved version', this.resource, new Date());

			// Clear flags
			const wasDirty = this.dirty;
			this.setDirty(false);

			// Emit event
			if (wasDirty) {
				this._onDidStateChange.fire(StateChange.REVERTED);
			}

			return;
		}

		diag('onModelContentChanged() - model content changed and marked as dirty', this.resource, new Date());

		// Mark as dirty
		this.makeDirty();

		// Start auto save process unless we are in conflict resolution mode and unless it is disabled
		if (this.autoSaveAfterMilliesEnabled) {
			if (!this.inConflictResolutionMode) {
				this.doAutoSave(this.versionId);
			} else {
				diag('makeDirty() - prevented save because we are in conflict resolution mode', this.resource, new Date());
			}
		}

		// Handle content change events
		this.contentChangeEventScheduler.schedule();
	}

	private makeDirty(): void {

		// Track dirty state and version id
		const wasDirty = this.dirty;
		this.setDirty(true);

		// Emit as Event if we turned dirty
		if (!wasDirty) {
			this._onDidStateChange.fire(StateChange.DIRTY);
		}
	}

	private doAutoSave(versionId: number): TPromise<void> {
		diag(`doAutoSave() - enter for versionId ${versionId}`, this.resource, new Date());

		// Cancel any currently running auto saves to make this the one that succeeds
		this.cancelAutoSavePromise();

		// Create new save promise and keep it
		this.autoSavePromise = TPromise.timeout(this.autoSaveAfterMillies).then(() => {

			// Only trigger save if the version id has not changed meanwhile
			if (versionId === this.versionId) {
				this.doSave(versionId, SaveReason.AUTO).done(null, onUnexpectedError); // Very important here to not return the promise because if the timeout promise is canceled it will bubble up the error otherwise - do not change
			}
		});

		return this.autoSavePromise;
	}

	private cancelAutoSavePromise(): void {
		if (this.autoSavePromise) {
			this.autoSavePromise.cancel();
			this.autoSavePromise = void 0;
		}
	}

	/**
	 * Saves the current versionId of this editor model if it is dirty.
	 */
	public save(options: IModelSaveOptions = Object.create(null)): TPromise<void> {
		if (!this.isResolved()) {
			return TPromise.as<void>(null);
		}

		diag('save() - enter', this.resource, new Date());

		// Cancel any currently running auto saves to make this the one that succeeds
		this.cancelAutoSavePromise();

		return this.doSave(this.versionId, types.isUndefinedOrNull(options.reason) ? SaveReason.EXPLICIT : options.reason, options.overwriteReadonly, options.overwriteEncoding);
	}

	private doSave(versionId: number, reason: SaveReason, overwriteReadonly?: boolean, overwriteEncoding?: boolean): TPromise<void> {
		diag(`doSave(${versionId}) - enter with versionId ' + versionId`, this.resource, new Date());

		// Lookup any running pending save for this versionId and return it if found
		//
		// Scenario: user invoked the save action multiple times quickly for the same contents
		//           while the save was not yet finished to disk
		//
		if (this.saveSequentializer.hasPendingSave(versionId)) {
			diag(`doSave(${versionId}) - exit - found a pending save for versionId ${versionId}`, this.resource, new Date());

			return this.saveSequentializer.pendingSave;
		}

		// Return early if not dirty or version changed meanwhile
		//
		// Scenario A: user invoked save action even though the model is not dirty
		// Scenario B: auto save was triggered for a certain change by the user but meanwhile the user changed
		//             the contents and the version for which auto save was started is no longer the latest.
		//             Thus we avoid spawning multiple auto saves and only take the latest.
		//
		if (!this.dirty || versionId !== this.versionId) {
			diag(`doSave(${versionId}) - exit - because not dirty and/or versionId is different (this.isDirty: ${this.dirty}, this.versionId: ${this.versionId})`, this.resource, new Date());

			return TPromise.as<void>(null);
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
			diag(`doSave(${versionId}) - exit - because busy saving`, this.resource, new Date());

			// Register this as the next upcoming save and return
			return this.saveSequentializer.setNext(() => this.doSave(this.versionId /* make sure to use latest version id here */, reason, overwriteReadonly, overwriteEncoding));
		}

		// Push all edit operations to the undo stack so that the user has a chance to
		// Ctrl+Z back to the saved version. We only do this when auto-save is turned off
		if (!this.autoSaveAfterMilliesEnabled) {
			this.textEditorModel.pushStackElement();
		}

		// A save participant can still change the model now and since we are so close to saving
		// we do not want to trigger another auto save or similar, so we block this
		// In addition we update our version right after in case it changed because of a model change
		// We DO NOT run any save participant if we are in the shutdown phase and files are being
		// saved as a result of that.
		let saveParticipantPromise = TPromise.as(versionId);
		if (TextFileEditorModel.saveParticipant && !this.lifecycleService.willShutdown) {
			const onCompleteOrError = () => {
				this.blockModelContentChange = false;

				return this.versionId;
			};

			saveParticipantPromise = TPromise.as(undefined).then(() => {
				this.blockModelContentChange = true;

				return TextFileEditorModel.saveParticipant.participate(this, { reason });
			}).then(onCompleteOrError, onCompleteOrError);
		}

		// mark the save participant as current pending save operation
		return this.saveSequentializer.setPending(versionId, saveParticipantPromise.then(newVersionId => {

			// update versionId with its new value (if pre-save changes happened)
			versionId = newVersionId;

			// Clear error flag since we are trying to save again
			this.inErrorMode = false;

			// Remember when this model was saved last
			this.lastSaveAttemptTime = Date.now();

			// Save to Disk
			// mark the save operation as currently pending with the versionId (it might have changed from a save participant triggering)
			diag(`doSave(${versionId}) - before updateContent()`, this.resource, new Date());
			return this.saveSequentializer.setPending(newVersionId, this.fileService.updateContent(this.versionOnDiskStat.resource, this.getValue(), {
				overwriteReadonly,
				overwriteEncoding,
				mtime: this.versionOnDiskStat.mtime,
				encoding: this.getEncoding(),
				etag: this.versionOnDiskStat.etag
			}).then((stat: IFileStat) => {
				diag(`doSave(${versionId}) - after updateContent()`, this.resource, new Date());

				// Telemetry
				this.telemetryService.publicLog('filePUT', { mimeType: guessMimeTypes(this.resource.fsPath).join(', '), ext: paths.extname(this.versionOnDiskStat.resource.fsPath) });

				// Update dirty state unless model has changed meanwhile
				if (versionId === this.versionId) {
					diag(`doSave(${versionId}) - setting dirty to false because versionId did not change`, this.resource, new Date());
					this.setDirty(false);
				} else {
					diag(`doSave(${versionId}) - not setting dirty to false because versionId did change meanwhile`, this.resource, new Date());
				}

				// Updated resolved stat with updated stat, and keep old for event
				this.updateVersionOnDiskStat(stat);

				// Cancel any content change event promises as they are no longer valid
				this.contentChangeEventScheduler.cancel();

				// Emit File Saved Event
				this._onDidStateChange.fire(StateChange.SAVED);
			}, error => {
				diag(`doSave(${versionId}) - exit - resulted in a save error: ${error.toString()}`, this.resource, new Date());

				// Flag as error state
				this.inErrorMode = true;

				// Show to user
				this.onSaveError(error);

				// Emit as event
				this._onDidStateChange.fire(StateChange.SAVE_ERROR);
			}));
		}));
	}

	private setDirty(dirty: boolean): () => void {
		const wasDirty = this.dirty;
		const wasInConflictResolutionMode = this.inConflictResolutionMode;
		const wasInErrorMode = this.inErrorMode;
		const oldBufferSavedVersionId = this.bufferSavedVersionId;

		if (!dirty) {
			this.dirty = false;
			this.inConflictResolutionMode = false;
			this.inErrorMode = false;

			// we remember the models alternate version id to remember when the version
			// of the model matches with the saved version on disk. we need to keep this
			// in order to find out if the model changed back to a saved version (e.g.
			// when undoing long enough to reach to a version that is saved and then to
			// clear the dirty flag)
			if (this.textEditorModel) {
				this.bufferSavedVersionId = this.textEditorModel.getAlternativeVersionId();
			}
		} else {
			this.dirty = true;
		}

		// Return function to revert this call
		return () => {
			this.dirty = wasDirty;
			this.inConflictResolutionMode = wasInConflictResolutionMode;
			this.inErrorMode = wasInErrorMode;
			this.bufferSavedVersionId = oldBufferSavedVersionId;
		};
	}

	private updateVersionOnDiskStat(newVersionOnDiskStat: IFileStat): void {

		// First resolve - just take
		if (!this.versionOnDiskStat) {
			this.versionOnDiskStat = newVersionOnDiskStat;
		}

		// Subsequent resolve - make sure that we only assign it if the mtime is equal or has advanced.
		// This is essential a If-Modified-Since check on the client ot prevent race conditions from loading
		// and saving. If a save comes in late after a revert was called, the mtime could be out of sync.
		else if (this.versionOnDiskStat.mtime <= newVersionOnDiskStat.mtime) {
			this.versionOnDiskStat = newVersionOnDiskStat;
		}
	}

	private onSaveError(error: any): void {

		// Prepare handler
		if (!TextFileEditorModel.saveErrorHandler) {
			TextFileEditorModel.setSaveErrorHandler(this.instantiationService.createInstance(DefaultSaveErrorHandler));
		}

		// Handle
		TextFileEditorModel.saveErrorHandler.onSaveError(error, this);
	}

	/**
	 * Returns true if the content of this model has changes that are not yet saved back to the disk.
	 */
	public isDirty(): boolean {
		return this.dirty;
	}

	/**
	 * Returns the time in millies when this working copy was attempted to be saved.
	 */
	public getLastSaveAttemptTime(): number {
		return this.lastSaveAttemptTime;
	}

	/**
	 * Returns the time in millies when this working copy was last modified by the user or some other program.
	 */
	public getLastModifiedTime(): number {
		return this.versionOnDiskStat ? this.versionOnDiskStat.mtime : -1;
	}

	/**
	 * Returns the state this text text file editor model is in with regards to changes and saving.
	 */
	public getState(): ModelState {
		if (this.inConflictResolutionMode) {
			return ModelState.CONFLICT;
		}

		if (this.inErrorMode) {
			return ModelState.ERROR;
		}

		if (!this.dirty) {
			return ModelState.SAVED;
		}

		if (this.saveSequentializer.hasPendingSave()) {
			return ModelState.PENDING_SAVE;
		}

		if (this.dirty) {
			return ModelState.DIRTY;
		}
	}

	public getEncoding(): string {
		return this.preferredEncoding || this.contentEncoding;
	}

	public setEncoding(encoding: string, mode: EncodingMode): void {
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

			if (!this.inConflictResolutionMode) {
				this.save({ overwriteEncoding: true }).done(null, onUnexpectedError);
			}
		}

		// Decode: Load with encoding
		else {
			if (this.isDirty()) {
				this.messageService.show(Severity.Info, nls.localize('saveFileFirst', "The file is dirty. Please save it first before reopening it with another encoding."));

				return;
			}

			this.updatePreferredEncoding(encoding);

			// Load
			this.load(true /* force because encoding has changed */).done(null, onUnexpectedError);
		}
	}

	public updatePreferredEncoding(encoding: string): void {
		if (!this.isNewEncoding(encoding)) {
			return;
		}

		this.preferredEncoding = encoding;

		// Emit
		this._onDidStateChange.fire(StateChange.ENCODING);
	}

	private isNewEncoding(encoding: string): boolean {
		if (this.preferredEncoding === encoding) {
			return false; // return early if the encoding is already the same
		}

		if (!this.preferredEncoding && this.contentEncoding === encoding) {
			return false; // also return if we don't have a preferred encoding but the content encoding is already the same
		}

		return true;
	}

	public isResolved(): boolean {
		return !types.isUndefinedOrNull(this.versionOnDiskStat);
	}

	/**
	 * Returns true if the dispose() method of this model has been called.
	 */
	public isDisposed(): boolean {
		return this.disposed;
	}

	/**
	 * Returns the full resource URI of the file this text file editor model is about.
	 */
	public getResource(): URI {
		return this.resource;
	}

	public dispose(): void {
		this.disposed = true;
		this.inConflictResolutionMode = false;
		this.inErrorMode = false;

		this.toDispose = dispose(this.toDispose);
		this.createTextEditorModelPromise = null;

		this.cancelAutoSavePromise();
		this.contentChangeEventScheduler.cancel();

		super.dispose();
	}
}

interface IPendingSave {
	versionId: number;
	promise: TPromise<void>;
}

interface ISaveOperation {
	promise: TPromise<void>;
	promiseValue: TValueCallback<void>;
	promiseError: ErrorCallback;
	run: () => TPromise<void>;
}

export class SaveSequentializer {
	private _pendingSave: IPendingSave;
	private _nextSave: ISaveOperation;

	public hasPendingSave(versionId?: number): boolean {
		if (!this._pendingSave) {
			return false;
		}

		if (typeof versionId === 'number') {
			return this._pendingSave.versionId === versionId;
		}

		return !!this._pendingSave;
	}

	public get pendingSave(): TPromise<void> {
		return this._pendingSave ? this._pendingSave.promise : void 0;
	}

	public setPending(versionId: number, promise: TPromise<void>): TPromise<void> {
		this._pendingSave = { versionId, promise };

		promise.done(() => this.donePending(versionId), () => this.donePending(versionId));

		return promise;
	}

	private donePending(versionId: number): void {
		if (this._pendingSave && versionId === this._pendingSave.versionId) {

			// only set pending to done if the promise finished that is associated with that versionId
			this._pendingSave = void 0;

			// schedule the next save now that we are free if we have any
			this.triggerNextSave();
		}
	}

	private triggerNextSave(): void {
		if (this._nextSave) {
			const saveOperation = this._nextSave;
			this._nextSave = void 0;

			// Run next save and complete on the associated promise
			saveOperation.run().done(saveOperation.promiseValue, saveOperation.promiseError);
		}
	}

	public setNext(run: () => TPromise<void>): TPromise<void> {

		// this is our first next save, so we create associated promise with it
		// so that we can return a promise that completes when the save operation
		// has completed.
		if (!this._nextSave) {
			let promiseValue: TValueCallback<void>;
			let promiseError: ErrorCallback;
			const promise = new TPromise<void>((c, e) => {
				promiseValue = c;
				promiseError = e;
			});

			this._nextSave = {
				run,
				promise,
				promiseValue,
				promiseError
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

	constructor( @IMessageService private messageService: IMessageService) { }

	public onSaveError(error: any, model: TextFileEditorModel): void {
		this.messageService.show(Severity.Error, nls.localize('genericSaveError', "Failed to save '{0}': {1}", paths.basename(model.getResource().fsPath), toErrorMessage(error, false)));
	}
}

// Diagnostics support
let diag: (...args: any[]) => void;
if (!diag) {
	diag = diagnostics.register('TextFileEditorModelDiagnostics', function (...args: any[]) {
		console.log(args[1] + ' - ' + args[0] + ' (time: ' + args[2].getTime() + ' [' + args[2].toUTCString() + '])');
	});
}
