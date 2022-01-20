/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { isWindows } from 'vs/base/common/platform';
import { ILogService } from 'vs/platform/log/common/log';
import { TerminalCapability } from 'vs/platform/terminal/common/terminal';
import { TerminalCommand } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IBuffer, IMarker, Terminal } from 'xterm';

interface ICurrentPartialCommand {
	previousCommandMarker?: IMarker;

	promptStartMarker?: IMarker;

	commandStartMarker?: IMarker;
	commandStartX?: number;

	commandExecutedMarker?: IMarker;
	commandExecutedX?: number;

	commandFinishedMarker?: IMarker;

	command?: string;
}

export class CommandDetectionCapability {
	readonly type = TerminalCapability.CommandDetection;

	private _commands: TerminalCommand[] = [];
	private _exitCode: number | undefined;
	private _cwd: string | undefined;
	private _currentCommand: ICurrentPartialCommand = {};

	get commands(): readonly TerminalCommand[] { return this._commands; }

	set cwd(value: string) { this._cwd = value; }

	private readonly _onCommandFinished = new Emitter<TerminalCommand>();
	readonly onCommandFinished = this._onCommandFinished.event;

	constructor(
		private _terminal: Terminal,
		@ILogService private readonly _logService: ILogService
	) {
	}

	/**
	 * Gets the working directory for a line, this will return undefined if it's unknown in which
	 * case the terminal's initial cwd should be used.
	 */
	getCwdForLine(line: number): string | undefined {
		// TODO: It would be more reliable to take the closest cwd above the line if it isn't found for the line
		// TODO: Use a reverse for loop to find the line to avoid creating another array
		const reversed = [...this._commands].reverse();
		return reversed.find(c => c.marker!.line <= line - 1)?.cwd;
	}

	handlePromptStart(): void {
		this._currentCommand.promptStartMarker = this._terminal.registerMarker(0);
		this._logService.debug('CommandDetectionCapability#handlePromptStart', this._terminal.buffer.active.cursorX, this._currentCommand.promptStartMarker?.line);
	}

	handleCommandStart(): void {
		this._currentCommand.commandStartX = this._terminal.buffer.active.cursorX;
		this._currentCommand.commandStartMarker = this._terminal.registerMarker(0);
		this._logService.debug('CommandDetectionCapability#handleCommandStart', this._currentCommand.commandStartX, this._currentCommand.commandStartMarker?.line);
	}

	handleCommandExecuted(): void {
		this._currentCommand.commandExecutedMarker = this._terminal.registerMarker(0);
		this._logService.debug('CommandDetectionCapability#handleCommandExecuted', this._terminal.buffer.active.cursorX, this._currentCommand.commandExecutedMarker?.line);
		// TODO: Make sure this only runs on Windows backends (not frontends)
		if (!isWindows && this._currentCommand.commandStartMarker && this._currentCommand.commandExecutedMarker && this._currentCommand.commandStartX) {
			this._currentCommand.command = this._terminal.buffer.active.getLine(this._currentCommand.commandStartMarker.line)?.translateToString().substring(this._currentCommand.commandStartX);
			let y = this._currentCommand.commandStartMarker.line + 1;
			const commandExecutedLine = this._currentCommand.commandExecutedMarker.line;
			for (; y < commandExecutedLine; y++) {
				const line = this._terminal.buffer.active.getLine(y);
				if (line) {
					this._currentCommand.command += line.translateToString(true);
				}
			}
			if (y === commandExecutedLine) {
				this._currentCommand.command += this._terminal.buffer.active.getLine(commandExecutedLine)?.translateToString(true, undefined, this._currentCommand.commandExecutedX) || '';
			}
			return;
		}

		// TODO: Leverage key events on Windows between CommandStart and Executed to ensure we have the correct line

		// TODO: Only do this on Windows backends
		// Check if the command line is the same as the previous command line or if the
		// start Y differs from the executed Y. This is to catch the conpty case where the
		// "rendering" of the shell integration sequences doesn't occur on the correct cell
		// due to https://github.com/microsoft/terminal/issues/11220
		if (this._currentCommand.previousCommandMarker?.line === this._currentCommand.commandStartMarker?.line ||
			this._currentCommand.commandStartMarker?.line === this._currentCommand.commandExecutedMarker?.line) {
			this._currentCommand.commandStartMarker = this._terminal?.registerMarker(0);
			this._currentCommand.commandStartX = 0;
		}

		// TODO: This does not yet work when the prompt line is wrapped
		this._currentCommand.command = this._terminal!.buffer.active.getLine(this._currentCommand.commandExecutedMarker!.line)?.translateToString(true, this._currentCommand.commandStartX || 0);

		// TODO: Only do this on Windows backends
		// Something went wrong, try predict the prompt based on the shell.
		if (this._currentCommand.commandStartX === 0) {
			// TODO: Only do this on pwsh
			const promptPredictions = [
				`PS ${this._cwd}> `,
				`PS>`,
			];
			for (const promptPrediction of promptPredictions) {
				if (this._currentCommand.command?.startsWith(promptPrediction)) {
					// TODO: Consider cell vs string positioning; test CJK
					this._currentCommand.commandStartX = promptPrediction.length;
					this._currentCommand.command = this._currentCommand.command.substring(this._currentCommand.commandStartX);
					break;
				}
			}
		}
	}

	handleCommandFinished(exitCode: number): void {
		// TODO: Make sure naive command tracking still works
		// if (this._terminal.buffer.active.cursorX >= 2) {
		// this._terminal.registerMarker(0);
		// this.clearMarker();
		// }

		this._currentCommand.commandFinishedMarker = this._terminal.registerMarker(0);
		const command = this._currentCommand.command;
		this._logService.debug('CommandDetectionCapability#handleCommandFinished', this._terminal.buffer.active.cursorX, this._currentCommand.commandFinishedMarker?.line, this._currentCommand.command, this._currentCommand);
		this._exitCode = exitCode;
		if (!this._currentCommand.commandStartMarker?.line || !this._terminal.buffer.active) {
			return;
		}
		if (command && !command.startsWith('\\') && command !== '') {
			const buffer = this._terminal.buffer.active;
			const clonedPartialCommand = { ...this._currentCommand };
			const newCommand = {
				command,
				timestamp: Date.now(),
				cwd: this._cwd,
				exitCode: this._exitCode,
				getOutput: () => getOutputForCommand(clonedPartialCommand, buffer),
				marker: this._currentCommand.commandStartMarker
			};
			this._commands.push(newCommand);
		}
		this._currentCommand.previousCommandMarker?.dispose();
		this._currentCommand.previousCommandMarker = this._currentCommand.commandStartMarker;
		this._currentCommand = {};
	}

	/**
	 * Set the command line explicitly.
	 */
	setCommandLine(commandLine: string) {
		this._logService.debug('CommandDetectionCapability#setCommandLine', commandLine);
		this._currentCommand.command = commandLine;
	}
}

function getOutputForCommand(command: ICurrentPartialCommand, buffer: IBuffer): string | undefined {
	const startLine = command.previousCommandMarker ? command.previousCommandMarker.line! + 1 : 0;
	const endLine = command.commandStartMarker!.line!;
	let output = '';
	for (let i = startLine; i < endLine; i++) {
		output += buffer.getLine(i)?.translateToString() + '\n';
	}
	return output === '' ? undefined : output;
}
