/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as dom from 'vs/base/browser/dom';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IAnchor } from 'vs/base/browser/ui/contextview/contextview';
import { IAction } from 'vs/base/common/actions';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import 'vs/css!./actionWidget';
import { localize } from 'vs/nls';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { acceptSelectedActionCommand, ActionList, IListMenuItem, previewSelectedActionCommand } from 'vs/platform/actionWidget/browser/actionList';
import { IActionItem, IActionKeybindingResolver } from 'vs/platform/actionWidget/common/actionWidget';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator, IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';


const ActionWidgetContextKeys = {
	Visible: new RawContextKey<boolean>('actionWidgetVisible', false, localize('actionWidgetVisible', "Whether the action widget list is visible"))
};

export interface IRenderDelegate<T extends IActionItem> {
	onHide(didCancel?: boolean): void;
	onSelect(action: IActionItem, preview?: boolean): Promise<any>;
}

export const IActionWidgetService = createDecorator<IActionWidgetService>('actionWidgetService');

export interface IActionWidgetService {
	readonly _serviceBrand: undefined;

	show(user: string, items: IListMenuItem<IActionItem>[], delegate: IRenderDelegate<any>, anchor: IAnchor, container: HTMLElement | undefined, actionBarActions?: readonly IAction[]): Promise<void>;

	hide(): void;

	readonly isVisible: boolean;
}

class ActionWidgetService extends Disposable implements IActionWidgetService {
	declare readonly _serviceBrand: undefined;

	get isVisible() {
		return ActionWidgetContextKeys.Visible.getValue(this._contextKeyService) || false;
	}

	private readonly _list = this._register(new MutableDisposable<ActionList<any>>());

	constructor(
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
	}

	async show(user: string, items: IListMenuItem<IActionItem>[], delegate: IRenderDelegate<any>, anchor: IAnchor, container: HTMLElement | undefined, actionBarActions?: readonly IAction[], resolver?: IActionKeybindingResolver): Promise<void> {
		const visibleContext = ActionWidgetContextKeys.Visible.bindTo(this._contextKeyService);

		const list = this._instantiationService.createInstance(ActionList, user, items, delegate, resolver);
		this.contextViewService.showContextView({
			getAnchor: () => anchor,
			render: (container: HTMLElement) => {
				visibleContext.set(true);
				return this._renderWidget(container, list, actionBarActions ?? []);
			},
			onHide: (didCancel) => {
				visibleContext.reset();
				return this._onWidgetClosed(didCancel);
			},
		}, container, false);
	}

	acceptSelected(preview?: boolean) {
		this._list.value?.acceptSelected(preview);
	}

	focusPrevious() {
		this._list?.value?.focusPrevious();
	}

	focusNext() {
		this._list?.value?.focusNext();
	}

	hide() {
		this._list.value?.hide();
		this._list.clear();
	}

	clear() {
		this._list.clear();
	}

	private _renderWidget(element: HTMLElement, list: ActionList<any>, actionBarActions: readonly IAction[]): IDisposable {
		const widget = document.createElement('div');
		widget.classList.add('action-widget');
		element.appendChild(widget);

		this._list.value = list;
		if (this._list.value) {
			widget.appendChild(this._list.value.domNode);
		} else {
			throw new Error('List has no value');
		}
		const renderDisposables = new DisposableStore();

		// Invisible div to block mouse interaction in the rest of the UI
		const menuBlock = document.createElement('div');
		const block = element.appendChild(menuBlock);
		block.classList.add('context-view-block');
		renderDisposables.add(dom.addDisposableListener(block, dom.EventType.MOUSE_DOWN, e => e.stopPropagation()));

		// Invisible div to block mouse interaction with the menu
		const pointerBlockDiv = document.createElement('div');
		const pointerBlock = element.appendChild(pointerBlockDiv);
		pointerBlock.classList.add('context-view-pointerBlock');

		// Removes block on click INSIDE widget or ANY mouse movement
		renderDisposables.add(dom.addDisposableListener(pointerBlock, dom.EventType.POINTER_MOVE, () => pointerBlock.remove()));
		renderDisposables.add(dom.addDisposableListener(pointerBlock, dom.EventType.MOUSE_DOWN, () => pointerBlock.remove()));

		// Action bar
		let actionBarWidth = 0;
		if (actionBarActions.length) {
			const actionBar = this._createActionBar('.action-widget-action-bar', actionBarActions);
			if (actionBar) {
				widget.appendChild(actionBar.getContainer().parentElement!);
				renderDisposables.add(actionBar);
				actionBarWidth = actionBar.getContainer().offsetWidth;
			}
		}

		const width = this._list.value?.layout(actionBarWidth);
		widget.style.width = `${width}px`;

		const focusTracker = renderDisposables.add(dom.trackFocus(element));
		renderDisposables.add(focusTracker.onDidBlur(() => this.hide()));

		return renderDisposables;
	}

