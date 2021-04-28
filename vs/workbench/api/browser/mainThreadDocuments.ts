/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toErrorMessage } from 'vs/base/common/errorMessage';
import { IReference, dispose, Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService, shouldSynchronizeModel } from 'vs/editor/common/services/modelService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IFileService, FileOperation } from 'vs/platform/files/common/files';
import { MainThreadDocumentsAndEditors } from 'vs/workbench/api/browser/mainThreadDocumentsAndEditors';
import { ExtHostContext, ExtHostDocumentsShape, IExtHostContext, MainThreadDocumentsShape } from 'vs/workbench/api/common/extHost.protocol';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { toLocalResource, extUri, IExtUri } from 'vs/base/common/resources';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { Emitter } from 'vs/base/common/event';
import { IPathService } from 'vs/workbench/services/path/common/pathService';

export class BoundModelReferenceCollection {

	private _data = new Array<{ uri: URI, length: number, dispose(): void }>();
	private _length = 0;

	constructor(
		private readonly _extUri: IExtUri,
		private readonly _maxAge: number = 1000 * 60 * 3,
		private readonly _maxLength: number = 1024 * 1024 * 80,
	) {
		//
	}

	dispose(): void {
		this._data = dispose(this._data);
	}

	remove(uri: URI): void {
		for (const entry of [...this._data] /* copy array because dispose will modify it */) {
			if (this._extUri.isEqualOrParent(entry.uri, uri)) {
				entry.dispose();
			}
		}
	}

	add(uri: URI, ref: IReference<any>, length: number = 0): void {
		// const length = ref.object.textEditorModel.getValueLength();
		let handle: any;
		let entry: { uri: URI, length: number, dispose(): void };
		const dispose = () => {
			const idx = this._data.indexOf(entry);
			if (idx >= 0) {
				this._length -= length;
				ref.dispose();
				clearTimeout(handle);
				this._data.splice(idx, 1);
			}
		};
		handle = setTimeout(dispose, this._maxAge);
		entry = { uri, length, dispose };

		this._data.push(entry);
		this._length += length;
		this._cleanup();
	}

	private _cleanup(): void {
		while (this._length > this._maxLength) {
			this._data[0].dispose();
		}
	}
}

class ModelTracker extends Disposable {

	private _knownVersionId: number;

	constructor(
		private readonly _model: ITextModel,
		private readonly _onIsCaughtUpWithContentChanges: Emitter<URI>,
		private readonly _proxy: ExtHostDocumentsShape,
		private readonly _textFileService: ITextFileService,
	) {
		super();
		this._knownVersionId = this._model.getVersionId();
		this._register(this._model.onDidChangeContent((e) => {
			this._knownVersionId = e.versionId;
			this._proxy.$acceptModelChanged(this._model.uri, e, this._textFileService.isDirty(this._model.uri));
			if (this.isCaughtUpWithContentChanges()) {
				this._onIsCaughtUpWithContentChanges.fire(this._model.uri);
			}
		}));
	}

	public isCaughtUpWithContentChanges(): boolean {
		return (this._model.getVersionId() === this._knownVersionId);
	}
}

export class MainThreadDocuments extends Disposable implements MainThreadDocumentsShape {

	private _onIsCaughtUpWithContentChanges = this._register(new Emitter<URI>());
	public readonly onIsCaughtUpWithContentChanges = this._onIsCaughtUpWithContentChanges.event;

	private readonly _modelService: IModelService;
	private readonly _textModelResolverService: ITextModelService;
	private readonly _textFileService: ITextFileService;
	private readonly _fileService: IFileService;
	private readonly _environmentService: IWorkbenchEnvironmentService;
	private readonly _uriIdentityService: IUriIdentityService;

	private _modelTrackers: { [modelUrl: string]: ModelTracker; };
	private readonly _proxy: ExtHostDocumentsShape;
	private readonly _modelIsSynced = new Set<string>();
	private readonly _modelReferenceCollection: BoundModelReferenceCollection;

	constructor(
		documentsAndEditors: MainThreadDocumentsAndEditors,
		extHostContext: IExtHostContext,
		@IModelService modelService: IModelService,
		@ITextFileService textFileService: ITextFileService,
		@IFileService fileService: IFileService,
		@ITextModelService textModelResolverService: ITextModelService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IPathService private readonly _pathService: IPathService
	) {
		super();
		this._modelService = modelService;
		this._textModelResolverService = textModelResolverService;
		this._textFileService = textFileService;
		this._fileService = fileService;
		this._environmentService = environmentService;
		this._uriIdentityService = uriIdentityService;

		this._modelReferenceCollection = this._register(new BoundModelReferenceCollection(uriIdentityService.extUri));

		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostDocuments);

		this._register(documentsAndEditors.onDocumentAdd(models => models.forEach(this._onModelAdded, this)));
		this._register(documentsAndEditors.onDocumentRemove(urls => urls.forEach(this._onModelRemoved, this)));
		this._register(modelService.onModelModeChanged(this._onModelModeChanged, this));

		this._register(textFileService.files.onDidSave(e => {
			if (this._shouldHandleFileEvent(e.model.resource)) {
				this._proxy.$acceptModelSaved(e.model.resource);
			}
		}));
		this._register(textFileService.files.onDidChangeDirty(m => {
			if (this._shouldHandleFileEvent(m.resource)) {
				this._proxy.$acceptDirtyStateChanged(m.resource, m.isDirty());
			}
		}));

