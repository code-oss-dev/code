/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import * as paths from 'vs/base/common/paths';
import * as errors from 'vs/base/common/errors';
import * as objects from 'vs/base/common/objects';
import { Event, Emitter } from 'vs/base/common/event';
import * as platform from 'vs/base/common/platform';
import { IWindowsService } from 'vs/platform/windows/common/windows';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { IResult, ITextFileOperationResult, ITextFileService, IRawTextContent, IAutoSaveConfiguration, AutoSaveMode, SaveReason, ITextFileEditorModelManager, ITextFileEditorModel, ModelState, ISaveOptions, AutoSaveContext } from 'vs/workbench/services/textfile/common/textfiles';
import { ConfirmResult, IRevertOptions } from 'vs/workbench/common/editor';
import { ILifecycleService, ShutdownReason } from 'vs/platform/lifecycle/common/lifecycle';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IFileService, IResolveContentOptions, IFilesConfiguration, FileOperationError, FileOperationResult, AutoSaveConfiguration, HotExitConfiguration } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IUntitledEditorService } from 'vs/workbench/services/untitled/common/untitledEditorService';
import { UntitledEditorModel } from 'vs/workbench/common/editor/untitledEditorModel';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ResourceMap } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { createTextBufferFactoryFromSnapshot } from 'vs/editor/common/model/textModel';
import { IModelService } from 'vs/editor/common/services/modelService';
import { INotificationService } from 'vs/platform/notification/common/notification';

export interface IBackupResult {
	didBackup: boolean;
}

/**
 * The workbench file service implementation implements the raw file service spec and adds additional methods on top.
 *
 * It also adds diagnostics and logging around file system operations.
 */
export abstract class TextFileService implements ITextFileService {

	public _serviceBrand: any;

	private toUnbind: IDisposable[];
	private _models: TextFileEditorModelManager;

	private readonly _onFilesAssociationChange: Emitter<void>;
	private currentFilesAssociationConfig: { [key: string]: string; };

	private readonly _onAutoSaveConfigurationChange: Emitter<IAutoSaveConfiguration>;
	private configuredAutoSaveDelay: number;
	private configuredAutoSaveOnFocusChange: boolean;
	private configuredAutoSaveOnWindowChange: boolean;

	private autoSaveContext: IContextKey<string>;

	private configuredHotExit: string;

	constructor(
		private lifecycleService: ILifecycleService,
		private contextService: IWorkspaceContextService,
		private configurationService: IConfigurationService,
		protected fileService: IFileService,
		private untitledEditorService: IUntitledEditorService,
		private instantiationService: IInstantiationService,
		private notificationService: INotificationService,
		protected environmentService: IEnvironmentService,
		private backupFileService: IBackupFileService,
		private windowsService: IWindowsService,
		private historyService: IHistoryService,
		contextKeyService: IContextKeyService,
		private modelService: IModelService
	) {
		this.toUnbind = [];

		this._onAutoSaveConfigurationChange = new Emitter<IAutoSaveConfiguration>();
		this.toUnbind.push(this._onAutoSaveConfigurationChange);

		this._onFilesAssociationChange = new Emitter<void>();
		this.toUnbind.push(this._onFilesAssociationChange);

		this._models = this.instantiationService.createInstance(TextFileEditorModelManager);
		this.autoSaveContext = AutoSaveContext.bindTo(contextKeyService);

		const configuration = this.configurationService.getValue<IFilesConfiguration>();
		this.currentFilesAssociationConfig = configuration && configuration.files && configuration.files.associations;

		this.onFilesConfigurationChange(configuration);

		this.registerListeners();
	}

	public get models(): ITextFileEditorModelManager {
		return this._models;
	}

	abstract resolveTextContent(resource: URI, options?: IResolveContentOptions): TPromise<IRawTextContent>;

	abstract promptForPath(defaultPath: string): TPromise<string>;

	abstract confirmSave(resources?: URI[]): TPromise<ConfirmResult>;

