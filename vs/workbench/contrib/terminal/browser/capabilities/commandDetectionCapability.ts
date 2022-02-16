/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ICommandDetectionCapability, TerminalCapability, ITerminalCommand } from 'vs/workbench/contrib/terminal/common/capabilities/capabilities';
import { IBuffer, IDisposable, IMarker, Terminal } from 'xterm';

interface ICurrentPartialCommand {
	previousCommandMarker?: IMarker;

	promptStartMarker?: IMarker;

	commandStartMarker?: IMarker;
	commandStartX?: number;

	commandLines?: IMarker;

	commandExecutedMarker?: IMarker;
	commandExecutedX?: number;

	commandFinishedMarker?: IMarker;

	command?: string;
}

export class CommandDetectionCapability implements ICommandDetectionCapability {
	readonly type = TerminalCapability.CommandDetection;

	protected _commands: ITerminalCommand[] = [];
	private _exitCode: number | undefined;
	private _cwd: string | undefined;
	private _currentCommand: ICurrentPartialCommand = {};
	private _isWindowsPty: boolean = false;
	private _onCursorMoveListener?: IDisposable;
	private _commandMarkers: IMarker[] = [];

	get commands(): readonly ITerminalCommand[] { return this._commands; }

	private readonly _onCommandFinished = new Emitter<ITerminalCommand>();
	readonly onCommandFinished = this._onCommandFinished.event;

	constructor(
		private readonly _terminal: Terminal,
		@ILogService private readonly _logService: ILogService
	) { }

	setCwd(value: string) {
		this._cwd = value;
	}

	setIsWindowsPty(value: boolean) {
		this._isWindowsPty = value;
	}

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
		// On Windows track all cursor movements after the command start sequence
		if (this._isWindowsPty) {
			this._commandMarkers.length = 0;
			this._onCursorMoveListener = this._terminal.onCursorMove(() => {
				if (this._commandMarkers.length === 0 || this._commandMarkers[this._commandMarkers.length - 1].line !== this._terminal.buffer.active.cursorY) {
					const marker = this._terminal.registerMarker(0);
					if (marker) {
						this._commandMarkers.push(marker);
					}
				}
			});
		}
		this._logService.debug('CommandDetectionCapability#handleCommandStart', this._currentCommand.commandStartX, this._currentCommand.commandStartMarker?.line);
	}

	handleCommandExecuted(): void {
		// On Windows, use the gathered cursor move markers to correct the command start and
		// executed markers
		if (this._isWindowsPty) {
			this._onCursorMoveListener?.dispose();
			this._onCursorMoveListener = undefined;
		}

		this._currentCommand.commandExecutedMarker = this._terminal.registerMarker(0);
		this._currentCommand.commandExecutedX = this._terminal.buffer.active.cursorX;
		this._logService.debug('CommandDetectionCapability#handleCommandExecuted', this._currentCommand.commandExecutedX, this._currentCommand.commandExecutedMarker?.line);

		// Don't get the command on Windows, rely on the command line sequence for this
		if (this._isWindowsPty) {
			return;
		}

		// Sanity check optional props
		if (!this._currentCommand.commandStartMarker || !this._currentCommand.commandExecutedMarker || !this._currentCommand.commandStartX) {
			return;
		}

		// Calculate the command
		this._currentCommand.command = this._terminal.buffer.active.getLine(this._currentCommand.commandStartMarker.line)?.translateToString(true, this._currentCommand.commandStartX);
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
	}

	handleCommandFinished(exitCode: number | undefined): void {
		// On Windows, use the gathered cursor move markers to correct the command start and
		// executed markers. This is done on command finished just in case command executed never
		// happens (for example PSReadLine tab completion)
		if (this._isWindowsPty) {
			this._commandMarkers = this._commandMarkers.sort((a, b) => a.line - b.line);
			this._currentCommand.commandStartMarker = this._commandMarkers[0];
			this._currentCommand.commandExecutedMarker = this._commandMarkers[this._commandMarkers.length - 1];
		}

		this._currentCommand.commandFinishedMarker = this._terminal.registerMarker(0);
		const command = this._currentCommand.command;
		this._logService.debug('CommandDetectionCapability#handleCommandFinished', this._terminal.buffer.active.cursorX, this._currentCommand.commandFinishedMarker?.line, this._currentCommand.command, this._currentCommand);
		this._exitCode = exitCode;

		if (this._currentCommand.commandStartMarker === undefined || !this._terminal.buffer.active) {
			return;
		}
		if (command !== undefined && !command.startsWith('\\')) {
			const buffer = this._terminal.buffer.active;
			const clonedPartialCommand = { ...this._currentCommand };
			const timestamp = Date.now();
			const newCommand = {
				command,
				marker: this._currentCommand.commandStartMarker,
				endMarker: this._currentCommand.commandFinishedMarker,
				timestamp,
				cwd: this._cwd,
				exitCode: this._exitCode,
				hasOutput: !!(this._currentCommand.commandExecutedMarker && this._currentCommand.commandFinishedMarker && this._currentCommand.commandExecutedMarker?.line < this._currentCommand.commandFinishedMarker!.line),
				getOutput: () => getOutputForCommand(clonedPartialCommand, buffer)
			};
			this._commands.push(newCommand);
			this._logService.debug('CommandDetectionCapability#onCommandFinished', newCommand);
			this._onCommandFinished.fire(newCommand);
		}
		this._currentCommand.previousCommandMarker?.dispose();
		this._currentCommand.previousCommandMarker = this._currentCommand.commandStartMarker;
		this._currentCommand = {};
	}

	setCommandLine(commandLine: string) {
		this._logService.debug('CommandDetectionCapability#setCommandLine', commandLine);
		this._currentCommand.command = commandLine;
	}
}

function getOutputForCommand(command: ICurrentPartialCommand, buffer: IBuffer): string | undefined {
	const startLine = command.commandExecutedMarker!.line;
	const endLine = command.commandFinishedMarker!.line;

	if (startLine === endLine) {
		return undefined;
	}
	let output = '';
	for (let i = startLine; i < endLine; i++) {
		output += buffer.getLine(i)?.translateToString() + '\n';
	}
	return output === '' ? undefined : output;
}
