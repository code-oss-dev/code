/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorDescriptor, Extensions as EditorExtensions, IEditorRegistry } from 'vs/workbench/browser/editor';
import { NotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { IEditorService, IOpenEditorOverride } from 'vs/workbench/services/editor/common/editorService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { IEditorInput } from 'vs/workbench/common/editor';
import { IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { endsWith } from 'vs/base/common/strings';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		NotebookEditor,
		NotebookEditor.ID,
		'Notebook Editor'
	),
	[
		new SyncDescriptor(NotebookEditorInput)
	]
);

export class NotebookContribution implements IWorkbenchContribution {
	private _resourceMapping: Map<string, NotebookEditorInput> = new Map<string, NotebookEditorInput>();

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService

	) {
		this.editorService.overrideOpenEditor((editor, options, group) => this.onEditorOpening(editor, options, group));
	}

	private onEditorOpening(editor: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup): IOpenEditorOverride | undefined {
		const resource = editor.getResource();

		if (
			!resource ||
			!endsWith(resource.path, '.ipynb')
		) {
			return undefined;
		}

		if (this._resourceMapping.has(resource.path)) {
			const input = this._resourceMapping.get(resource.path);

			return { override: this.editorService.openEditor(input!, options, group) };
		}

		const input = this.instantiationService.createInstance(NotebookEditorInput, editor);
		this._resourceMapping.set(resource.path, input);

		return { override: this.editorService.openEditor(input, { ...options, ignoreOverrides: true }, group) };
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(NotebookContribution, LifecyclePhase.Starting);
