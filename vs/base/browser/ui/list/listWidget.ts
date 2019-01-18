/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./list';
import { localize } from 'vs/nls';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { isNumber } from 'vs/base/common/types';
import { range, firstIndex } from 'vs/base/common/arrays';
import { memoize } from 'vs/base/common/decorators';
import * as DOM from 'vs/base/browser/dom';
import * as platform from 'vs/base/common/platform';
import { Gesture } from 'vs/base/browser/touch';
import { KeyCode } from 'vs/base/common/keyCodes';
import { StandardKeyboardEvent, IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Event, Emitter, EventBufferer } from 'vs/base/common/event';
import { domEvent } from 'vs/base/browser/event';
import { IListVirtualDelegate, IListRenderer, IListEvent, IListContextMenuEvent, IListMouseEvent, IListTouchEvent, IListGestureEvent, IIdentityProvider, IKeyboardNavigationLabelProvider, IListDragAndDrop, IListDragOverReaction } from './list';
import { ListView, IListViewOptions, IListViewDragAndDrop } from './listView';
import { Color } from 'vs/base/common/color';
import { mixin } from 'vs/base/common/objects';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { ISpliceable } from 'vs/base/common/sequence';
import { CombinedSpliceable } from 'vs/base/browser/ui/list/splice';
import { clamp } from 'vs/base/common/numbers';
import { matchesPrefix } from 'vs/base/common/filters';
import { IDragAndDropData } from 'vs/base/browser/dnd';

interface ITraitChangeEvent {
	indexes: number[];
	browserEvent?: UIEvent;
}

type ITraitTemplateData = HTMLElement;

interface IRenderedContainer {
	templateData: ITraitTemplateData;
	index: number;
}

class TraitRenderer<T> implements IListRenderer<T, ITraitTemplateData>
{
	private renderedElements: IRenderedContainer[] = [];

	constructor(private trait: Trait<T>) { }

	get templateId(): string {
		return `template:${this.trait.trait}`;
	}

	renderTemplate(container: HTMLElement): ITraitTemplateData {
		return container;
	}

	renderElement(element: T, index: number, templateData: ITraitTemplateData): void {
		const renderedElementIndex = firstIndex(this.renderedElements, el => el.templateData === templateData);

		if (renderedElementIndex >= 0) {
			const rendered = this.renderedElements[renderedElementIndex];
			this.trait.unrender(templateData);
			rendered.index = index;
		} else {
			const rendered = { index, templateData };
			this.renderedElements.push(rendered);
		}

		this.trait.renderIndex(index, templateData);
	}

	splice(start: number, deleteCount: number, insertCount: number): void {
		const rendered: IRenderedContainer[] = [];

		for (const renderedElement of this.renderedElements) {

			if (renderedElement.index < start) {
				rendered.push(renderedElement);
			} else if (renderedElement.index >= start + deleteCount) {
				rendered.push({
					index: renderedElement.index + insertCount - deleteCount,
					templateData: renderedElement.templateData
				});
			}
		}

		this.renderedElements = rendered;
	}

	renderIndexes(indexes: number[]): void {
		for (const { index, templateData } of this.renderedElements) {
			if (indexes.indexOf(index) > -1) {
				this.trait.renderIndex(index, templateData);
			}
		}
	}

	disposeTemplate(templateData: ITraitTemplateData): void {
		const index = firstIndex(this.renderedElements, el => el.templateData === templateData);

		if (index < 0) {
			return;
		}

		this.renderedElements.splice(index, 1);
	}
}

class Trait<T> implements ISpliceable<boolean>, IDisposable {

	/**
	 * Sorted indexes which have this trait.
	 */
	private indexes: number[];

	private _onChange = new Emitter<ITraitChangeEvent>();
	get onChange(): Event<ITraitChangeEvent> { return this._onChange.event; }

	get trait(): string { return this._trait; }

	@memoize
	get renderer(): TraitRenderer<T> {
		return new TraitRenderer<T>(this);
	}

	constructor(private _trait: string) {
		this.indexes = [];
	}

	splice(start: number, deleteCount: number, elements: boolean[]): void {
		const diff = elements.length - deleteCount;
		const end = start + deleteCount;
		const indexes = [
			...this.indexes.filter(i => i < start),
			...elements.map((hasTrait, i) => hasTrait ? i + start : -1).filter(i => i !== -1),
			...this.indexes.filter(i => i >= end).map(i => i + diff)
		];

		this.renderer.splice(start, deleteCount, elements.length);
		this.set(indexes);
	}

	renderIndex(index: number, container: HTMLElement): void {
		DOM.toggleClass(container, this._trait, this.contains(index));
	}

	unrender(container: HTMLElement): void {
		DOM.removeClass(container, this._trait);
	}

	/**
	 * Sets the indexes which should have this trait.
	 *
	 * @param indexes Indexes which should have this trait.
	 * @return The old indexes which had this trait.
	 */
	set(indexes: number[], browserEvent?: UIEvent): number[] {
		const result = this.indexes;
		this.indexes = indexes;

		const toRender = disjunction(result, indexes);
		this.renderer.renderIndexes(toRender);

		this._onChange.fire({ indexes, browserEvent });
		return result;
	}

	get(): number[] {
		return this.indexes;
	}

	contains(index: number): boolean {
		return this.indexes.some(i => i === index);
	}

	dispose() {
		this._onChange = dispose(this._onChange);
	}
}

class FocusTrait<T> extends Trait<T> {

	constructor(
		private getDomId: (index: number) => string
	) {
		super('focused');
	}

	renderIndex(index: number, container: HTMLElement): void {
		super.renderIndex(index, container);
		container.setAttribute('role', 'treeitem');
		container.setAttribute('id', this.getDomId(index));

		if (this.contains(index)) {
			container.setAttribute('aria-selected', 'true');
		} else {
			container.removeAttribute('aria-selected');
		}
	}
}

/**
 * The TraitSpliceable is used as a util class to be able
 * to preserve traits across splice calls, given an identity
 * provider.
 */
class TraitSpliceable<T> implements ISpliceable<T> {

	constructor(
		private trait: Trait<T>,
		private view: ListView<T>,
		private identityProvider?: IIdentityProvider<T>
	) { }

