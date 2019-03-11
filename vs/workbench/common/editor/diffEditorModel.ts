/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorModel } from 'vs/workbench/common/editor';
import { IEditorModel } from 'vs/platform/editor/common/editor';

/**
 * The base editor model for the diff editor. It is made up of two editor models, the original version
 * and the modified version.
 */
export class DiffEditorModel extends EditorModel {
	protected readonly _originalModel: IEditorModel | null;
	protected readonly _modifiedModel: IEditorModel | null;

	constructor(originalModel: IEditorModel | null, modifiedModel: IEditorModel | null) {
		super();

		this._originalModel = originalModel;
		this._modifiedModel = modifiedModel;
	}

	get originalModel(): EditorModel | null {
		if (!this._originalModel) {
			return null;
		}
		return this._originalModel as EditorModel;
	}

	get modifiedModel(): EditorModel | null {
		if (!this._modifiedModel) {
			return null;
		}
		return this._modifiedModel as EditorModel;
	}

	load(): Promise<EditorModel> {
		return Promise.all([
			this._originalModel ? this._originalModel.load() : Promise.resolve(undefined),
			this._modifiedModel ? this._modifiedModel.load() : Promise.resolve(undefined),
		]).then(() => this);
	}

	isResolved(): boolean {
		return !!this.originalModel && this.originalModel.isResolved() && !!this.modifiedModel && this.modifiedModel.isResolved();
	}

	dispose(): void {

		// Do not propagate the dispose() call to the two models inside. We never created the two models
		// (original and modified) so we can not dispose them without sideeffects. Rather rely on the
		// models getting disposed when their related inputs get disposed from the diffEditorInput.

		super.dispose();
	}
}