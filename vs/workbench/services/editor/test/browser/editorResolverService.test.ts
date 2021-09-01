/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { EditorResolverService } from 'vs/workbench/services/editor/browser/editorResolverService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorResolverService, ResolvedStatus, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';
import { createEditorPart, ITestInstantiationService, TestFileEditorInput, TestServiceAccessor, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';

suite('EditorResolverService', () => {

	const TEST_EDITOR_INPUT_ID = 'testEditorInputForEditorResolverService';
	const disposables = new DisposableStore();

	teardown(() => disposables.clear());

	async function createEditorResolverService(instantiationService: ITestInstantiationService = workbenchInstantiationService()): Promise<[EditorPart, EditorResolverService, TestServiceAccessor]> {
		const part = await createEditorPart(instantiationService, disposables);

		instantiationService.stub(IEditorGroupsService, part);
		const editorResolverService = instantiationService.createInstance(EditorResolverService);
		instantiationService.stub(IEditorResolverService, editorResolverService);

		return [part, editorResolverService, instantiationService.createInstance(TestServiceAccessor)];
	}

	test('Simple Resolve', async () => {
		const [part, service] = await createEditorResolverService();
		const registeredEditor = service.registerEditor('*.test',
			{
				id: 'TEST_EDITOR',
				label: 'Test Editor Label',
				detail: 'Test Editor Details',
				priority: RegisteredEditorPriority.default
			},
			{ canHandleDiff: false },
			({ resource, options }, group) => ({ editor: new TestFileEditorInput(URI.parse(resource.toString()), TEST_EDITOR_INPUT_ID) }),
		);

		const resultingResolution = await service.resolveEditor({ resource: URI.file('my://resource-basics.test') }, part.activeGroup);
		assert.ok(resultingResolution);
		assert.notStrictEqual(typeof resultingResolution, 'number');
		if (resultingResolution !== ResolvedStatus.ABORT && resultingResolution !== ResolvedStatus.NONE) {
			assert.strictEqual(resultingResolution.editor.typeId, TEST_EDITOR_INPUT_ID);
			resultingResolution.editor.dispose();
		}
		registeredEditor.dispose();
	});

	test('Untitled Resolve', async () => {
		const UNTITLED_TEST_EDITOR_INPUT_ID = 'UNTITLED_TEST_INPUT';
		const [part, service] = await createEditorResolverService();
		const registeredEditor = service.registerEditor('*.test',
			{
				id: 'TEST_EDITOR',
				label: 'Test Editor Label',
				detail: 'Test Editor Details',
				priority: RegisteredEditorPriority.default
			},
			{ canHandleDiff: false },
			({ resource, options }, group) => ({ editor: new TestFileEditorInput(URI.parse(resource.toString()), TEST_EDITOR_INPUT_ID) }),
			({ resource, options }, group) => ({ editor: new TestFileEditorInput((resource ? resource : URI.from({ scheme: Schemas.untitled })), UNTITLED_TEST_EDITOR_INPUT_ID) }),
		);

		// Untyped untitled - no resource
		let resultingResolution = await service.resolveEditor({ resource: undefined }, part.activeGroup);
		assert.ok(resultingResolution);
		// We don't expect untitled to match the *.test glob
		assert.strictEqual(typeof resultingResolution, 'number');

		// Untyped untitled - with untitled resource
		resultingResolution = await service.resolveEditor({ resource: URI.from({ scheme: Schemas.untitled, path: 'foo.test' }) }, part.activeGroup);
		assert.ok(resultingResolution);
		assert.notStrictEqual(typeof resultingResolution, 'number');
		if (resultingResolution !== ResolvedStatus.ABORT && resultingResolution !== ResolvedStatus.NONE) {
			assert.strictEqual(resultingResolution.editor.typeId, UNTITLED_TEST_EDITOR_INPUT_ID);
			resultingResolution.editor.dispose();
		}

		// Untyped untitled - file resource with forceUntitled
		resultingResolution = await service.resolveEditor({ resource: URI.file('/fake.test'), forceUntitled: true }, part.activeGroup);
		assert.ok(resultingResolution);
		assert.notStrictEqual(typeof resultingResolution, 'number');
		if (resultingResolution !== ResolvedStatus.ABORT && resultingResolution !== ResolvedStatus.NONE) {
			assert.strictEqual(resultingResolution.editor.typeId, UNTITLED_TEST_EDITOR_INPUT_ID);
			resultingResolution.editor.dispose();
		}

		registeredEditor.dispose();
	});

	test('Side by side Resolve', async () => {
		const [part, service] = await createEditorResolverService();
		const registeredEditorPrimary = service.registerEditor('*.test-primary',
			{
				id: 'TEST_EDITOR_PRIMARY',
				label: 'Test Editor Label Primary',
				detail: 'Test Editor Details Primary',
				priority: RegisteredEditorPriority.default
			},
			{ canHandleDiff: false },
			({ resource, options }, group) => ({ editor: new TestFileEditorInput(URI.parse(resource.toString()), TEST_EDITOR_INPUT_ID) }),
		);

		const registeredEditorSecondary = service.registerEditor('*.test-secondary',
			{
				id: 'TEST_EDITOR_SECONDARY',
				label: 'Test Editor Label Secondary',
				detail: 'Test Editor Details Secondary',
				priority: RegisteredEditorPriority.default
			},
			{ canHandleDiff: false },
			({ resource, options }, group) => ({ editor: new TestFileEditorInput(URI.parse(resource.toString()), TEST_EDITOR_INPUT_ID) }),
		);

		const resultingResolution = await service.resolveEditor({
			primary: { resource: URI.file('my://resource-basics.test-primary') },
			secondary: { resource: URI.file('my://resource-basics.test-secondary') }
		}, part.activeGroup);
		assert.ok(resultingResolution);
		assert.notStrictEqual(typeof resultingResolution, 'number');
		if (resultingResolution !== ResolvedStatus.ABORT && resultingResolution !== ResolvedStatus.NONE) {
			assert.strictEqual(resultingResolution.editor.typeId, 'workbench.editorinputs.sidebysideEditorInput');
			resultingResolution.editor.dispose();
		} else {
			assert.fail();
		}
		registeredEditorPrimary.dispose();
		registeredEditorSecondary.dispose();
	});

	test('Diff editor Resolve', async () => {
		const [part, service, accessor] = await createEditorResolverService();
		const registeredEditor = service.registerEditor('*.test-diff',
			{
				id: 'TEST_EDITOR',
				label: 'Test Editor Label',
				detail: 'Test Editor Details',
				priority: RegisteredEditorPriority.default
			},
			{ canHandleDiff: true },
			({ resource, options }, group) => ({ editor: new TestFileEditorInput(URI.parse(resource.toString()), TEST_EDITOR_INPUT_ID) }),
			undefined,
			({ modified, original, options }, group) => ({
				editor: accessor.instantiationService.createInstance(
					DiffEditorInput,
					'name',
					'description',
					new TestFileEditorInput(URI.parse(original.toString()), TEST_EDITOR_INPUT_ID),
					new TestFileEditorInput(URI.parse(modified.toString()), TEST_EDITOR_INPUT_ID),
					undefined)
			})
		);

		const resultingResolution = await service.resolveEditor({
			original: { resource: URI.file('my://resource-basics.test-diff') },
			modified: { resource: URI.file('my://resource-basics.test-diff') }
		}, part.activeGroup);
		assert.ok(resultingResolution);
		assert.notStrictEqual(typeof resultingResolution, 'number');
		if (resultingResolution !== ResolvedStatus.ABORT && resultingResolution !== ResolvedStatus.NONE) {
			assert.strictEqual(resultingResolution.editor.typeId, 'workbench.editors.diffEditorInput');
			resultingResolution.editor.dispose();
		} else {
			assert.fail();
		}
		registeredEditor.dispose();
	});
});