	splice(start: number, deleteCount: number, elements: T[]): void {
		if (!this.identityProvider) {
			return this.trait.splice(start, deleteCount, elements.map(() => false));
		}

		const pastElementsWithTrait = this.trait.get().map(i => this.identityProvider!.getId(this.view.element(i)).toString());
		const elementsWithTrait = elements.map(e => pastElementsWithTrait.indexOf(this.identityProvider!.getId(e).toString()) > -1);

		this.trait.splice(start, deleteCount, elementsWithTrait);
	}
}

function isInputElement(e: HTMLElement): boolean {
	return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA';
}

class KeyboardController<T> implements IDisposable {

	private disposables: IDisposable[];
	private openController: IOpenController;

	constructor(
		private list: List<T>,
		private view: ListView<T>,
		options: IListOptions<T>
	) {
		const multipleSelectionSupport = !(options.multipleSelectionSupport === false);
		this.disposables = [];

		this.openController = options.openController || DefaultOpenController;

		const onKeyDown = Event.chain(domEvent(view.domNode, 'keydown'))
			.filter(e => !isInputElement(e.target as HTMLElement))
			.map(e => new StandardKeyboardEvent(e));

		onKeyDown.filter(e => e.keyCode === KeyCode.Enter).on(this.onEnter, this, this.disposables);
		onKeyDown.filter(e => e.keyCode === KeyCode.UpArrow).on(this.onUpArrow, this, this.disposables);
		onKeyDown.filter(e => e.keyCode === KeyCode.DownArrow).on(this.onDownArrow, this, this.disposables);
		onKeyDown.filter(e => e.keyCode === KeyCode.PageUp).on(this.onPageUpArrow, this, this.disposables);
		onKeyDown.filter(e => e.keyCode === KeyCode.PageDown).on(this.onPageDownArrow, this, this.disposables);
		onKeyDown.filter(e => e.keyCode === KeyCode.Escape).on(this.onEscape, this, this.disposables);

		if (multipleSelectionSupport) {
			onKeyDown.filter(e => (platform.isMacintosh ? e.metaKey : e.ctrlKey) && e.keyCode === KeyCode.KEY_A).on(this.onCtrlA, this, this.disposables);
		}
	}

	private onEnter(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.list.setSelection(this.list.getFocus(), e.browserEvent);

		if (this.openController.shouldOpen(e.browserEvent)) {
			this.list.open(this.list.getFocus(), e.browserEvent);
		}
	}

	private onUpArrow(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.list.focusPrevious(1, false, e.browserEvent);
		this.list.reveal(this.list.getFocus()[0]);
		this.view.domNode.focus();
	}

	private onDownArrow(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.list.focusNext(1, false, e.browserEvent);
		this.list.reveal(this.list.getFocus()[0]);
		this.view.domNode.focus();
	}

	private onPageUpArrow(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.list.focusPreviousPage(e.browserEvent);
		this.list.reveal(this.list.getFocus()[0]);
		this.view.domNode.focus();
	}

	private onPageDownArrow(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.list.focusNextPage(e.browserEvent);
		this.list.reveal(this.list.getFocus()[0]);
		this.view.domNode.focus();
	}

	private onCtrlA(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.list.setSelection(range(this.list.length), e.browserEvent);
		this.view.domNode.focus();
	}

	private onEscape(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.list.setSelection([], e.browserEvent);
		this.view.domNode.focus();
	}

	dispose() {
		this.disposables = dispose(this.disposables);
	}
}

enum TypeLabelControllerState {
	Idle,
	Typing
}

export function mightProducePrintableCharacter(event: IKeyboardEvent): boolean {
	if (event.ctrlKey || event.metaKey || event.altKey) {
		return false;
	}

	return (event.keyCode >= KeyCode.KEY_A && event.keyCode <= KeyCode.KEY_Z)
		|| (event.keyCode >= KeyCode.KEY_0 && event.keyCode <= KeyCode.KEY_9)
		|| (event.keyCode >= KeyCode.US_SEMICOLON && event.keyCode <= KeyCode.US_QUOTE);
}

class TypeLabelController<T> implements IDisposable {

	private state: TypeLabelControllerState = TypeLabelControllerState.Idle;
	private disposables: IDisposable[] = [];

	constructor(
		private list: List<T>,
		private view: ListView<T>,
		private keyboardNavigationLabelProvider: IKeyboardNavigationLabelProvider<T>
	) {
		const onChar = Event.chain(domEvent(view.domNode, 'keydown'))
			.filter(e => !isInputElement(e.target as HTMLElement))
			.map(event => new StandardKeyboardEvent(event))
			.filter(keyboardNavigationLabelProvider.mightProducePrintableCharacter ? e => keyboardNavigationLabelProvider.mightProducePrintableCharacter!(e) : e => mightProducePrintableCharacter(e))
			.map(event => event.browserEvent.key)
			.event;

		const onClear = Event.debounce<string, null>(onChar, () => null, 800);
		const onInput = Event.reduce<string | null, string | null>(Event.any(onChar, onClear), (r, i) => i === null ? null : ((r || '') + i));

		onInput(this.onInput, this, this.disposables);
	}

	private onInput(word: string | null): void {
		if (!word) {
			this.state = TypeLabelControllerState.Idle;
			return;
		}

		const focus = this.list.getFocus();
		const start = focus.length > 0 ? focus[0] : 0;
		const delta = this.state === TypeLabelControllerState.Idle ? 1 : 0;
		this.state = TypeLabelControllerState.Typing;

		for (let i = 0; i < this.list.length; i++) {
			const index = (start + i + delta) % this.list.length;
			const label = this.keyboardNavigationLabelProvider.getKeyboardNavigationLabel(this.view.element(index));

			if (matchesPrefix(word, label.toString())) {
				this.list.setFocus([index]);
				this.list.reveal(index);
				return;
			}
		}
	}

	dispose() {
		this.disposables = dispose(this.disposables);
	}
}

class DOMFocusController<T> implements IDisposable {

	private disposables: IDisposable[] = [];

	constructor(
		private list: List<T>,
		private view: ListView<T>
	) {
		this.disposables = [];

		const onKeyDown = Event.chain(domEvent(view.domNode, 'keydown'))
			.filter(e => !isInputElement(e.target as HTMLElement))
			.map(e => new StandardKeyboardEvent(e));

		onKeyDown.filter(e => e.keyCode === KeyCode.Tab && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey)
			.on(this.onTab, this, this.disposables);
	}

