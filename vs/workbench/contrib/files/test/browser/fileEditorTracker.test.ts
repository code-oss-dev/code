/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { TextFileEditorTracker } from 'vs/workbench/contrib/files/browser/editors/textFileEditorTracker';
import { toResource } from 'vs/base/test/common/utils';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { TestFileService, TestTextFileService, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { ITextFileService, IResolvedTextFileEditorModel, snapshotToString } from 'vs/workbench/services/textfile/common/textfiles';
import { FileChangesEvent, FileChangeType, IFileService } from 'vs/platform/files/common/files';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { timeout } from 'vs/base/common/async';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { IEditorRegistry, EditorDescriptor, Extensions as EditorExtensions } from 'vs/workbench/browser/editor';
import { Registry } from 'vs/platform/registry/common/platform';
import { TextFileEditor } from 'vs/workbench/contrib/files/browser/editors/textFileEditor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { EditorInput } from 'vs/workbench/common/editor';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';

class ServiceAccessor {
	constructor(
		@IEditorService public editorService: IEditorService,
		@IEditorGroupsService public editorGroupService: IEditorGroupsService,
		@ITextFileService public textFileService: TestTextFileService,
		@IFileService public fileService: TestFileService
	) {
	}
}

suite('Files - TextFileEditorTracker', () => {

	let disposables: IDisposable[] = [];

	setup(() => {
		disposables.push(Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
			EditorDescriptor.create(
				TextFileEditor,
				TextFileEditor.ID,
				'Text File Editor'
			),
			[new SyncDescriptor<EditorInput>(FileEditorInput)]
		));
	});

	teardown(() => {
		dispose(disposables);
		disposables = [];
	});

	test('file change event updates model', async function () {
		const instantiationService = workbenchInstantiationService();
		const accessor = instantiationService.createInstance(ServiceAccessor);

		const tracker = instantiationService.createInstance(TextFileEditorTracker);

		const resource = toResource.call(this, '/path/index.txt');

		const model = await accessor.textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;

		model.textEditorModel.setValue('Super Good');
		assert.equal(snapshotToString(model.createSnapshot()!), 'Super Good');

		await model.save();

		// change event (watcher)
		accessor.fileService.fireFileChanges(new FileChangesEvent([{ resource, type: FileChangeType.UPDATED }]));

		await timeout(0); // due to event updating model async

		assert.equal(snapshotToString(model.createSnapshot()!), 'Hello Html');

		tracker.dispose();
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
	});

	async function createTracker(): Promise<[EditorPart, ServiceAccessor, TextFileEditorTracker, IInstantiationService, IEditorService]> {
		const instantiationService = workbenchInstantiationService();

		const part = instantiationService.createInstance(EditorPart);
		part.create(document.createElement('div'));
		part.layout(400, 300);

		instantiationService.stub(IEditorGroupsService, part);

		const editorService: EditorService = instantiationService.createInstance(EditorService);
		instantiationService.stub(IEditorService, editorService);

		const accessor = instantiationService.createInstance(ServiceAccessor);

		await part.whenRestored;

		const tracker = instantiationService.createInstance(TextFileEditorTracker);

		return [part, accessor, tracker, instantiationService, editorService];
	}

	test('dirty text file model opens as editor', async function () {
		const [part, accessor, tracker] = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');

		assert.ok(!accessor.editorService.isOpen(accessor.editorService.createInput({ resource, forceFile: true })));

		const model = await accessor.textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;

		model.textEditorModel.setValue('Super Good');

		await awaitEditorOpening(accessor.editorService);
		assert.ok(accessor.editorService.isOpen(accessor.editorService.createInput({ resource, forceFile: true })));

		part.dispose();
		tracker.dispose();
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
	});

	test('dirty untitled text file model opens as editor', async function () {
		const [part, accessor, tracker, , editorService] = await createTracker();

		const untitledEditor = editorService.createInput({ forceUntitled: true }) as UntitledTextEditorInput;
		const model = await untitledEditor.resolve();

		assert.ok(!accessor.editorService.isOpen(untitledEditor));

		model.textEditorModel.setValue('Super Good');

		await awaitEditorOpening(accessor.editorService);
		assert.ok(accessor.editorService.isOpen(untitledEditor));

		part.dispose();
		tracker.dispose();
		model.dispose();
	});

	function awaitEditorOpening(editorService: IEditorService): Promise<void> {
		return new Promise(c => {
			Event.once(editorService.onDidActiveEditorChange)(c);
		});
	}
});
