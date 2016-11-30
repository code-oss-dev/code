/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/debugViewlet';
import * as nls from 'vs/nls';
import { $, Builder, Dimension } from 'vs/base/browser/builder';
import { TPromise } from 'vs/base/common/winjs.base';
import * as lifecycle from 'vs/base/common/lifecycle';
import { IAction } from 'vs/base/common/actions';
import { IActionItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { SplitView } from 'vs/base/browser/ui/splitview/splitview';
import { Scope } from 'vs/workbench/common/memento';
import { IViewletView, Viewlet } from 'vs/workbench/browser/viewlet';
import { IDebugService, VIEWLET_ID, State } from 'vs/workbench/parts/debug/common/debug';
import { DebugViewRegistry } from 'vs/workbench/parts/debug/browser/debugViewRegistry';
import { StartAction, ToggleReplAction, ConfigureAction, SelectConfigAction } from 'vs/workbench/parts/debug/browser/debugActions';
import { SelectConfigurationActionItem } from 'vs/workbench/parts/debug/browser/debugActionItems';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IProgressService, IProgressRunner } from 'vs/platform/progress/common/progress';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService } from 'vs/platform/storage/common/storage';

export class DebugViewlet extends Viewlet {

	private toDispose: lifecycle.IDisposable[];
	private actions: IAction[];
	private progressRunner: IProgressRunner;
	private viewletSettings: any;

	private $el: Builder;
	private splitView: SplitView;
	private views: IViewletView[];

	private lastFocusedView: IViewletView;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IProgressService private progressService: IProgressService,
		@IDebugService private debugService: IDebugService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService
	) {
		super(VIEWLET_ID, telemetryService);

		this.progressRunner = null;
		this.viewletSettings = this.getMemento(storageService, Scope.WORKSPACE);
		this.toDispose = [];
		this.views = [];
		this.toDispose.push(this.debugService.onDidChangeState(() => {
			this.onDebugServiceStateChange();
		}));
	}

	// viewlet

	public create(parent: Builder): TPromise<void> {
		super.create(parent);
		this.$el = parent.div().addClass('debug-viewlet');

		if (this.contextService.getWorkspace()) {
			const actionRunner = this.getActionRunner();
			this.views = DebugViewRegistry.getDebugViews().map(viewConstructor => this.instantiationService.createInstance(
				viewConstructor,
				actionRunner,
				this.viewletSettings)
			);

			this.splitView = new SplitView(this.$el.getHTMLElement());
			this.toDispose.push(this.splitView);
			this.views.forEach(v => this.splitView.addView(v));

			// Track focus
			this.toDispose.push(this.splitView.onFocus((view: IViewletView) => {
				this.lastFocusedView = view;
			}));
		} else {
			this.$el.append($([
				'<div class="noworkspace-view">',
				'<p>', nls.localize('noWorkspace', "There is no currently opened folder."), '</p>',
				'<p>', nls.localize('pleaseRestartToDebug', "Open a folder in order to start debugging."), '</p>',
				'</div>'
			].join('')));
		}

		return TPromise.as(null);
	}

	public setVisible(visible: boolean): TPromise<any> {
		return super.setVisible(visible).then(() => {
			return TPromise.join(this.views.map(view => view.setVisible(visible)));
		});
	}

	public layout(dimension: Dimension): void {
		if (this.splitView) {
			this.splitView.layout(dimension.height);
		}
	}

	public focus(): void {
		super.focus();

		if (this.lastFocusedView && this.lastFocusedView.isExpanded()) {
			this.lastFocusedView.focusBody();
			return;
		}

		if (this.views.length > 0) {
			this.views[0].focusBody();
		}
	}

	public getActions(): IAction[] {
		if (this.debugService.state === State.Disabled) {
			return [];
		}

		if (!this.actions) {
			this.actions = [
				this.instantiationService.createInstance(StartAction, StartAction.ID, StartAction.LABEL),
				this.instantiationService.createInstance(SelectConfigAction, SelectConfigAction.ID, SelectConfigAction.LABEL),
				this.instantiationService.createInstance(ConfigureAction, ConfigureAction.ID, ConfigureAction.LABEL),
				this.instantiationService.createInstance(ToggleReplAction, ToggleReplAction.ID, ToggleReplAction.LABEL)
			];

			this.actions.forEach(a => {
				this.toDispose.push(a);
			});
		}

		return this.actions;
	}

	public getActionItem(action: IAction): IActionItem {
		if (action.id === SelectConfigAction.ID) {
			return this.instantiationService.createInstance(SelectConfigurationActionItem, action);
		}

		return null;
	}

	private onDebugServiceStateChange(): void {
		if (this.progressRunner) {
			this.progressRunner.done();
		}

		if (this.debugService.state === State.Initializing) {
			this.progressRunner = this.progressService.show(true);
		} else {
			this.progressRunner = null;
		}
	}

	public dispose(): void {
		this.toDispose = lifecycle.dispose(this.toDispose);

		super.dispose();
	}

	public shutdown(): void {
		this.views.forEach(v => v.shutdown());
		super.shutdown();
	}
}
