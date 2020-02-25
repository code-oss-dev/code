/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorDescriptor, Extensions as EditorExtensions, IEditorRegistry } from 'vs/workbench/browser/editor';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { IEditorInput, IEditorInputFactoryRegistry, Extensions as EditorInputExtensions, IEditorInputFactory, EditorInput } from 'vs/workbench/common/editor';
import { NotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { INotebookService, NotebookService } from 'vs/workbench/contrib/notebook/browser/notebookService';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService, IOpenEditorOverride } from 'vs/workbench/services/editor/common/editorService';
import { ITextModelContentProvider, ITextModelService } from 'vs/editor/common/services/resolverService';
import { ITextModel } from 'vs/editor/common/model';
import { URI } from 'vs/base/common/uri';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IDisposable } from 'vs/base/common/lifecycle';
import { assertType } from 'vs/base/common/types';
import { parse } from 'vs/base/common/marshalling';

// Output renderers registration

import 'vs/workbench/contrib/notebook/browser/output/transforms/streamTransform';
import 'vs/workbench/contrib/notebook/browser/output/transforms/errorTransform';
import 'vs/workbench/contrib/notebook/browser/output/transforms/richTransform';

// Actions
import 'vs/workbench/contrib/notebook/browser/notebookActions';
import { parseCellUri } from 'vs/workbench/contrib/notebook/common/notebookCommon';

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

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(
	NotebookEditorInput.ID,
	class implements IEditorInputFactory {
		canSerialize(): boolean {
			return true;
		}
		serialize(input: EditorInput): string {
			assertType(input instanceof NotebookEditorInput);
			return JSON.stringify({
				resource: input.resource,
				name: input.name,
				viewType: input.viewType,
			});
		}
		deserialize(instantiationService: IInstantiationService, raw: string) {
			type Data = { resource: URI, name: string, viewType: string };
			const data = <Data>parse(raw);
			if (!data) {
				return undefined;
			}
			const { resource, name, viewType } = data;
			if (!data || !URI.isUri(resource) || typeof name !== 'string' || typeof viewType !== 'string') {
				return undefined;
			}
			// TODO@joh,peng this is disabled because the note-editor isn't fit for being
			// restorted (as it seems)
			if ('true') {
				return undefined;
			}
			return instantiationService.createInstance(NotebookEditorInput, resource, name, viewType);
		}
	}
);

export class NotebookContribution implements IWorkbenchContribution {
	private _resourceMapping: Map<string, NotebookEditorInput> = new Map<string, NotebookEditorInput>();

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@INotebookService private readonly notebookService: INotebookService,
		@IInstantiationService private readonly instantiationService: IInstantiationService

	) {
		this.editorService.overrideOpenEditor((editor, options, group) => this.onEditorOpening(editor, options, group));

		this.editorService.onDidActiveEditorChange(() => {
			if (this.editorService.activeEditor && this.editorService.activeEditor! instanceof NotebookEditorInput) {
				let editorInput = this.editorService.activeEditor! as NotebookEditorInput;
				this.notebookService.updateActiveNotebookDocument(editorInput.viewType!, editorInput.resource!);
			}
		});
	}

	private onEditorOpening(editor: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup): IOpenEditorOverride | undefined {
		const resource = editor.resource;
		let viewType: string | undefined = undefined;

		if (resource) {
			let notebookProviders = this.notebookService.getContributedNotebookProviders(resource);

			if (notebookProviders.length > 0) {
				viewType = notebookProviders[0].id;
			}
		}

		if (viewType === undefined) {
			return undefined;
		}

		if (this._resourceMapping.has(resource!.path)) {
			const input = this._resourceMapping.get(resource!.path);

			if (!input!.isDisposed()) {
				return { override: this.editorService.openEditor(input!, { ...options, ignoreOverrides: true }, group) };
			}
		}

		const input = this.instantiationService.createInstance(NotebookEditorInput, editor.resource!, editor.getName(), viewType);
		this._resourceMapping.set(resource!.path, input);

		return { override: this.editorService.openEditor(input, options, group) };
	}
}

class CellContentProvider implements ITextModelContentProvider {

	private readonly _registration: IDisposable;

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly _modelService: IModelService,
		@IModeService private readonly _modeService: IModeService,
		@INotebookService private readonly _notebookService: INotebookService,
	) {
		this._registration = textModelService.registerTextModelContentProvider('vscode-notebook', this);
	}

	dispose(): void {
		this._registration.dispose();
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const data = parseCellUri(resource);
		if (!data) {
			return null;
		}
		const notebook = await this._notebookService.resolveNotebook(data.viewType, data.notebook);
		if (!notebook) {
			return null;
		}
		for (let cell of notebook.cells) {
			if (cell.uri.toString() === resource.toString()) {
				let bufferFactory = cell.resolveTextBufferFactory();
				return this._modelService.createModel(
					bufferFactory,
					cell.language ? this._modeService.create(cell.language) : this._modeService.createByFilepathOrFirstLine(resource, cell.source[0]),
					resource
				);
			}
		}

		return null;
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(NotebookContribution, LifecyclePhase.Starting);
workbenchContributionsRegistry.registerWorkbenchContribution(CellContentProvider, LifecyclePhase.Starting);

registerSingleton(INotebookService, NotebookService);

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'notebook',
	order: 100,
	title: nls.localize('notebookConfigurationTitle', "Notebook"),
	type: 'object',
	properties: {
		'notebook.displayOrder': {
			markdownDescription: nls.localize('notebook.displayOrder.description', "Priority list for output mime types"),
			type: ['array'],
			items: {
				type: 'string'
			},
			default: []
		}
	}
});
