/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { INotebookKernel, INotebookTextModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookKernelBindEvent, INotebookKernelService, INotebookTextModelLike } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { score } from 'vs/workbench/contrib/notebook/common/notebookSelector';
import { LRUCache } from 'vs/base/common/map';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { URI } from 'vs/base/common/uri';
import { runWhenIdle } from 'vs/base/common/async';
import { ILogService } from 'vs/platform/log/common/log';
import { isEqual } from 'vs/base/common/resources';

interface IKernelInfo {
	kernel: INotebookKernel;
	score: number;
}

class ScoreInfo {
	constructor(private readonly _anchor: INotebookTextModelLike) { }

	equals(candidate: INotebookTextModelLike): boolean {
		return this._anchor.viewType === candidate.viewType && isEqual(this._anchor.uri, candidate.uri);
	}
}

export class NotebookKernelService implements INotebookKernelService {

	declare _serviceBrand: undefined;

	private static _storageKey = 'notebook.kernelBindings';

	private readonly _kernels = new Map<string, IKernelInfo>();
	private readonly _kernelBindings = new LRUCache<string, string>(1000, 0.7);
	private _scoreInfo?: ScoreInfo;

	private readonly _onDidChangeNotebookKernelBinding = new Emitter<INotebookKernelBindEvent>();
	private readonly _onDidAddKernel = new Emitter<INotebookKernel>();
	private readonly _onDidRemoveKernel = new Emitter<INotebookKernel>();

	readonly onDidChangeNotebookKernelBinding: Event<INotebookKernelBindEvent> = this._onDidChangeNotebookKernelBinding.event;
	readonly onDidAddKernel: Event<INotebookKernel> = this._onDidAddKernel.event;
	readonly onDidRemoveKernel: Event<INotebookKernel> = this._onDidRemoveKernel.event;

	constructor(
		@IStorageService private _storageService: IStorageService,
		@ILogService logService: ILogService,
	) {

		try {
			const value = _storageService.get(NotebookKernelService._storageKey, StorageScope.WORKSPACE, '[]');
			const data = JSON.parse(value);
			this._kernelBindings.fromJSON(data);
		} catch {
			logService.warn('FAILED to restore kernel bindings');
		}
	}

	private _persistBindings(): void {
		runWhenIdle(() => {
			const raw = JSON.stringify(this._kernelBindings);
			this._storageService.store(NotebookKernelService._storageKey, raw, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}, 100);
	}

	dispose() {
		this._onDidChangeNotebookKernelBinding.dispose();
		this._onDidAddKernel.dispose();
		this._onDidRemoveKernel.dispose();
		this._kernels.clear();
	}

	registerKernel(kernel: INotebookKernel): IDisposable {
		if (this._kernels.has(kernel.id)) {
			throw new Error(`NOTEBOOK CONTROLLER with id '${kernel.id}' already exists`);
		}

		this._scoreInfo = undefined;
		this._kernels.set(kernel.id, { kernel, score: -1 });
		this._onDidAddKernel.fire(kernel);

		return toDisposable(() => {
			this._scoreInfo = undefined;
			if (this._kernels.delete(kernel.id)) {
				this._onDidRemoveKernel.fire(kernel);
			}
			for (let [uri, candidate] of Array.from(this._kernelBindings)) {
				if (candidate === kernel.id) {
					this._kernelBindings.delete(uri);
					this._onDidChangeNotebookKernelBinding.fire({ notebook: URI.parse(uri), oldKernel: kernel.id, newKernel: undefined });
				}
			}
		});
	}

	getNotebookKernels(notebook: INotebookTextModelLike): { bound: INotebookKernel | undefined, all: INotebookKernel[] } {

		// update score if needed
		if (!this._scoreInfo?.equals(notebook)) {
			for (let item of this._kernels.values()) {
				item.score = score(item.kernel.selector, notebook.uri, notebook.viewType);
			}
			this._scoreInfo = new ScoreInfo(notebook);
		}

		// all applicable kernels
		const all = Array.from(this._kernels.values())
			.filter(item => item.score > 0)
			.sort((a, b) => {
				// (1) sort by preference
				if (a.kernel.isPreferred !== b.kernel.isPreferred) {
					if (a.kernel.isPreferred) {
						return -1;
					} else {
						return 1;
					}
				}
				// (2) sort by score
				if (b.score !== a.score) {
					return b.score - a.score;
				}
				// (3) sort by name
				return a.kernel.label.localeCompare(b.kernel.label);
			})
			.map(item => item.kernel);

		// bound kernel
		const boundId = this._kernelBindings.get(notebook.uri.toString());
		const bound = boundId ? this._kernels.get(boundId)?.kernel : undefined;

		return { all, bound };
	}

	// a notebook has one kernel, a kernel has N notebooks
	// notebook <-1----N-> kernel
	updateNotebookKernelBinding(notebook: INotebookTextModel, kernel: INotebookKernel | undefined): void {
		const key = notebook.uri.toString();
		const oldKernel = this._kernelBindings.get(key);
		if (oldKernel !== kernel) {
			if (kernel) {
				this._kernelBindings.set(key, kernel.id);
			} else {
				this._kernelBindings.delete(key);
			}
			this._onDidChangeNotebookKernelBinding.fire({ notebook: notebook.uri, oldKernel, newKernel: kernel?.id });
			this._persistBindings();
		}
	}
}
