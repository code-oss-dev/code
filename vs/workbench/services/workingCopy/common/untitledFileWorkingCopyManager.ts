/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBufferReadableStream } from 'vs/base/common/buffer';
import { DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IUntitledFileWorkingCopy, IUntitledFileWorkingCopyModel, IUntitledFileWorkingCopyModelFactory, IUntitledFileWorkingCopySaveDelegate, UntitledFileWorkingCopy } from 'vs/workbench/services/workingCopy/common/untitledFileWorkingCopy';
import { Event, Emitter } from 'vs/base/common/event';
import { Schemas } from 'vs/base/common/network';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILogService } from 'vs/platform/log/common/log';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IFileService } from 'vs/platform/files/common/files';
import { BaseFileWorkingCopyManager, IBaseFileWorkingCopyManager } from 'vs/workbench/services/workingCopy/common/abstractFileWorkingCopyManager';
import { ResourceMap } from 'vs/base/common/map';

/**
 * The only one that should be dealing with `IUntitledFileWorkingCopy` and
 * handle all operations that are working copy related, such as save/revert,
 * backup and resolving.
 */
export interface IUntitledFileWorkingCopyManager<T extends IUntitledFileWorkingCopyModel> extends IBaseFileWorkingCopyManager<T, IUntitledFileWorkingCopy<T>> {

	/**
	 * An event for when a untitled file working copy changed it's dirty state.
	 */
	readonly onDidChangeDirty: Event<IUntitledFileWorkingCopy<T>>;

	/**
	 * An event for when a untitled file working copy is about to be disposed.
	 */
	readonly onWillDispose: Event<IUntitledFileWorkingCopy<T>>;

