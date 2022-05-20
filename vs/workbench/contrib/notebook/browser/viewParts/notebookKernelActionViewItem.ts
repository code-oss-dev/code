/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./notebookKernelActionViewItem';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { Action, IAction } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { executingStateIcon, selectKernelIcon } from 'vs/workbench/contrib/notebook/browser/notebookIcons';
import { INotebookKernel, INotebookKernelMatchResult, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { Event } from 'vs/base/common/event';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export class NotebooKernelActionViewItem extends ActionViewItem {

	private _kernelLabel?: HTMLAnchorElement;
	private _kernelDisposable: DisposableStore;

	constructor(
		actualAction: IAction,
		private readonly _editor: { onDidChangeModel: Event<void>; textModel: NotebookTextModel | undefined } | INotebookEditor,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
	) {
		super(
			undefined,
			new Action('fakeAction', undefined, ThemeIcon.asClassName(selectKernelIcon), true, (event) => actualAction.run(event)),
			{ label: false, icon: true }
		);
		this._register(_editor.onDidChangeModel(this._update, this));
		this._register(_notebookKernelService.onDidChangeNotebookAffinity(this._update, this));
		this._register(_notebookKernelService.onDidChangeSelectedNotebooks(this._update, this));
		this._register(_notebookKernelService.onDidChangeSourceActions(this._update, this));
		this._kernelDisposable = this._register(new DisposableStore());
	}

	override render(container: HTMLElement): void {
		this._update();
		super.render(container);
		container.classList.add('kernel-action-view-item');
		this._kernelLabel = document.createElement('a');
		container.appendChild(this._kernelLabel);
		this.updateLabel();
	}

	override updateLabel() {
		if (this._kernelLabel) {
			this._kernelLabel.classList.add('kernel-label');
			this._kernelLabel.innerText = this._action.label;
			this._kernelLabel.title = this._action.tooltip;
		}
	}

	protected _update(): void {
		const notebook = this._editor.textModel;

		if (!notebook) {
			this._resetAction();
			return;
		}

		const runningAction = this._notebookKernelService.getRunningSourceAction();
		if (runningAction) {
			return this._updateActionFromSourceAction(runningAction, true);
		}

		const info = this._notebookKernelService.getMatchingKernel(notebook);
		if (info.all.length === 0) {
			return this._updateActionsFromSourceActions();
		}

		this._updateActionFromKernelInfo(info);
	}

	private _updateActionFromSourceAction(sourceAction: IAction, running: boolean) {
		this.action.class = running ? ThemeIcon.asClassName(ThemeIcon.modify(executingStateIcon, 'spin')) : ThemeIcon.asClassName(selectKernelIcon);
		this.updateClass();
		this._action.label = sourceAction.label;
		this._action.enabled = true;
	}

	private _updateActionsFromSourceActions() {
		this._action.enabled = true;
		const sourceActions = this._notebookKernelService.getSourceActions();
		if (sourceActions.length === 1) {
			// exact one action
			this._updateActionFromSourceAction(sourceActions[0], false);
		} else {
			this._action.class = ThemeIcon.asClassName(selectKernelIcon);
			this._action.label = localize('select', "Select Kernel");
			this._action.tooltip = '';
		}
	}

	private _updateActionFromKernelInfo(info: INotebookKernelMatchResult): void {
		this._kernelDisposable.clear();
		this._action.enabled = true;
		this._action.class = ThemeIcon.asClassName(selectKernelIcon);
		const selectedOrSuggested = info.selected ?? (info.suggestions.length === 1 ? info.suggestions[0] : undefined);
		if (selectedOrSuggested) {
			// selected or suggested kernel
			this._action.label = this._generateKenrelLabel(selectedOrSuggested);
			this._action.tooltip = selectedOrSuggested.description ?? selectedOrSuggested.detail ?? '';
			if (!info.selected) {
				// special UI for selected kernel?
			}

			this._kernelDisposable.add(selectedOrSuggested.onDidChange(e => {
				if (e.state) {
					this._action.label = this._generateKenrelLabel(selectedOrSuggested);
				}
			}));
		} else {
			// many kernels or no kernels
			this._action.label = localize('select', "Select Kernel");
			this._action.tooltip = '';
		}
	}

	private _generateKenrelLabel(kernel: INotebookKernel) {
		return kernel.label;
	}

	private _resetAction(): void {
		this._action.enabled = false;
		this._action.label = '';
		this._action.class = '';
	}
}
