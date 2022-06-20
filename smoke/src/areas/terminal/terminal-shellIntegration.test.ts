/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Terminal, SettingsEditor, TerminalCommandIdWithValue, TerminalCommandId } from '../../../../automation';
import { setTerminalTestSettings } from './terminal-helpers';

export function setup() {
	describe('Terminal Shell Integration', () => {
		let terminal: Terminal;
		let settingsEditor: SettingsEditor;
		let app: Application;
		// Acquire automation API
		before(async function () {
			app = this.app as Application;
			terminal = app.workbench.terminal;
			settingsEditor = app.workbench.settingsEditor;
		});

		afterEach(async function () {
			await app.workbench.terminal.runCommand(TerminalCommandId.KillAll);
		});

		after(async function () {
			await settingsEditor.clearUserSettings();
		});

		async function createShellIntegrationProfile() {
			await terminal.runCommandWithValue(TerminalCommandIdWithValue.NewWithProfile, process.platform === 'win32' ? 'PowerShell' : 'bash');
		}

		async function createSimpleProfile() {
			await terminal.runCommandWithValue(TerminalCommandIdWithValue.NewWithProfile, process.platform === 'win32' ? 'Command Prompt' : 'sh');
		}

		// TODO: Some agents may not have pwsh installed?
		(process.platform === 'win32' ? describe.skip : describe)(`Process-based tests`, function () {
			before(async function () {
				await setTerminalTestSettings(app, [['terminal.integrated.shellIntegration.enabled', 'true']]);
			});
			describe('Decorations', function () {
				describe('Should show default icons', function () {

					it('Placeholder', async () => {
						await createShellIntegrationProfile();
						await terminal.assertCommandDecorations({ placeholder: 1, success: 0, error: 0 });
					});
					it('Success', async () => {
						await createShellIntegrationProfile();
						await terminal.runCommandInTerminal(`echo "success"`);
						await terminal.assertCommandDecorations({ placeholder: 1, success: 1, error: 0 });
					});
					it('Error', async () => {
						await createShellIntegrationProfile();
						await terminal.runCommandInTerminal(`false`);
						await terminal.assertCommandDecorations({ placeholder: 1, success: 0, error: 1 });
					});
				});
				describe('Custom configuration', function () {
					it('Should update and show custom icons', async () => {
						await createShellIntegrationProfile();
						await terminal.assertCommandDecorations({ placeholder: 1, success: 0, error: 0 });
						await terminal.runCommandInTerminal(`echo "foo"`);
						await terminal.runCommandInTerminal(`bar`);
						await settingsEditor.addUserSetting('terminal.integrated.shellIntegration.decorationIcon', '"zap"');
						await settingsEditor.addUserSetting('terminal.integrated.shellIntegration.decorationIconSuccess', '"zap"');
						await settingsEditor.addUserSetting('terminal.integrated.shellIntegration.decorationIconError', '"zap"');
						await terminal.assertCommandDecorations(undefined, { updatedIcon: "zap", count: 3 });
						await app.workbench.terminal.runCommand(TerminalCommandId.KillAll);
					});
				});
			});
		});

		describe('Write data-based tests', () => {
			before(async function () {
				await setTerminalTestSettings(app);
			});
			beforeEach(async function () {
				// Create the simplest system profile to get as little process interaction as possible
				await createSimpleProfile();
				// Erase all content and reset cursor to top
				await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `${csi('2J')}${csi('H')}`);
			});
			describe('VS Code sequences', () => {
				it('should handle the simple case', async () => {
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `${vsc('A')}Prompt> ${vsc('B')}exitcode 0`);
					await terminal.assertCommandDecorations({ placeholder: 1, success: 0, error: 0 });
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `\\r\\n${vsc('C')}Success\\r\\n${vsc('D;0')}`);
					await terminal.assertCommandDecorations({ placeholder: 0, success: 1, error: 0 });
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `${vsc('A')}Prompt> ${vsc('B')}exitcode 1`);
					await terminal.assertCommandDecorations({ placeholder: 1, success: 1, error: 0 });
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `\\r\\n${vsc('C')}Failure\\r\\n${vsc('D;1')}`);
					await terminal.assertCommandDecorations({ placeholder: 0, success: 1, error: 1 });
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `${vsc('A')}Prompt> ${vsc('B')}exitcode 1`);
					await terminal.assertCommandDecorations({ placeholder: 1, success: 1, error: 1 });
				});
			});
			// TODO: This depends on https://github.com/microsoft/vscode/issues/146587
			describe.skip('Final Term sequences', () => {
				it('should handle the simple case', async () => {
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `${ft('A')}Prompt> ${ft('B')}exitcode 0`);
					await terminal.assertCommandDecorations({ placeholder: 1, success: 0, error: 0 });
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `\\r\\n${ft('C')}Success\\r\\n${ft('D;0')}`);
					await terminal.assertCommandDecorations({ placeholder: 0, success: 1, error: 0 });
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `${ft('A')}Prompt> ${ft('B')}exitcode 1`);
					await terminal.assertCommandDecorations({ placeholder: 1, success: 1, error: 0 });
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `\\r\\n${ft('C')}Failure\\r\\n${ft('D;1')}`);
					await terminal.assertCommandDecorations({ placeholder: 0, success: 1, error: 1 });
					await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, `${ft('A')}Prompt> ${ft('B')}exitcode 1`);
					await terminal.assertCommandDecorations({ placeholder: 1, success: 1, error: 1 });
				});
			});
		});
	});
}

function ft(data: string) {
	return setTextParams(`133;${data}`);
}

function vsc(data: string) {
	return setTextParams(`633;${data}`);
}

function setTextParams(data: string) {
	return osc(`${data}\\x07`);
}

function osc(data: string) {
	return `\\x1b]${data}`;
}

function csi(data: string) {
	return `\\x1b[${data}`;
}
