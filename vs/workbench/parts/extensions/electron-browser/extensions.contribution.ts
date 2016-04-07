/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/extensions';
import { localize } from 'vs/nls';
import { Registry } from 'vs/platform/platform';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IStatusbarRegistry, Extensions as StatusbarExtensions, StatusbarItemDescriptor, StatusbarAlignment } from 'vs/workbench/browser/parts/statusbar/statusbar';
import { ExtensionsStatusbarItem } from 'vs/workbench/parts/extensions/electron-browser/extensionsWidgets';
import { IGalleryService, ExtensionsLabel } from 'vs/workbench/parts/extensions/common/extensions';
import { GalleryService } from 'vs/workbench/parts/extensions/common/vsoGalleryService';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { ExtensionsWorkbenchExtension } from 'vs/workbench/parts/extensions/electron-browser/extensionsWorkbenchExtension';
import { IOutputChannelRegistry, Extensions as OutputExtensions } from 'vs/workbench/parts/output/common/output';
import { EditorDescriptor, IEditorRegistry, Extensions as EditorExtensions, IEditorInputFactory } from 'vs/workbench/browser/parts/editor/baseEditor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ExtensionsInput } from 'vs/workbench/parts/extensions/common/extensionsInput';
import { ExtensionsPart } from 'vs/workbench/parts/extensions/electron-browser/extensionsPart';
import { GlobalExtensionsActionContributor } from 'vs/workbench/parts/extensions/electron-browser/extensionsActions';
import { IActionBarRegistry, Scope as ActionBarScope, Extensions as ActionBarExtensions } from 'vs/workbench/browser/actionBarRegistry';
import { EditorInput } from 'vs/workbench/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

class ExtensionsInputFactory implements IEditorInputFactory {

	constructor() {}

	public serialize(editorInput: EditorInput): string {
		return '';
	}

	public deserialize(instantiationService: IInstantiationService, resourceRaw: string): EditorInput {
		return instantiationService.createInstance(ExtensionsInput);
	}
}

registerSingleton(IGalleryService, GalleryService);

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(ExtensionsWorkbenchExtension);

Registry.as<IStatusbarRegistry>(StatusbarExtensions.Statusbar)
	.registerStatusbarItem(new StatusbarItemDescriptor(ExtensionsStatusbarItem, StatusbarAlignment.LEFT,10000));

Registry.as<IOutputChannelRegistry>(OutputExtensions.OutputChannels)
	.registerChannel(ExtensionsLabel);

Registry.as<IEditorRegistry>(EditorExtensions.Editors)
	.registerEditorInputFactory(ExtensionsInput.ID, ExtensionsInputFactory);

const editorDescriptor = new EditorDescriptor(
	ExtensionsPart.ID,
	localize('extensions', "Extensions"),
	'vs/workbench/parts/extensions/electron-browser/extensionsPart',
	'ExtensionsPart'
);

Registry.as<IEditorRegistry>(EditorExtensions.Editors)
	.registerEditor(editorDescriptor, [new SyncDescriptor(ExtensionsInput)]);

Registry.as<IActionBarRegistry>(ActionBarExtensions.Actionbar)
	.registerActionBarContributor(ActionBarScope.GLOBAL, GlobalExtensionsActionContributor);