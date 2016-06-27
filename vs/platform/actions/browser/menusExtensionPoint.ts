/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {createCSSRule} from 'vs/base/browser/dom';
import {localize} from 'vs/nls';
import {join} from 'vs/base/common/paths';
import {IdGenerator} from 'vs/base/common/idGenerator';
import {IJSONSchema} from 'vs/base/common/jsonSchema';
import {forEach} from 'vs/base/common/collections';
import {IExtensionPointUser, IExtensionMessageCollector, ExtensionsRegistry} from 'vs/platform/extensions/common/extensionsRegistry';
import {IDeclaredMenuItem, MenuRegistry} from './menuService';
import {MenuId} from 'vs/platform/actions/common/actions';

namespace schema {

	// --- menus contribution point

	export function parseMenuId(value: string): MenuId {
		switch (value) {
			case 'editor/title': return MenuId.EditorTitle;
			case 'editor/context': return MenuId.EditorContext;
			case 'explorer/context': return MenuId.ExplorerContext;
		}
	}

	export function isValidMenuItems(menu: IDeclaredMenuItem[], collector: IExtensionMessageCollector): boolean {
		if (!Array.isArray(menu)) {
			collector.error(localize('requirearry', "menu items must be an arry"));
			return false;
		}

		for (let item of menu) {
			if (typeof item.command !== 'string') {
				collector.error(localize('requirestring', "property `{0}` is mandatory and must be of type `string`", 'command'));
				return false;
			}
			if (item.alt && typeof item.alt !== 'string') {
				collector.error(localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'alt'));
				return false;
			}
			if (item.when && typeof item.when !== 'string') {
				collector.error(localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'when'));
				return false;
			}
			if (item.group && typeof item.group !== 'string') {
				collector.error(localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'group'));
				return false;
			}
		}

		return true;
	}

	const menuItem: IJSONSchema = {
		type: 'object',
		properties: {
			command: {
				description: localize('vscode.extension.contributes.menuItem.command', 'Identifier of the command to execute'),
				type: 'string'
			},
			alt: {
				description: localize('vscode.extension.contributes.menuItem.alt', 'Identifier of an alternative command to execute'),
				type: 'string'
			},
			when: {
				description: localize('vscode.extension.contributes.menuItem.when', 'Condition which must be true to show this item'),
				type: 'string'
			},
			group: {
				description: localize('vscode.extension.contributes.menuItem.group', 'Group into which this command belongs'),
				type: 'string'
			}
		}
	};

	export const menusContribtion: IJSONSchema = {
		description: localize('vscode.extension.contributes.menus', "Contributes menu items to predefined locations"),
		type: 'object',
		properties: {
			'editor/title': {
				type: 'array',
				items: menuItem
			},
			'explorer/context': {
				type: 'array',
				items: menuItem
			},
			'editor/context': {
				type: 'array',
				items: menuItem
			}
		}
	};

	// --- commands contribution point

	export interface IUserFriendlyCommand {
		command: string;
		title: string;
		category?: string;
		icon?: IUserFriendlyIcon;
	}

	export type IUserFriendlyIcon = string | { light: string; dark: string; };

	export function isValidCommand(command: IUserFriendlyCommand, collector: IExtensionMessageCollector): boolean {
		if (!command) {
			collector.error(localize('nonempty', "expected non-empty value."));
			return false;
		}
		if (typeof command.command !== 'string') {
			collector.error(localize('requirestring', "property `{0}` is mandatory and must be of type `string`", 'command'));
			return false;
		}
		if (typeof command.title !== 'string') {
			collector.error(localize('requirestring', "property `{0}` is mandatory and must be of type `string`", 'title'));
			return false;
		}
		if (command.category && typeof command.category !== 'string') {
			collector.error(localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'category'));
			return false;
		}
		if (!isValidIcon(command.icon, collector)) {
			return false;
		}
		return true;
	}

	function isValidIcon(icon: IUserFriendlyIcon, collector: IExtensionMessageCollector): boolean {
		if (typeof icon === 'undefined') {
			return true;
		}
		if (typeof icon === 'string') {
			return true;
		} else if (typeof icon.dark === 'string' && typeof icon.light === 'string') {
			return true;
		}
		collector.error(localize('opticon', "property `icon` can be omitted or must be either a string or a literal like `{dark, light}`"));
		return false;
	}

	const commandType: IJSONSchema = {
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
				description: localize('vscode.extension.contributes.commandType.category', '(Optional) Category string by the command is grouped in the UI'),
				type: 'string'
			},
			icon: {
				description: localize('vscode.extension.contributes.commandType.icon', '(Optional) Icon which is used to represent the command in the UI. Either a file path or a themable configuration'),
				anyOf: [
					'string',
					{
						type: 'object',
						properties: {
							light: {
								description: localize('vscode.extension.contributes.commandType.icon.light', 'Icon path when a light theme is used'),
								type: 'string'
							},
							dark: {
								description: localize('vscode.extension.contributes.commandType.icon.dark', 'Icon path when a dark theme is used'),
								type: 'string'
							}
						}
					}
				]
			}
		}
	};

	export const commandsContribution: IJSONSchema = {
		description: localize('vscode.extension.contributes.commands', "Contributes commands to the command palette."),
		oneOf: [
			commandType,
			{
				type: 'array',
				items: commandType
			}
		]
	};
}

