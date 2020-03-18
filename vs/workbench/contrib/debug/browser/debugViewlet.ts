/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/debugViewlet';
import * as nls from 'vs/nls';
import { IAction, Action } from 'vs/base/common/actions';
import * as DOM from 'vs/base/browser/dom';
import { Event } from 'vs/base/common/event';
import { IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { IDebugService, VIEWLET_ID, State, BREAKPOINTS_VIEW_ID, IDebugConfiguration, DEBUG_PANEL_ID, CONTEXT_DEBUG_UX, CONTEXT_DEBUG_UX_KEY, IDebugSession } from 'vs/workbench/contrib/debug/common/debug';
import { StartAction, ConfigureAction, SelectAndStartAction, FocusSessionAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { StartDebugActionViewItem, FocusSessionActionViewItem } from 'vs/workbench/contrib/debug/browser/debugActionViewItems';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { memoize } from 'vs/base/common/decorators';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { DebugToolBar } from 'vs/workbench/contrib/debug/browser/debugToolBar';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ViewPane, ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IMenu, MenuId, IMenuService, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { MenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { TogglePanelAction } from 'vs/workbench/browser/panel';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { WelcomeView } from 'vs/workbench/contrib/debug/browser/welcomeView';

export class DebugViewPaneContainer extends ViewPaneContainer {

	private startDebugActionViewItem: StartDebugActionViewItem | undefined;
	private progressResolve: (() => void) | undefined;
	private breakpointView: ViewPane | undefined;
	private paneListeners = new Map<string, IDisposable>();
	private debugToolBarMenu: IMenu | undefined;
	private disposeOnTitleUpdate: IDisposable | undefined;
	private progressEvents: { event: DebugProtocol.ProgressStartEvent, session: IDebugSession }[] = [];

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProgressService private readonly progressService: IProgressService,
		@IDebugService private readonly debugService: IDebugService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@INotificationService private readonly notificationService: INotificationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {
		super(VIEWLET_ID, `${VIEWLET_ID}.state`, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService);

		this._register(this.debugService.onDidChangeState(state => this.onDebugServiceStateChange(state)));
		this._register(this.debugService.onDidNewSession(() => this.updateToolBar()));
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([CONTEXT_DEBUG_UX_KEY]))) {
				this.updateTitleArea();
			}
		}));

		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateTitleArea()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('debug.toolBarLocation')) {
				this.updateTitleArea();
			}
		}));

		let progressListener: IDisposable;
		this._register(this.debugService.getViewModel().onDidFocusSession(session => {
			if (progressListener) {
				progressListener.dispose();
			}
			if (session) {
				progressListener = session.onDidProgressStart(async progressStartEvent => {
					// Update title area to show the cancel progress action
					this.progressEvents.push({ session: session, event: progressStartEvent });
					this.cancelAction.tooltip = nls.localize('cancelProgress', "Cancel {0}", progressStartEvent.body.title);
					this.updateTitleArea();
					await this.progressService.withProgress({ location: VIEWLET_ID }, () => {
						return new Promise(r => {
							// Show progress until a progress end event comes or the session ends
							const listener = Event.any(Event.filter(session.onDidProgressEnd, e => e.body.progressId === progressStartEvent.body.progressId),
								session.onDidEndAdapter)(() => {
									listener.dispose();
									r();
								});
						});
					});
					this.cancelAction.tooltip = nls.localize('cancel', "Cancel");
					this.progressEvents = this.progressEvents.filter(pe => pe.event.body.progressId !== progressStartEvent.body.progressId);
					this.updateTitleArea();
				});
			}
		}));
	}

	create(parent: HTMLElement): void {
		super.create(parent);
		DOM.addClass(parent, 'debug-viewlet');
	}

	focus(): void {
		super.focus();

		if (this.startDebugActionViewItem) {
			this.startDebugActionViewItem.focus();
		} else {
			this.focusView(WelcomeView.ID);
		}
	}

	@memoize
	private get startAction(): StartAction {
		return this._register(this.instantiationService.createInstance(StartAction, StartAction.ID, StartAction.LABEL));
	}

	@memoize
	private get configureAction(): ConfigureAction {
		return this._register(this.instantiationService.createInstance(ConfigureAction, ConfigureAction.ID, ConfigureAction.LABEL));
	}

	@memoize
	private get toggleReplAction(): OpenDebugPanelAction {
		return this._register(this.instantiationService.createInstance(OpenDebugPanelAction, OpenDebugPanelAction.ID, OpenDebugPanelAction.LABEL));
	}

	@memoize
	private get cancelAction(): Action {
		return this._register(new Action('debug.cancelProgress', nls.localize('cancel', "Cancel"), 'debug-action codicon codicon-stop', true, async () => {
			let { event, session } = this.progressEvents[this.progressEvents.length - 1];
			await session.cancel(event.body.progressId);
		}));
	}

	@memoize
	private get selectAndStartAction(): SelectAndStartAction {
		return this._register(this.instantiationService.createInstance(SelectAndStartAction, SelectAndStartAction.ID, nls.localize('startAdditionalSession', "Start Additional Session")));
	}

	getActions(): IAction[] {
		if (CONTEXT_DEBUG_UX.getValue(this.contextKeyService) === 'simple') {
			return [];
		}

		let result: IAction[];
		if (!this.showInitialDebugActions) {

			if (!this.debugToolBarMenu) {
				this.debugToolBarMenu = this.menuService.createMenu(MenuId.DebugToolBar, this.contextKeyService);
				this._register(this.debugToolBarMenu);
			}

			const { actions, disposable } = DebugToolBar.getActions(this.debugToolBarMenu, this.debugService, this.instantiationService);
			if (this.disposeOnTitleUpdate) {
				dispose(this.disposeOnTitleUpdate);
			}
			this.disposeOnTitleUpdate = disposable;

			result = actions;
		} else if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			result = [this.toggleReplAction];
		} else {
			result = [this.startAction, this.configureAction, this.toggleReplAction];
		}

		if (this.progressEvents.length) {
			result.unshift(this.cancelAction);
		}

		return result;
	}

	get showInitialDebugActions(): boolean {
		const state = this.debugService.state;
		return state === State.Inactive || this.configurationService.getValue<IDebugConfiguration>('debug').toolBarLocation !== 'docked';
	}

	getSecondaryActions(): IAction[] {
		if (this.showInitialDebugActions) {
			return [];
		}

		return [this.selectAndStartAction, this.configureAction, this.toggleReplAction];
	}

	getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action.id === StartAction.ID) {
			this.startDebugActionViewItem = this.instantiationService.createInstance(StartDebugActionViewItem, null, action);
			return this.startDebugActionViewItem;
		}
		if (action.id === FocusSessionAction.ID) {
			return new FocusSessionActionViewItem(action, this.debugService, this.themeService, this.contextViewService, this.configurationService);
		}
		if (action instanceof MenuItemAction) {
			return new MenuEntryActionViewItem(action, this.keybindingService, this.notificationService, this.contextMenuService);
		}

		return undefined;
	}

	focusView(id: string): void {
		const view = this.getView(id);
		if (view) {
			view.focus();
		}
	}

	private onDebugServiceStateChange(state: State): void {
		if (this.progressResolve) {
			this.progressResolve();
			this.progressResolve = undefined;
		}

		if (state === State.Initializing) {
			this.progressService.withProgress({ location: VIEWLET_ID }, _progress => {
				return new Promise(resolve => this.progressResolve = resolve);
			});
		}

		this.updateToolBar();
	}

	private updateToolBar(): void {
		if (this.configurationService.getValue<IDebugConfiguration>('debug').toolBarLocation === 'docked') {
			this.updateTitleArea();
		}
	}

	addPanes(panes: { pane: ViewPane, size: number, index?: number }[]): void {
		super.addPanes(panes);

		for (const { pane: pane } of panes) {
			// attach event listener to
			if (pane.id === BREAKPOINTS_VIEW_ID) {
				this.breakpointView = pane;
				this.updateBreakpointsMaxSize();
			} else {
				this.paneListeners.set(pane.id, pane.onDidChange(() => this.updateBreakpointsMaxSize()));
			}
		}
	}

	removePanes(panes: ViewPane[]): void {
		super.removePanes(panes);
		for (const pane of panes) {
			dispose(this.paneListeners.get(pane.id));
			this.paneListeners.delete(pane.id);
		}
	}

	private updateBreakpointsMaxSize(): void {
		if (this.breakpointView) {
			// We need to update the breakpoints view since all other views are collapsed #25384
			const allOtherCollapsed = this.panes.every(view => !view.isExpanded() || view === this.breakpointView);
			this.breakpointView.maximumBodySize = allOtherCollapsed ? Number.POSITIVE_INFINITY : this.breakpointView.minimumBodySize;
		}
	}
}

export class OpenDebugPanelAction extends TogglePanelAction {
	public static readonly ID = 'workbench.debug.action.toggleRepl';
	public static readonly LABEL = nls.localize('toggleDebugPanel', "Debug Console");

	constructor(
		id: string,
		label: string,
		@IPanelService panelService: IPanelService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		super(id, label, DEBUG_PANEL_ID, panelService, layoutService, 'codicon-repl');
	}
}
