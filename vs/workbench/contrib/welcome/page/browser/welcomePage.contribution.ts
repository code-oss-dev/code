/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { WelcomePageContribution, WelcomePageAction, WelcomeInputFactory } from 'vs/workbench/contrib/welcome/page/browser/welcomePage';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions, CATEGORIES } from 'vs/workbench/common/actions';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationNode } from 'vs/platform/configuration/common/configurationRegistry';
import { IEditorInputFactoryRegistry, Extensions as EditorExtensions } from 'vs/workbench/common/editor';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';

export const DEFAULT_STARTUP_EDITOR_CONFIG: IConfigurationNode = {
	...workbenchConfigurationNodeBase,
	'properties': {
		'workbench.startupEditor': {
			'scope': ConfigurationScope.RESOURCE,
			'type': 'string',
			'enum': ['none', 'welcomePage', 'readme', 'newUntitledFile', 'welcomePageInEmptyWorkbench', 'gettingStarted'],
			'enumDescriptions': [...[
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.none' }, "Start without an editor."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePage' }, "Open the Welcome page."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.readme' }, "Open the README when opening a folder that contains one, fallback to 'welcomePage' otherwise."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.newUntitledFile' }, "Open a new untitled file (only applies when opening an empty window)."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePageInEmptyWorkbench' }, "Open the Welcome page when opening an empty workbench."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.gettingStarted' }, "Open the Getting Started page.")]
			],
			'default': 'welcomePage',
			'description': localize('workbench.startupEditor', "Controls which editor is shown at startup, if none are restored from the previous session.")
		},
	}
};

export const EXPERIMENTAL_GETTING_STARTED_STARTUP_EDITOR_CONFIG: IConfigurationNode = {
	...workbenchConfigurationNodeBase,
	'properties': {
		'workbench.startupEditor': {
			'scope': ConfigurationScope.RESOURCE,
			'type': 'string',
			'enum': ['none', 'welcomePage', 'readme', 'newUntitledFile', 'welcomePageInEmptyWorkbench', 'gettingStarted'],
			'enumDescriptions': [...[
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.none' }, "Start without an editor."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePage' }, "Open the Welcome page."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.readme' }, "Open the README when opening a folder that contains one, fallback to 'welcomePage' otherwise."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.newUntitledFile' }, "Open a new untitled file (only applies when opening an empty window)."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePageInEmptyWorkbench' }, "Open the Welcome page when opening an empty workbench."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.gettingStarted' }, "Open the Getting Started page.")]
			],
			'default': 'gettingStarted',
			'description': localize('workbench.startupEditor', "Controls which editor is shown at startup, if none are restored from the previous session.")
		},
	}
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration(DEFAULT_STARTUP_EDITOR_CONFIG);

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(WelcomePageContribution, LifecyclePhase.Restored);

Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions)
	.registerWorkbenchAction(SyncActionDescriptor.from(WelcomePageAction), 'Help: Welcome', CATEGORIES.Help.value);

Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputFactory(WelcomeInputFactory.ID, WelcomeInputFactory);

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: '1_welcome',
	command: {
		id: 'workbench.action.showWelcomePage',
		title: localize({ key: 'miWelcome', comment: ['&& denotes a mnemonic'] }, "&&Welcome")
	},
	order: 1
});
