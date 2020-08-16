/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/replFilter';
import * as DOM from 'vs/base/browser/dom';
import { BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { Delayer } from 'vs/base/common/async';
import { IAction } from 'vs/base/common/actions';
import { HistoryInputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { toDisposable, Disposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ContextScopedHistoryInputBox } from 'vs/platform/browser/contextScopedHistoryWidget';
import { localize } from 'vs/nls';

export interface IReplFiltersChangeEvent {
	filterText?: boolean;
	layout?: boolean;
}

export interface IReplFiltersOptions {
	filterText: string;
	filterHistory: string[];
	layout: DOM.Dimension;
}

export class ReplFilterState extends Disposable {

	private readonly _onDidChange: Emitter<IReplFiltersChangeEvent> = this._register(new Emitter<IReplFiltersChangeEvent>());
	readonly onDidChange: Event<IReplFiltersChangeEvent> = this._onDidChange.event;

	constructor(options: IReplFiltersOptions) {
		super();
		this._filterText = options.filterText;
		this.filterHistory = options.filterHistory;
		this._layout = options.layout;
	}

	private _filterText: string;
	get filterText(): string {
		return this._filterText;
	}
	set filterText(filterText: string) {
		if (this._filterText !== filterText) {
			this._filterText = filterText;
			this._onDidChange.fire({ filterText: true });
		}
	}

	filterHistory: string[];

	private _layout: DOM.Dimension = new DOM.Dimension(0, 0);
	get layout(): DOM.Dimension {
		return this._layout;
	}
	set layout(layout: DOM.Dimension) {
		if (this._layout.width !== layout.width || this._layout.height !== layout.height) {
			this._layout = layout;
			this._onDidChange.fire(<IReplFiltersChangeEvent>{ layout: true });
		}
	}
}

export class ReplFilterActionViewItem extends BaseActionViewItem {

	private delayedFilterUpdate: Delayer<void>;
	private container: HTMLElement | undefined;
	private filterInputBox: HistoryInputBox | undefined;

	constructor(
		action: IAction,
		private filters: ReplFilterState,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextViewService private readonly contextViewService: IContextViewService) {
		super(null, action);
		this.delayedFilterUpdate = new Delayer<void>(200);
		this._register(toDisposable(() => this.delayedFilterUpdate.cancel()));
	}

	render(container: HTMLElement): void {
		this.container = container;
		DOM.addClass(this.container, 'repl-panel-action-filter-container');

		this.element = DOM.append(this.container, DOM.$(''));
		this.element.className = this.class;
		this.createInput(this.element);
		this.updateClass();
	}

	focus(): void {
		if (this.filterInputBox) {
			this.filterInputBox.focus();
		}
	}

	private clearFilterText(): void {
		if (this.filterInputBox) {
			this.filterInputBox.value = '';
		}
	}

	private createInput(container: HTMLElement): void {
		this.filterInputBox = this._register(this.instantiationService.createInstance(ContextScopedHistoryInputBox, container, this.contextViewService, {
			placeholder: localize('workbench.debug.filter.placeholder', "Filter. E.g.: text, !exclude"),
			history: this.filters.filterHistory
		}));
		this.filterInputBox.value = this.filters.filterText;
		this._register(this.filterInputBox.onDidChange(() => this.delayedFilterUpdate.trigger(() => this.onDidInputChange(this.filterInputBox!))));
		this._register(this.filters.onDidChange((event: IReplFiltersChangeEvent) => {
			if (event.filterText) {
				this.filterInputBox!.value = this.filters.filterText;
			}
		}));
		this._register(DOM.addStandardDisposableListener(this.filterInputBox.inputElement, DOM.EventType.KEY_DOWN, (e: any) => this.onInputKeyDown(e)));
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_DOWN, this.handleKeyboardEvent));
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_UP, this.handleKeyboardEvent));
		this._register(DOM.addStandardDisposableListener(this.filterInputBox.inputElement, DOM.EventType.CLICK, (e) => {
			e.stopPropagation();
			e.preventDefault();
		}));
		this._register(this.filters.onDidChange(e => this.onDidFiltersChange(e)));
	}

	private onDidFiltersChange(e: IReplFiltersChangeEvent): void {
		if (e.layout) {
			this.updateClass();
		}
	}

	private onDidInputChange(inputbox: HistoryInputBox) {
		inputbox.addToHistory();
		this.filters.filterText = inputbox.value;
		this.filters.filterHistory = inputbox.getHistory();
	}

	// Action toolbar is swallowing some keys for action items which should not be for an input box
	private handleKeyboardEvent(event: StandardKeyboardEvent) {
		if (event.equals(KeyCode.Space)
			|| event.equals(KeyCode.LeftArrow)
			|| event.equals(KeyCode.RightArrow)
			|| event.equals(KeyCode.Escape)
		) {
			event.stopPropagation();
		}
	}

	private onInputKeyDown(event: StandardKeyboardEvent) {
		let handled = false;
		if (event.equals(KeyCode.Escape)) {
			this.clearFilterText();
			handled = true;
		}
		if (handled) {
			event.stopPropagation();
			event.preventDefault();
		}
	}

	protected updateClass(): void {
		if (this.element && this.container) {
			this.element.className = this.class;
			DOM.toggleClass(this.container, 'grow', DOM.hasClass(this.element, 'grow'));
		}
	}

	protected get class(): string {
		if (this.filters.layout.width > 800) {
			return 'repl-panel-action-filter grow';
		} else if (this.filters.layout.width < 600) {
			return 'repl-panel-action-filter small';
		} else {
			return 'repl-panel-action-filter';
		}
	}
}
