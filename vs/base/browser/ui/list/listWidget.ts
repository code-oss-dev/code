/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./list';
import { IDisposable, dispose, disposeAll } from 'vs/base/common/lifecycle';
import { isNumber } from 'vs/base/common/types';
import * as DOM from 'vs/base/browser/dom';
import Event, { Emitter, mapEvent } from 'vs/base/common/event';
import { IDelegate, IRenderer, IListMouseEvent, IFocusChangeEvent, ISelectionChangeEvent } from './list';
import { ListView } from './listView';

interface ITraitTemplateData<D> {
	container: HTMLElement;
	data: D;
}

interface ITraitChangeEvent {
	indexes: number[];
}

class TraitRenderer<T, D> implements IRenderer<T, ITraitTemplateData<D>>
{
	private elements: { [id: string]: T };

	constructor(
		private controller: Trait,
		private renderer: IRenderer<T,D>
	) {}

	public get templateId(): string {
		return this.renderer.templateId;
	}

	renderTemplate(container: HTMLElement): ITraitTemplateData<D> {
		const data = this.renderer.renderTemplate(container);
		return { container, data };
	}

	renderElement(element: T, index: number, templateData: ITraitTemplateData<D>): void {
		DOM.toggleClass(templateData.container, this.controller.trait, this.controller.contains(index));
		this.renderer.renderElement(element, index, templateData.data);
	}

	disposeTemplate(templateData: ITraitTemplateData<D>): void {
		return this.renderer.disposeTemplate(templateData.data);
	}
}

class Trait implements IDisposable {

	private indexes: number[];

	private _onChange = new Emitter<ITraitChangeEvent>();
	get onChange() { return this._onChange.event; }

	constructor(private _trait: string) {
		this.indexes = [];
	}

	splice(start: number, deleteCount: number, insertCount: number): void {
		const diff = insertCount - deleteCount;
		const end = start + deleteCount;
		const indexes = [];

		for (const index of indexes) {
			if (index >= start && index < end) {
				continue;
			}

			indexes.push(index > start ? index + diff : index);
		}

		this.indexes = indexes;
		this._onChange.fire({ indexes });
	}

	get trait(): string {
		return this._trait;
	}

	set(...indexes: number[]): number[] {
		const result = this.indexes;
		this.indexes = indexes;
		this._onChange.fire({ indexes });
		return result;
	}

	get(): number[] {
		return this.indexes;
	}

	add(index: number): void {
		if (this.contains(index)) {
			return;
		}

		this.indexes.push(index);
		this._onChange.fire({ indexes: this.indexes });
	}

	remove(index: number): void {
		this.indexes = this.indexes.filter(i => i === index);
		this._onChange.fire({ indexes: this.indexes });
	}

	contains(index: number): boolean {
		return this.indexes.some(i => i === index);
	}

	next(n: number): void {
		let index = this.indexes.length ? this.indexes[0] : 0;
		index = Math.min(index + n, this.indexes.length);
		this.set(index);
	}

	previous(n: number): void {
		let index = this.indexes.length ? this.indexes[0] : this.indexes.length - 1;
		index = Math.max(index - n, 0);
		this.set(index);
	}

	wrapRenderer<T, D>(renderer: IRenderer<T, D>): IRenderer<T, ITraitTemplateData<D>> {
		return new TraitRenderer<T, D>(this, renderer);
	}

	dispose() {
		this.indexes = null;
		this._onChange = dispose(this._onChange);
	}
}

class Controller<T> implements IDisposable {

	private toDispose: IDisposable[];

	constructor(
		private list: List<T>,
		private view: ListView<T>
	) {
		this.toDispose = [];
		this.toDispose.push(view.addListener('click', e => this.onClick(e)));
	}

	private onClick(e: IListMouseEvent<T>) {
		this.list.setSelection(e.index);
	}

	dispose() {
		this.toDispose = disposeAll(this.toDispose);
	}
}

export class List<T> implements IDisposable {

	private focus: Trait;
	private selection: Trait;
	private view: ListView<T>;
	private controller: Controller<T>;

