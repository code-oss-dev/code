/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { MenuId, MenuRegistry, SyncActionDescriptor, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actions';
import { OutputService, LogContentProvider } from 'vs/workbench/contrib/output/browser/outputServices';
import { ToggleOutputAction, ClearOutputAction, OpenLogOutputFile, ShowLogsOutputChannelAction, OpenOutputLogFileAction } from 'vs/workbench/contrib/output/browser/outputActions';
import { OUTPUT_MODE_ID, OUTPUT_MIME, OUTPUT_VIEW_ID, IOutputService, CONTEXT_IN_OUTPUT, LOG_SCHEME, LOG_MODE_ID, LOG_MIME, CONTEXT_ACTIVE_LOG_OUTPUT } from 'vs/workbench/contrib/output/common/output';
import { OutputViewPane } from 'vs/workbench/contrib/output/browser/outputView';
import { IEditorRegistry, Extensions as EditorExtensions, EditorDescriptor } from 'vs/workbench/browser/editor';
import { LogViewer, LogViewerInput } from 'vs/workbench/contrib/output/browser/logViewer';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';

// Register Service
registerSingleton(IOutputService, OutputService);

// Register Output Mode
ModesRegistry.registerLanguage({
	id: OUTPUT_MODE_ID,
	extensions: [],
	mimetypes: [OUTPUT_MIME]
});

// Register Log Output Mode
ModesRegistry.registerLanguage({
	id: LOG_MODE_ID,
	extensions: [],
	mimetypes: [LOG_MIME]
});

// register output container
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: OUTPUT_VIEW_ID,
	name: nls.localize('output', "Output"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [OUTPUT_VIEW_ID, OUTPUT_VIEW_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	focusCommand: {
		id: ToggleOutputAction.ID, keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_U,
			linux: {
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_H)  // On Ubuntu Ctrl+Shift+U is taken by some global OS command
			}
		}
	}
}, ViewContainerLocation.Panel);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: OUTPUT_VIEW_ID,
	name: nls.localize('output', "Output"),
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(OutputViewPane),
}], VIEW_CONTAINER);

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		LogViewer,
		LogViewer.LOG_VIEWER_EDITOR_ID,
		nls.localize('logViewer', "Log Viewer")
	),
	[
		new SyncDescriptor(LogViewerInput)
	]
);

class OutputContribution implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ITextModelService textModelService: ITextModelService
	) {
		textModelService.registerTextModelContentProvider(LOG_SCHEME, instantiationService.createInstance(LogContentProvider));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(OutputContribution, LifecyclePhase.Restored);

// register toggle output action globally
const actionRegistry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.create(ToggleOutputAction, ToggleOutputAction.ID, ToggleOutputAction.LABEL, {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_U,
	linux: {
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_H)  // On Ubuntu Ctrl+Shift+U is taken by some global OS command
	}
}), 'View: Toggle Output', nls.localize('viewCategory', "View"));

actionRegistry.registerWorkbenchAction(SyncActionDescriptor.create(ClearOutputAction, ClearOutputAction.ID, ClearOutputAction.LABEL),
	'View: Clear Output', nls.localize('viewCategory', "View"));

const devCategory = nls.localize('developer', "Developer");
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.create(ShowLogsOutputChannelAction, ShowLogsOutputChannelAction.ID, ShowLogsOutputChannelAction.LABEL), 'Developer: Show Logs...', devCategory);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.create(OpenOutputLogFileAction, OpenOutputLogFileAction.ID, OpenOutputLogFileAction.LABEL), 'Developer: Open Log File...', devCategory);

// Define clear command, contribute to editor context menu
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'editor.action.clearoutput',
			title: { value: nls.localize('clearOutput.label', "Clear Output"), original: 'Clear Output' },
			menu: {
				id: MenuId.EditorContext,
				when: CONTEXT_IN_OUTPUT
			},
		});
	}
	run(accessor: ServicesAccessor) {
		const activeChannel = accessor.get(IOutputService).getActiveChannel();
		if (activeChannel) {
			activeChannel.clear();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.openActiveLogOutputFile',
			title: { value: nls.localize('openActiveLogOutputFile', "Open Active Log Output File"), original: 'Open Active Log Output File' },
			menu: {
				id: MenuId.CommandPalette,
				when: CONTEXT_ACTIVE_LOG_OUTPUT
			},
		});
	}
	run(accessor: ServicesAccessor) {
		accessor.get(IInstantiationService).createInstance(OpenLogOutputFile).run();
	}
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '4_panels',
	command: {
		id: ToggleOutputAction.ID,
		title: nls.localize({ key: 'miToggleOutput', comment: ['&& denotes a mnemonic'] }, "&&Output")
	},
	order: 1
});

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'output',
	order: 30,
	title: nls.localize('output', "Output"),
	type: 'object',
	properties: {
		'output.smartScroll.enabled': {
			type: 'boolean',
			description: nls.localize('output.smartScroll.enabled', "Enable/disable the ability of smart scrolling in the output view. Smart scrolling allows you to lock scrolling automatically when you click in the output view and unlocks when you click in the last line."),
			default: true,
			scope: ConfigurationScope.APPLICATION,
			tags: ['output']
		}
	}
});
