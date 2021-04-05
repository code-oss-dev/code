/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TerminalTab } from 'vs/workbench/contrib/terminal/browser/terminalTab';
import { IListService, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { ITreeElement, ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { DefaultStyleController, IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IIdentityProvider, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITerminalService, ITerminalTab } from 'vs/workbench/contrib/terminal/browser/terminal';
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';


const $ = DOM.$;

class TerminalTabsDelegate implements IListVirtualDelegate<TerminalTab> {
	getHeight(element: any): number {
		return 24;
	}
	getTemplateId(element: any): string {
		return 'terminal.tabs';
	}
}
class TerminalTabsIdentityProvider implements IIdentityProvider<TerminalTab> {
	constructor() {
	}
	getId(element: TerminalTab): { toString(): string; } {
		// to do - fix this won't work
		return element ? element?.terminalInstances.length > 1 ? `Terminals (${element?.terminalInstances.length})` : element?.terminalInstances[0].title : '';
	}

}
class TerminalTabsAccessibilityProvider implements IListAccessibilityProvider<TerminalTab> {
	getAriaLabel(tab: TerminalTab) {
		return tab ? tab?.terminalInstances.length > 1 ? `Terminals (${tab?.terminalInstances.length})` : tab?.terminalInstances[0].title : '';
	}

	getWidgetAriaLabel() {
		return localize('terminal.tabs', "TerminalTabs");
	}
}
export class TerminalTabsWidget extends WorkbenchObjectTree<ITerminalTab>  {
	constructor(
		container: HTMLElement,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@ITerminalService terminalService: ITerminalService
	) {
		super('TerminalTabsTree', container,
			new TerminalTabsDelegate(),
			[new TerminalTabsRenderer()],
			{
				horizontalScrolling: false,
				supportDynamicHeights: true,
				identityProvider: new TerminalTabsIdentityProvider(),
				accessibilityProvider: new TerminalTabsAccessibilityProvider(),
				styleController: id => new DefaultStyleController(DOM.createStyleSheet(container), id),
				filter: undefined,
				smoothScrolling: configurationService.getValue<boolean>('workbench.list.smoothScrolling'),
				multipleSelectionSupport: false,
			},
			contextKeyService,
			listService,
			themeService,
			configurationService,
			keybindingService,
			accessibilityService,
		);
		this.setChildren(null, undefined);
		this.setChildren(null, createTerminalTabsIterator(terminalService.terminalTabs));
	}
}

function createTerminalTabsIterator(tabs: ITerminalTab[]): Iterable<ITreeElement<ITerminalTab>> {
	const result = tabs.map(tab => {
		const hasChildren = tab.terminalInstances.length > 1;
		return {
			element: tab,
			collapsed: true,
			collapsible: hasChildren,
			//  children: hasChildren ? tab.terminalInstances : undefined // TODO
			children: undefined
		};
	});
	return result;
}

class TerminalTabsRenderer implements ITreeRenderer<ITerminalTab, never, ITerminalTabEntryTemplate> {

	templateId = 'terminal.tabs';

	renderTemplate(container: HTMLElement): ITerminalTabEntryTemplate {
		return {
			labelElement: DOM.append(container, $('.terminal-tabs-entry')),
		};
	}

	renderElement(node: ITreeNode<ITerminalTab>, index: number, template: ITerminalTabEntryTemplate): void {
		const element = node.element;
		const label = element ? element.terminalInstances.length === 0 ? 'Starting...' : element?.terminalInstances.length > 1 ? `Terminals (${element?.terminalInstances.length})` : element?.terminalInstances[0].title : '';

		template.labelElement.textContent = label;
		template.labelElement.title = label;
	}

	disposeTemplate(templateData: ITerminalTabEntryTemplate): void {
	}
}

interface ITerminalTabEntryTemplate {
	labelElement: HTMLElement;
}

