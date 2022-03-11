/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, ok } from 'assert';
import { timeout } from 'vs/base/common/async';
import { Terminal } from 'xterm';
import { CommandDetectionCapability } from 'vs/workbench/contrib/terminal/common/capabilities/commandDetectionCapability';
import { NullLogService } from 'vs/platform/log/common/log';
import { ITerminalCommand } from 'vs/workbench/contrib/terminal/common/capabilities/capabilities';

async function writeP(terminal: Terminal, data: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const failTimeout = timeout(2000);
		failTimeout.then(() => reject('Writing to xterm is taking longer than 2 seconds'));
		terminal.write(data, () => {
			failTimeout.cancel();
			resolve();
		});
	});
}

type TestTerminalCommandMatch = Pick<ITerminalCommand, 'command' | 'cwd' | 'exitCode'> & { marker: { line: number } };

class TestCommandDetectionCapability extends CommandDetectionCapability {
	clearCommands() {
		this._commands.length = 0;
	}
}

suite('CommandDetectionCapability', () => {
	let xterm: Terminal;
	let capability: TestCommandDetectionCapability;
	let addEvents: ITerminalCommand[];

	function assertCommands(expectedCommands: TestTerminalCommandMatch[]) {
		deepStrictEqual(capability.commands.map(e => e.command), expectedCommands.map(e => e.command));
		deepStrictEqual(capability.commands.map(e => e.cwd), expectedCommands.map(e => e.cwd));
		deepStrictEqual(capability.commands.map(e => e.exitCode), expectedCommands.map(e => e.exitCode));
		deepStrictEqual(capability.commands.map(e => e.marker?.line), expectedCommands.map(e => e.marker?.line));
		// Ensure timestamps are set and were captured recently
		for (const command of capability.commands) {
			ok(Math.abs(Date.now() - command.timestamp) < 2000);
		}
		deepStrictEqual(addEvents, capability.commands);
		// Clear the commands to avoid re-asserting past commands
		addEvents.length = 0;
		capability.clearCommands();
	}

	async function printStandardCommand(prompt: string, command: string, output: string, cwd: string | undefined, exitCode: number) {
		if (cwd !== undefined) {
			capability.setCwd(cwd);
		}
		capability.handlePromptStart();
		await writeP(xterm, `\r${prompt}`);
		capability.handleCommandStart();
		await writeP(xterm, command);
		capability.handleCommandExecuted();
		await writeP(xterm, `\r\n${output}\r\n`);
		capability.handleCommandFinished(exitCode);
	}

	setup(() => {
		xterm = new Terminal({ cols: 80 });
		capability = new TestCommandDetectionCapability(xterm, new NullLogService());
		addEvents = [];
		capability.onCommandFinished(e => addEvents.push(e));
		assertCommands([]);
	});

	test('should not add commands when no capability methods are triggered', async () => {
		await writeP(xterm, 'foo\r\nbar\r\n');
		assertCommands([]);
		await writeP(xterm, 'baz\r\n');
		assertCommands([]);
	});

	test('should add commands for expected capability method calls', async () => {
		await printStandardCommand('$ ', 'echo foo', 'foo', undefined, 0);
		assertCommands([{
			command: 'echo foo',
			exitCode: 0,
			cwd: undefined,
			marker: { line: 0 }
		}]);
	});

	test('should trim the command when command executed appears on the following line', async () => {
		await printStandardCommand('$ ', 'echo foo\r\n', 'foo', undefined, 0);
		assertCommands([{
			command: 'echo foo',
			exitCode: 0,
			cwd: undefined,
			marker: { line: 0 }
		}]);
	});

	suite('cwd', () => {
		test('should add cwd to commands when it\'s set', async () => {
			await printStandardCommand('$ ', 'echo foo', 'foo', '/home', 0);
			await printStandardCommand('$ ', 'echo bar', 'bar', '/home/second', 0);
			assertCommands([
				{ command: 'echo foo', exitCode: 0, cwd: '/home', marker: { line: 0 } },
				{ command: 'echo bar', exitCode: 0, cwd: '/home/second', marker: { line: 2 } }
			]);
		});
		test('should add old cwd to commands if no cwd sequence is output', async () => {
			await printStandardCommand('$ ', 'echo foo', 'foo', '/home', 0);
			await printStandardCommand('$ ', 'echo bar', 'bar', undefined, 0);
			assertCommands([
				{ command: 'echo foo', exitCode: 0, cwd: '/home', marker: { line: 0 } },
				{ command: 'echo bar', exitCode: 0, cwd: '/home', marker: { line: 2 } }
			]);
		});
		test('should use an undefined cwd if it\'s not set initially', async () => {
			await printStandardCommand('$ ', 'echo foo', 'foo', undefined, 0);
			await printStandardCommand('$ ', 'echo bar', 'bar', '/home', 0);
			assertCommands([
				{ command: 'echo foo', exitCode: 0, cwd: undefined, marker: { line: 0 } },
				{ command: 'echo bar', exitCode: 0, cwd: '/home', marker: { line: 2 } }
			]);
		});
	});
});