ExtensionsRegistry.registerExtensionPoint<schema.IUserFriendlyCommand | schema.IUserFriendlyCommand[]>('commands', schema.commandsContribution).setHandler(extensions => {

	const ids = new IdGenerator('contrib-cmd-icon-');

	function handleCommand(userFriendlyCommand: schema.IUserFriendlyCommand , extension: IExtensionPointUser<any>) {

		if (!schema.isValidCommand(userFriendlyCommand, extension.collector)) {
			return;
		}

		let {icon, category, title, command} = userFriendlyCommand;
		let iconClass: string;
		if (icon) {
			iconClass = ids.nextId();
			if (typeof icon === 'string') {
				const path = join(extension.description.extensionFolderPath, icon);
				createCSSRule(`.icon.${iconClass}`, `background-image: url("${path}")`);
			} else {
				const light = join(extension.description.extensionFolderPath, icon.light);
				const dark = join(extension.description.extensionFolderPath, icon.dark);
				createCSSRule(`.icon.${iconClass}`, `background-image: url("${light}")`);
				createCSSRule(`.vs-dark .icon.${iconClass}, hc-black .icon.${iconClass}`, `background-image: url("${dark}")`);
			}
		}

		if (MenuRegistry.addCommand({ id: command, title, category, iconClass })) {
			extension.collector.info(localize('dup', "Command `{0}` appears multiple times in the `commands` section.", userFriendlyCommand.command));
		}
	}

	for (let extension of extensions) {
		const {value} = extension;
		if (Array.isArray<schema.IUserFriendlyCommand>(value)) {
			for (let command of value) {
				handleCommand(command, extension);
			}
		} else {
			handleCommand(value, extension);
		}
	}
});


ExtensionsRegistry.registerExtensionPoint<{ [loc: string]: IDeclaredMenuItem[] }>('menus', schema.menusContribtion).setHandler(extensions => {
	for (let extension of extensions) {
		const {value, collector} = extension;

		forEach(value, entry => {
			if (!schema.isValidMenuItems(entry.value, collector)) {
				return;
			}

			const menu = schema.parseMenuId(entry.key);
			if (!menu) {
				collector.warn(localize('menuId.invalid', "`{0}` is not a valid menu identifier", entry.key));
				return;
			}

			for (let item of entry.value) {
				if (!MenuRegistry.hasCommand(item.command)) {
					collector.warn(localize('missing.command', "Menu item references command `{0}` but is not defined in the `commands` section.", item.command));
				}
				if (item.alt && !MenuRegistry.hasCommand(item.alt)) {
					collector.warn(localize('missing.altCommand', "Menu item references alt-command `{0}` but is not defined in the `commands` section.", item.alt));
				}
				if (item.command || item.alt) {
					collector.info(localize('dupe.command', "Menu item references the same command as default and alternative command"));
				}
			}

			MenuRegistry.addMenuItems(menu, entry.value);
		});
	}
});
