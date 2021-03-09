/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { EditorInput, IEditorInput, GroupIdentifier, ISaveOptions, IMoveResult, IRevertOptions } from 'vs/workbench/common/editor';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { URI } from 'vs/base/common/uri';
import { isEqual, joinPath } from 'vs/base/common/resources';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INotebookEditorModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';
import { IReference } from 'vs/base/common/lifecycle';
import { IResolvedNotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ILabelService } from 'vs/platform/label/common/label';

interface NotebookEditorInputOptions {
	startDirty?: boolean;
}

export class NotebookEditorInput extends EditorInput {

	static create(instantiationService: IInstantiationService, resource: URI, viewType: string, options: NotebookEditorInputOptions = {}) {
		return instantiationService.createInstance(NotebookEditorInput, resource, viewType, options);
	}

	static readonly ID: string = 'workbench.input.notebook';

	private readonly _name: string;

	private _textModel: IReference<IResolvedNotebookEditorModel> | null = null;
	private _defaultDirtyState: boolean = false;

	constructor(
		public readonly resource: URI,
		public readonly viewType: string,
		public readonly options: NotebookEditorInputOptions,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookEditorModelResolverService private readonly _notebookModelResolverService: INotebookEditorModelResolverService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILabelService labelService: ILabelService,
	) {
		super();
		this._defaultDirtyState = !!options.startDirty;
		this._name = labelService.getUriBasenameLabel(resource);
	}

	getTypeId(): string {
		return NotebookEditorInput.ID;
	}

	getName(): string {
		return this._name;
	}

	isDirty() {
		if (!this._textModel) {
			return !!this._defaultDirtyState;
		}
		return this._textModel.object.isDirty();
	}

	isUntitled(): boolean {
		return this._textModel?.object.isUntitled() || false;
	}

	isReadonly() {
		return false;
	}

	async save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (this._textModel) {

			if (this.isUntitled()) {
				return this.saveAs(group, options);
			} else {
				await this._textModel.object.save();
			}

			return this;
		}

		return undefined;
	}

	async saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (!this._textModel) {
			return undefined;
		}

		const provider = this._notebookService.getContributedNotebookProvider(this.viewType);

		if (!provider) {
			return undefined;
		}

		const dialogPath = this.isUntitled() ? await this._suggestName(this._name) : this._textModel.object.resource;

		const target = await this._fileDialogService.pickFileToSave(dialogPath, options?.availableFileSystems);
		if (!target) {
			return undefined; // save cancelled
		}

		if (!provider.matches(target)) {
			const patterns = provider.selectors.map(pattern => {
				if (typeof pattern === 'string') {
					return pattern;
				}

				if (glob.isRelativePattern(pattern)) {
					return `${pattern} (base ${pattern.base})`;
				}

				return `${pattern.include} (exclude: ${pattern.exclude})`;
			}).join(', ');
			throw new Error(`File name ${target} is not supported by ${provider.providerDisplayName}.

Please make sure the file name matches following patterns:
${patterns}
`);
		}

		if (!await this._textModel.object.saveAs(target)) {
			return undefined;
		}

		return this._move(group, target)?.editor;
	}

	private async _suggestName(suggestedFilename: string) {
		return joinPath(await this._fileDialogService.defaultFilePath(), suggestedFilename);
	}

	// called when users rename a notebook document
	rename(group: GroupIdentifier, target: URI): IMoveResult | undefined {
		if (this._textModel) {
			const contributedNotebookProviders = this._notebookService.getContributedNotebookProviders(target);

			if (contributedNotebookProviders.find(provider => provider.id === this._textModel!.object.viewType)) {
				return this._move(group, target);
			}
		}
		return undefined;
	}

	private _move(group: GroupIdentifier, newResource: URI): { editor: IEditorInput } | undefined {
		const editorInput = NotebookEditorInput.create(this._instantiationService, newResource, this.viewType);
		return { editor: editorInput };
	}

	async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		if (this._textModel && this._textModel.object.isDirty()) {
			await this._textModel.object.revert(options);
		}

		return;
	}

	async resolve(): Promise<IResolvedNotebookEditorModel | null> {
		if (!await this._notebookService.canResolve(this.viewType)) {
			return null;
		}

		if (!this._textModel) {
			this._textModel = await this._notebookModelResolverService.resolve(this.resource, this.viewType);
			if (this.isDisposed()) {
				this._textModel.dispose();
				this._textModel = null;
				return null;
			}
			this._register(this._textModel.object.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
			if (this._textModel.object.isDirty()) {
				this._onDidChangeDirty.fire();
			}
		}

		return this._textModel.object;
	}

	matches(otherInput: unknown): boolean {
		if (this === otherInput) {
			return true;
		}
		if (otherInput instanceof NotebookEditorInput) {
			return this.viewType === otherInput.viewType && isEqual(this.resource, otherInput.resource);
		}
		return false;
	}

	dispose() {
		this._textModel?.dispose();
		this._textModel = null;
		super.dispose();
	}
}
