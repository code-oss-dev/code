/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IQuickAccessRegistry, Extensions } from 'vs/platform/quickinput/common/quickAccess';
import { Registry } from 'vs/platform/registry/common/platform';
import { HelpQuickAccessProvider } from 'vs/platform/quickinput/browser/helpQuickAccess';
import { ViewQuickAccessProvider, OpenViewPickerAction, QuickOpenViewPickerAction } from 'vs/workbench/contrib/quickaccess/browser/viewQuickAccess';
import { CommandsQuickAccessProvider, CommandPaletteEditorAction, ShowAllCommandsAction, ClearCommandHistoryAction } from 'vs/workbench/contrib/quickaccess/browser/commandsQuickAccess';
import { registerEditorAction } from 'vs/editor/browser/editorExtensions';
import { MenuRegistry, MenuId, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actions';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { GotoLineAction } from 'vs/workbench/contrib/codeEditor/browser/quickaccess/gotoLineQuickAccess';
import { GotoSymbolAction } from 'vs/workbench/contrib/codeEditor/browser/quickaccess/gotoSymbolQuickAccess';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { inQuickOpenContext, getQuickNavigateHandler } from 'vs/workbench/browser/quickopen';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

//#region Quick Access Proviers

const quickOpenRegistry = Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess);

quickOpenRegistry.registerQuickAccessProvider({
	ctor: HelpQuickAccessProvider,
	prefix: HelpQuickAccessProvider.PREFIX,
	placeholder: localize('helpQuickAccessPlaceholder', "Type '{0}' to get help on the actions you can take from here.", HelpQuickAccessProvider.PREFIX),
	helpEntries: [{ description: localize('helpQuickAccess', "Show all Quick Access Providers"), needsEditor: false }]
});

quickOpenRegistry.registerQuickAccessProvider({
	ctor: ViewQuickAccessProvider,
	prefix: ViewQuickAccessProvider.PREFIX,
	contextKey: 'inViewsPicker',
	placeholder: localize('viewQuickAccessPlaceholder', "Type the name of a view, output channel or terminal to open."),
	helpEntries: [{ description: localize('viewQuickAccess', "Open View"), needsEditor: false }]
});

quickOpenRegistry.registerQuickAccessProvider({
	ctor: CommandsQuickAccessProvider,
	prefix: CommandsQuickAccessProvider.PREFIX,
	contextKey: 'inCommandsPicker',
	placeholder: localize('commandsQuickAccessPlaceholder', "Type the name of a command to run."),
	helpEntries: [{ description: localize('commandsQuickAccess', "Show and Run Commands"), needsEditor: false }]
});

//#endregion


//#region Menu contributions

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '1_open',
	command: {
		id: ShowAllCommandsAction.ID,
		title: localize({ key: 'miCommandPalette', comment: ['&& denotes a mnemonic'] }, "&&Command Palette...")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '1_open',
	command: {
		id: OpenViewPickerAction.ID,
		title: localize({ key: 'miOpenView', comment: ['&& denotes a mnemonic'] }, "&&Open View...")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '4_symbol_nav',
	command: {
		id: 'workbench.action.gotoSymbol',
		title: localize({ key: 'miGotoSymbolInEditor', comment: ['&& denotes a mnemonic'] }, "Go to &&Symbol in Editor...")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '5_infile_nav',
	command: {
		id: 'workbench.action.gotoLine',
		title: localize({ key: 'miGotoLine', comment: ['&& denotes a mnemonic'] }, "Go to &&Line/Column...")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '1_command',
	command: {
		id: ShowAllCommandsAction.ID,
		title: localize('commandPalette', "Command Palette...")
	},
	order: 1
});

//#endregion


//#region Workbench actions and commands

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.create(ClearCommandHistoryAction, ClearCommandHistoryAction.ID, ClearCommandHistoryAction.LABEL), 'Clear Command History');
registry.registerWorkbenchAction(SyncActionDescriptor.create(ShowAllCommandsAction, ShowAllCommandsAction.ID, ShowAllCommandsAction.LABEL, {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_P,
	secondary: [KeyCode.F1]
}), 'Show All Commands');

registry.registerWorkbenchAction(SyncActionDescriptor.create(GotoLineAction, GotoLineAction.ID, GotoLineAction.LABEL, {
	primary: KeyMod.CtrlCmd | KeyCode.KEY_G,
	mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_G }
}), 'Go to Line/Column...');

registry.registerWorkbenchAction(SyncActionDescriptor.create(GotoSymbolAction, GotoSymbolAction.ID, GotoSymbolAction.LABEL, {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_O
}), 'Go to Symbol in Editor...');

const inViewsPickerContextKey = 'inViewsPicker';
const inViewsPickerContext = ContextKeyExpr.and(inQuickOpenContext, ContextKeyExpr.has(inViewsPickerContextKey));

const viewPickerKeybinding = { primary: KeyMod.CtrlCmd | KeyCode.KEY_Q, mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_Q }, linux: { primary: 0 } };

const viewCategory = localize('view', "View");
registry.registerWorkbenchAction(SyncActionDescriptor.create(OpenViewPickerAction, OpenViewPickerAction.ID, OpenViewPickerAction.LABEL), 'View: Open View', viewCategory);
registry.registerWorkbenchAction(SyncActionDescriptor.create(QuickOpenViewPickerAction, QuickOpenViewPickerAction.ID, QuickOpenViewPickerAction.LABEL, viewPickerKeybinding), 'View: Quick Open View', viewCategory);

const quickOpenNavigateNextInViewPickerId = 'workbench.action.quickOpenNavigateNextInViewPicker';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: quickOpenNavigateNextInViewPickerId,
	weight: KeybindingWeight.WorkbenchContrib + 50,
	handler: getQuickNavigateHandler(quickOpenNavigateNextInViewPickerId, true),
	when: inViewsPickerContext,
	primary: viewPickerKeybinding.primary,
	linux: viewPickerKeybinding.linux,
	mac: viewPickerKeybinding.mac
});

const quickOpenNavigatePreviousInViewPickerId = 'workbench.action.quickOpenNavigatePreviousInViewPicker';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: quickOpenNavigatePreviousInViewPickerId,
	weight: KeybindingWeight.WorkbenchContrib + 50,
	handler: getQuickNavigateHandler(quickOpenNavigatePreviousInViewPickerId, false),
	when: inViewsPickerContext,
	primary: viewPickerKeybinding.primary | KeyMod.Shift,
	linux: viewPickerKeybinding.linux,
	mac: {
		primary: viewPickerKeybinding.mac.primary | KeyMod.Shift
	}
});

//#endregion


//#region Actions

registerEditorAction(CommandPaletteEditorAction);

//#endregion
