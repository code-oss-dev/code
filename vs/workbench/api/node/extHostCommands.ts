/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { validateConstraint } from 'vs/base/common/types';
import { ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { TPromise } from 'vs/base/common/winjs.base';
import * as extHostTypes from 'vs/workbench/api/node/extHostTypes';
import * as extHostTypeConverter from 'vs/workbench/api/node/extHostTypeConverters';
import { cloneAndChange } from 'vs/base/common/objects';
import { MainContext, MainThreadCommandsShape, ExtHostCommandsShape, ObjectIdentifier, IMainContext } from './extHost.protocol';
import { ExtHostHeapService } from 'vs/workbench/api/node/extHostHeapService';
import { isFalsyOrEmpty } from 'vs/base/common/arrays';
import * as modes from 'vs/editor/common/modes';
import * as vscode from 'vscode';

interface CommandHandler {
	callback: Function;
	thisArg: any;
	description: ICommandHandlerDescription;
}

export interface ArgumentProcessor {
	processArgument(arg: any): any;
}

export class ExtHostCommands implements ExtHostCommandsShape {

	private _commands = new Map<string, CommandHandler>();
	private _proxy: MainThreadCommandsShape;
	private _converter: CommandsConverter;
	private _argumentProcessors: ArgumentProcessor[] = [];

	constructor(
		mainContext: IMainContext,
		heapService: ExtHostHeapService
	) {
		this._proxy = mainContext.get(MainContext.MainThreadCommands);
		this._converter = new CommandsConverter(this, heapService);
	}

	get converter(): CommandsConverter {
		return this._converter;
	}

	registerArgumentProcessor(processor: ArgumentProcessor): void {
		this._argumentProcessors.push(processor);
	}

	registerCommand(id: string, callback: <T>(...args: any[]) => T | Thenable<T>, thisArg?: any, description?: ICommandHandlerDescription): extHostTypes.Disposable {

		if (!id.trim().length) {
			throw new Error('invalid id');
		}

		if (this._commands.has(id)) {
			throw new Error(`command '${id}' already exists`);
		}

		this._commands.set(id, { callback, thisArg, description });
		this._proxy.$registerCommand(id);

		return new extHostTypes.Disposable(() => {
			if (this._commands.delete(id)) {
				this._proxy.$unregisterCommand(id);
			}
		});
	}

	executeCommand<T>(id: string, ...args: any[]): Thenable<T> {

		if (this._commands.has(id)) {
			// we stay inside the extension host and support
			// to pass any kind of parameters around
			return this._executeContributedCommand<T>(id, ...args);

		} else {
			// automagically convert some argument types

			args = cloneAndChange(args, function (value) {
				if (value instanceof extHostTypes.Position) {
					return extHostTypeConverter.fromPosition(value);
				}
				if (value instanceof extHostTypes.Range) {
					return extHostTypeConverter.fromRange(value);
				}
				if (value instanceof extHostTypes.Location) {
					return extHostTypeConverter.location.from(value);
				}
				if (!Array.isArray(value)) {
					return value;
				}
			});

			return this._proxy.$executeCommand<T>(id, args);
		}
	}

	private _executeContributedCommand<T>(id: string, ...args: any[]): Thenable<T> {
		let command = this._commands.get(id);
		if (!command) {
			return TPromise.wrapError<T>(new Error(`Contributed command '${id}' does not exist.`));
		}

		let { callback, thisArg, description } = command;

		if (description) {
			for (let i = 0; i < description.args.length; i++) {
				try {
					validateConstraint(args[i], description.args[i].constraint);
				} catch (err) {
					return TPromise.wrapError<T>(new Error(`Running the contributed command:'${id}' failed. Illegal argument '${description.args[i].name}' - ${description.args[i].description}`));
				}
			}
		}

		args = args.map(arg => this._argumentProcessors.reduce((r, p) => p.processArgument(r), arg));

		try {
			let result = callback.apply(thisArg, args);
			return TPromise.as(result);
		} catch (err) {
			// console.log(err);
			// try {
			// 	console.log(toErrorMessage(err));
			// } catch (err) {
			// 	//
			// }
			return TPromise.wrapError<T>(new Error(`Running the contributed command:'${id}' failed.`));
		}
	}

	$executeContributedCommand<T>(id: string, ...args: any[]): Thenable<void> {
		return this._executeContributedCommand(id, ...args).then(result => void 0);
	}

	getCommands(filterUnderscoreCommands: boolean = false): Thenable<string[]> {
		return this._proxy.$getCommands().then(result => {
			if (filterUnderscoreCommands) {
				result = result.filter(command => command[0] !== '_');
			}
			return result;
		});
	}

	$getContributedCommandHandlerDescriptions(): TPromise<{ [id: string]: string | ICommandHandlerDescription }> {
		const result: { [id: string]: string | ICommandHandlerDescription } = Object.create(null);
		this._commands.forEach((command, id) => {
			let { description } = command;
			if (description) {
				result[id] = description;
			}
		});
		return TPromise.as(result);
	}
}


export class CommandsConverter {

	private _commands: ExtHostCommands;
	private _heap: ExtHostHeapService;

	// --- conversion between internal and api commands
	constructor(commands: ExtHostCommands, heap: ExtHostHeapService) {

		this._commands = commands;
		this._heap = heap;
		this._commands.registerCommand('_internal_command_delegation', this._executeConvertedCommand, this);
	}

	toInternal(command: vscode.Command): modes.Command {

		if (!command) {
			return undefined;
		}

		const result: modes.Command = {
			id: command.command,
			title: command.title
		};

		if (command.command && !isFalsyOrEmpty(command.arguments)) {
			// we have a contributed command with arguments. that
			// means we don't want to send the arguments around

			const id = this._heap.keep(command);
			ObjectIdentifier.mixin(result, id);

			result.id = '_internal_command_delegation';
			result.arguments = [id];
		}

		if (command.tooltip) {
			result.tooltip = command.tooltip;
		}

		return result;
	}

	fromInternal(command: modes.Command): vscode.Command {

		if (!command) {
			return undefined;
		}

		const id = ObjectIdentifier.of(command);
		if (typeof id === 'number') {
			return this._heap.get<vscode.Command>(id);

		} else {
			return {
				command: command.id,
				title: command.title,
				arguments: command.arguments
			};
		}
	}

	private _executeConvertedCommand<R>(...args: any[]): Thenable<R> {
		const actualCmd = this._heap.get<vscode.Command>(args[0]);
		return this._commands.executeCommand(actualCmd.command, ...actualCmd.arguments);
	}

}
