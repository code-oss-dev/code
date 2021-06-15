/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { AbstractResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { IResolvedNotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/common/notebookEditorInput';

export class InteractiveEditorInput extends AbstractResourceEditorInput {
	typeId: string = 'workbench.input.interactive';

	private _notebookEditorInput: NotebookEditorInput;
	get notebookEditorInput() {
		return this._notebookEditorInput;
	}

	constructor(
		resource: URI,
		preferredResource: URI | undefined,
		@ILabelService labelService: ILabelService,
		@IFileService fileService: IFileService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(resource, preferredResource, labelService, fileService);
		// do something similar to untitled file
		this._notebookEditorInput = NotebookEditorInput.create(instantiationService, URI.parse('inmem://test/test.interactive'), 'interactive', {});
	}

	override async resolve(): Promise<IResolvedNotebookEditorModel | null> {
		return this._notebookEditorInput.resolve();
	}
}
