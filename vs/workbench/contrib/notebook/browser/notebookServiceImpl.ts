/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Disposable, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { URI, UriComponents } from 'vs/base/common/uri';
import { notebookProviderExtensionPoint, notebookRendererExtensionPoint, INotebookEditorContribution } from 'vs/workbench/contrib/notebook/browser/extensionPoint';
import { NotebookProviderInfo, NotebookEditorDescriptor } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { NotebookExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { Emitter, Event } from 'vs/base/common/event';
import { INotebookTextModel, INotebookRendererInfo, NotebookDocumentMetadata, ICellDto2, INotebookKernelInfo, CellOutputKind, ITransformedDisplayOutputDto, IDisplayOutput, ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER, NOTEBOOK_DISPLAY_ORDER, sortMimeTypes, IOrderedMimeType, mimeTypeSupportedByCore, IOutputRenderRequestOutputInfo, IOutputRenderRequestCellInfo, NotebookCellOutputsSplice, ICellEditOperation, CellEditType, ICellInsertEdit, IOutputRenderResponse, IProcessedOutput, BUILTIN_RENDERER_ID } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { NotebookOutputRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookOutputRenderer';
import { Iterable } from 'vs/base/common/iterator';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorService, ICustomEditorViewTypesHandler, ICustomEditorInfo } from 'vs/workbench/services/editor/common/editorService';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookEditorModelManager } from 'vs/workbench/contrib/notebook/common/notebookEditorModel';
import { INotebookService, IMainNotebookController } from 'vs/workbench/contrib/notebook/common/notebookService';
import * as glob from 'vs/base/common/glob';
import { basename } from 'vs/base/common/path';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { Memento } from 'vs/workbench/common/memento';
import { StorageScope, IStorageService } from 'vs/platform/storage/common/storage';
import { IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';

function MODEL_ID(resource: URI): string {
	return resource.toString();
}

export class NotebookProviderInfoStore implements IDisposable {
	private static readonly CUSTOM_EDITORS_STORAGE_ID = 'notebookEditors';
	private static readonly CUSTOM_EDITORS_ENTRY_ID = 'editors';

	private readonly _memento: Memento;
	constructor(storageService: IStorageService) {
		this._memento = new Memento(NotebookProviderInfoStore.CUSTOM_EDITORS_STORAGE_ID, storageService);

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL);
		for (const info of (mementoObject[NotebookProviderInfoStore.CUSTOM_EDITORS_ENTRY_ID] || []) as NotebookEditorDescriptor[]) {
			this.add(new NotebookProviderInfo(info));
		}
	}

	update(extensions: readonly IExtensionPointUser<INotebookEditorContribution[]>[]) {
		this.clear();

		for (const extension of extensions) {
			for (const notebookContribution of extension.value) {
				this.add(new NotebookProviderInfo({
					id: notebookContribution.viewType,
					displayName: notebookContribution.displayName,
					selector: notebookContribution.selector || [],
					providerDisplayName: extension.description.isBuiltin ? nls.localize('builtinProviderDisplayName', "Built-in") : extension.description.displayName || extension.description.identifier.value,
					providerExtensionLocation: extension.description.extensionLocation
				}));
			}
		}

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL);
		mementoObject[NotebookProviderInfoStore.CUSTOM_EDITORS_ENTRY_ID] = Array.from(this.contributedEditors.values());
		this._memento.saveMemento();
	}

	dispose(): void {
	}

	private readonly contributedEditors = new Map<string, NotebookProviderInfo>();

	clear() {
		this.contributedEditors.clear();
	}

	get(viewType: string): NotebookProviderInfo | undefined {
		return this.contributedEditors.get(viewType);
	}

	add(info: NotebookProviderInfo): void {
		if (this.contributedEditors.has(info.id)) {
			return;
		}
		this.contributedEditors.set(info.id, info);
	}

	getContributedNotebook(resource: URI): readonly NotebookProviderInfo[] {
		return [...Iterable.filter(this.contributedEditors.values(), customEditor => customEditor.matches(resource))];
	}

	public [Symbol.iterator](): Iterator<NotebookProviderInfo> {
		return this.contributedEditors.values();
	}
}