	private onTab(e: StandardKeyboardEvent): void {
		if (e.target !== this.view.domNode) {
			return;
		}

		const focus = this.list.getFocus();

		if (focus.length === 0) {
			return;
		}

		const focusedDomElement = this.view.domElement(focus[0]);

		if (!focusedDomElement) {
			return;
		}

		const tabIndexElement = focusedDomElement.querySelector('[tabIndex]');

		if (!tabIndexElement || !(tabIndexElement instanceof HTMLElement) || tabIndexElement.tabIndex === -1) {
			return;
		}

		const style = window.getComputedStyle(tabIndexElement);
		if (style.visibility === 'hidden' || style.display === 'none') {
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		tabIndexElement.focus();
	}

	dispose() {
		this.disposables = dispose(this.disposables);
	}
}

export function isSelectionSingleChangeEvent(event: IListMouseEvent<any> | IListTouchEvent<any>): boolean {
	return platform.isMacintosh ? event.browserEvent.metaKey : event.browserEvent.ctrlKey;
}

export function isSelectionRangeChangeEvent(event: IListMouseEvent<any> | IListTouchEvent<any>): boolean {
	return event.browserEvent.shiftKey;
}

function isMouseRightClick(event: UIEvent): boolean {
	return event instanceof MouseEvent && event.button === 2;
}

const DefaultMultipleSelectionContoller = {
	isSelectionSingleChangeEvent,
	isSelectionRangeChangeEvent
};

const DefaultOpenController: IOpenController = {
	shouldOpen: (event: UIEvent) => {
		if (event instanceof MouseEvent) {
			return !isMouseRightClick(event);
		}

		return true;
	}
};

class MouseController<T> implements IDisposable {

	private multipleSelectionSupport: boolean;
	private multipleSelectionController: IMultipleSelectionController<T>;
	private openController: IOpenController;
	private disposables: IDisposable[] = [];

	constructor(
		private list: List<T>,
		private view: ListView<T>,
		options: IListOptions<T> = {}
	) {
		this.multipleSelectionSupport = !(options.multipleSelectionSupport === false);

		if (this.multipleSelectionSupport) {
			this.multipleSelectionController = options.multipleSelectionController || DefaultMultipleSelectionContoller;
		}

		this.openController = options.openController || DefaultOpenController;

		view.onMouseDown(this.onMouseDown, this, this.disposables);
		view.onContextMenu(this.onContextMenu, this, this.disposables);
		view.onMouseClick(this.onPointer, this, this.disposables);
		view.onMouseDblClick(this.onDoubleClick, this, this.disposables);
		view.onTouchStart(this.onMouseDown, this, this.disposables);
		view.onTap(this.onPointer, this, this.disposables);
		Gesture.addTarget(view.domNode);
	}

	private isSelectionSingleChangeEvent(event: IListMouseEvent<any> | IListTouchEvent<any>): boolean {
		if (this.multipleSelectionController) {
			return this.multipleSelectionController.isSelectionSingleChangeEvent(event);
		}

		return platform.isMacintosh ? event.browserEvent.metaKey : event.browserEvent.ctrlKey;
	}

	private isSelectionRangeChangeEvent(event: IListMouseEvent<any> | IListTouchEvent<any>): boolean {
		if (this.multipleSelectionController) {
			return this.multipleSelectionController.isSelectionRangeChangeEvent(event);
		}

		return event.browserEvent.shiftKey;
	}

	private isSelectionChangeEvent(event: IListMouseEvent<any> | IListTouchEvent<any>): boolean {
		return this.isSelectionSingleChangeEvent(event) || this.isSelectionRangeChangeEvent(event);
	}

	private onMouseDown(e: IListMouseEvent<T> | IListTouchEvent<T>): void {
		if (document.activeElement !== e.browserEvent.target) {
			this.view.domNode.focus();
		}
	}

	private onContextMenu(e: IListMouseEvent<T> | IListTouchEvent<T>): void {
		const focus = typeof e.index === 'undefined' ? [] : [e.index];
		this.list.setFocus(focus, e.browserEvent);
	}

	private onPointer(e: IListMouseEvent<T>): void {
		let reference = this.list.getFocus()[0];
		const selection = this.list.getSelection();
		reference = reference === undefined ? selection[0] : reference;

		const focus = e.index;

		if (typeof focus === 'undefined') {
			this.list.setFocus([], e.browserEvent);
			this.list.setSelection([], e.browserEvent);
			return;
		}

		if (this.multipleSelectionSupport && this.isSelectionRangeChangeEvent(e)) {
			return this.changeSelection(e, reference);
		}

		if (this.multipleSelectionSupport && this.isSelectionChangeEvent(e)) {
			return this.changeSelection(e, reference);
		}

		this.list.setFocus([focus], e.browserEvent);

		if (!isMouseRightClick(e.browserEvent)) {
			this.list.setSelection([focus], e.browserEvent);

			if (this.openController.shouldOpen(e.browserEvent)) {
				this.list.open([focus], e.browserEvent);
			}
		}
	}

	private onDoubleClick(e: IListMouseEvent<T>): void {
		if (this.multipleSelectionSupport && this.isSelectionChangeEvent(e)) {
			return;
		}

		const focus = this.list.getFocus();
		this.list.setSelection(focus, e.browserEvent);
		this.list.pin(focus);
	}

	private changeSelection(e: IListMouseEvent<T> | IListTouchEvent<T>, reference: number | undefined): void {
		const focus = e.index!;

		if (this.isSelectionRangeChangeEvent(e) && reference !== undefined) {
			const min = Math.min(reference, focus);
			const max = Math.max(reference, focus);
			const rangeSelection = range(min, max + 1);
			const selection = this.list.getSelection();
			const contiguousRange = getContiguousRangeContaining(disjunction(selection, [reference]), reference);

			if (contiguousRange.length === 0) {
				return;
			}

			const newSelection = disjunction(rangeSelection, relativeComplement(selection, contiguousRange));
			this.list.setSelection(newSelection, e.browserEvent);

		} else if (this.isSelectionSingleChangeEvent(e)) {
			const selection = this.list.getSelection();
			const newSelection = selection.filter(i => i !== focus);

			if (selection.length === newSelection.length) {
				this.list.setSelection([...newSelection, focus], e.browserEvent);
			} else {
				this.list.setSelection(newSelection, e.browserEvent);
			}
		}
	}

