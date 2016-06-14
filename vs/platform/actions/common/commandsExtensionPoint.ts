/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {localize} from 'vs/nls';
import {IJSONSchema} from 'vs/base/common/jsonSchema';
import {IExtensionMessageCollector, ExtensionsRegistry} from 'vs/platform/extensions/common/extensionsRegistry';

export interface Command {
	command: string;
	title: string;
	category?: string;
}

function isCommands(thing: Command | Command[]): thing is Command[] {
	return Array.isArray(thing);
}

function isValidCommand(candidate: Command, rejects: string[]): boolean {
	if (!candidate) {
		rejects.push(localize('nonempty', "expected non-empty value."));
		return false;
	}
	if (typeof candidate.command !== 'string') {
		rejects.push(localize('requirestring', "property `{0}` is mandatory and must be of type `string`", 'command'));
		return false;
	}
	if (typeof candidate.title !== 'string') {
		rejects.push(localize('requirestring', "property `{0}` is mandatory and must be of type `string`", 'title'));
		return false;
	}
	if (candidate.category && typeof candidate.category !== 'string') {
		rejects.push(localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'category'));
		return false;
	}
	return true;
}

let commandType: IJSONSchema = {
	type: 'object',
	properties: {
		command: {
			description: localize('vscode.extension.contributes.commandType.command', 'Identifier of the command to execute'),
			type: 'string'
		},
		title: {
			description: localize('vscode.extension.contributes.commandType.title', 'Title by which the command is represented in the UI'),
			type: 'string'
		},
		category: {
			description: localize('vscode.extension.contributes.commandType.category', '(Optional) category string by the command is grouped in the UI'),
			type: 'string'
		}
	}
};

function handleCommand(command: Command, collector: IExtensionMessageCollector): void {

	let rejects: string[] = [];

	if (isValidCommand(command, rejects)) {
		// keep command
		commands.push(command);

	} else if (rejects.length > 0) {
		collector.error(localize(
			'error',
			"Invalid `contributes.commands`: {0}",
			rejects.join('\n')
		));
	}
}

export const commands: Command[] = [];

ExtensionsRegistry.registerExtensionPoint<Command | Command[]>('commands', {
	description: localize('vscode.extension.contributes.commands', "Contributes commands to the command palette."),
	oneOf: [
		commandType,
		{
			type: 'array',
			items: commandType
		}
	]
}).setHandler(extensions => {
	for (let extension of extensions) {
		const {value, collector} = extension;
		if (isCommands(value)) {
			for (let command of value) {
				handleCommand(command, collector);
			}
		} else {
			handleCommand(value, collector);
		}
	}

	Object.freeze(commands);
});