export class NotebookOutputRendererInfoStore {
	private readonly contributedRenderers = new Map<string, NotebookOutputRendererInfo>();

	clear() {
		this.contributedRenderers.clear();
	}

	get(viewType: string): NotebookOutputRendererInfo | undefined {
		return this.contributedRenderers.get(viewType);
	}

	add(info: NotebookOutputRendererInfo): void {
		if (this.contributedRenderers.has(info.id)) {
			return;
		}
		this.contributedRenderers.set(info.id, info);
	}

	getContributedRenderer(mimeType: string): readonly NotebookOutputRendererInfo[] {
		return Array.from(this.contributedRenderers.values()).filter(customEditor =>
			customEditor.matches(mimeType));
	}
}

class ModelData implements IDisposable {
	private readonly _modelEventListeners = new DisposableStore();

	constructor(
		public model: NotebookTextModel,
		onWillDispose: (model: INotebookTextModel) => void
	) {
		this._modelEventListeners.add(model.onWillDispose(() => onWillDispose(model)));
	}

	dispose(): void {
		this._modelEventListeners.dispose();
	}
}
export class NotebookService extends Disposable implements INotebookService, ICustomEditorViewTypesHandler {
	_serviceBrand: undefined;
	private readonly _notebookProviders = new Map<string, { controller: IMainNotebookController, extensionData: NotebookExtensionDescription }>();
	private readonly _notebookRenderers = new Map<string, INotebookRendererInfo>();
	private readonly _notebookKernels = new Map<string, INotebookKernelInfo>();
	notebookProviderInfoStore: NotebookProviderInfoStore;
	notebookRenderersInfoStore: NotebookOutputRendererInfoStore = new NotebookOutputRendererInfoStore();
	private readonly _models = new Map<string, ModelData>();
	private _onDidChangeActiveEditor = new Emitter<string | null>();
	onDidChangeActiveEditor: Event<string | null> = this._onDidChangeActiveEditor.event;
	private _onDidChangeVisibleEditors = new Emitter<string[]>();
	onDidChangeVisibleEditors: Event<string[]> = this._onDidChangeVisibleEditors.event;
	private readonly _onNotebookEditorAdd: Emitter<INotebookEditor> = this._register(new Emitter<INotebookEditor>());
	public readonly onNotebookEditorAdd: Event<INotebookEditor> = this._onNotebookEditorAdd.event;
	private readonly _onNotebookEditorsRemove: Emitter<INotebookEditor[]> = this._register(new Emitter<INotebookEditor[]>());
	public readonly onNotebookEditorsRemove: Event<INotebookEditor[]> = this._onNotebookEditorsRemove.event;
	private readonly _onNotebookDocumentAdd: Emitter<URI[]> = this._register(new Emitter<URI[]>());
	public readonly onNotebookDocumentAdd: Event<URI[]> = this._onNotebookDocumentAdd.event;
	private readonly _onNotebookDocumentRemove: Emitter<URI[]> = this._register(new Emitter<URI[]>());
	public readonly onNotebookDocumentRemove: Event<URI[]> = this._onNotebookDocumentRemove.event;
	private readonly _notebookEditors = new Map<string, INotebookEditor>();

	private readonly _onDidChangeViewTypes = new Emitter<void>();
	onDidChangeViewTypes: Event<void> = this._onDidChangeViewTypes.event;

	private readonly _onDidChangeKernels = new Emitter<void>();
	onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;
	private cutItems: NotebookCellTextModel[] | undefined;

	modelManager: NotebookEditorModelManager;
	private _displayOrder: { userOrder: string[], defaultOrder: string[] } = Object.create(null);