	/**
	 * Resolves an untitled file working copy from the provided options.
	 */
	resolve(options?: INewUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<T>>;
	resolve(options?: INewUntitledFileWorkingCopyWithAssociatedResourceOptions): Promise<IUntitledFileWorkingCopy<T>>;

	/**
	 * Resolves an untitled file working copy from the provided options
	 * unless an existing working copy already exists with that resource.
	 */
	resolve(options?: IExistingUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<T>>;
}

export interface INewUntitledFileWorkingCopyOptions {

	/**
	 * Initial value of the untitled file working copy.
	 *
	 * Note: An untitled file working copy with initial
	 * value is dirty right from the beginning.
	 */
	initialValue?: VSBufferReadableStream;
}

export interface INewUntitledFileWorkingCopyWithAssociatedResourceOptions extends INewUntitledFileWorkingCopyOptions {

	/**
	 * Resource components to associate with the untitled file working copy.
	 * When saving, the associated components will be used and the user
	 * is not being asked to provide a file path.
	 *
	 * Note: currently it is not possible to specify the `scheme` to use. The
	 * untitled file working copy will saved to the default local or remote resource.
	 */
	associatedResource: { authority?: string; path?: string; query?: string; fragment?: string; }
}

export interface IExistingUntitledFileWorkingCopyOptions extends INewUntitledFileWorkingCopyOptions {

	/**
	 * A resource to identify the untitled file working copy
	 * to create or return if already existing.
	 *
	 * Note: the resource will not be used unless the scheme is `untitled`.
	 */
	untitledResource: URI;
}

type IInternalUntitledFileWorkingCopyOptions = INewUntitledFileWorkingCopyOptions & INewUntitledFileWorkingCopyWithAssociatedResourceOptions & IExistingUntitledFileWorkingCopyOptions;

export class UntitledFileWorkingCopyManager<T extends IUntitledFileWorkingCopyModel> extends BaseFileWorkingCopyManager<T, IUntitledFileWorkingCopy<T>> implements IUntitledFileWorkingCopyManager<T> {

	//#region Events

	private readonly _onDidChangeDirty = this._register(new Emitter<IUntitledFileWorkingCopy<T>>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onWillDispose = this._register(new Emitter<IUntitledFileWorkingCopy<T>>());
	readonly onWillDispose = this._onWillDispose.event;

	//#endregion

	private readonly mapResourceToWorkingCopyListeners = new ResourceMap<IDisposable>();

	constructor(
		private readonly workingCopyTypeId: string,
		private readonly modelFactory: IUntitledFileWorkingCopyModelFactory<T>,
		private readonly saveDelegate: IUntitledFileWorkingCopySaveDelegate,
		@IFileService fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
		@IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService
	) {
		super(fileService, logService, workingCopyBackupService);
	}

	//#region Resolve

	resolve(options?: INewUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<T>>;
	resolve(options?: INewUntitledFileWorkingCopyWithAssociatedResourceOptions): Promise<IUntitledFileWorkingCopy<T>>;
	resolve(options?: IExistingUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<T>>;
	async resolve(options?: IInternalUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<T>> {
		const workingCopy = this.doCreateOrGet(options);
		await workingCopy.resolve();

		return workingCopy;
	}

	private doCreateOrGet(options: IInternalUntitledFileWorkingCopyOptions = Object.create(null)): IUntitledFileWorkingCopy<T> {
		const massagedOptions = this.massageOptions(options);

		// Return existing instance if asked for it
		if (massagedOptions.untitledResource) {
			const existingWorkingCopy = this.get(massagedOptions.untitledResource);
			if (existingWorkingCopy) {
				return existingWorkingCopy;
			}
		}

		// Create new instance otherwise
		return this.doCreate(massagedOptions);
	}

	private massageOptions(options: IInternalUntitledFileWorkingCopyOptions): IInternalUntitledFileWorkingCopyOptions {
		const massagedOptions: IInternalUntitledFileWorkingCopyOptions = Object.create(null);

		// Figure out associated and untitled resource
		if (options.associatedResource) {
			massagedOptions.untitledResource = URI.from({
				scheme: Schemas.untitled,
				authority: options.associatedResource.authority,
				fragment: options.associatedResource.fragment,
				path: options.associatedResource.path,
				query: options.associatedResource.query
			});
			massagedOptions.associatedResource = options.associatedResource;
		} else {
			if (options.untitledResource?.scheme === Schemas.untitled) {
				massagedOptions.untitledResource = options.untitledResource;
			}
		}

		// Take over initial value
		massagedOptions.initialValue = options.initialValue;

		return massagedOptions;
	}

	private doCreate(options: IInternalUntitledFileWorkingCopyOptions): IUntitledFileWorkingCopy<T> {

		// Create a new untitled resource if none is provided
		let untitledResource = options.untitledResource;
		if (!untitledResource) {
			let counter = 1;
			do {
				untitledResource = URI.from({ scheme: Schemas.untitled, path: `Untitled-${counter}` });
				counter++;
			} while (this.has(untitledResource));
		}

		// Create new working copy with provided options
		const workingCopy = this.instantiationService.createInstance(
			UntitledFileWorkingCopy,
			this.workingCopyTypeId,
			untitledResource,
			this.labelService.getUriBasenameLabel(untitledResource),
			!!options.associatedResource,
			options.initialValue,
			this.modelFactory,
			this.saveDelegate
		) as unknown as IUntitledFileWorkingCopy<T>;

		this.registerWorkingCopy(workingCopy);

		return workingCopy;
	}

	private registerWorkingCopy(workingCopy: IUntitledFileWorkingCopy<T>): void {

		// Install working copy listeners
		const workingCopyListeners = new DisposableStore();
		workingCopyListeners.add(workingCopy.onDidChangeDirty(() => this._onDidChangeDirty.fire(workingCopy)));
		workingCopyListeners.add(workingCopy.onWillDispose(() => this._onWillDispose.fire(workingCopy)));

		// Keep for disposal
		this.mapResourceToWorkingCopyListeners.set(workingCopy.resource, workingCopyListeners);

		// Add to cache
		this.add(workingCopy.resource, workingCopy);

		// If the working copy is dirty right from the beginning,
		// make sure to emit this as an event
		if (workingCopy.isDirty()) {
			this._onDidChangeDirty.fire(workingCopy);
		}
	}

	protected override remove(resource: URI): void {
		super.remove(resource);

		// Dispose any exsting working copy listeners
		const workingCopyListener = this.mapResourceToWorkingCopyListeners.get(resource);
		if (workingCopyListener) {
			dispose(workingCopyListener);
			this.mapResourceToWorkingCopyListeners.delete(resource);
		}
	}

	//#endregion

	//#region Lifecycle

	override dispose(): void {
		super.dispose();

		// Dispose the working copy change listeners
		dispose(this.mapResourceToWorkingCopyListeners.values());
		this.mapResourceToWorkingCopyListeners.clear();
	}

	//#endregion
}
