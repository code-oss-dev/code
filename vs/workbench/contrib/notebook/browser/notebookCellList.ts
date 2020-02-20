/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IListRenderer, IListVirtualDelegate, ListError } from 'vs/base/browser/ui/list/list';
import { Event } from 'vs/base/common/event';
import { ScrollEvent } from 'vs/base/common/scrollable';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IListService, IWorkbenchListOptions, WorkbenchList } from 'vs/platform/list/browser/listService';
import { IThemeService } from 'vs/platform/theme/common/themeService';

export class NotebookCellList<T> extends WorkbenchList<T> {
	get onWillScroll(): Event<ScrollEvent> { return this.view.onWillScroll; }

	get rowsContainer(): HTMLElement {
		return this.view.rowsContainer;
	}

	get isRendering(): boolean {
		return this.view.isRendering;
	}

	constructor(
		private listUser: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: IListRenderer<T, any>[],
		options: IWorkbenchListOptions<T>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService

	) {
		super(listUser, container, delegate, renderers, options, contextKeyService, listService, themeService, configurationService, keybindingService);
	}

	domElementAtIndex(index: number): HTMLElement | null {
		return this.view.domElement(index);
	}

	focusView() {
		this.view.domNode.focus();
	}

	domFocus() {
		if (document.activeElement && this.view.domNode.contains(document.activeElement)) {
			return;
		}

		super.domFocus();
	}

	getAbsoluteTop(index: number): number {
		if (index < 0 || index >= this.length) {
			throw new ListError(this.listUser, `Invalid index ${index}`);
		}

		return this.view.elementTop(index);
	}
}
