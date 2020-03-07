/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { IListRenderer, IListVirtualDelegate, ListError } from 'vs/base/browser/ui/list/list';
import { Event } from 'vs/base/common/event';
import { ScrollEvent } from 'vs/base/common/scrollable';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IListService, IWorkbenchListOptions, WorkbenchList } from 'vs/platform/list/browser/listService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { isMacintosh } from 'vs/base/common/platform';
import { isNumber } from 'vs/base/common/types';

export class NotebookCellList<T> extends WorkbenchList<T> {
	get onWillScroll(): Event<ScrollEvent> { return this.view.onWillScroll; }

	get rowsContainer(): HTMLElement {
		return this.view.containerDomNode;
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

	getAbsoluteTop(index: number): number {
		if (index < 0 || index >= this.length) {
			throw new ListError(this.listUser, `Invalid index ${index}`);
		}

		return this.view.elementTop(index);
	}

	triggerScrollFromMouseWheelEvent(browserEvent: IMouseWheelEvent) {
		this.view.triggerScrollFromMouseWheelEvent(browserEvent);
	}

	updateElementHeight(index: number, size: number): void {
		this.view.updateElementHeight(index, size);
	}

	// override
	domFocus() {
		// @TODO, custom menu doesn't work
		if (document.activeElement && this.view.domNode.contains(document.activeElement)) {
			// for example, when focus goes into monaco editor, if we refocus the list view, the editor will lose focus.
			return;
		}

		if (!isMacintosh && document.activeElement && isContextMenuFocused()) {
			return;
		}

		super.domFocus();
	}

	revealInView(index: number, offset?: number) {
		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const elementTop = this.view.elementTop(index);

		const viewItemOffset = elementTop + (isNumber(offset) ? offset : 0);

		if (viewItemOffset < scrollTop || viewItemOffset > wrapperBottom) {
			this.view.setScrollTop(viewItemOffset);
		}
	}

	revealInCenterIfOutsideViewport(index: number, offset?: number) {
		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const elementTop = this.view.elementTop(index);
		const viewItemOffset = elementTop + (isNumber(offset) ? offset : 0);

		if (viewItemOffset < scrollTop || viewItemOffset > wrapperBottom) {
			this.view.setScrollTop(viewItemOffset - this.view.renderHeight / 2);
		}
	}

	revealInCenter(index: number, offset?: number) {
		const elementTop = this.view.elementTop(index);
		const viewItemOffset = elementTop + (isNumber(offset) ? offset : 0);

		this.view.setScrollTop(viewItemOffset - this.view.renderHeight / 2);
	}
}

function isContextMenuFocused() {
	return !!DOM.findParentWithClass(<HTMLElement>document.activeElement, 'context-view');
}