		this._register(fileService.onDidRunOperation(e => {
			const isMove = e.isOperation(FileOperation.MOVE);
			if (isMove || e.isOperation(FileOperation.DELETE)) {
				const removed = isMove ? e.target?.resource : e.resource;
				if (removed) {
					this._modelReferenceCollection.remove(removed);
				}
			}
		}));

		this._modelTrackers = Object.create(null);
	}

	public override dispose(): void {
		Object.keys(this._modelTrackers).forEach((modelUrl) => {
			this._modelTrackers[modelUrl].dispose();
		});
		this._modelTrackers = Object.create(null);
		super.dispose();
	}

	public isCaughtUpWithContentChanges(resource: URI): boolean {
		const modelUrl = resource.toString();
		if (this._modelTrackers[modelUrl]) {
			return this._modelTrackers[modelUrl].isCaughtUpWithContentChanges();
		}
		return true;
	}

	private _shouldHandleFileEvent(resource: URI): boolean {
		const model = this._modelService.getModel(resource);
		return !!model && shouldSynchronizeModel(model);
	}

	private _onModelAdded(model: ITextModel): void {
		// Same filter as in mainThreadEditorsTracker
		if (!shouldSynchronizeModel(model)) {
			// don't synchronize too large models
			return;
		}
		const modelUrl = model.uri;
		this._modelIsSynced.add(modelUrl.toString());
		this._modelTrackers[modelUrl.toString()] = new ModelTracker(model, this._onIsCaughtUpWithContentChanges, this._proxy, this._textFileService);
	}

	private _onModelModeChanged(event: { model: ITextModel; oldModeId: string; }): void {
		let { model } = event;
		const modelUrl = model.uri;
		if (!this._modelIsSynced.has(modelUrl.toString())) {
			return;
		}
		this._proxy.$acceptModelModeChanged(model.uri, model.getLanguageIdentifier().language);
	}

	private _onModelRemoved(modelUrl: URI): void {
		const strModelUrl = modelUrl.toString();
		if (!this._modelIsSynced.has(strModelUrl)) {
			return;
		}
		this._modelIsSynced.delete(strModelUrl);
		this._modelTrackers[strModelUrl].dispose();
		delete this._modelTrackers[strModelUrl];
	}

	// --- from extension host process

	$trySaveDocument(uri: UriComponents): Promise<boolean> {
		return this._textFileService.save(URI.revive(uri)).then(target => !!target);
	}

	$tryOpenDocument(uriData: UriComponents): Promise<URI> {
		const inputUri = URI.revive(uriData);
		if (!inputUri.scheme || !(inputUri.fsPath || inputUri.authority)) {
			return Promise.reject(new Error(`Invalid uri. Scheme and authority or path must be set.`));
		}

		const canonicalUri = this._uriIdentityService.asCanonicalUri(inputUri);

		let promise: Promise<URI>;
		switch (canonicalUri.scheme) {
			case Schemas.untitled:
				promise = this._handleUntitledScheme(canonicalUri);
				break;
			case Schemas.file:
			default:
				promise = this._handleAsResourceInput(canonicalUri);
				break;
		}

		return promise.then(documentUri => {
			if (!documentUri) {
				return Promise.reject(new Error(`cannot open ${canonicalUri.toString()}`));
			} else if (!extUri.isEqual(documentUri, canonicalUri)) {
				return Promise.reject(new Error(`cannot open ${canonicalUri.toString()}. Detail: Actual document opened as ${documentUri.toString()}`));
			} else if (!this._modelIsSynced.has(canonicalUri.toString())) {
				return Promise.reject(new Error(`cannot open ${canonicalUri.toString()}. Detail: Files above 50MB cannot be synchronized with extensions.`));
			} else {
				return canonicalUri;
			}
		}, err => {
			return Promise.reject(new Error(`cannot open ${canonicalUri.toString()}. Detail: ${toErrorMessage(err)}`));
		});
	}

	$tryCreateDocument(options?: { language?: string, content?: string }): Promise<URI> {
		return this._doCreateUntitled(undefined, options ? options.language : undefined, options ? options.content : undefined);
	}

	private _handleAsResourceInput(uri: URI): Promise<URI> {
		return this._textModelResolverService.createModelReference(uri).then(ref => {
			this._modelReferenceCollection.add(uri, ref, ref.object.textEditorModel.getValueLength());
			return ref.object.textEditorModel.uri;
		});
	}

	private _handleUntitledScheme(uri: URI): Promise<URI> {
		const asLocalUri = toLocalResource(uri, this._environmentService.remoteAuthority, this._pathService.defaultUriScheme);
		return this._fileService.resolve(asLocalUri).then(stats => {
			// don't create a new file ontop of an existing file
			return Promise.reject(new Error('file already exists'));
		}, err => {
			return this._doCreateUntitled(Boolean(uri.path) ? uri : undefined);
		});
	}

	private _doCreateUntitled(associatedResource?: URI, mode?: string, initialValue?: string): Promise<URI> {
		return this._textFileService.untitled.resolve({
			associatedResource,
			mode,
			initialValue
		}).then(model => {
			const resource = model.resource;

			if (!this._modelIsSynced.has(resource.toString())) {
				throw new Error(`expected URI ${resource.toString()} to have come to LIFE`);
			}

			this._proxy.$acceptDirtyStateChanged(resource, true); // mark as dirty

			return resource;
		});
	}
}