	private _createActionBar(className: string, actions: readonly IAction[]): ActionBar | undefined {
		if (!actions.length) {
			return undefined;
		}

		const container = dom.$(className);
		const actionBar = new ActionBar(container);
		actionBar.push(actions, { icon: false, label: true });
		return actionBar;
	}

	private _onWidgetClosed(didCancel?: boolean): void {
		this._list.value?.hide(didCancel);
	}
}

registerSingleton(IActionWidgetService, ActionWidgetService, InstantiationType.Delayed);

const weight = KeybindingWeight.EditorContrib + 1000;

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'hideCodeActionWidget',
			title: {
				value: localize('hideCodeActionWidget.title', "Hide action widget"),
				original: 'Hide action widget'
			},
			precondition: ActionWidgetContextKeys.Visible,
			keybinding: {
				weight,
				primary: KeyCode.Escape,
				secondary: [KeyMod.Shift | KeyCode.Escape]
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IActionWidgetService).hide();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'selectPrevCodeAction',
			title: {
				value: localize('selectPrevCodeAction.title', "Select previous action"),
				original: 'Select previous action'
			},
			precondition: ActionWidgetContextKeys.Visible,
			keybinding: {
				weight,
				primary: KeyCode.UpArrow,
				secondary: [KeyMod.CtrlCmd | KeyCode.UpArrow],
				mac: { primary: KeyCode.UpArrow, secondary: [KeyMod.CtrlCmd | KeyCode.UpArrow, KeyMod.WinCtrl | KeyCode.KeyP] },
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const widgetService = accessor.get(IActionWidgetService);
		if (widgetService instanceof ActionWidgetService) {
			widgetService.focusPrevious();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'selectNextCodeAction',
			title: {
				value: localize('selectNextCodeAction.title', "Select next action"),
				original: 'Select next action'
			},
			precondition: ActionWidgetContextKeys.Visible,
			keybinding: {
				weight,
				primary: KeyCode.DownArrow,
				secondary: [KeyMod.CtrlCmd | KeyCode.DownArrow],
				mac: { primary: KeyCode.DownArrow, secondary: [KeyMod.CtrlCmd | KeyCode.DownArrow, KeyMod.WinCtrl | KeyCode.KeyN] }
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const widgetService = accessor.get(IActionWidgetService);
		if (widgetService instanceof ActionWidgetService) {
			widgetService.focusNext();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: acceptSelectedActionCommand,
			title: {
				value: localize('acceptSelected.title', "Accept selected action"),
				original: 'Accept selected action'
			},
			precondition: ActionWidgetContextKeys.Visible,
			keybinding: {
				weight,
				primary: KeyCode.Enter,
				secondary: [KeyMod.CtrlCmd | KeyCode.Period],
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const widgetService = accessor.get(IActionWidgetService);
		if (widgetService instanceof ActionWidgetService) {
			widgetService.acceptSelected();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: previewSelectedActionCommand,
			title: {
				value: localize('previewSelected.title', "Preview selected action"),
				original: 'Preview selected action'
			},
			precondition: ActionWidgetContextKeys.Visible,
			keybinding: {
				weight,
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const widgetService = accessor.get(IActionWidgetService);
		if (widgetService instanceof ActionWidgetService) {
			widgetService.acceptSelected(true);
		}
	}
});