	get onFocusChange(): Event<IFocusChangeEvent<T>> {
		return mapEvent(this.focus.onChange, e => ({
			elements: e.indexes.map(i => this.view.element(i)),
			indexes: e.indexes
		}));
	}

	get onSelectionChange(): Event<ISelectionChangeEvent<T>> {
		return mapEvent(this.selection.onChange, e => ({
			elements: e.indexes.map(i => this.view.element(i)),
			indexes: e.indexes
		}));
	}

	constructor(
		container: HTMLElement,
		delegate: IDelegate<T>,
		renderers: IRenderer<T, any>[]
	) {
		this.focus = new Trait('focused');
		this.selection = new Trait('selected');

		renderers = renderers.map(r => {
			r = this.focus.wrapRenderer(r);
			r = this.selection.wrapRenderer(r);
			return r;
		});

		this.view = new ListView(container, delegate, renderers);
		this.controller = new Controller(this, this.view);
	}

	splice(start: number, deleteCount: number, ...elements: T[]): void {
		this.focus.splice(start, deleteCount, elements.length);
		this.selection.splice(start, deleteCount, elements.length);
		this.view.splice(start, deleteCount, ...elements);
	}

	get length(): number {
		return this.view.length;
	}

	get contentHeight(): number {
		return this.view.getScrollHeight();
	}

	layout(height?: number): void {
		this.view.layout(height);
	}

	setSelection(...indexes: number[]): void {
		indexes = indexes.concat(this.selection.set(...indexes));
		indexes.forEach(i => this.view.splice(i, 1, this.view.element(i)));
	}

	selectNext(n = 1, loop = false): void {
		if (this.length === 0) return;
		const selection = this.selection.get();
		let index = selection.length > 0 ? selection[0] + n : 0;
		this.selection.set(loop ? index % this.length : Math.min(index, this.length - 1));
	}

	selectPrevious(n = 1, loop = false): void {
		if (this.length === 0) return;
		const selection = this.selection.get();
		let index = selection.length > 0 ? selection[0] - n : 0;
		if (loop && index < 0) index = this.length + (index % this.length);
		this.selection.set(Math.max(index, 0));
	}

	setFocus(...indexes: number[]): void {
		indexes = indexes.concat(this.focus.set(...indexes));
		indexes.forEach(i => this.view.splice(i, 1, this.view.element(i)));
	}

	focusNext(n = 1, loop = false): void {
		if (this.length === 0) return;
		const focus = this.focus.get();
		let index = focus.length > 0 ? focus[0] + n : 0;
		this.focus.set(loop ? index % this.length : Math.min(index, this.length - 1));
	}

	focusPrevious(n = 1, loop = false): void {
		if (this.length === 0) return;
		const focus = this.focus.get();
		let index = focus.length > 0 ? focus[0] - n : 0;
		if (loop && index < 0) index = this.length + (index % this.length);
		this.focus.set(Math.max(index, 0));
	}

	getFocus(): T[] {
		return this.focus.get().map(i => this.view.element(i));
	}

	reveal(index: number, relativeTop?: number): void {
		const scrollTop = this.view.getScrollTop();
		const elementTop = this.view.elementTop(index);
		const elementHeight = this.view.elementHeight(index);

		if (isNumber(relativeTop)) {
			relativeTop = relativeTop < 0 ? 0 : relativeTop;
			relativeTop = relativeTop > 1 ? 1 : relativeTop;

			// y = mx + b
			const m = elementHeight - this.view.height;
			this.view.setScrollTop(m * relativeTop + elementTop);
		} else {
			const viewItemBottom = elementTop + elementHeight;
			const wrapperBottom = scrollTop + this.view.height;

			if (elementTop < scrollTop) {
				this.view.setScrollTop(elementTop);
			} else if (viewItemBottom >= wrapperBottom) {
				this.view.setScrollTop(viewItemBottom - this.view.height);
			}
		}
	}

	dispose(): void {
		this.view = dispose(this.view);
		this.focus = dispose(this.focus);
		this.selection = dispose(this.selection);
	}
}
