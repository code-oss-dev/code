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
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookCellViewModel';
import { EDITOR_TOP_PADDING } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Range } from 'vs/editor/common/core/range';
import { CellRevealType, CellRevealPosition } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export class NotebookCellList extends WorkbenchList<CellViewModel> {
	get onWillScroll(): Event<ScrollEvent> { return this.view.onWillScroll; }

	get rowsContainer(): HTMLElement {
		return this.view.containerDomNode;
	}

	constructor(
		private listUser: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<CellViewModel>,
		renderers: IListRenderer<CellViewModel, any>[],
		options: IWorkbenchListOptions<CellViewModel>,
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
		if (document.activeElement && this.view.domNode.contains(document.activeElement)) {
			// for example, when focus goes into monaco editor, if we refocus the list view, the editor will lose focus.
			return;
		}

		if (!isMacintosh && document.activeElement && isContextMenuFocused()) {
			return;
		}

		super.domFocus();
	}

	private _revealRange(index: number, range: Range, revealType: CellRevealType, newlyCreated: boolean, alignToBottom: boolean) {
		const element = this.view.element(index);
		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const startLineNumber = range.startLineNumber;
		const lineOffset = element.getLineScrollTopOffset(startLineNumber);
		const elementTop = this.view.elementTop(index);
		const lineTop = elementTop + lineOffset + EDITOR_TOP_PADDING;

		// TODO@rebornix 30 ---> line height * 1.5
		if (lineTop < scrollTop) {
			this.view.setScrollTop(lineTop - 30);
		} else if (lineTop > wrapperBottom) {
			this.view.setScrollTop(scrollTop + lineTop - wrapperBottom + 30);
		} else if (newlyCreated) {
			// newly scrolled into view
			if (alignToBottom) {
				// align to the bottom
				this.view.setScrollTop(scrollTop + lineTop - wrapperBottom + 30);
			} else {
				// align to to top
				this.view.setScrollTop(lineTop - 30);
			}
		}

		if (revealType === CellRevealType.Range) {
			element.revealRangeInCenter(range);
		}
	}

	// TODO@rebornix TEST & Fix potential bugs
	// List items have real dynamic heights, which means after we set `scrollTop` based on the `elementTop(index)`, the element at `index` might still be removed from the view once all relayouting tasks are done.
	// For example, we scroll item 10 into the view upwards, in the first round, items 7, 8, 9, 10 are all in the viewport. Then item 7 and 8 resize themselves to be larger and finally item 10 is removed from the view.
	// To ensure that item 10 is always there, we need to scroll item 10 to the top edge of the viewport.
	private _revealRangeInternal(index: number, range: Range, revealType: CellRevealType) {
		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const elementTop = this.view.elementTop(index);
		const element = this.view.element(index);

		if (element.editorAttached) {
			this._revealRange(index, range, revealType, false, false);
		} else {
			const elementHeight = this.view.elementHeight(index);
			let upwards = false;

			if (elementTop + elementHeight < scrollTop) {
				// scroll downwards
				this.view.setScrollTop(elementTop);
				upwards = false;
			} else if (elementTop > wrapperBottom) {
				// scroll upwards
				this.view.setScrollTop(elementTop - this.view.renderHeight / 2);
				upwards = true;
			}

			const editorAttachedPromise = new Promise((resolve, reject) => {
				element.onDidChangeEditorAttachState(state => state ? resolve() : reject());
			});

			editorAttachedPromise.then(() => {
				this._revealRange(index, range, revealType, true, upwards);
			});
		}
	}

	revealLineInView(index: number, line: number) {
		this._revealRangeInternal(index, new Range(line, 1, line, 1), CellRevealType.Line);
	}

	revealRangeInView(index: number, range: Range): void {
		this._revealRangeInternal(index, range, CellRevealType.Range);
	}

	private _revealRangeInCenterInternal(index: number, range: Range, revealType: CellRevealType) {
		const reveal = (index: number, range: Range, revealType: CellRevealType) => {
			const element = this.view.element(index);
			let lineOffset = element.getLineScrollTopOffset(range.startLineNumber);
			let lineOffsetInView = this.view.elementTop(index) + lineOffset;
			this.view.setScrollTop(lineOffsetInView - this.view.renderHeight / 2);

			if (revealType === CellRevealType.Range) {
				element.revealRangeInCenter(range);
			}
		};

		const elementTop = this.view.elementTop(index);
		const viewItemOffset = elementTop;
		this.view.setScrollTop(viewItemOffset - this.view.renderHeight / 2);
		const element = this.view.element(index);

		if (!element.editorAttached) {
			getEditorAttachedPromise(element).then(() => reveal(index, range, revealType));
		} else {
			reveal(index, range, revealType);
		}
	}

	revealLineInCenter(index: number, line: number) {
		this._revealRangeInCenterInternal(index, new Range(line, 1, line, 1), CellRevealType.Line);
	}

	revealRangeInCenter(index: number, range: Range): void {
		this._revealRangeInCenterInternal(index, range, CellRevealType.Range);
	}

	private _revealRangeInCenterIfOutsideViewportInternal(index: number, range: Range, revealType: CellRevealType) {
		const reveal = (index: number, range: Range, revealType: CellRevealType) => {
			const element = this.view.element(index);
			let lineOffset = element.getLineScrollTopOffset(range.startLineNumber);
			let lineOffsetInView = this.view.elementTop(index) + lineOffset;
			this.view.setScrollTop(lineOffsetInView - this.view.renderHeight / 2);

			if (revealType === CellRevealType.Range) {
				element.revealRangeInCenter(range);
			}
		};

		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const elementTop = this.view.elementTop(index);
		const viewItemOffset = elementTop;
		const element = this.view.element(index);

		if (viewItemOffset < scrollTop || viewItemOffset > wrapperBottom) {
			this.view.setScrollTop(viewItemOffset - this.view.renderHeight / 2);
			if (!element.editorAttached) {
				getEditorAttachedPromise(element).then(() => reveal(index, range, revealType));
			} else {
				// for example markdown
			}
		} else {
			if (element.editorAttached) {
				element.revealRangeInCenter(range);
			} else {
				// for example, markdown cell in preview mode
				getEditorAttachedPromise(element).then(() => reveal(index, range, revealType));
			}
		}
	}

	revealLineInCenterIfOutsideViewport(index: number, line: number) {
		this._revealRangeInCenterIfOutsideViewportInternal(index, new Range(line, 1, line, 1), CellRevealType.Line);
	}

	revealRangeInCenterIfOutsideViewport(index: number, range: Range): void {
		this._revealRangeInCenterIfOutsideViewportInternal(index, range, CellRevealType.Range);
	}

	private _revealInternal(index: number, ignoreIfInsideViewport: boolean, revealPosition: CellRevealPosition) {
		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const elementTop = this.view.elementTop(index);

		if (ignoreIfInsideViewport && elementTop >= scrollTop && elementTop <= wrapperBottom) {
			// inside the viewport
			return;
		}

		let viewItemOffset = elementTop;

		if (revealPosition === CellRevealPosition.Top) {
			viewItemOffset = elementTop;
		} else if (revealPosition === CellRevealPosition.Center) {
			viewItemOffset = elementTop - this.view.renderHeight / 2;
		}

		this.view.setScrollTop(viewItemOffset);
	}

	revealInView(index: number) {
		this._revealInternal(index, true, CellRevealPosition.Top);
	}

	revealInCenter(index: number) {
		this._revealInternal(index, false, CellRevealPosition.Center);
	}

	revealInCenterIfOutsideViewport(index: number) {
		this._revealInternal(index, true, CellRevealPosition.Center);
	}

	setCellSelection(index: number, range: Range) {
		const element = this.view.element(index);
		element.setSelection(range);
	}

}

function getEditorAttachedPromise(element: CellViewModel) {
	return new Promise((resolve, reject) => {
		Event.once(element.onDidChangeEditorAttachState)(state => state ? resolve() : reject());
	});
}

function isContextMenuFocused() {
	return !!DOM.findParentWithClass(<HTMLElement>document.activeElement, 'context-view');
}