	dispose() {
		this.disposables = dispose(this.disposables);
	}
}

export interface IMultipleSelectionController<T> {
	isSelectionSingleChangeEvent(event: IListMouseEvent<T> | IListTouchEvent<T>): boolean;
	isSelectionRangeChangeEvent(event: IListMouseEvent<T> | IListTouchEvent<T>): boolean;
}

export interface IOpenController {
	shouldOpen(event: UIEvent): boolean;
}

export interface IStyleController {
	style(styles: IListStyles): void;
}

export interface IAccessibilityProvider<T> {

	/**
	 * Given an element in the tree, return the ARIA label that should be associated with the
	 * item. This helps screen readers to provide a meaningful label for the currently focused
	 * tree element.
	 *
	 * Returning null will not disable ARIA for the element. Instead it is up to the screen reader
	 * to compute a meaningful label based on the contents of the element in the DOM
	 *
	 * See also: https://www.w3.org/TR/wai-aria/#aria-label
	 */
	getAriaLabel(element: T): string | null;

	/**
	 * https://www.w3.org/TR/wai-aria/#aria-level
	 */
	getAriaLevel?(element: T): number | undefined;
}

export class DefaultStyleController implements IStyleController {

	constructor(private styleElement: HTMLStyleElement, private selectorSuffix?: string) { }

	style(styles: IListStyles): void {
		const suffix = this.selectorSuffix ? `.${this.selectorSuffix}` : '';
		const content: string[] = [];

		if (styles.listFocusBackground) {
			content.push(`.monaco-list${suffix}:focus .monaco-list-row.focused { background-color: ${styles.listFocusBackground}; }`);
			content.push(`.monaco-list${suffix}:focus .monaco-list-row.focused:hover { background-color: ${styles.listFocusBackground}; }`); // overwrite :hover style in this case!
		}

		if (styles.listFocusForeground) {
			content.push(`.monaco-list${suffix}:focus .monaco-list-row.focused { color: ${styles.listFocusForeground}; }`);
		}

		if (styles.listActiveSelectionBackground) {
			content.push(`.monaco-list${suffix}:focus .monaco-list-row.selected { background-color: ${styles.listActiveSelectionBackground}; }`);
			content.push(`.monaco-list${suffix}:focus .monaco-list-row.selected:hover { background-color: ${styles.listActiveSelectionBackground}; }`); // overwrite :hover style in this case!
		}

		if (styles.listActiveSelectionForeground) {
			content.push(`.monaco-list${suffix}:focus .monaco-list-row.selected { color: ${styles.listActiveSelectionForeground}; }`);
		}

		if (styles.listFocusAndSelectionBackground) {
			content.push(`
				.monaco-list-drag-image,
				.monaco-list${suffix}:focus .monaco-list-row.selected.focused { background-color: ${styles.listFocusAndSelectionBackground}; }
			`);
		}

		if (styles.listFocusAndSelectionForeground) {
			content.push(`
				.monaco-list-drag-image,
				.monaco-list${suffix}:focus .monaco-list-row.selected.focused { color: ${styles.listFocusAndSelectionForeground}; }
			`);
		}

		if (styles.listInactiveFocusBackground) {
			content.push(`.monaco-list${suffix} .monaco-list-row.focused { background-color:  ${styles.listInactiveFocusBackground}; }`);
			content.push(`.monaco-list${suffix} .monaco-list-row.focused:hover { background-color:  ${styles.listInactiveFocusBackground}; }`); // overwrite :hover style in this case!
		}

		if (styles.listInactiveSelectionBackground) {
			content.push(`.monaco-list${suffix} .monaco-list-row.selected { background-color:  ${styles.listInactiveSelectionBackground}; }`);
			content.push(`.monaco-list${suffix} .monaco-list-row.selected:hover { background-color:  ${styles.listInactiveSelectionBackground}; }`); // overwrite :hover style in this case!
		}

		if (styles.listInactiveSelectionForeground) {
			content.push(`.monaco-list${suffix} .monaco-list-row.selected { color: ${styles.listInactiveSelectionForeground}; }`);
		}

		if (styles.listHoverBackground) {
			content.push(`.monaco-list${suffix}:not(.drop-target) .monaco-list-row:hover { background-color:  ${styles.listHoverBackground}; }`);
		}

		if (styles.listHoverForeground) {
			content.push(`.monaco-list${suffix} .monaco-list-row:hover { color:  ${styles.listHoverForeground}; }`);
		}

		if (styles.listSelectionOutline) {
			content.push(`.monaco-list${suffix} .monaco-list-row.selected { outline: 1px dotted ${styles.listSelectionOutline}; outline-offset: -1px; }`);
		}

		if (styles.listFocusOutline) {
			content.push(`
				.monaco-list-drag-image,
				.monaco-list${suffix}:focus .monaco-list-row.focused { outline: 1px solid ${styles.listFocusOutline}; outline-offset: -1px; }
			`);
		}

		if (styles.listInactiveFocusOutline) {
			content.push(`.monaco-list${suffix} .monaco-list-row.focused { outline: 1px dotted ${styles.listInactiveFocusOutline}; outline-offset: -1px; }`);
		}

		if (styles.listHoverOutline) {
			content.push(`.monaco-list${suffix} .monaco-list-row:hover { outline: 1px dashed ${styles.listHoverOutline}; outline-offset: -1px; }`);
		}

		if (styles.listDropBackground) {
			content.push(`
				.monaco-list${suffix}.drop-target,
				.monaco-list${suffix} .monaco-list-row.drop-target { background-color: ${styles.listDropBackground} !important; color: inherit !important; }
			`);
		}

		if (styles.listMatchesBackground) {
			content.push(`.monaco-list-type-filter { background-color: ${styles.listMatchesBackground} }`);
		}

		if (styles.listMatchesOutline) {
			content.push(`.monaco-list-type-filter { border-color: ${styles.listMatchesOutline} }`);
		}

		const newStyles = content.join('\n');
		if (newStyles !== this.styleElement.innerHTML) {
			this.styleElement.innerHTML = newStyles;
		}
	}
}

export interface IListOptions<T> extends IListStyles {
	readonly identityProvider?: IIdentityProvider<T>;
	readonly dnd?: IListDragAndDrop<T>;
	readonly keyboardNavigationLabelProvider?: IKeyboardNavigationLabelProvider<T>;
	readonly ariaLabel?: string;
	readonly keyboardSupport?: boolean;
	readonly multipleSelectionSupport?: boolean;
	readonly multipleSelectionController?: IMultipleSelectionController<T>;
	readonly openController?: IOpenController;
	readonly styleController?: IStyleController;
	readonly accessibilityProvider?: IAccessibilityProvider<T>;

