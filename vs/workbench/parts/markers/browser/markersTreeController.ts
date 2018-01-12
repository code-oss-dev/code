/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import * as mouse from 'vs/base/browser/mouseEvent';
import tree = require('vs/base/parts/tree/browser/tree');
import treedefaults = require('vs/base/parts/tree/browser/treeDefaults');
import { MarkersModel } from 'vs/workbench/parts/markers/common/markersModel';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IAction } from 'vs/base/common/actions';
import { ActionItem, Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { WorkbenchTree } from 'vs/platform/list/browser/listService';

export class Controller extends treedefaults.DefaultController {

	constructor(
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IMenuService private menuService: IMenuService,
		@IKeybindingService private _keybindingService: IKeybindingService
	) {
		super({ clickBehavior: treedefaults.ClickBehavior.ON_MOUSE_DOWN, keyboardSupport: false });
	}

	protected onLeftClick(tree: tree.ITree, element: any, event: mouse.IMouseEvent): boolean {
		let currentFoucssed = tree.getFocus();
		if (super.onLeftClick(tree, element, event)) {
			if (element instanceof MarkersModel) {
				if (currentFoucssed) {
					tree.setFocus(currentFoucssed);
				} else {
					tree.focusFirst();
				}
			}
			return true;
		}
		return false;
	}

	public onContextMenu(tree: WorkbenchTree, element: any, event: tree.ContextMenuEvent): boolean {
		tree.setFocus(element);
		const actions = this._getMenuActions(tree);
		if (!actions.length) {
			return true;
		}
		const anchor = { x: event.posx, y: event.posy };
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,

			getActions: () => {
				return TPromise.as(actions);
			},

			getActionItem: (action) => {
				const keybinding = this._keybindingService.lookupKeybinding(action.id);
				if (keybinding) {
					return new ActionItem(action, action, { label: true, keybinding: keybinding.getLabel() });
				}
				return null;
			},

			onHide: (wasCancelled?: boolean) => {
				if (wasCancelled) {
					tree.DOMFocus();
				}
			}
		});

		return true;
	}

	private _getMenuActions(tree: WorkbenchTree): IAction[] {
		const result: IAction[] = [];
		const groups = this.menuService.createMenu(MenuId.ProblemsPanelContext, tree.contextKeyService).getActions();

		for (let group of groups) {
			const [, actions] = group;
			result.push(...actions);
			result.push(new Separator());
		}
		result.pop(); // remove last separator
		return result;
	}
}
