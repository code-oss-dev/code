/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import URI from 'vs/base/common/uri';
import {TestInstantiationService} from 'vs/test/utils/instantiationTestUtils';
import {TextFileEditorModelManager} from 'vs/workbench/parts/files/common/editors/textFileEditorModelManager';
import {EditorModel} from 'vs/workbench/common/editor';
import {join, basename} from 'vs/base/common/paths';
import {workbenchInstantiationService, TestEditorGroupService} from 'vs/test/utils/servicesTestUtils';
import {IEditorGroupService} from 'vs/workbench/services/group/common/groupService';
import {FileEditorInput} from 'vs/workbench/parts/files/common/editors/fileEditorInput';
import {TextFileEditorModel} from 'vs/workbench/parts/files/common/editors/textFileEditorModel';
import {IEventService} from 'vs/platform/event/common/event';
import {LocalFileChangeEvent} from 'vs/workbench/parts/files/common/files';
import {FileChangesEvent, EventType as CommonFileEventType, FileChangeType} from 'vs/platform/files/common/files';

class ServiceAccessor {
	constructor(
		@IEditorGroupService public editorGroupService: TestEditorGroupService,
		@IEventService public eventService: IEventService
	) {
	}
}

function toResource(path: string): URI {
	return URI.file(join('C:\\', path));
}

function toStat(resource: URI) {
	return {
		resource,
		isDirectory: false,
		hasChildren: false,
		name: basename(resource.fsPath),
		mtime: Date.now(),
		etag: 'etag',
		mime: 'text/plain'
	};
}

suite('Files - TextFileEditorModelManager', () => {

	let instantiationService: TestInstantiationService;
	let accessor: ServiceAccessor;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(ServiceAccessor);
	});

	test('add, remove, clear, get, getAll', function () {
		const manager = instantiationService.createInstance(TextFileEditorModelManager);

		const model1 = new EditorModel();
		const model2 = new EditorModel();
		const model3 = new EditorModel();

		manager.add(URI.file('/test.html'), <any>model1);
		manager.add(URI.file('/some/other.html'), <any>model2);
		manager.add(URI.file('/some/this.txt'), <any>model3);

		assert(!manager.get(URI.file('foo')));
		assert.strictEqual(manager.get(URI.file('/test.html')), model1);

		let result = manager.getAll();
		assert.strictEqual(3, result.length);

		result = manager.getAll(URI.file('/yes'));
		assert.strictEqual(0, result.length);

		result = manager.getAll(URI.file('/some/other.txt'));
		assert.strictEqual(0, result.length);

		result = manager.getAll(URI.file('/some/other.html'));
		assert.strictEqual(1, result.length);

		manager.remove(URI.file(''));

		result = manager.getAll();
		assert.strictEqual(3, result.length);

		manager.remove(URI.file('/test.html'));

		result = manager.getAll();
		assert.strictEqual(2, result.length);

		manager.clear();
		result = manager.getAll();
		assert.strictEqual(0, result.length);
	});

	test('removed from cache when model disposed', function () {
		const manager = instantiationService.createInstance(TextFileEditorModelManager);

		const model1 = new EditorModel();
		const model2 = new EditorModel();
		const model3 = new EditorModel();

		manager.add(URI.file('/test.html'), <any>model1);
		manager.add(URI.file('/some/other.html'), <any>model2);
		manager.add(URI.file('/some/this.txt'), <any>model3);

		assert.strictEqual(manager.get(URI.file('/test.html')), model1);

		model1.dispose();
		assert(!manager.get(URI.file('/test.html')));
	});

	test('disposes model when not open anymore', function () {
		const manager: TextFileEditorModelManager = instantiationService.createInstance(TextFileEditorModelManager);

		const resource = toResource('/path/index.txt');

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, resource, 'utf8');
		manager.add(resource, model);

		const input = instantiationService.createInstance(FileEditorInput, resource, 'text/plain', void 0);

		const stacks = accessor.editorGroupService.getStacksModel();
		const group = stacks.openGroup('group', true);
		group.openEditor(input);

		accessor.editorGroupService.fireChange();

		assert.ok(!model.isDisposed());

		group.closeEditor(input);
		accessor.editorGroupService.fireChange();
		assert.ok(model.isDisposed());

		manager.dispose();
	});

	test('local file changes dispose model - delete', function () {
		const manager: TextFileEditorModelManager = instantiationService.createInstance(TextFileEditorModelManager);

		const resource = toResource('/path/index.txt');

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, resource, 'utf8');
		manager.add(resource, model);

		assert.ok(!model.isDisposed());

		// delete event (local)
		accessor.eventService.emit('files.internal:fileChanged', new LocalFileChangeEvent(toStat(resource)));

		assert.ok(model.isDisposed());

		manager.dispose();
	});

	test('local file changes dispose model - move', function () {
		const manager: TextFileEditorModelManager = instantiationService.createInstance(TextFileEditorModelManager);

		const resource = toResource('/path/index.txt');

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, resource, 'utf8');
		manager.add(resource, model);

		assert.ok(!model.isDisposed());

		// move event (local)
		accessor.eventService.emit('files.internal:fileChanged', new LocalFileChangeEvent(toStat(resource), toStat(toResource('/path/index_moved.txt'))));

		assert.ok(model.isDisposed());

		manager.dispose();
	});

	test('file event delete dispose model', function () {
		const manager: TextFileEditorModelManager = instantiationService.createInstance(TextFileEditorModelManager);

		const resource = toResource('/path/index.txt');

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, resource, 'utf8');
		manager.add(resource, model);

		assert.ok(!model.isDisposed());

		// delete event (watcher)
		accessor.eventService.emit(CommonFileEventType.FILE_CHANGES, new FileChangesEvent([{ resource, type: FileChangeType.DELETED }]));

		assert.ok(model.isDisposed());

		manager.dispose();
	});

	test('file change event dispose model if happening > 2 second after last save', function () {
		const manager: TextFileEditorModelManager = instantiationService.createInstance(TextFileEditorModelManager);

		const resource = toResource('/path/index.txt');

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, resource, 'utf8');
		manager.add(resource, model);

		assert.ok(!model.isDisposed());

		// change event (watcher)
		accessor.eventService.emit(CommonFileEventType.FILE_CHANGES, new FileChangesEvent([{ resource, type: FileChangeType.UPDATED }]));

		assert.ok(model.isDisposed());

		manager.dispose();
	});

	test('file change event does NOT dispose model if happening < 2 second after last save', function (done) {
		const manager: TextFileEditorModelManager = instantiationService.createInstance(TextFileEditorModelManager);

		const resource = toResource('/path/index.txt');

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, resource, 'utf8');
		manager.add(resource, model);

		assert.ok(!model.isDisposed());

		model.load().then(resolved => {
			model.textEditorModel.setValue('changed');
			model.save().then(() => {

				// change event (watcher)
				accessor.eventService.emit(CommonFileEventType.FILE_CHANGES, new FileChangesEvent([{ resource, type: FileChangeType.UPDATED }]));

				assert.ok(!model.isDisposed());

				manager.dispose();
				done();
			});
		});
	});
});