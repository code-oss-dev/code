/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import { TPromise } from 'vs/base/common/winjs.base';
import * as paths from 'vs/base/common/paths';
import { IEditorModel } from 'vs/platform/editor/common/editor';
import URI from 'vs/base/common/uri';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorInput, EditorOptions, IFileEditorInput, IEditorInput } from 'vs/workbench/common/editor';
import { workbenchInstantiationService } from 'vs/workbench/test/workbenchTestServices';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { NextEditorService, DelegatingWorkbenchEditorService } from 'vs/workbench/services/editor/browser/nextEditorService';
import { INextEditorGroup, INextEditorGroupsService, GroupDirection } from 'vs/workbench/services/group/common/nextEditorGroupsService';
import { NextEditorPart } from 'vs/workbench/browser/parts/editor2/nextEditorPart';
import { Dimension } from 'vs/base/browser/dom';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { INextEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/nextEditorService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { IEditorRegistry, EditorDescriptor, Extensions } from 'vs/workbench/browser/editor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { Registry } from 'vs/platform/registry/common/platform';
import { FileEditorInput } from 'vs/workbench/parts/files/common/editors/fileEditorInput';
import { UntitledEditorInput } from 'vs/workbench/common/editor/untitledEditorInput';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';

export class TestEditorControl extends BaseEditor {

	constructor(@ITelemetryService telemetryService: ITelemetryService) { super('MyTestEditorForNextEditorService', NullTelemetryService, new TestThemeService()); }

	getId(): string { return 'myTestEditorForNextEditorService'; }
	layout(): void { }
	createEditor(): any { }
}

export class TestEditorInput extends EditorInput implements IFileEditorInput {
	public gotDisposed: boolean;
	constructor(private resource: URI) { super(); }

	getTypeId() { return 'testEditorInputForNextEditorService'; }
	resolve(): TPromise<IEditorModel> { return null; }
	matches(other: TestEditorInput): boolean { return other && other.resource && this.resource.toString() === other.resource.toString() && other instanceof TestEditorInput; }
	setEncoding(encoding: string) { }
	getEncoding(): string { return null; }
	setPreferredEncoding(encoding: string) { }
	getResource(): URI { return this.resource; }
	setForceOpenAsBinary(): void { }
	dispose(): void {
		super.dispose();
		this.gotDisposed = true;
	}
}

suite('Editor service (editor2)', () => {

	function registerTestEditorInput(): void {
		Registry.as<IEditorRegistry>(Extensions.Editors).registerEditor(new EditorDescriptor(TestEditorControl, 'MyTestEditorForNextEditorService', 'My Test Editor For Next Editor Service'), new SyncDescriptor(TestEditorInput));
	}

	registerTestEditorInput();

	test('basics', function () {
		const partInstantiator = workbenchInstantiationService();

		const part = partInstantiator.createInstance(NextEditorPart, 'id', false);
		part.create(document.createElement('div'));
		part.layout(new Dimension(400, 300));

		const testInstantiationService = partInstantiator.createChild(new ServiceCollection([INextEditorGroupsService, part]));

		const service: INextEditorService = testInstantiationService.createInstance(NextEditorService);

		const input = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource'));
		const otherInput = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource2'));

		let willOpenEditorEventCounter = 0;
		const willOpenEditorListener = service.onWillOpenEditor(() => {
			willOpenEditorEventCounter++;
		});

		let activeEditorChangeEventCounter = 0;
		const activeEditorChangeListener = service.onDidActiveEditorChange(() => {
			activeEditorChangeEventCounter++;
		});

		let visibleEditorChangeEventCounter = 0;
		const visibleEditorChangeListener = service.onDidVisibleEditorsChange(() => {
			visibleEditorChangeEventCounter++;
		});

		let didCloseEditorListenerCounter = 0;
		const didCloseEditorListener = service.onDidCloseEditor(editor => {
			didCloseEditorListenerCounter++;
		});

		let willCloseEditorListenerCounter = 0;
		const willCloseEditorListener = service.onWillCloseEditor(editor => {
			willCloseEditorListenerCounter++;
		});

		// Open input
		return service.openEditor(input, { pinned: true }).then(editor => {
			assert.ok(editor instanceof TestEditorControl);
			assert.equal(editor, service.activeControl);
			assert.equal(input, service.activeEditor);
			assert.equal(service.visibleControls.length, 1);
			assert.equal(service.visibleControls[0], editor);
			assert.ok(!service.activeTextEditorControl);
			assert.equal(service.visibleTextEditorControls.length, 0);
			assert.equal(service.isOpen(input), true);
			assert.equal(service.isOpen(input, part.activeGroup), true);
			assert.equal(activeEditorChangeEventCounter, 1);
			assert.equal(visibleEditorChangeEventCounter, 1);
			assert.equal(willOpenEditorEventCounter, 1);

			// Close input
			editor.group.closeEditor(input);
			assert.equal(willCloseEditorListenerCounter, 1);
			assert.equal(didCloseEditorListenerCounter, 1);
			assert.equal(activeEditorChangeEventCounter, 2);
			assert.equal(visibleEditorChangeEventCounter, 2);
			assert.ok(input.gotDisposed);

			// Open again 2 inputs
			return service.openEditor(input, { pinned: true }).then(editor => {
				return service.openEditor(otherInput, { pinned: true }).then(editor => {
					assert.equal(service.visibleControls.length, 1);
					assert.equal(service.isOpen(input), true);
					assert.equal(service.isOpen(otherInput), true);

					assert.equal(activeEditorChangeEventCounter, 4);
					assert.equal(visibleEditorChangeEventCounter, 4);

					activeEditorChangeListener.dispose();
					visibleEditorChangeListener.dispose();
					willCloseEditorListener.dispose();
					didCloseEditorListener.dispose();
					willOpenEditorListener.dispose();
				});
			});
		});
	});

	test('openEditors() / replaceEditors()', function () {
		const partInstantiator = workbenchInstantiationService();

		const part = partInstantiator.createInstance(NextEditorPart, 'id', false);
		part.create(document.createElement('div'));
		part.layout(new Dimension(400, 300));

		const testInstantiationService = partInstantiator.createChild(new ServiceCollection([INextEditorGroupsService, part]));

		const service: INextEditorService = testInstantiationService.createInstance(NextEditorService);

		const input = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource'));
		const otherInput = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource2'));
		const replaceInput = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource3'));

		// Open editors
		return service.openEditors([{ editor: input }, { editor: otherInput }]).then(() => {
			assert.equal(part.activeGroup.count, 2);

			return service.replaceEditors([{ editor: input, replacement: replaceInput }], part.activeGroup).then(() => {
				assert.equal(part.activeGroup.count, 2);
				assert.equal(part.activeGroup.getIndexOfEditor(replaceInput), 0);
			});
		});
	});

	test('caching', function () {
		const instantiationService = workbenchInstantiationService();
		const service: NextEditorService = <any>instantiationService.createInstance(NextEditorService);

		// Cached Input (Files)
		const fileResource1 = toFileResource(this, '/foo/bar/cache1.js');
		const fileInput1 = service.createInput({ resource: fileResource1 });
		assert.ok(fileInput1);

		const fileResource2 = toFileResource(this, '/foo/bar/cache2.js');
		const fileInput2 = service.createInput({ resource: fileResource2 });
		assert.ok(fileInput2);

		assert.notEqual(fileInput1, fileInput2);

		const fileInput1Again = service.createInput({ resource: fileResource1 });
		assert.equal(fileInput1Again, fileInput1);

		fileInput1Again.dispose();

		assert.ok(fileInput1.isDisposed());

		const fileInput1AgainAndAgain = service.createInput({ resource: fileResource1 });
		assert.notEqual(fileInput1AgainAndAgain, fileInput1);
		assert.ok(!fileInput1AgainAndAgain.isDisposed());

		// Cached Input (Resource)
		const resource1 = toResource.call(this, '/foo/bar/cache1.js');
		const input1 = service.createInput({ resource: resource1 });
		assert.ok(input1);

		const resource2 = toResource.call(this, '/foo/bar/cache2.js');
		const input2 = service.createInput({ resource: resource2 });
		assert.ok(input2);

		assert.notEqual(input1, input2);

		const input1Again = service.createInput({ resource: resource1 });
		assert.equal(input1Again, input1);

		input1Again.dispose();

		assert.ok(input1.isDisposed());

		const input1AgainAndAgain = service.createInput({ resource: resource1 });
		assert.notEqual(input1AgainAndAgain, input1);
		assert.ok(!input1AgainAndAgain.isDisposed());
	});

	test('createInput', function () {
		const instantiationService = workbenchInstantiationService();
		const service: NextEditorService = <any>instantiationService.createInstance(NextEditorService);

		// Untyped Input (file)
		let input = service.createInput({ resource: toFileResource(this, '/index.html'), options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof FileEditorInput);
		let contentInput = <FileEditorInput>input;
		assert.strictEqual(contentInput.getResource().fsPath, toFileResource(this, '/index.html').fsPath);

		// Untyped Input (file, encoding)
		input = service.createInput({ resource: toFileResource(this, '/index.html'), encoding: 'utf16le', options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof FileEditorInput);
		contentInput = <FileEditorInput>input;
		assert.equal(contentInput.getPreferredEncoding(), 'utf16le');

		// Untyped Input (untitled)
		input = service.createInput({ options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledEditorInput);

		// Untyped Input (untitled with contents)
		input = service.createInput({ contents: 'Hello Untitled', options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledEditorInput);

		// Untyped Input (untitled with file path)
		input = service.createInput({ filePath: '/some/path.txt', options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledEditorInput);
		assert.ok((input as UntitledEditorInput).hasAssociatedFilePath);
	});

	test('delegate', function (done) {
		const instantiationService = workbenchInstantiationService();

		class MyEditor extends BaseEditor {

			constructor(id: string) {
				super(id, null, new TestThemeService());
			}

			getId(): string {
				return 'myEditor';
			}

			layout(): void { }

			createEditor(): any { }
		}

		const ed = instantiationService.createInstance(MyEditor, 'my.editor');

		const inp = instantiationService.createInstance(ResourceEditorInput, 'name', 'description', URI.parse('my://resource'));
		const delegate = instantiationService.createInstance(DelegatingWorkbenchEditorService);
		delegate.setEditorOpenHandler((group: INextEditorGroup, input: IEditorInput, options?: EditorOptions) => {
			assert.strictEqual(input, inp);

			done();

			return TPromise.as(ed);
		});

		delegate.openEditor(inp);
	});

	test('close editor does not dispose when editor opened in other group', function () {
		const partInstantiator = workbenchInstantiationService();

		const part = partInstantiator.createInstance(NextEditorPart, 'id', false);
		part.create(document.createElement('div'));
		part.layout(new Dimension(400, 300));

		const testInstantiationService = partInstantiator.createChild(new ServiceCollection([INextEditorGroupsService, part]));

		const service: INextEditorService = testInstantiationService.createInstance(NextEditorService);

		const input = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource'));

		const rootGroup = part.activeGroup;
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		// Open input
		return service.openEditor(input, { pinned: true }).then(editor => {
			return service.openEditor(input, { pinned: true }, rightGroup).then(editor => {

				// Close input
				return rootGroup.closeEditor(input).then(() => {
					assert.equal(input.isDisposed(), false);

					return rightGroup.closeEditor(input).then(() => {
						assert.equal(input.isDisposed(), true);
					});
				});
			});
		});
	});

	test('close editor does not dispose when editor opened in other group (diff input)', function () {
		const partInstantiator = workbenchInstantiationService();

		const part = partInstantiator.createInstance(NextEditorPart, 'id', false);
		part.create(document.createElement('div'));
		part.layout(new Dimension(400, 300));

		const testInstantiationService = partInstantiator.createChild(new ServiceCollection([INextEditorGroupsService, part]));

		const service: INextEditorService = testInstantiationService.createInstance(NextEditorService);

		const input = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource'));
		const otherInput = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource2'));
		const diffInput = new DiffEditorInput('name', 'description', input, otherInput);

		const rootGroup = part.activeGroup;
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		// Open input
		return service.openEditor(diffInput, { pinned: true }).then(editor => {
			return service.openEditor(diffInput, { pinned: true }, rightGroup).then(editor => {

				// Close input
				return rootGroup.closeEditor(diffInput).then(() => {
					assert.equal(diffInput.isDisposed(), false);
					assert.equal(input.isDisposed(), false);
					assert.equal(otherInput.isDisposed(), false);

					return rightGroup.closeEditor(diffInput).then(() => {
						assert.equal(diffInput.isDisposed(), true);
						assert.equal(input.isDisposed(), true);
						assert.equal(otherInput.isDisposed(), true);
					});
				});
			});
		});
	});

	test('close editor disposes properly (diff input)', function () {
		const partInstantiator = workbenchInstantiationService();

		const part = partInstantiator.createInstance(NextEditorPart, 'id', false);
		part.create(document.createElement('div'));
		part.layout(new Dimension(400, 300));

		const testInstantiationService = partInstantiator.createChild(new ServiceCollection([INextEditorGroupsService, part]));

		const service: INextEditorService = testInstantiationService.createInstance(NextEditorService);

		const input = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource'));
		const otherInput = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource2'));
		const diffInput = new DiffEditorInput('name', 'description', input, otherInput);

		// Open input
		return service.openEditor(diffInput, { pinned: true }).then(editor => {

			// Close input
			return editor.group.closeEditor(diffInput).then(() => {
				assert.equal(diffInput.isDisposed(), true);
				assert.equal(otherInput.isDisposed(), true);
				assert.equal(input.isDisposed(), true);
			});
		});
	});

	test('close editor disposes properly (diff input, left side still opened)', function () {
		const partInstantiator = workbenchInstantiationService();

		const part = partInstantiator.createInstance(NextEditorPart, 'id', false);
		part.create(document.createElement('div'));
		part.layout(new Dimension(400, 300));

		const testInstantiationService = partInstantiator.createChild(new ServiceCollection([INextEditorGroupsService, part]));

		const service: INextEditorService = testInstantiationService.createInstance(NextEditorService);

		const input = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource'));
		const otherInput = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource2'));
		const diffInput = new DiffEditorInput('name', 'description', input, otherInput);

		// Open input
		return service.openEditor(diffInput, { pinned: true }).then(editor => {
			return service.openEditor(input, { pinned: true }).then(editor => {

				// Close input
				return editor.group.closeEditor(diffInput).then(() => {
					assert.equal(diffInput.isDisposed(), true);
					assert.equal(otherInput.isDisposed(), true);
					assert.equal(input.isDisposed(), false);
				});
			});
		});
	});

	test('open to the side', function () {
		const partInstantiator = workbenchInstantiationService();

		const part = partInstantiator.createInstance(NextEditorPart, 'id', false);
		part.create(document.createElement('div'));
		part.layout(new Dimension(400, 300));

		const testInstantiationService = partInstantiator.createChild(new ServiceCollection([INextEditorGroupsService, part]));

		const service: INextEditorService = testInstantiationService.createInstance(NextEditorService);

		const input1 = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource1'));
		const input2 = testInstantiationService.createInstance(TestEditorInput, URI.parse('my://resource2'));

		const rootGroup = part.activeGroup;

		return service.openEditor(input1, { pinned: true }, rootGroup).then(editor => {
			return service.openEditor(input1, { pinned: true, preserveFocus: true }, SIDE_GROUP).then(editor => {
				assert.equal(part.activeGroup, rootGroup);
				assert.equal(part.count, 2);
				assert.equal(editor.group, part.groups[1]);

				// Open to the side uses existing neighbour group if any
				return service.openEditor(input2, { pinned: true, preserveFocus: true }, SIDE_GROUP).then(editor => {
					assert.equal(part.activeGroup, rootGroup);
					assert.equal(part.count, 2);
					assert.equal(editor.group, part.groups[1]);
				});
			});
		});
	});
});

function toResource(path: string) {
	return URI.from({ scheme: 'custom', path });
}

function toFileResource(self: any, path: string) {
	return URI.file(paths.join('C:\\', Buffer.from(self.test.fullTitle()).toString('base64'), path));
}
