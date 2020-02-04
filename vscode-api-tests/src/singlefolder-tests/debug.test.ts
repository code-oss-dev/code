/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { debug, workspace, commands, window, Disposable } from 'vscode';
import { basename } from 'path';
import { disposeAll, createRandomFile } from '../utils';

suite('Debug', function () {

	test('breakpoints', async function () {
		assert.equal(debug.breakpoints.length, 0);
		let onDidChangeBreakpointsCounter = 0;
		const toDispose: Disposable[] = [];
		let onBreakpointsChange: () => void;

		toDispose.push(debug.onDidChangeBreakpoints(() => {
			onDidChangeBreakpointsCounter++;
			if (onBreakpointsChange) {
				onBreakpointsChange();
			}
		}));

		debug.addBreakpoints([{ id: '1', enabled: true }, { id: '2', enabled: false, condition: '2 < 5' }]);
		assert.equal(onDidChangeBreakpointsCounter, 1);
		assert.equal(debug.breakpoints.length, 2);
		assert.equal(debug.breakpoints[0].id, '1');
		assert.equal(debug.breakpoints[1].id, '2');
		assert.equal(debug.breakpoints[1].condition, '2 < 5');

		debug.removeBreakpoints([{ id: '1', enabled: true }]);
		assert.equal(onDidChangeBreakpointsCounter, 2);
		assert.equal(debug.breakpoints.length, 1);

		debug.removeBreakpoints([{ id: '2', enabled: false }]);
		assert.equal(onDidChangeBreakpointsCounter, 3);
		assert.equal(debug.breakpoints.length, 0);

		const file = await createRandomFile('let i = 5;', undefined, '.js');
		const doc = await workspace.openTextDocument(file);
		await window.showTextDocument(doc, undefined, false);

		const breakpointsChanged = new Promise<void>(resolve => onBreakpointsChange = resolve);
		await commands.executeCommand('editor.debug.action.toggleBreakpoint');
		await breakpointsChanged;
		assert.equal(debug.breakpoints.length, 1);
		assert.equal(debug.breakpoints[0].enabled, true);

		const breakpointsChangedSecond = new Promise<void>(resolve => onBreakpointsChange = resolve);
		await commands.executeCommand('editor.debug.action.toggleBreakpoint');
		await breakpointsChangedSecond;
		assert.equal(debug.breakpoints.length, 0);

		disposeAll(toDispose);
	});

	test('start debugging', async function () {
		assert.equal(debug.activeDebugSession, undefined);
		let stoppedEvents = 0;
		let variablesRetrieved: () => void;
		const firstVariablesRetrieved = new Promise<void>(resolve => variablesRetrieved = resolve);
		const toDispose: Disposable[] = [];
		toDispose.push(debug.registerDebugAdapterTrackerFactory('node2', {
			createDebugAdapterTracker: () => ({
				onDidSendMessage: m => {
					if (m.event === 'stopped') {
						stoppedEvents++;
					}
					if (m.type === 'response' && m.command === 'variables') {
						variablesRetrieved();
					}
				}
			})
		}));

		const success = await debug.startDebugging(workspace.workspaceFolders![0], 'Launch debug.js');
		assert.equal(success, true);
		assert.notEqual(debug.activeDebugSession, undefined);
		assert.equal(debug.activeDebugSession?.name, 'Launch debug.js');

		await firstVariablesRetrieved;
		assert.equal(stoppedEvents, 1);

		const secondVariablesRetrieved = new Promise<void>(resolve => variablesRetrieved = resolve);
		await commands.executeCommand('workbench.action.debug.stepOver');
		await secondVariablesRetrieved;
		assert.equal(stoppedEvents, 2);
		const editor = window.activeTextEditor;
		assert.notEqual(editor, undefined);
		assert.equal(basename(editor!.document.fileName), 'debug.js');

		const thirdVariablesRetrieved = new Promise<void>(resolve => variablesRetrieved = resolve);
		await commands.executeCommand('workbench.action.debug.stepOver');
		await thirdVariablesRetrieved;
		assert.equal(stoppedEvents, 3);

		const fourthVariablesRetrieved = new Promise<void>(resolve => variablesRetrieved = resolve);
		await commands.executeCommand('workbench.action.debug.stepInto');
		await fourthVariablesRetrieved;
		assert.equal(stoppedEvents, 4);

		const fifthVariablesRetrieved = new Promise<void>(resolve => variablesRetrieved = resolve);
		await commands.executeCommand('workbench.action.debug.stepOut');
		await fifthVariablesRetrieved;
		assert.equal(stoppedEvents, 5);

		let sessionTerminated: () => void;
		toDispose.push(debug.onDidTerminateDebugSession(() => {
			sessionTerminated();
		}));
		const sessionTerminatedPromise = new Promise<void>(resolve => sessionTerminated = resolve);
		await commands.executeCommand('workbench.action.debug.stop');
		await sessionTerminatedPromise;
		assert.equal(debug.activeDebugSession, undefined);

		disposeAll(toDispose);
	});

	test('start debugging failure', async function () {
		let errorCount = 0;
		try {
			await debug.startDebugging(workspace.workspaceFolders![0], 'non existent');
		} catch (e) {
			errorCount++;
		}
		assert.equal(errorCount, 1);
	});
});