	// list view options
	readonly useShadows?: boolean;
	readonly verticalScrollMode?: ScrollbarVisibility;
	readonly setRowLineHeight?: boolean;
	readonly supportDynamicHeights?: boolean;
	readonly mouseSupport?: boolean;
}

export interface IListStyles {
	listFocusBackground?: Color;
	listFocusForeground?: Color;
	listActiveSelectionBackground?: Color;
	listActiveSelectionForeground?: Color;
	listFocusAndSelectionBackground?: Color;
	listFocusAndSelectionForeground?: Color;
	listInactiveSelectionBackground?: Color;
	listInactiveSelectionForeground?: Color;
	listInactiveFocusBackground?: Color;
	listHoverBackground?: Color;
	listHoverForeground?: Color;
	listDropBackground?: Color;
	listFocusOutline?: Color;
	listInactiveFocusOutline?: Color;
	listSelectionOutline?: Color;
	listHoverOutline?: Color;
	listMatchesBackground?: Color;
	listMatchesOutline?: Color;
}

const defaultStyles: IListStyles = {
	listFocusBackground: Color.fromHex('#073655'),
	listActiveSelectionBackground: Color.fromHex('#0E639C'),
	listActiveSelectionForeground: Color.fromHex('#FFFFFF'),
	listFocusAndSelectionBackground: Color.fromHex('#094771'),
	listFocusAndSelectionForeground: Color.fromHex('#FFFFFF'),
	listInactiveSelectionBackground: Color.fromHex('#3F3F46'),
	listHoverBackground: Color.fromHex('#2A2D2E'),
	listDropBackground: Color.fromHex('#383B3D')
};

const DefaultOptions = {
	keyboardSupport: true,
	mouseSupport: true,
	multipleSelectionSupport: true,
	dnd: {
		getDragURI() { return null; },
		onDragStart(): void { },
		onDragOver() { return false; },
		drop() { }
	}
};

// TODO@Joao: move these utils into a SortedArray class

function getContiguousRangeContaining(range: number[], value: number): number[] {
	const index = range.indexOf(value);

	if (index === -1) {
		return [];
	}

	const result: number[] = [];
	let i = index - 1;
	while (i >= 0 && range[i] === value - (index - i)) {
		result.push(range[i--]);
	}

	result.reverse();
	i = index;
	while (i < range.length && range[i] === value + (i - index)) {
		result.push(range[i++]);
	}

	return result;
}

/**
 * Given two sorted collections of numbers, returns the intersection
 * betweem them (OR).
 */
function disjunction(one: number[], other: number[]): number[] {
	const result: number[] = [];
	let i = 0, j = 0;

	while (i < one.length || j < other.length) {
		if (i >= one.length) {
			result.push(other[j++]);
		} else if (j >= other.length) {
			result.push(one[i++]);
		} else if (one[i] === other[j]) {
			result.push(one[i]);
			i++;
			j++;
			continue;
		} else if (one[i] < other[j]) {
			result.push(one[i++]);
		} else {
			result.push(other[j++]);
		}
	}

	return result;
}

/**
 * Given two sorted collections of numbers, returns the relative
 * complement between them (XOR).
 */
function relativeComplement(one: number[], other: number[]): number[] {
	const result: number[] = [];
	let i = 0, j = 0;

	while (i < one.length || j < other.length) {
		if (i >= one.length) {
			result.push(other[j++]);
		} else if (j >= other.length) {
			result.push(one[i++]);
		} else if (one[i] === other[j]) {
			i++;
			j++;
			continue;
		} else if (one[i] < other[j]) {
			result.push(one[i++]);
		} else {
			j++;
		}
	}

	return result;
}

const numericSort = (a: number, b: number) => a - b;

class PipelineRenderer<T> implements IListRenderer<T, any> {

	constructor(
		private _templateId: string,
		private renderers: IListRenderer<any /* TODO@joao */, any>[]
	) { }

	get templateId(): string {
		return this._templateId;
	}

	renderTemplate(container: HTMLElement): any[] {
		return this.renderers.map(r => r.renderTemplate(container));
	}

	renderElement(element: T, index: number, templateData: any[]): void {
		let i = 0;

		for (const renderer of this.renderers) {
			renderer.renderElement(element, index, templateData[i++]);
		}
	}

	disposeElement(element: T, index: number, templateData: any[]): void {
		let i = 0;

		for (const renderer of this.renderers) {
			if (renderer.disposeElement) {
				renderer.disposeElement(element, index, templateData[i]);
			}

			i += 1;
		}
	}

	disposeTemplate(templateData: any[]): void {
		let i = 0;

		for (const renderer of this.renderers) {
			renderer.disposeTemplate(templateData[i++]);
		}
	}
}

class AccessibiltyRenderer<T> implements IListRenderer<T, HTMLElement> {

	templateId: string = 'a18n';

	constructor(private accessibilityProvider: IAccessibilityProvider<T>) { }

	renderTemplate(container: HTMLElement): HTMLElement {
		return container;
	}

	renderElement(element: T, index: number, container: HTMLElement): void {
		const ariaLabel = this.accessibilityProvider.getAriaLabel(element);

		if (ariaLabel) {
			container.setAttribute('aria-label', ariaLabel);
		} else {
			container.removeAttribute('aria-label');
		}

		const ariaLevel = this.accessibilityProvider.getAriaLevel && this.accessibilityProvider.getAriaLevel(element);

		if (typeof ariaLevel === 'number') {
			container.setAttribute('aria-level', `${ariaLevel}`);
		} else {
			container.removeAttribute('aria-level');
		}
	}

	disposeTemplate(templateData: any): void {
		// noop
	}
}

class ListViewDragAndDrop<T> implements IListViewDragAndDrop<T> {

