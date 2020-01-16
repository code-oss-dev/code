/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import * as arrays from 'vs/base/common/arrays';
import { UntitledTextEditorInput } from 'vs/workbench/common/editor/untitledTextEditorInput';
import { IFilesConfiguration, IFileService } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Event, Emitter } from 'vs/base/common/event';
import { ResourceMap } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { UntitledTextEditorModel } from 'vs/workbench/common/editor/untitledTextEditorModel';
import type { IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';

export const IUntitledTextEditorService = createDecorator<IUntitledTextEditorService>('untitledTextEditorService');

export interface IUntitledCreationOptions {
	resource?: URI;
	mode?: string;
	initialValue?: string;
	encoding?: string;
	useResourcePath?: boolean;
}

export interface IUntitledTextEditorModelManager {

	/**
	 * Events for when untitled text editors change (e.g. getting dirty, saved or reverted).
	 */
	readonly onDidChangeDirty: Event<URI>;

	/**
	 * Events for when untitled text editor encodings change.
	 */
	readonly onDidChangeEncoding: Event<URI>;

	/**
	 * Events for when untitled text editors are disposed.
	 */
	readonly onDidDisposeModel: Event<URI>;

	/**
	 * Returns if an untitled resource with the given URI exists.
	 */
	exists(resource: URI): boolean;

	/**
	 * Creates a new untitled input with the optional resource URI or returns an existing one
	 * if the provided resource exists already as untitled input.
	 *
	 * It is valid to pass in a file resource. In that case the path will be used as identifier.
	 * The use case is to be able to create a new file with a specific path with VSCode.
	 */
	createOrGet(options?: IUntitledCreationOptions): UntitledTextEditorInput;
	createOrGet(resource?: URI, mode?: string, initialValue?: string, encoding?: string, hasAssociatedFilePath?: boolean): UntitledTextEditorInput;

	/**
	 * Creates a new untitled model with the optional resource URI or returns an existing one
	 * if the provided resource exists already as untitled model.
	 *
	 * It is valid to pass in a file resource. In that case the path will be used as identifier.
	 * The use case is to be able to create a new file with a specific path with VSCode.
	 */
	loadOrCreate(options?: IUntitledCreationOptions): Promise<UntitledTextEditorModel & IResolvedTextEditorModel>;

	/**
	 * A check to find out if a untitled resource has a file path associated or not.
	 */
	hasAssociatedFilePath(resource: URI): boolean;
}

export interface IUntitledTextEditorService extends IUntitledTextEditorModelManager {

	_serviceBrand: undefined;
}

export class UntitledTextEditorService extends Disposable implements IUntitledTextEditorService {

	_serviceBrand: undefined;

	private readonly _onDidChangeDirty = this._register(new Emitter<URI>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<URI>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly _onDidDisposeModel = this._register(new Emitter<URI>());
	readonly onDidDisposeModel = this._onDidDisposeModel.event;

	private readonly mapResourceToInput = new ResourceMap<UntitledTextEditorInput>();
	private readonly mapResourceToAssociatedFilePath = new ResourceMap<boolean>();

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	protected get(resource: URI): UntitledTextEditorInput | undefined {
		return this.mapResourceToInput.get(resource);
	}

	protected getAll(resources?: URI[]): UntitledTextEditorInput[] {
		if (resources) {
			return arrays.coalesce(resources.map(r => this.get(r)));
		}

		return this.mapResourceToInput.values();
	}

	exists(resource: URI): boolean {
		return this.mapResourceToInput.has(resource);
	}

	createOrGet(options?: IUntitledCreationOptions): UntitledTextEditorInput;
	createOrGet(resource?: URI, mode?: string, initialValue?: string, encoding?: string, hasAssociatedFilePath?: boolean): UntitledTextEditorInput;
	createOrGet(resourceOrOptions?: URI | IUntitledCreationOptions, mode?: string, initialValue?: string, encoding?: string, hasAssociatedFilePath: boolean = false): UntitledTextEditorInput {
		if (resourceOrOptions && !URI.isUri(resourceOrOptions)) {
			return this.createOrGet(resourceOrOptions.resource, resourceOrOptions.mode, resourceOrOptions.initialValue, resourceOrOptions.encoding, resourceOrOptions.useResourcePath);
		}

		let resource = resourceOrOptions;
		if (resource) {

			// Massage resource if it comes with known file based resource
			if (this.fileService.canHandleResource(resource)) {
				hasAssociatedFilePath = true;
				resource = resource.with({ scheme: Schemas.untitled }); // ensure we have the right scheme
			}

			if (hasAssociatedFilePath) {
				this.mapResourceToAssociatedFilePath.set(resource, true); // remember for future lookups
			}
		}

		// Return existing instance if asked for it
		if (resource && this.mapResourceToInput.has(resource)) {
			return this.mapResourceToInput.get(resource)!;
		}

		// Create new otherwise
		return this.doCreate(resource, hasAssociatedFilePath, mode, initialValue, encoding);
	}

	private doCreate(resource?: URI, hasAssociatedFilePath?: boolean, mode?: string, initialValue?: string, encoding?: string): UntitledTextEditorInput {
		let untitledResource: URI;
		if (resource) {
			untitledResource = resource;
		} else {

			// Create new taking a resource URI that is not already taken
			let counter = this.mapResourceToInput.size + 1;
			do {
				untitledResource = URI.from({ scheme: Schemas.untitled, path: `Untitled-${counter}` });
				counter++;
			} while (this.mapResourceToInput.has(untitledResource));
		}

		// Look up default language from settings if any
		if (!mode && !hasAssociatedFilePath) {
			const configuration = this.configurationService.getValue<IFilesConfiguration>();
			if (configuration.files?.defaultLanguage) {
				mode = configuration.files.defaultLanguage;
			}
		}

		const input = this.instantiationService.createInstance(UntitledTextEditorInput, untitledResource, !!hasAssociatedFilePath, mode, initialValue, encoding);

		const dirtyListener = input.onDidChangeDirty(() => this._onDidChangeDirty.fire(untitledResource));
		const encodingListener = input.onDidModelChangeEncoding(() => this._onDidChangeEncoding.fire(untitledResource));
		const disposeListener = input.onDispose(() => this._onDidDisposeModel.fire(untitledResource));

		// Remove from cache on dispose
		const onceDispose = Event.once(input.onDispose);
		onceDispose(() => {
			this.mapResourceToInput.delete(input.getResource());
			this.mapResourceToAssociatedFilePath.delete(input.getResource());
			dirtyListener.dispose();
			encodingListener.dispose();
			disposeListener.dispose();
		});

		// Add to cache
		this.mapResourceToInput.set(untitledResource, input);

		return input;
	}

	loadOrCreate(options?: IUntitledCreationOptions): Promise<UntitledTextEditorModel & IResolvedTextEditorModel> {
		return this.createOrGet(options).resolve();
	}

	hasAssociatedFilePath(resource: URI): boolean {
		return this.mapResourceToAssociatedFilePath.has(resource);
	}
}

registerSingleton(IUntitledTextEditorService, UntitledTextEditorService, true);
