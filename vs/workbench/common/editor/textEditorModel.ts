/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel, ITextBufferFactory, ITextSnapshot } from 'vs/editor/common/model';
import { EditorModel, IModeSupport } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { ITextEditorModel, IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';
import { IModeService, ILanguageSelection } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IDisposable } from 'vs/base/common/lifecycle';
import { PLAINTEXT_MODE_ID } from 'vs/editor/common/modes/modesRegistry';

/**
 * The base text editor model leverages the code editor model. This class is only intended to be subclassed and not instantiated.
 */
export abstract class BaseTextEditorModel extends EditorModel implements ITextEditorModel, IModeSupport {
	protected textEditorModelHandle: URI | null;
	private createdEditorModel: boolean;

	private modelDisposeListener: IDisposable | null;

	constructor(
		@IModelService protected modelService: IModelService,
		@IModeService protected modeService: IModeService,
		textEditorModelHandle?: URI
	) {
		super();

		if (textEditorModelHandle) {
			this.handleExistingModel(textEditorModelHandle);
		}
	}

	private handleExistingModel(textEditorModelHandle: URI): void {

		// We need the resource to point to an existing model
		const model = this.modelService.getModel(textEditorModelHandle);
		if (!model) {
			throw new Error(`Document with resource ${textEditorModelHandle.toString()} does not exist`);
		}

		this.textEditorModelHandle = textEditorModelHandle;

		// Make sure we clean up when this model gets disposed
		this.registerModelDisposeListener(model);
	}

	private registerModelDisposeListener(model: ITextModel): void {
		if (this.modelDisposeListener) {
			this.modelDisposeListener.dispose();
		}

		this.modelDisposeListener = model.onWillDispose(() => {
			this.textEditorModelHandle = null; // make sure we do not dispose code editor model again
			this.dispose();
		});
	}

	get textEditorModel(): ITextModel | null {
		return this.textEditorModelHandle ? this.modelService.getModel(this.textEditorModelHandle) : null;
	}

	abstract isReadonly(): boolean;

	setMode(mode: string): void {
		if (!this.isResolved()) {
			return;
		}

		if (!mode || mode === this.textEditorModel.getModeId()) {
			return;
		}

		this.modelService.setMode(this.textEditorModel, this.modeService.create(mode));
	}

	/**
	 * Creates the text editor model with the provided value, optional preferred mode
	 * (can be comma separated for multiple values) and optional resource URL.
	 */
	protected createTextEditorModel(value: ITextBufferFactory, resource: URI | undefined, preferredMode?: string): EditorModel {
		const firstLineText = this.getFirstLineText(value);
		const languageSelection = this.getOrCreateMode(resource, this.modeService, preferredMode, firstLineText);

		return this.doCreateTextEditorModel(value, languageSelection, resource);
	}

	private doCreateTextEditorModel(value: ITextBufferFactory, languageSelection: ILanguageSelection, resource: URI | undefined): EditorModel {
		let model = resource && this.modelService.getModel(resource);
		if (!model) {
			model = this.modelService.createModel(value, languageSelection, resource);
			this.createdEditorModel = true;

			// Make sure we clean up when this model gets disposed
			this.registerModelDisposeListener(model);
		} else {
			this.updateTextEditorModel(value, languageSelection.languageIdentifier.language);
		}

		this.textEditorModelHandle = model.uri;

		return this;
	}

	protected getFirstLineText(value: ITextBufferFactory | ITextModel): string {

		// text buffer factory
		const textBufferFactory = value as ITextBufferFactory;
		if (typeof textBufferFactory.getFirstLineText === 'function') {
			return textBufferFactory.getFirstLineText(100);
		}

		// text model
		const textSnapshot = value as ITextModel;
		return textSnapshot.getLineContent(1).substr(0, 100);
	}

	/**
	 * Gets the mode for the given identifier. Subclasses can override to provide their own implementation of this lookup.
	 *
	 * @param firstLineText optional first line of the text buffer to set the mode on. This can be used to guess a mode from content.
	 */
	protected getOrCreateMode(resource: URI | undefined, modeService: IModeService, preferredMode: string | undefined, firstLineText?: string): ILanguageSelection {

		// lookup mode via resource path if the provided mode is unspecific
		if (!preferredMode || preferredMode === PLAINTEXT_MODE_ID) {
			return modeService.createByFilepathOrFirstLine(resource ? resource.fsPath : null, firstLineText);
		}

		// otherwise take the preferred mode for granted
		return modeService.create(preferredMode);
	}

	/**
	 * Updates the text editor model with the provided value. If the value is the same as the model has, this is a no-op.
	 */
	protected updateTextEditorModel(newValue: ITextBufferFactory, preferredMode?: string): void {
		if (!this.isResolved()) {
			return;
		}

		// contents
		this.modelService.updateModel(this.textEditorModel, newValue);

		// mode (only if specific and changed)
		if (preferredMode && preferredMode !== PLAINTEXT_MODE_ID && this.textEditorModel.getModeId() !== preferredMode) {
			this.modelService.setMode(this.textEditorModel, this.modeService.create(preferredMode));
		}
	}

	createSnapshot(this: IResolvedTextEditorModel): ITextSnapshot;
	createSnapshot(this: ITextEditorModel): ITextSnapshot | null;
	createSnapshot(): ITextSnapshot | null {
		if (!this.textEditorModel) {
			return null;
		}

		return this.textEditorModel.createSnapshot(true /* preserve BOM */);
	}

	isResolved(): this is IResolvedTextEditorModel {
		return !!this.textEditorModelHandle;
	}

	dispose(): void {
		if (this.modelDisposeListener) {
			this.modelDisposeListener.dispose(); // dispose this first because it will trigger another dispose() otherwise
			this.modelDisposeListener = null;
		}

		if (this.textEditorModelHandle && this.createdEditorModel) {
			this.modelService.destroyModel(this.textEditorModelHandle);
		}

		this.textEditorModelHandle = null;
		this.createdEditorModel = false;

		super.dispose();
	}
}