	constructor(private list: List<T>, private dnd: IListDragAndDrop<T>) { }

	getDragElements(element: T): T[] {
		const selection = this.list.getSelectedElements();
		const elements = selection.indexOf(element) > -1 ? selection : [element];
		return elements;
	}

	getDragURI(element: T): string | null {
		return this.dnd.getDragURI(element);
	}

	getDragLabel?(elements: T[]): string | undefined {
		if (this.dnd.getDragLabel) {
			return this.dnd.getDragLabel(elements);
		}

		return undefined;
	}

	onDragStart(data: IDragAndDropData, originalEvent: DragEvent): void {
		if (this.dnd.onDragStart) {
			this.dnd.onDragStart(data, originalEvent);
		}
	}

	onDragOver(data: IDragAndDropData, targetElement: T, targetIndex: number, originalEvent: DragEvent): boolean | IListDragOverReaction {
		return this.dnd.onDragOver(data, targetElement, targetIndex, originalEvent);
	}

	drop(data: IDragAndDropData, targetElement: T, targetIndex: number, originalEvent: DragEvent): void {
		this.dnd.drop(data, targetElement, targetIndex, originalEvent);
	}
}

export class List<T> implements ISpliceable<T>, IDisposable {

	private static InstanceCount = 0;
	private idPrefix = `list_id_${++List.InstanceCount}`;

	private focus: Trait<T>;
	private selection: Trait<T>;
	private eventBufferer = new EventBufferer();
	private view: ListView<T>;
	private spliceable: ISpliceable<T>;
	private styleElement: HTMLStyleElement;
	private styleController: IStyleController;

	protected disposables: IDisposable[];

	@memoize get onFocusChange(): Event<IListEvent<T>> {
		return Event.map(this.eventBufferer.wrapEvent(this.focus.onChange), e => this.toListEvent(e));
	}

	@memoize get onSelectionChange(): Event<IListEvent<T>> {
		return Event.map(this.eventBufferer.wrapEvent(this.selection.onChange), e => this.toListEvent(e));
	}

	private _onDidOpen = new Emitter<IListEvent<T>>();
	readonly onDidOpen: Event<IListEvent<T>> = this._onDidOpen.event;

	private _onPin = new Emitter<number[]>();
	@memoize get onPin(): Event<IListEvent<T>> {
		return Event.map(this._onPin.event, indexes => this.toListEvent({ indexes }));
	}

	get onMouseClick(): Event<IListMouseEvent<T>> { return this.view.onMouseClick; }
	get onMouseDblClick(): Event<IListMouseEvent<T>> { return this.view.onMouseDblClick; }
	get onMouseMiddleClick(): Event<IListMouseEvent<T>> { return this.view.onMouseMiddleClick; }
	get onMouseUp(): Event<IListMouseEvent<T>> { return this.view.onMouseUp; }
	get onMouseDown(): Event<IListMouseEvent<T>> { return this.view.onMouseDown; }
	get onMouseOver(): Event<IListMouseEvent<T>> { return this.view.onMouseOver; }
	get onMouseMove(): Event<IListMouseEvent<T>> { return this.view.onMouseMove; }
	get onMouseOut(): Event<IListMouseEvent<T>> { return this.view.onMouseOut; }
	get onTouchStart(): Event<IListTouchEvent<T>> { return this.view.onTouchStart; }
	get onTap(): Event<IListGestureEvent<T>> { return this.view.onTap; }

	private didJustPressContextMenuKey: boolean = false;
	@memoize get onContextMenu(): Event<IListContextMenuEvent<T>> {
		const fromKeydown = Event.chain(domEvent(this.view.domNode, 'keydown'))
			.map(e => new StandardKeyboardEvent(e))
			.filter(e => this.didJustPressContextMenuKey = e.keyCode === KeyCode.ContextMenu || (e.shiftKey && e.keyCode === KeyCode.F10))
			.filter(e => { e.preventDefault(); e.stopPropagation(); return false; })
			.map(event => {
				const index = this.getFocus()[0];
				const element = this.view.element(index);
				const anchor = this.view.domElement(index) || undefined;
				return { index, element, anchor, browserEvent: event.browserEvent };
			})
			.event;

		const fromKeyup = Event.chain(domEvent(this.view.domNode, 'keyup'))
			.filter(() => {
				const didJustPressContextMenuKey = this.didJustPressContextMenuKey;
				this.didJustPressContextMenuKey = false;
				return didJustPressContextMenuKey;
			})
			.filter(() => this.getFocus().length > 0)
			.map(browserEvent => {
				const index = this.getFocus()[0];
				const element = this.view.element(index);
				const anchor = this.view.domElement(index) || undefined;
				return { index, element, anchor, browserEvent };
			})
			.filter(({ anchor }) => !!anchor)
			.event;

		const fromMouse = Event.chain(this.view.onContextMenu)
			.filter(() => !this.didJustPressContextMenuKey)
			.map(({ element, index, browserEvent }) => ({ element, index, anchor: { x: browserEvent.clientX + 1, y: browserEvent.clientY }, browserEvent }))
			.event;

		return Event.any<IListContextMenuEvent<T>>(fromKeydown, fromKeyup, fromMouse);
	}

	get onKeyDown(): Event<KeyboardEvent> { return domEvent(this.view.domNode, 'keydown'); }
	get onKeyUp(): Event<KeyboardEvent> { return domEvent(this.view.domNode, 'keyup'); }
	get onKeyPress(): Event<KeyboardEvent> { return domEvent(this.view.domNode, 'keypress'); }

	readonly onDidFocus: Event<void>;
	readonly onDidBlur: Event<void>;

	private _onDidDispose = new Emitter<void>();
	get onDidDispose(): Event<void> { return this._onDidDispose.event; }

