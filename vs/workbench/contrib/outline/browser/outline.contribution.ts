/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IViewsRegistry, IViewDescriptor, Extensions as ViewExtensions, ViewContainer, IViewContainersRegistry, ViewContainerLocation, IViewDescriptorService, IViewsService } from 'vs/workbench/common/views';
import { OutlinePane } from './outlinePane';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { OutlineConfigKeys, OutlineViewId } from 'vs/editor/contrib/documentSymbols/outline';
import { VIEW_CONTAINER } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { Action } from 'vs/base/common/actions';
import { IWorkbenchActionRegistry, Extensions as ActionsExtensions } from 'vs/workbench/common/actions';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';

// import './outlineNavigation';

export const PANEL_ID = 'panel.view.outline';

export class OutlineViewPaneContainer extends ViewPaneContainer {
	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkspaceContextService protected contextService: IWorkspaceContextService,
		@IStorageService protected storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
	) {
		super(PANEL_ID, `${PANEL_ID}.state`, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService);
	}
}

export const VIEW_CONTAINER_PANEL: ViewContainer =
	Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
		id: PANEL_ID,
		ctorDescriptor: new SyncDescriptor(OutlineViewPaneContainer),
		name: localize('name', "Outline"),
		hideIfEmpty: true
	}, ViewContainerLocation.Panel);


const _outlineDesc = <IViewDescriptor>{
	id: OutlineViewId,
	name: localize('name', "Outline"),
	ctorDescriptor: new SyncDescriptor(OutlinePane),
	canToggleVisibility: true,
	hideByDefault: false,
	collapsed: true,
	order: 2,
	weight: 30,
	focusCommand: { id: 'outline.focus' }
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([_outlineDesc], VIEW_CONTAINER);

let inPanel = false;

export class ToggleOutlinePositionAction extends Action {

	static ID = 'outline.view.togglePosition';
	static LABEL = 'Toggle Outline View Position';

	constructor(
		id: string,
		label: string,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label, '', true);
	}

	async run(): Promise<void> {
		if (!inPanel) {
			this.viewDescriptorService.moveViews([_outlineDesc], VIEW_CONTAINER_PANEL);
			this.viewsService.openView(OutlineViewId, true);
			inPanel = true;
		} else {
			this.viewDescriptorService.moveViews([_outlineDesc], VIEW_CONTAINER);
			this.viewsService.openView(OutlineViewId, true);

			inPanel = false;
		}

	}
}

Registry.as<IWorkbenchActionRegistry>(ActionsExtensions.WorkbenchActions)
	.registerWorkbenchAction(SyncActionDescriptor.create(ToggleOutlinePositionAction, ToggleOutlinePositionAction.ID, ToggleOutlinePositionAction.LABEL), 'Show Release Notes');


Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	'id': 'outline',
	'order': 117,
	'title': localize('outlineConfigurationTitle', "Outline"),
	'type': 'object',
	'properties': {
		[OutlineConfigKeys.icons]: {
			'description': localize('outline.showIcons', "Render Outline Elements with Icons."),
			'type': 'boolean',
			'default': true
		},
		[OutlineConfigKeys.problemsEnabled]: {
			'description': localize('outline.showProblem', "Show Errors & Warnings on Outline Elements."),
			'type': 'boolean',
			'default': true
		},
		[OutlineConfigKeys.problemsColors]: {
			'description': localize('outline.problem.colors', "Use colors for Errors & Warnings."),
			'type': 'boolean',
			'default': true
		},
		[OutlineConfigKeys.problemsBadges]: {
			'description': localize('outline.problems.badges', "Use badges for Errors & Warnings."),
			'type': 'boolean',
			'default': true
		},
		'outline.showFiles': {
			type: 'boolean',
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			default: true,
			markdownDescription: localize('filteredTypes.file', "When enabled outline shows `file`-symbols.")
		},
		'outline.showModules': {
			type: 'boolean',
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			default: true,
			markdownDescription: localize('filteredTypes.module', "When enabled outline shows `module`-symbols.")
		},
		'outline.showNamespaces': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.namespace', "When enabled outline shows `namespace`-symbols.")
		},
		'outline.showPackages': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.package', "When enabled outline shows `package`-symbols.")
		},
		'outline.showClasses': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.class', "When enabled outline shows `class`-symbols.")
		},
		'outline.showMethods': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.method', "When enabled outline shows `method`-symbols.")
		},
		'outline.showProperties': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.property', "When enabled outline shows `property`-symbols.")
		},
		'outline.showFields': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.field', "When enabled outline shows `field`-symbols.")
		},
		'outline.showConstructors': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.constructor', "When enabled outline shows `constructor`-symbols.")
		},
		'outline.showEnums': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.enum', "When enabled outline shows `enum`-symbols.")
		},
		'outline.showInterfaces': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.interface', "When enabled outline shows `interface`-symbols.")
		},
		'outline.showFunctions': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.function', "When enabled outline shows `function`-symbols.")
		},
		'outline.showVariables': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.variable', "When enabled outline shows `variable`-symbols.")
		},
		'outline.showConstants': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.constant', "When enabled outline shows `constant`-symbols.")
		},
		'outline.showStrings': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.string', "When enabled outline shows `string`-symbols.")
		},
		'outline.showNumbers': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.number', "When enabled outline shows `number`-symbols.")
		},
		'outline.showBooleans': {
			type: 'boolean',
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			default: true,
			markdownDescription: localize('filteredTypes.boolean', "When enabled outline shows `boolean`-symbols.")
		},
		'outline.showArrays': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE_LANGUAGE,
			markdownDescription: localize('filteredTypes.array', "When enabled outline shows `array`-symbols.")
		},
		'outline.showObjects': {
			type: 'boolean',
			default: true,
			markdownDescription: localize('filteredTypes.object', "When enabled outline shows `object`-symbols.")
		},
		'outline.showKeys': {
			type: 'boolean',
			default: true,
			markdownDescription: localize('filteredTypes.key', "When enabled outline shows `key`-symbols.")
		},
		'outline.showNull': {
			type: 'boolean',
			default: true,
			markdownDescription: localize('filteredTypes.null', "When enabled outline shows `null`-symbols.")
		},
		'outline.showEnumMembers': {
			type: 'boolean',
			default: true,
			markdownDescription: localize('filteredTypes.enumMember', "When enabled outline shows `enumMember`-symbols.")
		},
		'outline.showStructs': {
			type: 'boolean',
			default: true,
			markdownDescription: localize('filteredTypes.struct', "When enabled outline shows `struct`-symbols.")
		},
		'outline.showEvents': {
			type: 'boolean',
			default: true,
			markdownDescription: localize('filteredTypes.event', "When enabled outline shows `event`-symbols.")
		},
		'outline.showOperators': {
			type: 'boolean',
			default: true,
			markdownDescription: localize('filteredTypes.operator', "When enabled outline shows `operator`-symbols.")
		},
		'outline.showTypeParameters': {
			type: 'boolean',
			default: true,
			markdownDescription: localize('filteredTypes.typeParameter', "When enabled outline shows `typeParameter`-symbols.")
		}
	}
});
