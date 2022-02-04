/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { toResource } from 'vs/base/test/common/utils';
import { URI } from 'vs/base/common/uri';
import { workbenchInstantiationService, TestFileEditorInput, registerTestEditor, createEditorPart, registerTestFileEditor, TestServiceAccessor } from 'vs/workbench/test/browser/workbenchTestServices';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IEditorGroupsService, GroupDirection } from 'vs/workbench/services/editor/common/editorGroupsService';
import { HistoryService } from 'vs/workbench/services/history/browser/historyService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { GoFilter, IHistoryService } from 'vs/workbench/services/history/common/history';
import { DeferredPromise, timeout } from 'vs/base/common/async';
import { Event } from 'vs/base/common/event';
import { isResourceEditorInput, IUntypedEditorInput } from 'vs/workbench/common/editor';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { IResolvedTextFileEditorModel, ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';

suite('HistoryService', function () {

	const TEST_EDITOR_ID = 'MyTestEditorForEditorHistory';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForHistoyService';

	async function createServices(): Promise<[EditorPart, HistoryService, EditorService, ITextFileService]> {
		const instantiationService = workbenchInstantiationService(undefined, disposables);

		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);

		const editorService = instantiationService.createInstance(EditorService);
		instantiationService.stub(IEditorService, editorService);

		const historyService = instantiationService.createInstance(HistoryService);
		instantiationService.stub(IHistoryService, historyService);

		const accessor = instantiationService.createInstance(TestServiceAccessor);

		return [part, historyService, editorService, accessor.textFileService];
	}

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)]));
		disposables.add(registerTestFileEditor());
	});

	teardown(() => {
		disposables.clear();
	});

	test('back / forward', async () => {
		const [part, historyService, editorService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, { pinned: true });
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input2, { pinned: true });
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.goBack();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.goForward();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);
	});

	test('back / forward works across groups', async () => {
		const [part, historyService, editorService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input1Group = (await part.activeGroup.openEditor(input1, { pinned: true }))?.group;

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		const input2Group = (await part.sideGroup.openEditor(input2, { pinned: true }))?.group;

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.goBack();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input1);
		assert.strictEqual(part.activeGroup, input1Group);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.goForward();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);
		assert.strictEqual(part.activeGroup, input2Group);
	});

	test('go to last edit location', async function () {
		const [, historyService, editorService, textFileService] = await createServices();

		const resource = toResource.call(this, '/path/index.txt');
		const otherResource = toResource.call(this, '/path/index.html');
		await editorService.openEditor({ resource });

		const model = await textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;
		model.textEditorModel.setValue('Hello World');
		await timeout(10); // history debounces change events

		await editorService.openEditor({ resource: otherResource });

		const onDidActiveEditorChange = new DeferredPromise<void>();
		editorService.onDidActiveEditorChange(e => {
			onDidActiveEditorChange.complete(e);
		});

		historyService.goLast(GoFilter.EDITS);
		await onDidActiveEditorChange.p;

		assert.strictEqual(editorService.activeEditor?.resource?.toString(), resource.toString());
	});

	test('reopen closed editor', async function () {
		const [, historyService, editorService] = await createServices();

		const resource = toResource.call(this, '/path/index.txt');
		const pane = await editorService.openEditor({ resource });

		await pane?.group?.closeAllEditors();

		const onDidActiveEditorChange = new DeferredPromise<void>();
		editorService.onDidActiveEditorChange(e => {
			onDidActiveEditorChange.complete(e);
		});

		historyService.reopenLastClosedEditor();
		await onDidActiveEditorChange.p;

		assert.strictEqual(editorService.activeEditor?.resource?.toString(), resource.toString());
	});

	test('getHistory', async () => {

		class TestFileEditorInputWithUntyped extends TestFileEditorInput {

			override toUntyped(): IUntypedEditorInput {
				return {
					resource: this.resource,
					options: {
						override: 'testOverride'
					}
				};
			}
		}

		const [part, historyService] = await createServices();

		let history = historyService.getHistory();
		assert.strictEqual(history.length, 0);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, { pinned: true });

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input2, { pinned: true });

		const input3 = new TestFileEditorInputWithUntyped(URI.parse('foo://bar3'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input3, { pinned: true });

		const input4 = new TestFileEditorInputWithUntyped(URI.file('bar4'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input4, { pinned: true });

		history = historyService.getHistory();
		assert.strictEqual(history.length, 4);

		// first entry is untyped because it implements `toUntyped` and has a supported scheme
		assert.strictEqual(isResourceEditorInput(history[0]) && !(history[0] instanceof EditorInput), true);
		assert.strictEqual((history[0] as IResourceEditorInput).options?.override, 'testOverride');
		// second entry is not untyped even though it implements `toUntyped` but has unsupported scheme
		assert.strictEqual(history[1] instanceof EditorInput, true);
		assert.strictEqual(history[2] instanceof EditorInput, true);
		assert.strictEqual(history[3] instanceof EditorInput, true);

		historyService.removeFromHistory(input2);
		history = historyService.getHistory();
		assert.strictEqual(history.length, 3);
		assert.strictEqual(history[0].resource?.toString(), input4.resource.toString());
	});

	test('getLastActiveFile', async () => {
		const [part, historyService] = await createServices();

		assert.ok(!historyService.getLastActiveFile('foo'));

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, { pinned: true });

		assert.strictEqual(historyService.getLastActiveFile('foo')?.toString(), input1.resource.toString());
	});

	test('open next/previous recently used editor (single group)', async () => {
		const [part, historyService, editorService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input1, { pinned: true });
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		await part.activeGroup.openEditor(input2, { pinned: true });
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openNextRecentlyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor(part.activeGroup.id);
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openNextRecentlyUsedEditor(part.activeGroup.id);
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);
	});

	test('open next/previous recently used editor (multi group)', async () => {
		const [part, historyService, editorService] = await createServices();
		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);

		const sideGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		await rootGroup.openEditor(input1, { pinned: true });
		await sideGroup.openEditor(input2, { pinned: true });

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup, rootGroup);
		assert.strictEqual(rootGroup.activeEditor, input1);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openNextRecentlyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup, sideGroup);
		assert.strictEqual(sideGroup.activeEditor, input2);
	});

	test('open next/previous recently is reset when other input opens', async () => {
		const [part, historyService, editorService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_EDITOR_INPUT_ID);
		const input4 = new TestFileEditorInput(URI.parse('foo://bar4'), TEST_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input1, { pinned: true });
		await part.activeGroup.openEditor(input2, { pinned: true });
		await part.activeGroup.openEditor(input3, { pinned: true });

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		await timeout(0);
		await part.activeGroup.openEditor(input4, { pinned: true });

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openNextRecentlyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input4);
	});
});
