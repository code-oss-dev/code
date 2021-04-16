/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ExtHostNotebookKernelsShape, IMainContext, INotebookKernelDto2, MainContext, MainThreadNotebookKernelsShape } from 'vs/workbench/api/common/extHost.protocol';
import * as vscode from 'vscode';
import { ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import * as extHostTypeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { asWebviewUri } from 'vs/workbench/api/common/shared/webview';

interface IKernelData {
	extensionId: ExtensionIdentifier,
	controller: vscode.NotebookController;
	onDidChangeSelection: Emitter<{ selected: boolean; notebook: vscode.NotebookDocument; }>;
	onDidReceiveMessage: Emitter<{ editor: vscode.NotebookEditor, message: any }>;
}

export class ExtHostNotebookKernels implements ExtHostNotebookKernelsShape {

	private readonly _proxy: MainThreadNotebookKernelsShape;

	private readonly _kernelData = new Map<number, IKernelData>();
	private _handlePool: number = 0;

	constructor(
		mainContext: IMainContext,
		private readonly _initData: IExtHostInitDataService,
		private readonly _extHostNotebook: ExtHostNotebookController
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadNotebookKernels);
	}

	createNotebookController(extension: IExtensionDescription, options: vscode.NotebookControllerOptions): vscode.NotebookController {

		for (let data of this._kernelData.values()) {
			if (data.controller.id === options.id) {
				throw new Error(`notebook controller with id '${options.id}' ALREADY exist`);
			}
		}

		const handle = this._handlePool++;
		const that = this;

		let isDisposed = false;
		const commandDisposables = new DisposableStore();

		const onDidChangeSelection = new Emitter<{ selected: boolean, notebook: vscode.NotebookDocument }>();
		const onDidReceiveMessage = new Emitter<{ editor: vscode.NotebookEditor, message: any }>();

		const data: INotebookKernelDto2 = {
			id: options.id,
			selector: options.selector,
			extensionId: extension.identifier,
			extensionLocation: extension.extensionLocation,
			label: options.label,
			supportedLanguages: [],
			preloads: options.preloads ? options.preloads.map(extHostTypeConverters.NotebookKernelPreload.from) : []
		};

		//
		let _executeHandler = options.executeHandler;
		let _interruptHandler = options.interruptHandler;

		// todo@jrieken the selector needs to be massaged
		this._proxy.$addKernel(handle, data).catch(err => {
			// this can happen when a kernel with that ID is already registered
			console.log(err);
			isDisposed = true;
		});

		// update: all setters write directly into the dto object
		// and trigger an update. the actual update will only happen
		// once per event loop execution
		let tokenPool = 0;
		const _update = () => {
			if (isDisposed) {
				return;
			}
			const myToken = ++tokenPool;
			Promise.resolve().then(() => {
				if (myToken === tokenPool) {
					this._proxy.$updateKernel(handle, data);
				}
			});
		};

		const controller: vscode.NotebookController = {
			get id() { return data.id; },
			get selector() { return data.selector; },
			onDidChangeNotebookAssociation: onDidChangeSelection.event,
			get label() {
				return data.label;
			},
			set label(value) {
				data.label = value;
				_update();
			},
			get description() {
				return data.description ?? '';
			},
			set description(value) {
				data.description = value;
				_update();
			},
			get isPreferred() {
				return data.isPreferred ?? false;
			},
			set isPreferred(value) {
				data.isPreferred = value;
				_update();
			},
			get supportedLanguages() {
				return data.supportedLanguages;
			},
			set supportedLanguages(value) {
				data.supportedLanguages = isNonEmptyArray(value) ? value : ['plaintext'];
				_update();
			},
			get hasExecutionOrder() {
				return data.hasExecutionOrder ?? false;
			},
			set hasExecutionOrder(value) {
				data.hasExecutionOrder = value;
				_update();
			},
			get preloads() {
				return data.preloads ? data.preloads.map(extHostTypeConverters.NotebookKernelPreload.to) : [];
			},
			get executeHandler() {
				return _executeHandler;
			},
			set executeHandler(value) {
				_executeHandler = value ?? (() => console.warn(`NO execute handler from notebook controller '${data.id}' of extension: '${extension.identifier}'`));
			},
			get interruptHandler() {
				return _interruptHandler;
			},
			set interruptHandler(value) {
				_interruptHandler = value;
				data.supportsInterrupt = Boolean(value);
				_update();
			},
			createNotebookCellExecutionTask(cell) {
				if (isDisposed) {
					throw new Error('notebook controller is DISPOSED');
				}
				//todo@jrieken
				return that._extHostNotebook.createNotebookCellExecution(cell.notebook.uri, cell.index, data.id)!;
			},
			dispose: () => {
				if (!isDisposed) {
					isDisposed = true;
					this._kernelData.delete(handle);
					commandDisposables.dispose();
					onDidChangeSelection.dispose();
					onDidReceiveMessage.dispose();
					this._proxy.$removeKernel(handle);
				}
			},
			// --- ipc
			onDidReceiveMessage: onDidReceiveMessage.event,
			postMessage(message, editor) {
				return that._proxy.$postMessage(handle, editor && that._extHostNotebook.getIdByEditor(editor), message);
			},
			asWebviewUri(uri: URI) {
				return asWebviewUri(that._initData.environment, data.id, uri);
			}
		};

		this._kernelData.set(handle, { extensionId: extension.identifier, controller, onDidChangeSelection, onDidReceiveMessage });

		controller.supportedLanguages = options.supportedLanguages ?? [];
		controller.executeHandler = options.executeHandler;
		controller.interruptHandler = options.interruptHandler;
		controller.hasExecutionOrder = options.hasExecutionOrder ?? false;

		return controller;
	}

	$acceptSelection(handle: number, uri: UriComponents, value: boolean): void {
		const obj = this._kernelData.get(handle);
		if (obj) {
			obj.onDidChangeSelection.fire({
				selected: value,
				notebook: this._extHostNotebook.lookupNotebookDocument(URI.revive(uri))!.notebookDocument
			});
		}
	}

	$executeCells(handle: number, uri: UriComponents, ranges: ICellRange[]): void {
		const obj = this._kernelData.get(handle);
		if (!obj) {
			// extension can dispose kernels in the meantime
			return;
		}
		const document = this._extHostNotebook.lookupNotebookDocument(URI.revive(uri));
		if (!document) {
			throw new Error('MISSING notebook');
		}

		const cells: vscode.NotebookCell[] = [];
		for (let range of ranges) {
			cells.push(...document.notebookDocument.getCells(extHostTypeConverters.NotebookRange.to(range)));
		}

		try {
			obj.controller.executeHandler.call(obj.controller, cells, obj.controller);
		} catch (err) {
			//
			console.error(err);
		}
	}

	$cancelCells(handle: number, uri: UriComponents, ranges: ICellRange[]): void {
		const obj = this._kernelData.get(handle);
		if (!obj) {
			// extension can dispose kernels in the meantime
			return;
		}
		const document = this._extHostNotebook.lookupNotebookDocument(URI.revive(uri));
		if (!document) {
			throw new Error('MISSING notebook');
		}
		if (obj.controller.interruptHandler) {
			obj.controller.interruptHandler.call(obj.controller);
		}

		// we do both? interrupt and cancellation or should we be selective?
		for (const range of ranges) {
			for (let i = range.start; i < range.end; i++) {
				const cell = document.getCellFromIndex(i);
				if (cell) {
					this._extHostNotebook.cancelOneNotebookCellExecution(cell);
				}
			}
		}
	}

	$acceptRendererMessage(handle: number, editorId: string, message: any): void {
		const obj = this._kernelData.get(handle);
		if (!obj) {
			// extension can dispose kernels in the meantime
			return;
		}

		const editor = this._extHostNotebook.getEditorById(editorId);
		if (!editor) {
			throw new Error(`send message for UNKNOWN editor: ${editorId}`);
		}

		obj.onDidReceiveMessage.fire(Object.freeze({ editor: editor.apiEditor, message }));
	}
}
