/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { memoize } from 'vs/base/common/decorators';
import { Lazy } from 'vs/base/common/lazy';
import { UnownedDisposable } from 'vs/base/common/lifecycle';
import { basename } from 'vs/base/common/path';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IEditorModel } from 'vs/platform/editor/common/editor';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { GroupIdentifier, IEditorInput, IRevertOptions, ISaveOptions, Verbosity } from 'vs/workbench/common/editor';
import { ICustomEditorModel, ICustomEditorService } from 'vs/workbench/contrib/customEditor/common/customEditor';
import { WebviewEditorOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { IWebviewWorkbenchService, LazilyResolvedWebviewEditorInput } from 'vs/workbench/contrib/webview/browser/webviewWorkbenchService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export class CustomFileEditorInput extends LazilyResolvedWebviewEditorInput {

	public static typeId = 'workbench.editors.webviewEditor';

	private readonly _editorResource: URI;
	private _model?: ICustomEditorModel;

	constructor(
		resource: URI,
		viewType: string,
		id: string,
		webview: Lazy<UnownedDisposable<WebviewEditorOverlay>>,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IWebviewWorkbenchService webviewWorkbenchService: IWebviewWorkbenchService,
		@ILabelService private readonly labelService: ILabelService,
		@ICustomEditorService private readonly customEditorService: ICustomEditorService,
		@IEditorService private readonly editorService: IEditorService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
	) {
		super(id, viewType, '', webview, webviewWorkbenchService, lifecycleService);
		this._editorResource = resource;
	}

	public getTypeId(): string {
		return CustomFileEditorInput.typeId;
	}

	public getResource(): URI {
		return this._editorResource;
	}

	@memoize
	getName(): string {
		return basename(this.labelService.getUriLabel(this.getResource()));
	}

	@memoize
	getDescription(): string | undefined {
		return super.getDescription();
	}

	matches(other: IEditorInput): boolean {
		return this === other || (other instanceof CustomFileEditorInput
			&& this.viewType === other.viewType
			&& isEqual(this.getResource(), other.getResource()));
	}

	@memoize
	private get shortTitle(): string {
		return this.getName();
	}

	@memoize
	private get mediumTitle(): string {
		return this.labelService.getUriLabel(this.getResource(), { relative: true });
	}

	@memoize
	private get longTitle(): string {
		return this.labelService.getUriLabel(this.getResource());
	}

	public getTitle(verbosity?: Verbosity): string {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.shortTitle;
			default:
			case Verbosity.MEDIUM:
				return this.mediumTitle;
			case Verbosity.LONG:
				return this.longTitle;
		}
	}

	public isReadonly(): boolean {
		return false;
	}

	public isDirty(): boolean {
		return this._model ? this._model.isDirty() : false;
	}

	public save(groupId: GroupIdentifier, options?: ISaveOptions): Promise<boolean> {
		return this._model ? this._model.save(options) : Promise.resolve(false);
	}

	public async saveAs(groupId: GroupIdentifier, options?: ISaveOptions): Promise<boolean> {
		if (!this._model) {
			return false;
		}

		// Preserve view state by opening the editor first. In addition
		// this allows the user to review the contents of the editor.
		// let viewState: IEditorViewState | undefined = undefined;
		// const editor = await this.editorService.openEditor(this, undefined, group);
		// if (isTextEditor(editor)) {
		// 	viewState = editor.getViewState();
		// }

		let dialogPath = this._editorResource;
		// if (this._editorResource.scheme === Schemas.untitled) {
		// 	dialogPath = this.suggestFileName(resource);
		// }

		const target = await this.promptForPath(this._editorResource, dialogPath, options?.availableFileSystems);
		if (!target) {
			return false; // save cancelled
		}

		await this._model.saveAs(this._editorResource, target, options);

		return true;
	}

	public revert(options?: IRevertOptions): Promise<boolean> {
		return this._model ? this._model.revert(options) : Promise.resolve(false);
	}

	public async resolve(): Promise<IEditorModel> {
		this._model = await this.customEditorService.models.loadOrCreate(this.getResource(), this.viewType);
		this._register(this._model.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
		return await super.resolve();
	}

	protected async promptForPath(resource: URI, defaultUri: URI, availableFileSystems?: readonly string[]): Promise<URI | undefined> {

		// Help user to find a name for the file by opening it first
		await this.editorService.openEditor({ resource, options: { revealIfOpened: true, preserveFocus: true } });

		return this.fileDialogService.pickFileToSave({});//this.getSaveDialogOptions(defaultUri, availableFileSystems));
	}
}