	constructor(
		container: HTMLElement,
		virtualDelegate: IListVirtualDelegate<T>,
		renderers: IListRenderer<any /* TODO@joao */, any>[],
		options: IListOptions<T> = DefaultOptions
	) {
		this.focus = new FocusTrait(i => this.getElementDomId(i));
		this.selection = new Trait('selected');

		mixin(options, defaultStyles, false);

		const baseRenderers: IListRenderer<T, ITraitTemplateData>[] = [this.focus.renderer, this.selection.renderer];

		if (options.accessibilityProvider) {
			baseRenderers.push(new AccessibiltyRenderer<T>(options.accessibilityProvider));
		}

		renderers = renderers.map(r => new PipelineRenderer(r.templateId, [...baseRenderers, r]));

		const viewOptions: IListViewOptions<T> = {
			...options,
			dnd: options.dnd && new ListViewDragAndDrop(this, options.dnd)
		};

		this.view = new ListView(container, virtualDelegate, renderers, viewOptions);
		this.view.domNode.setAttribute('role', 'tree');
		DOM.addClass(this.view.domNode, this.idPrefix);
		this.view.domNode.tabIndex = 0;

		this.styleElement = DOM.createStyleSheet(this.view.domNode);

		this.styleController = options.styleController || new DefaultStyleController(this.styleElement, this.idPrefix);

		this.spliceable = new CombinedSpliceable([
			new TraitSpliceable(this.focus, this.view, options.identityProvider),
			new TraitSpliceable(this.selection, this.view, options.identityProvider),
			this.view
		]);

		this.disposables = [this.focus, this.selection, this.view, this._onDidDispose];

		this.onDidFocus = Event.map(domEvent(this.view.domNode, 'focus', true), () => null!);
		this.onDidBlur = Event.map(domEvent(this.view.domNode, 'blur', true), () => null!);

		this.disposables.push(new DOMFocusController(this, this.view));

		if (typeof options.keyboardSupport !== 'boolean' || options.keyboardSupport) {
			const controller = new KeyboardController(this, this.view, options);
			this.disposables.push(controller);
		}

		if (options.keyboardNavigationLabelProvider) {
			const controller = new TypeLabelController(this, this.view, options.keyboardNavigationLabelProvider);
			this.disposables.push(controller);
		}

		if (typeof options.mouseSupport === 'boolean' ? options.mouseSupport : true) {
			this.disposables.push(new MouseController(this, this.view, options));
		}

		this.onFocusChange(this._onFocusChange, this, this.disposables);
		this.onSelectionChange(this._onSelectionChange, this, this.disposables);

		if (options.ariaLabel) {
			this.view.domNode.setAttribute('aria-label', localize('aria list', "{0}. Use the navigation keys to navigate.", options.ariaLabel));
		}

		this.style(options);
	}

	splice(start: number, deleteCount: number, elements: T[] = []): void {
		if (start < 0 || start > this.view.length) {
			throw new Error(`Invalid start index: ${start}`);
		}

		if (deleteCount < 0) {
			throw new Error(`Invalid delete count: ${deleteCount}`);
		}

		if (deleteCount === 0 && elements.length === 0) {
			return;
		}

		this.eventBufferer.bufferEvents(() => this.spliceable.splice(start, deleteCount, elements));
	}

	element(index: number): T {
		return this.view.element(index);
	}

	get length(): number {
		return this.view.length;
	}

	get contentHeight(): number {
		return this.view.contentHeight;
	}

	get onDidChangeContentHeight(): Event<number> {
		return this.view.onDidChangeContentHeight;
	}

	get scrollTop(): number {
		return this.view.getScrollTop();
	}

	set scrollTop(scrollTop: number) {
		this.view.setScrollTop(scrollTop);
	}

	get scrollHeight(): number {
		return this.view.scrollHeight;
	}

	get renderHeight(): number {
		return this.view.renderHeight;
	}

	domFocus(): void {
		this.view.domNode.focus();
	}

	layout(height?: number): void {
		this.view.layout(height);
	}

	layoutWidth(width: number): void {
		this.view.layoutWidth(width);
	}

	setSelection(indexes: number[], browserEvent?: UIEvent): void {
		for (const index of indexes) {
			if (index < 0 || index >= this.length) {
				throw new Error(`Invalid index ${index}`);
			}
		}

		indexes = indexes.sort(numericSort);
		this.selection.set(indexes, browserEvent);
	}

	getSelection(): number[] {
		return this.selection.get();
	}

	getSelectedElements(): T[] {
		return this.getSelection().map(i => this.view.element(i));
	}

	setFocus(indexes: number[], browserEvent?: UIEvent): void {
		for (const index of indexes) {
			if (index < 0 || index >= this.length) {
				throw new Error(`Invalid index ${index}`);
			}
		}

		indexes = indexes.sort(numericSort);
		this.focus.set(indexes, browserEvent);
	}

	focusNext(n = 1, loop = false, browserEvent?: UIEvent, filter?: (element: T) => boolean): void {
		if (this.length === 0) { return; }

		const focus = this.focus.get();
		const index = this.findNextIndex(focus.length > 0 ? focus[0] + n : 0, loop, filter);

		if (index > -1) {
			this.setFocus([index], browserEvent);
		}
	}

	focusPrevious(n = 1, loop = false, browserEvent?: UIEvent, filter?: (element: T) => boolean): void {
		if (this.length === 0) { return; }

		const focus = this.focus.get();
		const index = this.findPreviousIndex(focus.length > 0 ? focus[0] - n : 0, loop, filter);

		if (index > -1) {
			this.setFocus([index], browserEvent);
		}
	}

	focusNextPage(browserEvent?: UIEvent, filter?: (element: T) => boolean): void {
		let lastPageIndex = this.view.indexAt(this.view.getScrollTop() + this.view.renderHeight);
		lastPageIndex = lastPageIndex === 0 ? 0 : lastPageIndex - 1;
		const lastPageElement = this.view.element(lastPageIndex);
		const currentlyFocusedElement = this.getFocusedElements()[0];

		if (currentlyFocusedElement !== lastPageElement) {
			const lastGoodPageIndex = this.findPreviousIndex(lastPageIndex, false, filter);

			if (lastGoodPageIndex > -1 && currentlyFocusedElement !== this.view.element(lastGoodPageIndex)) {
				this.setFocus([lastGoodPageIndex], browserEvent);
			} else {
				this.setFocus([lastPageIndex], browserEvent);
			}
		} else {
			const previousScrollTop = this.view.getScrollTop();
			this.view.setScrollTop(previousScrollTop + this.view.renderHeight - this.view.elementHeight(lastPageIndex));

			if (this.view.getScrollTop() !== previousScrollTop) {
				// Let the scroll event listener run
				setTimeout(() => this.focusNextPage(browserEvent, filter), 0);
			}
		}
	}

