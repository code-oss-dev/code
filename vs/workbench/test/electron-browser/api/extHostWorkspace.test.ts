/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import URI from 'vs/base/common/uri';
import { basename } from 'path';
import { ExtHostWorkspace } from 'vs/workbench/api/node/extHostWorkspace';
import { TestRPCProtocol } from './testRPCProtocol';
import { normalize } from 'vs/base/common/paths';
import { IWorkspaceFolderData } from 'vs/platform/workspace/common/workspace';

suite('ExtHostWorkspace', function () {

	function assertAsRelativePath(workspace: ExtHostWorkspace, input: string, expected: string, includeWorkspace?: boolean) {
		const actual = workspace.getRelativePath(input, includeWorkspace);
		if (actual === expected) {
			assert.ok(true);
		} else {
			assert.equal(actual, normalize(expected, true));
		}
	}

	test('asRelativePath', function () {

		const ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/Applications/NewsWoWBot'), 0)], name: 'Test' });

		assertAsRelativePath(ws, '/Coding/Applications/NewsWoWBot/bernd/das/brot', 'bernd/das/brot');
		assertAsRelativePath(ws, '/Apps/DartPubCache/hosted/pub.dartlang.org/convert-2.0.1/lib/src/hex.dart',
			'/Apps/DartPubCache/hosted/pub.dartlang.org/convert-2.0.1/lib/src/hex.dart');

		assertAsRelativePath(ws, '', '');
		assertAsRelativePath(ws, '/foo/bar', '/foo/bar');
		assertAsRelativePath(ws, 'in/out', 'in/out');
	});

	test('asRelativePath, same paths, #11402', function () {
		const root = '/home/aeschli/workspaces/samples/docker';
		const input = '/home/aeschli/workspaces/samples/docker';
		const ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' });

		assertAsRelativePath(ws, (input), input);

		const input2 = '/home/aeschli/workspaces/samples/docker/a.file';
		assertAsRelativePath(ws, (input2), 'a.file');
	});

	test('asRelativePath, no workspace', function () {
		const ws = new ExtHostWorkspace(new TestRPCProtocol(), null);
		assertAsRelativePath(ws, (''), '');
		assertAsRelativePath(ws, ('/foo/bar'), '/foo/bar');
	});

	test('asRelativePath, multiple folders', function () {
		const ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/One'), 0), aWorkspaceFolderData(URI.file('/Coding/Two'), 1)], name: 'Test' });
		assertAsRelativePath(ws, '/Coding/One/file.txt', 'One/file.txt');
		assertAsRelativePath(ws, '/Coding/Two/files/out.txt', 'Two/files/out.txt');
		assertAsRelativePath(ws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt');
	});

	test('slightly inconsistent behaviour of asRelativePath and getWorkspaceFolder, #31553', function () {
		const mrws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/One'), 0), aWorkspaceFolderData(URI.file('/Coding/Two'), 1)], name: 'Test' });

		assertAsRelativePath(mrws, '/Coding/One/file.txt', 'One/file.txt');
		assertAsRelativePath(mrws, '/Coding/One/file.txt', 'One/file.txt', true);
		assertAsRelativePath(mrws, '/Coding/One/file.txt', 'file.txt', false);
		assertAsRelativePath(mrws, '/Coding/Two/files/out.txt', 'Two/files/out.txt');
		assertAsRelativePath(mrws, '/Coding/Two/files/out.txt', 'Two/files/out.txt', true);
		assertAsRelativePath(mrws, '/Coding/Two/files/out.txt', 'files/out.txt', false);
		assertAsRelativePath(mrws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt');
		assertAsRelativePath(mrws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', true);
		assertAsRelativePath(mrws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', false);

		const srws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/One'), 0)], name: 'Test' });
		assertAsRelativePath(srws, '/Coding/One/file.txt', 'file.txt');
		assertAsRelativePath(srws, '/Coding/One/file.txt', 'file.txt', false);
		assertAsRelativePath(srws, '/Coding/One/file.txt', 'One/file.txt', true);
		assertAsRelativePath(srws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt');
		assertAsRelativePath(srws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', true);
		assertAsRelativePath(srws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', false);
	});

	test('getPath, legacy', function () {
		let ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] });
		assert.equal(ws.getPath(), undefined);

		ws = new ExtHostWorkspace(new TestRPCProtocol(), null);
		assert.equal(ws.getPath(), undefined);

		ws = new ExtHostWorkspace(new TestRPCProtocol(), undefined);
		assert.equal(ws.getPath(), undefined);

		ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.file('Folder'), 0), aWorkspaceFolderData(URI.file('Another/Folder'), 1)] });
		assert.equal(ws.getPath().replace(/\\/g, '/'), '/Folder');

		ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.file('/Folder'), 0)] });
		assert.equal(ws.getPath().replace(/\\/g, '/'), '/Folder');
	});

	test('WorkspaceFolder has name and index', function () {
		const ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/One'), 0), aWorkspaceFolderData(URI.file('/Coding/Two'), 1)], name: 'Test' });

		const [one, two] = ws.getWorkspaceFolders();

		assert.equal(one.name, 'One');
		assert.equal(one.index, 0);
		assert.equal(two.name, 'Two');
		assert.equal(two.index, 1);
	});

	test('getContainingWorkspaceFolder', function () {
		const ws = new ExtHostWorkspace(new TestRPCProtocol(), {
			id: 'foo',
			name: 'Test',
			folders: [
				aWorkspaceFolderData(URI.file('/Coding/One'), 0),
				aWorkspaceFolderData(URI.file('/Coding/Two'), 1),
				aWorkspaceFolderData(URI.file('/Coding/Two/Nested'), 2)
			]
		});

		let folder = ws.getWorkspaceFolder(URI.file('/foo/bar'));
		assert.equal(folder, undefined);

		folder = ws.getWorkspaceFolder(URI.file('/Coding/One/file/path.txt'));
		assert.equal(folder.name, 'One');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/file/path.txt'));
		assert.equal(folder.name, 'Two');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nest'));
		assert.equal(folder.name, 'Two');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested/file'));
		assert.equal(folder.name, 'Nested');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested/f'));
		assert.equal(folder.name, 'Nested');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested'), true);
		assert.equal(folder.name, 'Two');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested/'), true);
		assert.equal(folder.name, 'Two');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested'));
		assert.equal(folder.name, 'Nested');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested/'));
		assert.equal(folder.name, 'Nested');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two'), true);
		assert.equal(folder, undefined);

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two'), false);
		assert.equal(folder.name, 'Two');
	});

	test('Multiroot change event should have a delta, #29641', function (done) {
		let ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] });

		let finished = false;
		const finish = (error?) => {
			if (!finished) {
				finished = true;
				done(error);
			}
		};

		let sub = ws.onDidChangeWorkspace(e => {
			finish(new Error('Not expecting an event'));
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [] });
		sub.dispose();

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepEqual(e.removed, []);
				assert.equal(e.added.length, 1);
				assert.equal(e.added[0].uri.toString(), 'foo:bar');
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0)] });
		sub.dispose();

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepEqual(e.removed, []);
				assert.equal(e.added.length, 1);
				assert.equal(e.added[0].uri.toString(), 'foo:bar2');
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0), aWorkspaceFolderData(URI.parse('foo:bar2'), 1)] });
		sub.dispose();

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.equal(e.removed.length, 2);
				assert.equal(e.removed[0].uri.toString(), 'foo:bar');
				assert.equal(e.removed[1].uri.toString(), 'foo:bar2');

				assert.equal(e.added.length, 1);
				assert.equal(e.added[0].uri.toString(), 'foo:bar3');
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0)] });
		sub.dispose();
		finish();
	});

	test('Multiroot change keeps existing workspaces live', function () {
		let ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0)] });

		let firstFolder = ws.workspace.folders[0];
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar2'), 0), aWorkspaceFolderData(URI.parse('foo:bar'), 1, 'renamed')] });

		assert.equal(ws.workspace.folders[1], firstFolder);
		assert.equal(firstFolder.index, 1);
		assert.equal(firstFolder.name, 'renamed');

		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0), aWorkspaceFolderData(URI.parse('foo:bar2'), 1), aWorkspaceFolderData(URI.parse('foo:bar'), 2)] });
		assert.equal(ws.workspace.folders[2], firstFolder);
		assert.equal(firstFolder.index, 2);

		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0)] });
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0), aWorkspaceFolderData(URI.parse('foo:bar'), 1)] });

		assert.notEqual(firstFolder, ws.workspace.folders[0]);
	});

	test('updateWorkspaceFolders - invalid arguments', function () {
		let ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] });

		assert.equal(false, ws.updateWorkspaceFolders('ext', null, null));
		assert.equal(false, ws.updateWorkspaceFolders('ext', 0, 0));
		assert.equal(false, ws.updateWorkspaceFolders('ext', 0, 1));
		assert.equal(false, ws.updateWorkspaceFolders('ext', 1, 0));
		assert.equal(false, ws.updateWorkspaceFolders('ext', -1, 0));
		assert.equal(false, ws.updateWorkspaceFolders('ext', -1, -1));

		ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0)] });

		assert.equal(false, ws.updateWorkspaceFolders('ext', 1, 1));
		assert.equal(false, ws.updateWorkspaceFolders('ext', 0, 2));
		assert.equal(false, ws.updateWorkspaceFolders('ext', 0, 1, aWorkspaceFolderData(URI.parse('foo:bar'), 0)));
	});

	test('updateWorkspaceFolders - valid arguments', function (done) {
		let finished = false;
		const finish = (error?) => {
			if (!finished) {
				finished = true;
				done(error);
			}
		};

		let ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] });

		//
		// Add one folder
		//

		assert.equal(true, ws.updateWorkspaceFolders('ext', 0, 0, aWorkspaceFolderData(URI.parse('foo:bar'), 0)));
		assert.equal(1, ws.workspace.folders.length);
		assert.equal(ws.workspace.folders[0].uri.toString(), URI.parse('foo:bar').toString());

		let sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepEqual(e.removed, []);
				assert.equal(e.added.length, 1);
				assert.equal(e.added[0].uri.toString(), 'foo:bar');
				// assert.equal(e.added[0], firstFolder); // TODO
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0)] }); // simulate acknowledgement from main side
		sub.dispose();

		//
		// Add two more folders
		//

		assert.equal(true, ws.updateWorkspaceFolders('ext', 0, 0, aWorkspaceFolderData(URI.parse('foo:bar1'), 1), aWorkspaceFolderData(URI.parse('foo:bar2'), 2)));
		assert.equal(3, ws.workspace.folders.length);
		assert.equal(ws.workspace.folders[0].uri.toString(), URI.parse('foo:bar').toString());
		assert.equal(ws.workspace.folders[1].uri.toString(), URI.parse('foo:bar1').toString());
		assert.equal(ws.workspace.folders[2].uri.toString(), URI.parse('foo:bar2').toString());

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepEqual(e.removed, []);
				assert.equal(e.added.length, 2);
				assert.equal(e.added[0].uri.toString(), 'foo:bar1');
				assert.equal(e.added[1].uri.toString(), 'foo:bar2');
				// assert.equal(e.added[0], secondFolder); // TODO
				// assert.equal(e.added[0], thirdFolder); // TODO
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0), aWorkspaceFolderData(URI.parse('foo:bar1'), 1), aWorkspaceFolderData(URI.parse('foo:bar2'), 2)] }); // simulate acknowledgement from main side
		sub.dispose();

		//
		// Remove one folder
		//

		assert.equal(true, ws.updateWorkspaceFolders('ext', 2, 1));
		assert.equal(2, ws.workspace.folders.length);
		assert.equal(ws.workspace.folders[0].uri.toString(), URI.parse('foo:bar').toString());
		assert.equal(ws.workspace.folders[1].uri.toString(), URI.parse('foo:bar1').toString());

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepEqual(e.added, []);
				assert.equal(e.removed.length, 1);
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0), aWorkspaceFolderData(URI.parse('foo:bar1'), 1)] }); // simulate acknowledgement from main side
		sub.dispose();

		//
		// Rename folder
		//

		assert.equal(true, ws.updateWorkspaceFolders('ext', 0, 2, aWorkspaceFolderData(URI.parse('foo:bar'), 0, 'renamed 1'), aWorkspaceFolderData(URI.parse('foo:bar1'), 1, 'renamed 2')));
		assert.equal(2, ws.workspace.folders.length);
		assert.equal(ws.workspace.folders[0].uri.toString(), URI.parse('foo:bar').toString());
		assert.equal(ws.workspace.folders[1].uri.toString(), URI.parse('foo:bar1').toString());
		assert.equal(ws.workspace.folders[0].name, 'renamed 1');
		assert.equal(ws.workspace.folders[1].name, 'renamed 2');

		sub = ws.onDidChangeWorkspace(e => {
			finish(new Error('Not expecting an event'));
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0, 'renamed 1'), aWorkspaceFolderData(URI.parse('foo:bar1'), 1, 'renamed 2')] }); // simulate acknowledgement from main side
		sub.dispose();

		//
		// Add and remove folders
		//

		assert.equal(true, ws.updateWorkspaceFolders('ext', 0, 2, aWorkspaceFolderData(URI.parse('foo:bar3'), 0), aWorkspaceFolderData(URI.parse('foo:bar4'), 1)));
		assert.equal(2, ws.workspace.folders.length);
		assert.equal(ws.workspace.folders[0].uri.toString(), URI.parse('foo:bar3').toString());
		assert.equal(ws.workspace.folders[1].uri.toString(), URI.parse('foo:bar4').toString());

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepEqual(e.added.length, 2);
				assert.equal(e.removed.length, 2);
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0), aWorkspaceFolderData(URI.parse('foo:bar4'), 1)] }); // simulate acknowledgement from main side
		sub.dispose();

		finish();
	});

	test('Multiroot change event is immutable', function () {
		let ws = new ExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] });
		let sub = ws.onDidChangeWorkspace(e => {
			assert.throws(() => {
				(<any>e).added = [];
			});
			assert.throws(() => {
				(<any>e.added)[0] = null;
			});
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [] });
		sub.dispose();
	});

	test('`vscode.workspace.getWorkspaceFolder(file)` don\'t return workspace folder when file open from command line. #36221', function () {
		let ws = new ExtHostWorkspace(new TestRPCProtocol(), {
			id: 'foo', name: 'Test', folders: [
				aWorkspaceFolderData(URI.file('c:/Users/marek/Desktop/vsc_test/'), 0)
			]
		});

		assert.ok(ws.getWorkspaceFolder(URI.file('c:/Users/marek/Desktop/vsc_test/a.txt')));
		assert.ok(ws.getWorkspaceFolder(URI.file('C:/Users/marek/Desktop/vsc_test/b.txt')));
	});

	function aWorkspaceFolderData(uri: URI, index: number, name: string = ''): IWorkspaceFolderData {
		return {
			uri,
			index,
			name: name || basename(uri.path)
		};
	}
});