	public get onAutoSaveConfigurationChange(): Event<IAutoSaveConfiguration> {
		return this._onAutoSaveConfigurationChange.event;
	}

	public get onFilesAssociationChange(): Event<void> {
		return this._onFilesAssociationChange.event;
	}

	private registerListeners(): void {

		// Lifecycle
		this.lifecycleService.onWillShutdown(event => event.veto(this.beforeShutdown(event.reason)));
		this.lifecycleService.onShutdown(this.dispose, this);

		// Files configuration changes
		this.toUnbind.push(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('files')) {
				this.onFilesConfigurationChange(this.configurationService.getValue<IFilesConfiguration>());
			}
		}));
	}

	private beforeShutdown(reason: ShutdownReason): boolean | TPromise<boolean> {

		// Dirty files need treatment on shutdown
		const dirty = this.getDirty();
		if (dirty.length) {

			// If auto save is enabled, save all files and then check again for dirty files
			// We DO NOT run any save participant if we are in the shutdown phase for performance reasons
			let handleAutoSave: TPromise<URI[] /* remaining dirty resources */>;
			if (this.getAutoSaveMode() !== AutoSaveMode.OFF) {
				handleAutoSave = this.saveAll(false /* files only */, { skipSaveParticipants: true }).then(() => this.getDirty());
			} else {
				handleAutoSave = TPromise.as(dirty);
			}

			return handleAutoSave.then(dirty => {

				// If we still have dirty files, we either have untitled ones or files that cannot be saved
				// or auto save was not enabled and as such we did not save any dirty files to disk automatically
				if (dirty.length) {

					// If hot exit is enabled, backup dirty files and allow to exit without confirmation
					if (this.isHotExitEnabled) {
						return this.backupBeforeShutdown(dirty, this.models, reason).then(result => {
							if (result.didBackup) {
								return this.noVeto({ cleanUpBackups: false }); // no veto and no backup cleanup (since backup was successful)
							}

							// since a backup did not happen, we have to confirm for the dirty files now
							return this.confirmBeforeShutdown();
						}, errors => {
							const firstError = errors[0];
							this.notificationService.error(nls.localize('files.backup.failSave', "Files that are dirty could not be written to the backup location (Error: {0}). Try saving your files first and then exit.", firstError.message));

							return true; // veto, the backups failed
						});
					}

					// Otherwise just confirm from the user what to do with the dirty files
					return this.confirmBeforeShutdown();
				}

				return void 0;
			});
		}

		// No dirty files: no veto
		return this.noVeto({ cleanUpBackups: true });
	}

	private backupBeforeShutdown(dirtyToBackup: URI[], textFileEditorModelManager: ITextFileEditorModelManager, reason: ShutdownReason): TPromise<IBackupResult> {
		return this.windowsService.getWindowCount().then(windowCount => {

			// When quit is requested skip the confirm callback and attempt to backup all workspaces.
			// When quit is not requested the confirm callback should be shown when the window being
			// closed is the only VS Code window open, except for on Mac where hot exit is only
			// ever activated when quit is requested.

			let doBackup: boolean;
			switch (reason) {
				case ShutdownReason.CLOSE:
					if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.configuredHotExit === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
						doBackup = true; // backup if a folder is open and onExitAndWindowClose is configured
					} else if (windowCount > 1 || platform.isMacintosh) {
						doBackup = false; // do not backup if a window is closed that does not cause quitting of the application
					} else {
						doBackup = true; // backup if last window is closed on win/linux where the application quits right after
					}
					break;

				case ShutdownReason.QUIT:
					doBackup = true; // backup because next start we restore all backups
					break;

				case ShutdownReason.RELOAD:
					doBackup = true; // backup because after window reload, backups restore
					break;

				case ShutdownReason.LOAD:
					if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.configuredHotExit === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
						doBackup = true; // backup if a folder is open and onExitAndWindowClose is configured
					} else {
						doBackup = false; // do not backup because we are switching contexts
					}
					break;
			}

			if (!doBackup) {
				return TPromise.as({ didBackup: false });
			}

			// Backup
			return this.backupAll(dirtyToBackup, textFileEditorModelManager).then(() => { return { didBackup: true }; });
		});
	}

	private backupAll(dirtyToBackup: URI[], textFileEditorModelManager: ITextFileEditorModelManager): TPromise<void> {

		// split up between files and untitled
		const filesToBackup: ITextFileEditorModel[] = [];
		const untitledToBackup: URI[] = [];
		dirtyToBackup.forEach(s => {
			if (this.fileService.canHandleResource(s)) {
				filesToBackup.push(textFileEditorModelManager.get(s));
			} else if (s.scheme === Schemas.untitled) {
				untitledToBackup.push(s);
			}
		});

		return this.doBackupAll(filesToBackup, untitledToBackup);
	}

	private doBackupAll(dirtyFileModels: ITextFileEditorModel[], untitledResources: URI[]): TPromise<void> {

		// Handle file resources first
		return TPromise.join(dirtyFileModels.map(model => this.backupFileService.backupResource(model.getResource(), model.createSnapshot(), model.getVersionId()))).then(results => {

			// Handle untitled resources
			const untitledModelPromises = untitledResources
				.filter(untitled => this.untitledEditorService.exists(untitled))
				.map(untitled => this.untitledEditorService.loadOrCreate({ resource: untitled }));

			return TPromise.join(untitledModelPromises).then(untitledModels => {
				const untitledBackupPromises = untitledModels.map(model => {
					return this.backupFileService.backupResource(model.getResource(), model.createSnapshot(), model.getVersionId());
				});

				return TPromise.join(untitledBackupPromises).then(() => void 0);
			});
		});
	}

	private confirmBeforeShutdown(): boolean | TPromise<boolean> {
		return this.confirmSave().then(confirm => {

			// Save
			if (confirm === ConfirmResult.SAVE) {
				return this.saveAll(true /* includeUntitled */, { skipSaveParticipants: true }).then(result => {
					if (result.results.some(r => !r.success)) {
						return true; // veto if some saves failed
					}

					return this.noVeto({ cleanUpBackups: true });
				});
			}

			// Don't Save
			else if (confirm === ConfirmResult.DONT_SAVE) {

				// Make sure to revert untitled so that they do not restore
				// see https://github.com/Microsoft/vscode/issues/29572
				this.untitledEditorService.revertAll();

				return this.noVeto({ cleanUpBackups: true });
			}

			// Cancel
			else if (confirm === ConfirmResult.CANCEL) {
				return true; // veto
			}

			return void 0;
		});
	}

	private noVeto(options: { cleanUpBackups: boolean }): boolean | TPromise<boolean> {
		if (!options.cleanUpBackups) {
			return false;
		}

		return this.cleanupBackupsBeforeShutdown().then(() => false, () => false);
	}

	protected cleanupBackupsBeforeShutdown(): TPromise<void> {
		if (this.environmentService.isExtensionDevelopment) {
			return TPromise.as(void 0);
		}

		return this.backupFileService.discardAllWorkspaceBackups();
	}

	protected onFilesConfigurationChange(configuration: IFilesConfiguration): void {
		const wasAutoSaveEnabled = (this.getAutoSaveMode() !== AutoSaveMode.OFF);

		const autoSaveMode = (configuration && configuration.files && configuration.files.autoSave) || AutoSaveConfiguration.OFF;
		this.autoSaveContext.set(autoSaveMode);
		switch (autoSaveMode) {
			case AutoSaveConfiguration.AFTER_DELAY:
				this.configuredAutoSaveDelay = configuration && configuration.files && configuration.files.autoSaveDelay;
				this.configuredAutoSaveOnFocusChange = false;
				this.configuredAutoSaveOnWindowChange = false;
				break;

			case AutoSaveConfiguration.ON_FOCUS_CHANGE:
				this.configuredAutoSaveDelay = void 0;
				this.configuredAutoSaveOnFocusChange = true;
				this.configuredAutoSaveOnWindowChange = false;
				break;

			case AutoSaveConfiguration.ON_WINDOW_CHANGE:
				this.configuredAutoSaveDelay = void 0;
				this.configuredAutoSaveOnFocusChange = false;
				this.configuredAutoSaveOnWindowChange = true;
				break;

			default:
				this.configuredAutoSaveDelay = void 0;
				this.configuredAutoSaveOnFocusChange = false;
				this.configuredAutoSaveOnWindowChange = false;
				break;
		}

		// Emit as event
		this._onAutoSaveConfigurationChange.fire(this.getAutoSaveConfiguration());

		// save all dirty when enabling auto save
		if (!wasAutoSaveEnabled && this.getAutoSaveMode() !== AutoSaveMode.OFF) {
			this.saveAll().done(null, errors.onUnexpectedError);
		}

		// Check for change in files associations
		const filesAssociation = configuration && configuration.files && configuration.files.associations;
		if (!objects.equals(this.currentFilesAssociationConfig, filesAssociation)) {
			this.currentFilesAssociationConfig = filesAssociation;
			this._onFilesAssociationChange.fire();
		}

		// Hot exit
		const hotExitMode = configuration && configuration.files && configuration.files.hotExit;
		if (hotExitMode === HotExitConfiguration.OFF || hotExitMode === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
			this.configuredHotExit = hotExitMode;
		} else {
			this.configuredHotExit = HotExitConfiguration.ON_EXIT;
		}
	}

	public getDirty(resources?: URI[]): URI[] {

		// Collect files
		const dirty = this.getDirtyFileModels(resources).map(m => m.getResource());

		// Add untitled ones
		dirty.push(...this.untitledEditorService.getDirty(resources));

		return dirty;
	}

	public isDirty(resource?: URI): boolean {

		// Check for dirty file
		if (this._models.getAll(resource).some(model => model.isDirty())) {
			return true;
		}

		// Check for dirty untitled
		return this.untitledEditorService.getDirty().some(dirty => !resource || dirty.toString() === resource.toString());
	}

	public save(resource: URI, options?: ISaveOptions): TPromise<boolean> {

		// Run a forced save if we detect the file is not dirty so that save participants can still run
		if (options && options.force && this.fileService.canHandleResource(resource) && !this.isDirty(resource)) {
			const model = this._models.get(resource);
			if (model) {
				model.save({ force: true, reason: SaveReason.EXPLICIT }).then(() => !model.isDirty());
			}
		}

		return this.saveAll([resource], options).then(result => result.results.length === 1 && result.results[0].success);
	}

	public saveAll(includeUntitled?: boolean, options?: ISaveOptions): TPromise<ITextFileOperationResult>;
	public saveAll(resources: URI[], options?: ISaveOptions): TPromise<ITextFileOperationResult>;
	public saveAll(arg1?: any, options?: ISaveOptions): TPromise<ITextFileOperationResult> {

		// get all dirty
		let toSave: URI[] = [];
		if (Array.isArray(arg1)) {
			toSave = this.getDirty(arg1);
		} else {
			toSave = this.getDirty();
		}

		// split up between files and untitled
		const filesToSave: URI[] = [];
		const untitledToSave: URI[] = [];
		toSave.forEach(s => {
			if ((Array.isArray(arg1) || arg1 === true /* includeUntitled */) && s.scheme === Schemas.untitled) {
				untitledToSave.push(s);
			} else {
				filesToSave.push(s);
			}
		});

		return this.doSaveAll(filesToSave, untitledToSave, options);
	}

	private doSaveAll(fileResources: URI[], untitledResources: URI[], options?: ISaveOptions): TPromise<ITextFileOperationResult> {

		// Handle files first that can just be saved
		return this.doSaveAllFiles(fileResources, options).then(async result => {

			// Preflight for untitled to handle cancellation from the dialog
			const targetsForUntitled: URI[] = [];
			for (let i = 0; i < untitledResources.length; i++) {
				const untitled = untitledResources[i];
				if (this.untitledEditorService.exists(untitled)) {
					let targetPath: string;

					// Untitled with associated file path don't need to prompt
					if (this.untitledEditorService.hasAssociatedFilePath(untitled)) {
						targetPath = untitled.fsPath;
					}

					// Otherwise ask user
					else {
						targetPath = await this.promptForPath(this.suggestFileName(untitled));
						if (!targetPath) {
							return TPromise.as({
								results: [...fileResources, ...untitledResources].map(r => {
									return {
										source: r
									};
								})
							});
						}
					}

					targetsForUntitled.push(URI.file(targetPath));
				}
			}

			// Handle untitled
			const untitledSaveAsPromises: TPromise<void>[] = [];
			targetsForUntitled.forEach((target, index) => {
				const untitledSaveAsPromise = this.saveAs(untitledResources[index], target).then(uri => {
					result.results.push({
						source: untitledResources[index],
						target: uri,
						success: !!uri
					});
				});

				untitledSaveAsPromises.push(untitledSaveAsPromise);
			});

			return TPromise.join(untitledSaveAsPromises).then(() => {
				return result;
			});
		});
	}

	private doSaveAllFiles(resources?: URI[], options: ISaveOptions = Object.create(null)): TPromise<ITextFileOperationResult> {
		const dirtyFileModels = this.getDirtyFileModels(Array.isArray(resources) ? resources : void 0 /* Save All */)
			.filter(model => {
				if ((model.hasState(ModelState.CONFLICT) || model.hasState(ModelState.ERROR)) && (options.reason === SaveReason.AUTO || options.reason === SaveReason.FOCUS_CHANGE || options.reason === SaveReason.WINDOW_CHANGE)) {
					return false; // if model is in save conflict or error, do not save unless save reason is explicit or not provided at all
				}

				return true;
			});

		const mapResourceToResult = new ResourceMap<IResult>();
		dirtyFileModels.forEach(m => {
			mapResourceToResult.set(m.getResource(), {
				source: m.getResource()
			});
		});

		return TPromise.join(dirtyFileModels.map(model => {
			return model.save(options).then(() => {
				if (!model.isDirty()) {
					mapResourceToResult.get(model.getResource()).success = true;
				}
			});
		})).then(r => {
			return {
				results: mapResourceToResult.values()
			};
		});
	}

	private getFileModels(resources?: URI[]): ITextFileEditorModel[];
	private getFileModels(resource?: URI): ITextFileEditorModel[];
	private getFileModels(arg1?: any): ITextFileEditorModel[] {
		if (Array.isArray(arg1)) {
			const models: ITextFileEditorModel[] = [];
			(<URI[]>arg1).forEach(resource => {
				models.push(...this.getFileModels(resource));
			});

			return models;
		}

		return this._models.getAll(<URI>arg1);
	}

	private getDirtyFileModels(resources?: URI[]): ITextFileEditorModel[];
	private getDirtyFileModels(resource?: URI): ITextFileEditorModel[];
	private getDirtyFileModels(arg1?: any): ITextFileEditorModel[] {
		return this.getFileModels(arg1).filter(model => model.isDirty());
	}

	public saveAs(resource: URI, target?: URI, options?: ISaveOptions): TPromise<URI> {

		// Get to target resource
		let targetPromise: TPromise<URI>;
		if (target) {
			targetPromise = TPromise.wrap(target);
		} else {
			let dialogPath = resource.fsPath;
			if (resource.scheme === Schemas.untitled) {
				dialogPath = this.suggestFileName(resource);
			}

			targetPromise = this.promptForPath(dialogPath).then(pathRaw => {
				if (pathRaw) {
					return URI.file(pathRaw);
				}

				return void 0;
			});
		}

		return targetPromise.then(target => {
			if (!target) {
				return TPromise.as(null); // user canceled
			}

			// Just save if target is same as models own resource
			if (resource.toString() === target.toString()) {
				return this.save(resource, options).then(() => resource);
			}

			// Do it
			return this.doSaveAs(resource, target, options);
		});
	}

	private doSaveAs(resource: URI, target?: URI, options?: ISaveOptions): TPromise<URI> {

		// Retrieve text model from provided resource if any
		let modelPromise: TPromise<ITextFileEditorModel | UntitledEditorModel> = TPromise.as(null);
		if (this.fileService.canHandleResource(resource)) {
			modelPromise = TPromise.as(this._models.get(resource));
		} else if (resource.scheme === Schemas.untitled && this.untitledEditorService.exists(resource)) {
			modelPromise = this.untitledEditorService.loadOrCreate({ resource });
		}

		return modelPromise.then<any>(model => {

			// We have a model: Use it (can be null e.g. if this file is binary and not a text file or was never opened before)
			if (model) {
				return this.doSaveTextFileAs(model, resource, target, options);
			}

			// Otherwise we can only copy
			return this.fileService.copyFile(resource, target);
		}).then(() => {

			// Revert the source
			return this.revert(resource).then(() => {

				// Done: return target
				return target;
			});
		});
	}

	private doSaveTextFileAs(sourceModel: ITextFileEditorModel | UntitledEditorModel, resource: URI, target: URI, options?: ISaveOptions): TPromise<void> {
		let targetModelResolver: TPromise<ITextFileEditorModel>;

		// Prefer an existing model if it is already loaded for the given target resource
		const targetModel = this.models.get(target);
		if (targetModel && targetModel.isResolved()) {
			targetModelResolver = TPromise.as(targetModel);
		}

		// Otherwise create the target file empty if it does not exist already and resolve it from there
		else {
			targetModelResolver = this.fileService.resolveFile(target).then(stat => stat, () => null).then(stat => stat || this.fileService.updateContent(target, '')).then(stat => {
				return this.models.loadOrCreate(target);
			});
		}

		return targetModelResolver.then(targetModel => {

			// take over encoding and model value from source model
			targetModel.updatePreferredEncoding(sourceModel.getEncoding());
			this.modelService.updateModel(targetModel.textEditorModel, createTextBufferFactoryFromSnapshot(sourceModel.createSnapshot()));

			// save model
			return targetModel.save(options);
		}, error => {

			// binary model: delete the file and run the operation again
			if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_IS_BINARY || (<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_TOO_LARGE) {
				return this.fileService.del(target).then(() => this.doSaveTextFileAs(sourceModel, resource, target, options));
			}

			return TPromise.wrapError(error);
		});
	}

	private suggestFileName(untitledResource: URI): string {
		const untitledFileName = this.untitledEditorService.suggestFileName(untitledResource);

		const lastActiveFile = this.historyService.getLastActiveFile();
		if (lastActiveFile) {
			return URI.file(paths.join(paths.dirname(lastActiveFile.fsPath), untitledFileName)).fsPath;
		}

		const lastActiveFolder = this.historyService.getLastActiveWorkspaceRoot('file');
		if (lastActiveFolder) {
			return URI.file(paths.join(lastActiveFolder.fsPath, untitledFileName)).fsPath;
		}

		return untitledFileName;
	}

	public revert(resource: URI, options?: IRevertOptions): TPromise<boolean> {
		return this.revertAll([resource], options).then(result => result.results.length === 1 && result.results[0].success);
	}

	public revertAll(resources?: URI[], options?: IRevertOptions): TPromise<ITextFileOperationResult> {

		// Revert files first
		return this.doRevertAllFiles(resources, options).then(operation => {

			// Revert untitled
			const reverted = this.untitledEditorService.revertAll(resources);
			reverted.forEach(res => operation.results.push({ source: res, success: true }));

			return operation;
		});
	}

	private doRevertAllFiles(resources?: URI[], options?: IRevertOptions): TPromise<ITextFileOperationResult> {
		const fileModels = options && options.force ? this.getFileModels(resources) : this.getDirtyFileModels(resources);

		const mapResourceToResult = new ResourceMap<IResult>();
		fileModels.forEach(m => {
			mapResourceToResult.set(m.getResource(), {
				source: m.getResource()
			});
		});

		return TPromise.join(fileModels.map(model => {
			return model.revert(options && options.soft).then(() => {
				if (!model.isDirty()) {
					mapResourceToResult.get(model.getResource()).success = true;
				}
			}, error => {

				// FileNotFound means the file got deleted meanwhile, so still record as successful revert
				if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
					mapResourceToResult.get(model.getResource()).success = true;
				}

				// Otherwise bubble up the error
				else {
					return TPromise.wrapError(error);
				}

				return void 0;
			});
		})).then(r => {
			return {
				results: mapResourceToResult.values()
			};
		});
	}

	public delete(resource: URI, useTrash?: boolean): TPromise<void> {
		return this.revert(resource, { soft: true }).then(() => this.fileService.del(resource, useTrash));
	}

	public move(source: URI, target: URI, overwrite?: boolean): TPromise<void> {

		// Handle target model if existing
		let handleTargetModelPromise: TPromise<any> = TPromise.as(void 0);
		const targetModel = this.models.get(target);
		if (targetModel) {
			if (!overwrite) {
				return TPromise.wrapError(new Error('Cannot move file because target file exists and we are not overwriting'));
			}

			// Soft revert the target file since we overwrite
			handleTargetModelPromise = this.revert(target, { soft: true });
		}

		return handleTargetModelPromise.then(() => {

			// Handle source model if existing
			let handleSourceModelPromise: TPromise<boolean>;
			const sourceModel = this.models.get(source);
			if (sourceModel && sourceModel.isDirty()) {
				// Backup to target if the source is dirty
				handleSourceModelPromise = this.backupFileService.backupResource(target, sourceModel.createSnapshot(), sourceModel.getVersionId()).then((() => true));
			} else {
				handleSourceModelPromise = TPromise.as(false);
			}

			return handleSourceModelPromise.then(dirty => {

				// Soft revert the source file
				return this.revert(source, { soft: true }).then(() => {

					// Rename to target
					return this.fileService.moveFile(source, target, overwrite).then(() => {

						// Load if we were dirty before
						if (dirty) {
							return this.models.loadOrCreate(target).then(() => void 0);
						}

						return void 0;
					}, error => {
						return this.backupFileService.discardResourceBackup(target).then(() => TPromise.wrapError(error));
					});
				});
			});
		});
	}

	public getAutoSaveMode(): AutoSaveMode {
		if (this.configuredAutoSaveOnFocusChange) {
			return AutoSaveMode.ON_FOCUS_CHANGE;
		}

		if (this.configuredAutoSaveOnWindowChange) {
			return AutoSaveMode.ON_WINDOW_CHANGE;
		}

		if (this.configuredAutoSaveDelay && this.configuredAutoSaveDelay > 0) {
			return this.configuredAutoSaveDelay <= 1000 ? AutoSaveMode.AFTER_SHORT_DELAY : AutoSaveMode.AFTER_LONG_DELAY;
		}

		return AutoSaveMode.OFF;
	}

	public getAutoSaveConfiguration(): IAutoSaveConfiguration {
		return {
			autoSaveDelay: this.configuredAutoSaveDelay && this.configuredAutoSaveDelay > 0 ? this.configuredAutoSaveDelay : void 0,
			autoSaveFocusChange: this.configuredAutoSaveOnFocusChange,
			autoSaveApplicationChange: this.configuredAutoSaveOnWindowChange
		};
	}

	public get isHotExitEnabled(): boolean {
		return !this.environmentService.isExtensionDevelopment && this.configuredHotExit !== HotExitConfiguration.OFF;
	}

	public dispose(): void {
		this.toUnbind = dispose(this.toUnbind);

		// Clear all caches
		this._models.clear();
	}
}