	focusPreviousPage(browserEvent?: UIEvent, filter?: (element: T) => boolean): void {
		let firstPageIndex: number;
		const scrollTop = this.view.getScrollTop();

		if (scrollTop === 0) {
			firstPageIndex = this.view.indexAt(scrollTop);
		} else {
			firstPageIndex = this.view.indexAfter(scrollTop - 1);
		}

		const firstPageElement = this.view.element(firstPageIndex);
		const currentlyFocusedElement = this.getFocusedElements()[0];

		if (currentlyFocusedElement !== firstPageElement) {
			const firstGoodPageIndex = this.findNextIndex(firstPageIndex, false, filter);

			if (firstGoodPageIndex > -1 && currentlyFocusedElement !== this.view.element(firstGoodPageIndex)) {
				this.setFocus([firstGoodPageIndex], browserEvent);
			} else {
				this.setFocus([firstPageIndex], browserEvent);
			}
		} else {
			const previousScrollTop = scrollTop;
			this.view.setScrollTop(scrollTop - this.view.renderHeight);

			if (this.view.getScrollTop() !== previousScrollTop) {
				// Let the scroll event listener run
				setTimeout(() => this.focusPreviousPage(browserEvent, filter), 0);
			}
		}
	}

	focusLast(browserEvent?: UIEvent, filter?: (element: T) => boolean): void {
		if (this.length === 0) { return; }

		const index = this.findPreviousIndex(this.length - 1, false, filter);

		if (index > -1) {
			this.setFocus([index], browserEvent);
		}
	}

	focusFirst(browserEvent?: UIEvent, filter?: (element: T) => boolean): void {
		if (this.length === 0) { return; }

		const index = this.findNextIndex(0, false, filter);

		if (index > -1) {
			this.setFocus([index], browserEvent);
		}
	}

	private findNextIndex(index: number, loop = false, filter?: (element: T) => boolean): number {
		for (let i = 0; i < this.length; i++) {
			if (index >= this.length && !loop) {
				return -1;
			}

			index = index % this.length;

			if (!filter || filter(this.element(index))) {
				return index;
			}

			index++;
		}

		return -1;
	}

	private findPreviousIndex(index: number, loop = false, filter?: (element: T) => boolean): number {
		for (let i = 0; i < this.length; i++) {
			if (index < 0 && !loop) {
				return -1;
			}

			index = (this.length + (index % this.length)) % this.length;

			if (!filter || filter(this.element(index))) {
				return index;
			}

			index--;
		}

		return -1;
	}

	getFocus(): number[] {
		return this.focus.get();
	}

	getFocusedElements(): T[] {
		return this.getFocus().map(i => this.view.element(i));
	}

	reveal(index: number, relativeTop?: number): void {
		if (index < 0 || index >= this.length) {
			throw new Error(`Invalid index ${index}`);
		}

		const scrollTop = this.view.getScrollTop();
		const elementTop = this.view.elementTop(index);
		const elementHeight = this.view.elementHeight(index);

		if (isNumber(relativeTop)) {
			// y = mx + b
			const m = elementHeight - this.view.renderHeight;
			this.view.setScrollTop(m * clamp(relativeTop, 0, 1) + elementTop);
		} else {
			const viewItemBottom = elementTop + elementHeight;
			const wrapperBottom = scrollTop + this.view.renderHeight;

			if (elementTop < scrollTop) {
				this.view.setScrollTop(elementTop);
			} else if (viewItemBottom >= wrapperBottom) {
				this.view.setScrollTop(viewItemBottom - this.view.renderHeight);
			}
		}
	}

	/**
	 * Returns the relative position of an element rendered in the list.
	 * Returns `null` if the element isn't *entirely* in the visible viewport.
	 */
	getRelativeTop(index: number): number | null {
		if (index < 0 || index >= this.length) {
			throw new Error(`Invalid index ${index}`);
		}

		const scrollTop = this.view.getScrollTop();
		const elementTop = this.view.elementTop(index);
		const elementHeight = this.view.elementHeight(index);

		if (elementTop < scrollTop || elementTop + elementHeight > scrollTop + this.view.renderHeight) {
			return null;
		}

		// y = mx + b
		const m = elementHeight - this.view.renderHeight;
		return Math.abs((scrollTop - elementTop) / m);
	}

	private getElementDomId(index: number): string {
		return `${this.idPrefix}_${index}`;
	}

	isDOMFocused(): boolean {
		return this.view.domNode === document.activeElement;
	}

	getHTMLElement(): HTMLElement {
		return this.view.domNode;
	}

	open(indexes: number[], browserEvent?: UIEvent): void {
		for (const index of indexes) {
			if (index < 0 || index >= this.length) {
				throw new Error(`Invalid index ${index}`);
			}
		}

		this._onDidOpen.fire({ indexes, elements: indexes.map(i => this.view.element(i)), browserEvent });
	}

	pin(indexes: number[]): void {
		for (const index of indexes) {
			if (index < 0 || index >= this.length) {
				throw new Error(`Invalid index ${index}`);
			}
		}

		this._onPin.fire(indexes);
	}

	style(styles: IListStyles): void {
		this.styleController.style(styles);
	}

	private toListEvent({ indexes, browserEvent }: ITraitChangeEvent) {
		return { indexes, elements: indexes.map(i => this.view.element(i)), browserEvent };
	}

	private _onFocusChange(): void {
		const focus = this.focus.get();

		if (focus.length > 0) {
			this.view.domNode.setAttribute('aria-activedescendant', this.getElementDomId(focus[0]));
		} else {
			this.view.domNode.removeAttribute('aria-activedescendant');
		}

		this.view.domNode.setAttribute('role', 'tree');
		DOM.toggleClass(this.view.domNode, 'element-focused', focus.length > 0);
	}

	private _onSelectionChange(): void {
		const selection = this.selection.get();

		DOM.toggleClass(this.view.domNode, 'selection-none', selection.length === 0);
		DOM.toggleClass(this.view.domNode, 'selection-single', selection.length === 1);
		DOM.toggleClass(this.view.domNode, 'selection-multiple', selection.length > 1);
	}

	dispose(): void {
		this._onDidDispose.fire();
		this.disposables = dispose(this.disposables);

		this._onDidOpen.dispose();
		this._onPin.dispose();
		this._onDidDispose.dispose();
	}
}
