/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { Registry } from 'vs/platform/registry/common/platform';
import { IAction } from 'vs/base/common/actions';
import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import { ICommandHandler, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { IMessageService } from 'vs/platform/message/common/message';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import Severity from 'vs/base/common/severity';

export const Extensions = {
	WorkbenchActions: 'workbench.contributions.actions'
};

export interface IActionProvider {
	getActions(): IAction[];
}

export interface IWorkbenchActionRegistry {

	/**
	 * Registers a workbench action to the platform. Workbench actions are not
	 * visible by default and can only be invoked through a keybinding if provided.
	 */
	registerWorkbenchAction(descriptor: SyncActionDescriptor, alias: string, category?: string): void;

	/**
	 * Unregisters a workbench action from the platform.
	 */
	unregisterWorkbenchAction(id: string): boolean;

	/**
	 * Returns the workbench action descriptor for the given id or null if none.
	 */
	getWorkbenchAction(id: string): SyncActionDescriptor;

	/**
	 * Returns an array of registered workbench actions known to the platform.
	 */
	getWorkbenchActions(): SyncActionDescriptor[];

	/**
	 * Returns the alias associated with the given action or null if none.
	 */
	getAlias(actionId: string): string;

	/**
	 * Returns the category for the given action or null if none.
	 */
	getCategory(actionId: string): string;
}

interface IActionMeta {
	alias: string;
	category?: string;
}

class WorkbenchActionRegistry implements IWorkbenchActionRegistry {

	public registerWorkbenchAction(descriptor: SyncActionDescriptor, alias: string, category?: string): void {
		registerWorkbenchCommandFromAction(descriptor, alias, category);
	}

	public unregisterWorkbenchAction(id: string): boolean {
		return true;
	}

	public getWorkbenchAction(id: string): SyncActionDescriptor {
		return null;
	}

	public getCategory(id: string): string {
		const commandAction = MenuRegistry.getCommand(id);
		if (!commandAction || !commandAction.category) {
			return null;
		}
		const { category } = commandAction;
		if (typeof category === 'string') {
			return category;
		} else {
			return category.value;
		}
	}

	public getAlias(id: string): string {
		const commandAction = MenuRegistry.getCommand(id);
		if (!commandAction) {
			return null;
		}
		const { title } = commandAction;
		if (typeof title === 'string') {
			return null;
		} else {
			return title.original;
		}
	}

	public getWorkbenchActions(): SyncActionDescriptor[] {
		return [];
	}
}

Registry.add(Extensions.WorkbenchActions, new WorkbenchActionRegistry());

function registerWorkbenchCommandFromAction(descriptor: SyncActionDescriptor, alias: string, category?: string): void {

	CommandsRegistry.registerCommand(descriptor.id, createCommandHandler(descriptor));

	{
		// register keybinding
		const when = descriptor.keybindingContext;
		const weight = (typeof descriptor.keybindingWeight === 'undefined' ? KeybindingsRegistry.WEIGHT.workbenchContrib() : descriptor.keybindingWeight);
		const keybindings = descriptor.keybindings;
		KeybindingsRegistry.registerKeybindingRule({
			id: descriptor.id,
			weight: weight,
			when: when,
			primary: keybindings && keybindings.primary,
			secondary: keybindings && keybindings.secondary,
			win: keybindings && keybindings.win,
			mac: keybindings && keybindings.mac,
			linux: keybindings && keybindings.linux
		});
	}

	{
		// register menu item
		if (descriptor.label) {
			// slightly weird if-check required because of
			// https://github.com/Microsoft/vscode/blob/d28ace31aa147596e35adf101a27768a048c79ec/src/vs/workbench/parts/files/browser/fileActions.contribution.ts#L194
			MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
				command: {
					id: descriptor.id,
					title: { value: descriptor.label, original: alias },
					category
				}
			});
		}
	}
}

function createCommandHandler(descriptor: SyncActionDescriptor): ICommandHandler {
	return (accessor, args) => {
		const messageService = accessor.get(IMessageService);
		const instantiationService = accessor.get(IInstantiationService);
		const telemetryService = accessor.get(ITelemetryService);
		const partService = accessor.get(IPartService);

		TPromise.as(triggerAndDisposeAction(instantiationService, telemetryService, partService, descriptor, args)).done(null, (err) => {
			messageService.show(Severity.Error, err);
		});
	};
}

function triggerAndDisposeAction(instantitationService: IInstantiationService, telemetryService: ITelemetryService, partService: IPartService, descriptor: SyncActionDescriptor, args: any): TPromise<any> {
	const actionInstance = instantitationService.createInstance(descriptor.syncDescriptor);
	actionInstance.label = descriptor.label || actionInstance.label;

	// don't run the action when not enabled
	if (!actionInstance.enabled) {
		actionInstance.dispose();

		return void 0;
	}

	const from = args && args.from || 'keybinding';
	if (telemetryService) {
		/* __GDPR__
			"workbenchActionExecuted" : {
				"id" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"from": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		telemetryService.publicLog('workbenchActionExecuted', { id: actionInstance.id, from });
	}

	// run action when workbench is created
	return partService.joinCreation().then(() => {
		try {
			return TPromise.as(actionInstance.run(undefined, { from })).then(() => {
				actionInstance.dispose();
			}, (err) => {
				actionInstance.dispose();
				return TPromise.wrapError(err);
			});
		} catch (err) {
			actionInstance.dispose();
			return TPromise.wrapError(err);
		}
	});
}