	constructor(
		@IExtensionService private readonly extensionService: IExtensionService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		this.modelManager = this.instantiationService.createInstance(NotebookEditorModelManager);
		this._register(this.modelManager);
		this.notebookProviderInfoStore = new NotebookProviderInfoStore(this.storageService);
		this._register(this.notebookProviderInfoStore);

		notebookProviderExtensionPoint.setHandler((extensions) => {
			this.notebookProviderInfoStore.update(extensions);

			// console.log(this._notebookProviderInfoStore);
		});

		notebookRendererExtensionPoint.setHandler((renderers) => {
			this.notebookRenderersInfoStore.clear();

			for (const extension of renderers) {
				for (const notebookContribution of extension.value) {
					this.notebookRenderersInfoStore.add(new NotebookOutputRendererInfo({
						id: notebookContribution.viewType,
						displayName: notebookContribution.displayName,
						mimeTypes: notebookContribution.mimeTypes || []
					}));
				}
			}

			// console.log(this.notebookRenderersInfoStore);
		});

		this.editorService.registerCustomEditorViewTypesHandler('Notebook', this);

		const updateOrder = () => {
			let userOrder = this.configurationService.getValue<string[]>('notebook.displayOrder');
			this._displayOrder = {
				defaultOrder: this.accessibilityService.isScreenReaderOptimized() ? ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER : NOTEBOOK_DISPLAY_ORDER,
				userOrder: userOrder
			};
		};

		updateOrder();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.indexOf('notebook.displayOrder') >= 0) {
				updateOrder();
			}
		}));

		this._register(this.accessibilityService.onDidChangeScreenReaderOptimized(() => {
			updateOrder();
		}));
	}

	getViewTypes(): ICustomEditorInfo[] {
		return [...this.notebookProviderInfoStore].map(info => ({
			id: info.id,
			displayName: info.displayName,
			providerDisplayName: info.providerDisplayName
		}));
	}

	async canResolve(viewType: string): Promise<boolean> {
		if (!this._notebookProviders.has(viewType)) {
			await this.extensionService.whenInstalledExtensionsRegistered();
			// notebook providers/kernels/renderers might use `*` as activation event.
			await this.extensionService.activateByEvent(`*`);
			// this awaits full activation of all matching extensions
			await this.extensionService.activateByEvent(`onNotebookEditor:${viewType}`);
		}
		return this._notebookProviders.has(viewType);
	}

	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: IMainNotebookController) {
		this._notebookProviders.set(viewType, { extensionData, controller });
		this.notebookProviderInfoStore.get(viewType)!.kernel = controller.kernel;
		this._onDidChangeViewTypes.fire();
	}

	unregisterNotebookProvider(viewType: string): void {
		this._notebookProviders.delete(viewType);
		this._onDidChangeViewTypes.fire();
	}

	registerNotebookRenderer(id: string, renderer: INotebookRendererInfo) {
		this._notebookRenderers.set(id, renderer);
	}

	unregisterNotebookRenderer(id: string) {
		this._notebookRenderers.delete(id);
	}

	registerNotebookKernel(notebook: INotebookKernelInfo): void {
		this._notebookKernels.set(notebook.id, notebook);
		this._onDidChangeKernels.fire();
	}

	unregisterNotebookKernel(id: string): void {
		this._notebookKernels.delete(id);
		this._onDidChangeKernels.fire();
	}

	getContributedNotebookKernels(viewType: string, resource: URI): INotebookKernelInfo[] {
		let kernelInfos: INotebookKernelInfo[] = [];
		this._notebookKernels.forEach(kernel => {
			if (this._notebookKernelMatch(resource, kernel!.selectors)) {
				kernelInfos.push(kernel!);
			}
		});

		// sort by extensions

		const notebookContentProvider = this._notebookProviders.get(viewType);

		if (!notebookContentProvider) {
			return kernelInfos;
		}

		kernelInfos = kernelInfos.sort((a, b) => {
			if (a.extension.value === notebookContentProvider!.extensionData.id.value) {
				return -1;
			} else if (b.extension.value === notebookContentProvider!.extensionData.id.value) {
				return 1;
			} else {
				return 0;
			}
		});

		return kernelInfos;
	}

	private _notebookKernelMatch(resource: URI, selectors: (string | glob.IRelativePattern)[]): boolean {
		for (let i = 0; i < selectors.length; i++) {
			const pattern = typeof selectors[i] !== 'string' ? selectors[i] : selectors[i].toString();
			if (glob.match(pattern, basename(resource.fsPath).toLowerCase())) {
				return true;
			}
		}

		return false;
	}

	getRendererInfo(id: string): INotebookRendererInfo | undefined {
		const renderer = this._notebookRenderers.get(id);

		return renderer;
	}

	async createNotebookFromBackup(viewType: string, uri: URI, metadata: NotebookDocumentMetadata, languages: string[], cells: ICellDto2[], editorId?: string): Promise<NotebookTextModel | undefined> {
		const provider = this._notebookProviders.get(viewType);
		if (!provider) {
			return undefined;
		}

		const notebookModel = await provider.controller.createNotebook(viewType, uri, { metadata, languages, cells }, false, editorId);
		if (!notebookModel) {
			return undefined;
		}

		// new notebook model created
		const modelId = MODEL_ID(uri);
		const modelData = new ModelData(
			notebookModel,
			(model) => this._onWillDisposeDocument(model),
		);
		this._models.set(modelId, modelData);
		this._onNotebookDocumentAdd.fire([notebookModel.uri]);
		// after the document is added to the store and sent to ext host, we transform the ouputs
		await this.transformTextModelOutputs(notebookModel!);
		return modelData.model;
	}

	async resolveNotebook(viewType: string, uri: URI, forceReload: boolean, editorId?: string): Promise<NotebookTextModel | undefined> {
		const provider = this._notebookProviders.get(viewType);
		if (!provider) {
			return undefined;
		}

		const notebookModel = await provider.controller.createNotebook(viewType, uri, undefined, forceReload, editorId);
		if (!notebookModel) {
			return undefined;
		}

		// new notebook model created
		const modelId = MODEL_ID(uri);
		const modelData = new ModelData(
			notebookModel!,
			(model) => this._onWillDisposeDocument(model),
		);

		this._models.set(modelId, modelData);
		this._onNotebookDocumentAdd.fire([notebookModel!.uri]);
		// after the document is added to the store and sent to ext host, we transform the ouputs
		await this.transformTextModelOutputs(notebookModel!);
		return modelData.model;
	}

	private async _fillInTransformedOutputs<T>(
		renderers: Set<string>,
		requestItems: IOutputRenderRequestCellInfo<T>[],
		renderFunc: (rendererId: string, items: IOutputRenderRequestCellInfo<T>[]) => Promise<IOutputRenderResponse<T> | undefined>,
		lookUp: (key: T) => { outputs: IProcessedOutput[] }
	) {
		for (let id of renderers) {
			const requestsPerRenderer: IOutputRenderRequestCellInfo<T>[] = requestItems.map(req => {
				return {
					key: req.key,
					outputs: req.outputs.filter(output => output.handlerId === id)
				};
			});

			const response = await renderFunc(id, requestsPerRenderer);

			// mix the response with existing outputs, which will replace the picked transformed mimetype with resolved result
			if (response) {
				response.items.forEach(cellInfo => {
					const cell = lookUp(cellInfo.key)!;
					cellInfo.outputs.forEach(outputInfo => {
						const output = cell.outputs[outputInfo.index];
						if (output.outputKind === CellOutputKind.Rich && output.orderedMimeTypes && output.orderedMimeTypes.length) {
							output.orderedMimeTypes[0] = {
								mimeType: outputInfo.mimeType,
								isResolved: true,
								rendererId: outputInfo.handlerId,
								output: outputInfo.transformedOutput
							};
						}
					});
				});
			}
		}
	}

	async transformTextModelOutputs(textModel: NotebookTextModel) {
		const renderers = new Set<string>();

		const cellMapping: Map<string, NotebookCellTextModel> = new Map();

		const requestItems: IOutputRenderRequestCellInfo<UriComponents>[] = [];
		for (let i = 0; i < textModel.cells.length; i++) {
			const cell = textModel.cells[i];
			cellMapping.set(cell.uri.fragment, cell);
			const outputs = cell.outputs;
			const outputRequest: IOutputRenderRequestOutputInfo[] = [];

			outputs.forEach((output, index) => {
				if (output.outputKind === CellOutputKind.Rich) {
					// TODO no string[] casting
					const ret = this._transformMimeTypes(output, textModel.metadata.displayOrder as string[] || []);
					const orderedMimeTypes = ret.orderedMimeTypes!;
					const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
					output.pickedMimeTypeIndex = pickedMimeTypeIndex;
					output.orderedMimeTypes = orderedMimeTypes;

					if (orderedMimeTypes[pickedMimeTypeIndex!].rendererId && orderedMimeTypes[pickedMimeTypeIndex].rendererId !== BUILTIN_RENDERER_ID) {
						outputRequest.push({ index, handlerId: orderedMimeTypes[pickedMimeTypeIndex].rendererId!, mimeType: orderedMimeTypes[pickedMimeTypeIndex].mimeType });
						renderers.add(orderedMimeTypes[pickedMimeTypeIndex].rendererId!);
					}
				}
			});

			requestItems.push({ key: cell.uri, outputs: outputRequest });
		}

		await this._fillInTransformedOutputs<UriComponents>(renderers, requestItems, async (rendererId, items) => {
			return await this._notebookRenderers.get(rendererId)?.render(textModel.uri, { items: items });
		}, (key: UriComponents) => { return cellMapping.get(URI.revive(key).fragment)!; });

		textModel.updateRenderers([...renderers]);
	}

	async transformEditsOutputs(textModel: NotebookTextModel, edits: ICellEditOperation[]) {
		const renderers = new Set<string>();
		const requestItems: IOutputRenderRequestCellInfo<[number, number]>[] = [];

		edits.forEach((edit, editIndex) => {
			if (edit.editType === CellEditType.Insert) {
				edit.cells.forEach((cell, cellIndex) => {
					const outputs = cell.outputs;
					const outputRequest: IOutputRenderRequestOutputInfo[] = [];
					outputs.map((output, index) => {
						if (output.outputKind === CellOutputKind.Rich) {
							const ret = this._transformMimeTypes(output, textModel.metadata.displayOrder as string[] || []);
							const orderedMimeTypes = ret.orderedMimeTypes!;
							const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
							output.pickedMimeTypeIndex = pickedMimeTypeIndex;
							output.orderedMimeTypes = orderedMimeTypes;

							if (orderedMimeTypes[pickedMimeTypeIndex!].rendererId && orderedMimeTypes[pickedMimeTypeIndex].rendererId !== BUILTIN_RENDERER_ID) {
								outputRequest.push({ index, handlerId: orderedMimeTypes[pickedMimeTypeIndex].rendererId!, mimeType: orderedMimeTypes[pickedMimeTypeIndex].mimeType, output: output });
								renderers.add(orderedMimeTypes[pickedMimeTypeIndex].rendererId!);
							}
						}
					});

					requestItems.push({ key: [editIndex, cellIndex], outputs: outputRequest });
				});
			}
		});

		await this._fillInTransformedOutputs<[number, number]>(renderers, requestItems, async (rendererId, items) => {
			return await this._notebookRenderers.get(rendererId)?.render2<[number, number]>(textModel.uri, { items: items });
		}, (key: [number, number]) => {
			return (edits[key[0]] as ICellInsertEdit).cells[key[1]];
		});

		textModel.updateRenderers([...renderers]);
	}

	async transformSpliceOutputs(textModel: NotebookTextModel, splices: NotebookCellOutputsSplice[]) {
		const renderers = new Set<string>();
		const requestItems: IOutputRenderRequestCellInfo<number>[] = [];

		splices.forEach((splice, spliceIndex) => {
			const outputs = splice[2];
			const outputRequest: IOutputRenderRequestOutputInfo[] = [];
			outputs.map((output, index) => {
				if (output.outputKind === CellOutputKind.Rich) {
					const ret = this._transformMimeTypes(output, textModel.metadata.displayOrder as string[] || []);
					const orderedMimeTypes = ret.orderedMimeTypes!;
					const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
					output.pickedMimeTypeIndex = pickedMimeTypeIndex;
					output.orderedMimeTypes = orderedMimeTypes;

					if (orderedMimeTypes[pickedMimeTypeIndex!].rendererId && orderedMimeTypes[pickedMimeTypeIndex].rendererId !== BUILTIN_RENDERER_ID) {
						outputRequest.push({ index, handlerId: orderedMimeTypes[pickedMimeTypeIndex].rendererId!, mimeType: orderedMimeTypes[pickedMimeTypeIndex].mimeType, output: output });
						renderers.add(orderedMimeTypes[pickedMimeTypeIndex].rendererId!);
					}
				}
			});
			requestItems.push({ key: spliceIndex, outputs: outputRequest });
		});

		await this._fillInTransformedOutputs<number>(renderers, requestItems, async (rendererId, items) => {
			return await this._notebookRenderers.get(rendererId)?.render2<number>(textModel.uri, { items: items });
		}, (key: number) => {
			return { outputs: splices[key][2] };
		});

		textModel.updateRenderers([...renderers]);
	}

	async transformSingleOutput(textModel: NotebookTextModel, output: IProcessedOutput, rendererId: string, mimeType: string): Promise<IOrderedMimeType | undefined> {
		const items = [
			{
				key: 0,
				outputs: [
					{
						index: 0,
						handlerId: rendererId,
						mimeType: mimeType,
						output: output
					}
				]
			}
		];
		const response = await this._notebookRenderers.get(rendererId)?.render2<number>(textModel.uri, { items: items });

		if (response) {
			textModel.updateRenderers([rendererId]);
			const outputInfo = response.items[0].outputs[0];

			return {
				mimeType: outputInfo.mimeType,
				isResolved: true,
				rendererId: outputInfo.handlerId,
				output: outputInfo.transformedOutput
			};
		}

		return;
	}

	private _transformMimeTypes(output: IDisplayOutput, documentDisplayOrder: string[]): ITransformedDisplayOutputDto {
		let mimeTypes = Object.keys(output.data);
		let coreDisplayOrder = this._displayOrder;
		const sorted = sortMimeTypes(mimeTypes, coreDisplayOrder?.userOrder || [], documentDisplayOrder, coreDisplayOrder?.defaultOrder || []);

		let orderMimeTypes: IOrderedMimeType[] = [];

		sorted.forEach(mimeType => {
			let handlers = this.findBestMatchedRenderer(mimeType);

			if (handlers.length) {
				const handler = handlers[0];

				orderMimeTypes.push({
					mimeType: mimeType,
					isResolved: false,
					rendererId: handler.id,
				});

				for (let i = 1; i < handlers.length; i++) {
					orderMimeTypes.push({
						mimeType: mimeType,
						isResolved: false,
						rendererId: handlers[i].id
					});
				}

				if (mimeTypeSupportedByCore(mimeType)) {
					orderMimeTypes.push({
						mimeType: mimeType,
						isResolved: false,
						rendererId: BUILTIN_RENDERER_ID
					});
				}
			} else {
				orderMimeTypes.push({
					mimeType: mimeType,
					isResolved: false,
					rendererId: BUILTIN_RENDERER_ID
				});
			}
		});

		return {
			outputKind: output.outputKind,
			data: output.data,
			orderedMimeTypes: orderMimeTypes,
			pickedMimeTypeIndex: 0
		};
	}

	findBestMatchedRenderer(mimeType: string): readonly NotebookOutputRendererInfo[] {
		return this.notebookRenderersInfoStore.getContributedRenderer(mimeType);
	}

	async executeNotebook(viewType: string, uri: URI, useAttachedKernel: boolean, token: CancellationToken): Promise<void> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.executeNotebook(viewType, uri, useAttachedKernel, token);
		}

		return;
	}

	async executeNotebookCell(viewType: string, uri: URI, handle: number, useAttachedKernel: boolean, token: CancellationToken): Promise<void> {
		const provider = this._notebookProviders.get(viewType);
		if (provider) {
			await provider.controller.executeNotebookCell(uri, handle, useAttachedKernel, token);
		}
	}

	async executeNotebook2(viewType: string, uri: URI, kernelId: string, token: CancellationToken): Promise<void> {
		const kernel = this._notebookKernels.get(kernelId);
		if (kernel) {
			await kernel.executeNotebook(viewType, uri, undefined, token);
		}
	}

	async executeNotebookCell2(viewType: string, uri: URI, handle: number, kernelId: string, token: CancellationToken): Promise<void> {
		const kernel = this._notebookKernels.get(kernelId);
		if (kernel) {
			await kernel.executeNotebook(viewType, uri, handle, token);
		}
	}

	getContributedNotebookProviders(resource: URI): readonly NotebookProviderInfo[] {
		return this.notebookProviderInfoStore.getContributedNotebook(resource);
	}

	getContributedNotebookProvider(viewType: string): NotebookProviderInfo | undefined {
		return this.notebookProviderInfoStore.get(viewType);
	}

	getContributedNotebookOutputRenderers(mimeType: string): readonly NotebookOutputRendererInfo[] {
		return this.notebookRenderersInfoStore.getContributedRenderer(mimeType);
	}

	getNotebookProviderResourceRoots(): URI[] {
		let ret: URI[] = [];
		this._notebookProviders.forEach(val => {
			ret.push(URI.revive(val.extensionData.location));
		});

		return ret;
	}

	removeNotebookEditor(editor: INotebookEditor) {
		let editorCache = this._notebookEditors.get(editor.getId());

		if (editorCache) {
			this._notebookEditors.delete(editor.getId());
			this._onNotebookEditorsRemove.fire([editor]);
		}
	}

	addNotebookEditor(editor: INotebookEditor) {
		this._notebookEditors.set(editor.getId(), editor);
		this._onNotebookEditorAdd.fire(editor);
	}

	listNotebookEditors(): INotebookEditor[] {
		return [...this._notebookEditors].map(e => e[1]);
	}

	listVisibleNotebookEditors(): INotebookEditor[] {
		return this.editorService.visibleEditorPanes
			.filter(pane => (pane as any).isNotebookEditor)
			.map(pane => pane.getControl() as INotebookEditor)
			.filter(editor => !!editor)
			.filter(editor => this._notebookEditors.has(editor.getId()));
	}

	listNotebookDocuments(): NotebookTextModel[] {
		return [...this._models].map(e => e[1].model);
	}

	destoryNotebookDocument(viewType: string, notebook: INotebookTextModel): void {
		this._onWillDisposeDocument(notebook);
	}

	updateActiveNotebookEditor(editor: INotebookEditor | null) {
		this._onDidChangeActiveEditor.fire(editor ? editor.getId() : null);
	}

	updateVisibleNotebookEditor(editors: string[]) {
		const alreadyCreated = editors.filter(editorId => this._notebookEditors.has(editorId));
		this._onDidChangeVisibleEditors.fire(alreadyCreated);
	}

	setToCopy(items: NotebookCellTextModel[]) {
		this.cutItems = items;
	}

	getToCopy(): NotebookCellTextModel[] | undefined {
		return this.cutItems;
	}

	async save(viewType: string, resource: URI, token: CancellationToken): Promise<boolean> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.save(resource, token);
		}

		return false;
	}

	async saveAs(viewType: string, resource: URI, target: URI, token: CancellationToken): Promise<boolean> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.saveAs(resource, target, token);
		}

		return false;
	}

	onDidReceiveMessage(viewType: string, editorId: string, message: any): void {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.onDidReceiveMessage(editorId, message);
		}
	}

	private _onWillDisposeDocument(model: INotebookTextModel): void {
		let modelId = MODEL_ID(model.uri);

		let modelData = this._models.get(modelId);
		this._models.delete(modelId);

		if (modelData) {
			// delete editors and documents
			const willRemovedEditors: INotebookEditor[] = [];
			this._notebookEditors.forEach(editor => {
				if (editor.textModel === modelData!.model) {
					willRemovedEditors.push(editor);
				}
			});

			willRemovedEditors.forEach(e => this._notebookEditors.delete(e.getId()));

			let provider = this._notebookProviders.get(modelData!.model.viewType);

			if (provider) {
				provider.controller.removeNotebookDocument(modelData!.model);
			}


			this._onNotebookEditorsRemove.fire(willRemovedEditors.map(e => e));
			this._onNotebookDocumentRemove.fire([modelData.model.uri]);
			modelData?.dispose();
		}
	}
}
