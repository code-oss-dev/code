/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import * as assert from 'assert';
import {join} from 'vs/base/common/paths';
import {TestInstantiationService} from 'vs/test/utils/instantiationTestUtils';
import {IUntitledEditorService} from 'vs/workbench/services/untitled/common/untitledEditorService';
import {workbenchInstantiationService} from 'vs/test/utils/servicesTestUtils';
import {UntitledEditorModel} from 'vs/workbench/common/editor/untitledEditorModel';

class ServiceAccessor {
	constructor(@IUntitledEditorService public untitledEditorService: IUntitledEditorService) {
	}
}

suite('Workbench - Untitled Editor', () => {

	let instantiationService: TestInstantiationService;
	let accessor: ServiceAccessor;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(ServiceAccessor);
		accessor.untitledEditorService.revertAll();
	});

	test('Untitled Editor Service', function (done) {
		const service = accessor.untitledEditorService;
		assert.equal(service.getAll().length, 0);

		const input1 = service.createOrGet();
		const input2 = service.createOrGet();

		// get() / getAll()
		assert.equal(service.get(input1.getResource()), input1);
		assert.equal(service.getAll().length, 2);
		assert.equal(service.getAll([input1.getResource(), input2.getResource()]).length, 2);

		// revertAll()
		service.revertAll([input1.getResource()]);
		assert.ok(input1.isDisposed());
		assert.equal(service.getAll().length, 1);

		// dirty
		input2.resolve().then((model: UntitledEditorModel) => {
			assert.ok(!service.isDirty(input2.getResource()));

			const listener = service.onDidChangeDirty(resource => {
				listener.dispose();

				assert.equal(resource.toString(), input2.getResource().toString());

				assert.ok(service.isDirty(input2.getResource()));
				assert.equal(service.getDirty()[0].toString(), input2.getResource().toString());

				service.revertAll();
				assert.equal(service.getAll().length, 0);
				assert.ok(!input2.isDirty());
				assert.ok(!model.isDirty());

				done();
			});

			model.textEditorModel.setValue('foo bar');
		});
	});

	test('Untitled with associated resource', function () {
		const service = accessor.untitledEditorService;
		const file = URI.file(join('C:\\', '/foo/file.txt'));
		const untitled = service.createOrGet(file);

		assert.ok(service.hasAssociatedFilePath(untitled.getResource()));

		untitled.dispose();
	});
});