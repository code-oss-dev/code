/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IViewDescriptorService, ViewContainer, IViewDescriptor, IView, ViewContainerLocation, IViewsService, IViewPaneContainer, getVisbileViewContextKey, getEnabledViewContainerContextKey, FocusedViewContext } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { ContextKeyDefinedExpr, ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { Event, Emitter } from 'vs/base/common/event';
import { isString } from 'vs/base/common/types';
import { MenuId, registerAction2, Action2, MenuRegistry, ICommandActionTitle } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPaneComposite } from 'vs/workbench/common/panecomposite';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { ServicesAccessor, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { PanelRegistry, PanelDescriptor, Extensions as PanelExtensions, Panel } from 'vs/workbench/browser/panel';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { Viewlet, ViewletDescriptor, ViewletRegistry, Extensions as ViewletExtensions } from 'vs/workbench/browser/viewlet';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { URI } from 'vs/base/common/uri';
import { IProgressIndicator } from 'vs/platform/progress/common/progress';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';

export class ViewsService extends Disposable implements IViewsService {

	declare readonly _serviceBrand: undefined;

	private readonly viewDisposable: Map<IViewDescriptor, IDisposable>;
	private readonly viewPaneContainers: Map<string, { viewPaneContainer: ViewPaneContainer, disposable: IDisposable }>;

	private readonly _onDidChangeViewVisibility: Emitter<{ id: string, visible: boolean }> = this._register(new Emitter<{ id: string, visible: boolean }>());
	readonly onDidChangeViewVisibility: Event<{ id: string, visible: boolean }> = this._onDidChangeViewVisibility.event;

	private readonly _onDidChangeViewContainerVisibility = this._register(new Emitter<{ id: string, visible: boolean, location: ViewContainerLocation }>());
	readonly onDidChangeViewContainerVisibility = this._onDidChangeViewContainerVisibility.event;

	private readonly visibleViewContextKeys: Map<string, IContextKey<boolean>>;

	constructor(
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IPanelService private readonly panelService: IPanelService,
		@IViewletService private readonly viewletService: IViewletService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super();

		this.viewDisposable = new Map<IViewDescriptor, IDisposable>();
		this.visibleViewContextKeys = new Map<string, IContextKey<boolean>>();
		this.viewPaneContainers = new Map<string, { viewPaneContainer: ViewPaneContainer, disposable: IDisposable }>();

		this._register(toDisposable(() => {
			this.viewDisposable.forEach(disposable => disposable.dispose());
			this.viewDisposable.clear();
		}));

		this.viewDescriptorService.viewContainers.forEach(viewContainer => this.onDidRegisterViewContainer(viewContainer, this.viewDescriptorService.getViewContainerLocation(viewContainer)!));
		this._register(this.viewDescriptorService.onDidChangeViewContainers(({ added, removed }) => this.onDidChangeContainers(added, removed)));
		this._register(this.viewDescriptorService.onDidChangeContainerLocation(({ viewContainer, from, to }) => this.onDidChangeContainerLocation(viewContainer, from, to)));

		// View Container Visibility
		this._register(this.viewletService.onDidViewletOpen(viewlet => this._onDidChangeViewContainerVisibility.fire({ id: viewlet.getId(), visible: true, location: ViewContainerLocation.Sidebar })));
		this._register(this.panelService.onDidPanelOpen(e => this._onDidChangeViewContainerVisibility.fire({ id: e.panel.getId(), visible: true, location: ViewContainerLocation.Panel })));
		this._register(this.viewletService.onDidViewletClose(viewlet => this._onDidChangeViewContainerVisibility.fire({ id: viewlet.getId(), visible: false, location: ViewContainerLocation.Sidebar })));
		this._register(this.panelService.onDidPanelClose(panel => this._onDidChangeViewContainerVisibility.fire({ id: panel.getId(), visible: false, location: ViewContainerLocation.Panel })));

	}

	private registerViewPaneContainer(viewPaneContainer: ViewPaneContainer): void {
		const disposable = new DisposableStore();
		disposable.add(viewPaneContainer);
		disposable.add(viewPaneContainer.onDidAddViews(views => this.onViewsAdded(views)));
		disposable.add(viewPaneContainer.onDidChangeViewVisibility(view => this.onViewsVisibilityChanged(view, view.isBodyVisible())));
		disposable.add(viewPaneContainer.onDidRemoveViews(views => this.onViewsRemoved(views)));

		this.viewPaneContainers.set(viewPaneContainer.getId(), { viewPaneContainer, disposable });
	}

	private deregisterViewPaneContainer(id: string): void {
		const viewPaneContainerItem = this.viewPaneContainers.get(id);
		if (viewPaneContainerItem) {
			viewPaneContainerItem.disposable.dispose();
			this.viewPaneContainers.delete(id);
		}
	}

	private onViewsAdded(added: IView[]): void {
		for (const view of added) {
			this.onViewsVisibilityChanged(view, view.isBodyVisible());
		}
	}

	private onViewsVisibilityChanged(view: IView, visible: boolean): void {
		this.getOrCreateActiveViewContextKey(view).set(visible);
		this._onDidChangeViewVisibility.fire({ id: view.id, visible: visible });
	}

	private onViewsRemoved(removed: IView[]): void {
		for (const view of removed) {
			this.onViewsVisibilityChanged(view, false);
		}
	}

	private getOrCreateActiveViewContextKey(view: IView): IContextKey<boolean> {
		const visibleContextKeyId = getVisbileViewContextKey(view.id);
		let contextKey = this.visibleViewContextKeys.get(visibleContextKeyId);
		if (!contextKey) {
			contextKey = new RawContextKey(visibleContextKeyId, false).bindTo(this.contextKeyService);
			this.visibleViewContextKeys.set(visibleContextKeyId, contextKey);
		}
		return contextKey;
	}

	private onDidChangeContainers(added: ReadonlyArray<{ container: ViewContainer, location: ViewContainerLocation }>, removed: ReadonlyArray<{ container: ViewContainer, location: ViewContainerLocation }>): void {
		for (const { container, location } of removed) {
			this.deregisterViewletOrPanel(container, location);
		}
		for (const { container, location } of added) {
			this.onDidRegisterViewContainer(container, location);
		}
	}

	private onDidRegisterViewContainer(viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation): void {
		this.registerViewletOrPanel(viewContainer, viewContainerLocation);
		const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);
		this.onViewDescriptorsAdded(viewContainerModel.allViewDescriptors, viewContainer);
		this._register(viewContainerModel.onDidChangeAllViewDescriptors(({ added, removed }) => {
			this.onViewDescriptorsAdded(added, viewContainer);
			this.onViewDescriptorsRemoved(removed);
		}));

		// Register Action to Open View Container
		if (viewContainer.commandActionDescriptor !== false) {
			const { id, keybindings, mnemonicTitle, order } = viewContainer.commandActionDescriptor ?? { id: viewContainer.id };
			const that = this;
			this._register(registerAction2(class OpenViewContainerAction extends Action2 {
				constructor() {
					super({
						id,
						get title(): ICommandActionTitle {
							const viewContainerLocation = that.viewDescriptorService.getViewContainerLocation(viewContainer);
							if (viewContainerLocation === ViewContainerLocation.Sidebar) {
								return { value: localize('show view', "Show {0}", viewContainer.title), original: `Show ${viewContainer.title}` };
							} else {
								return { value: localize('toggle view', "Toggle {0}", viewContainer.title), original: `Toggle ${viewContainer.title}` };
							}
						},
						category: CATEGORIES.View.value,
						precondition: ContextKeyExpr.has(getEnabledViewContainerContextKey(viewContainer.id)),
						keybinding: keybindings ? { ...keybindings, weight: KeybindingWeight.WorkbenchContrib } : undefined,
						f1: true
					});
				}
				public async run(serviceAccessor: ServicesAccessor): Promise<any> {
					const editorGroupService = serviceAccessor.get(IEditorGroupsService);
					const viewDescriptorService = serviceAccessor.get(IViewDescriptorService);
					const layoutService = serviceAccessor.get(IWorkbenchLayoutService);
					const viewsService = serviceAccessor.get(IViewsService);
					const viewContainerLocation = viewDescriptorService.getViewContainerLocation(viewContainer);
					switch (viewContainerLocation) {
						case ViewContainerLocation.Sidebar:
							if (!viewsService.isViewContainerVisible(viewContainer.id) || !layoutService.hasFocus(Parts.SIDEBAR_PART)) {
								await viewsService.openViewContainer(viewContainer.id, true);
							} else {
								editorGroupService.activeGroup.focus();
							}
							break;
						case ViewContainerLocation.Panel:
							if (!viewsService.isViewContainerVisible(viewContainer.id) || !layoutService.hasFocus(Parts.PANEL_PART)) {
								await viewsService.openViewContainer(viewContainer.id, true);
							} else {
								viewsService.closeViewContainer(viewContainer.id);
							}
							break;
					}
				}
			}));

			if (mnemonicTitle) {
				const defaultLocation = this.viewDescriptorService.getDefaultViewContainerLocation(viewContainer);
				this._register(MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
					command: {
						id,
						title: mnemonicTitle,
					},
					group: defaultLocation === ViewContainerLocation.Sidebar ? '3_views' : '4_panels',
					when: ContextKeyExpr.has(getEnabledViewContainerContextKey(viewContainer.id)),
					order: order ?? Number.MAX_VALUE
				}));
			}
		}
	}

	private onDidChangeContainerLocation(viewContainer: ViewContainer, from: ViewContainerLocation, to: ViewContainerLocation): void {
		this.deregisterViewletOrPanel(viewContainer, from);
		this.registerViewletOrPanel(viewContainer, to);
	}

	private onViewDescriptorsAdded(views: ReadonlyArray<IViewDescriptor>, container: ViewContainer): void {
		const location = this.viewDescriptorService.getViewContainerLocation(container);
		if (location === null) {
			return;
		}

		const composite = this.getComposite(container.id, location);
		for (const viewDescriptor of views) {
			const disposables = new DisposableStore();

			// Register Action to Open View
			if (viewDescriptor.commandActionDescriptor) {
				const commandId = viewDescriptor.commandActionDescriptor.id;
				const that = this;
				disposables.add(registerAction2(class OpenViewAction extends Action2 {
					constructor() {
						super({
							id: commandId,
							get title(): ICommandActionTitle {
								const viewContainerLocation = that.viewDescriptorService.getViewLocationById(viewDescriptor.id);
								if (viewContainerLocation === ViewContainerLocation.Sidebar) {
									return { value: localize('show view', "Show {0}", viewDescriptor.name), original: `Show ${viewDescriptor.name}` };
								} else {
									return { value: localize('toggle view', "Toggle {0}", viewDescriptor.name), original: `Toggle ${viewDescriptor.name}` };
								}
							},
							category: CATEGORIES.View.value,
							precondition: ContextKeyDefinedExpr.create(`${viewDescriptor.id}.active`),
							keybinding: viewDescriptor.commandActionDescriptor!.keybindings ? { ...viewDescriptor.commandActionDescriptor!.keybindings, weight: KeybindingWeight.WorkbenchContrib } : undefined,
							f1: true
						});
					}
					public async run(serviceAccessor: ServicesAccessor): Promise<any> {
						const editorGroupService = serviceAccessor.get(IEditorGroupsService);
						const viewDescriptorService = serviceAccessor.get(IViewDescriptorService);
						const layoutService = serviceAccessor.get(IWorkbenchLayoutService);
						const viewsService = serviceAccessor.get(IViewsService);
						const contextKeyService = serviceAccessor.get(IContextKeyService);

						const focusedViewId = FocusedViewContext.getValue(contextKeyService);
						if (focusedViewId === viewDescriptor.id) {
							if (viewDescriptorService.getViewLocationById(viewDescriptor.id) === ViewContainerLocation.Sidebar) {
								editorGroupService.activeGroup.focus();
							} else {
								layoutService.setPanelHidden(true);
							}
						} else {
							viewsService.openView(viewDescriptor.id, true);
						}
					}
				}));

				const defaultViewContainer = this.viewDescriptorService.getDefaultContainerById(viewDescriptor.id);
				if (defaultViewContainer) {
					const defaultLocation = this.viewDescriptorService.getDefaultViewContainerLocation(defaultViewContainer);
					disposables.add(MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
						command: {
							id: commandId,
							title: viewDescriptor.commandActionDescriptor.mnemonicTitle ?? viewDescriptor.name,
						},
						group: defaultLocation === ViewContainerLocation.Sidebar ? '3_views' : '4_panels',
						when: ContextKeyDefinedExpr.create(`${viewDescriptor.id}.active`),
						order: viewDescriptor.commandActionDescriptor.order ?? Number.MAX_VALUE
					}));
				}
			}

			disposables.add(registerAction2(class FocusViewAction extends Action2 {
				constructor() {
					super({
						id: viewDescriptor.focusCommand ? viewDescriptor.focusCommand.id : `${viewDescriptor.id}.focus`,
						title: { original: `Focus on ${viewDescriptor.name} View`, value: localize({ key: 'focus view', comment: ['{0} indicates the name of the view to be focused.'] }, "Focus on {0} View", viewDescriptor.name) },
						category: composite ? composite.name : CATEGORIES.View,
						menu: [{
							id: MenuId.CommandPalette,
							when: viewDescriptor.when,
						}],
						keybinding: {
							when: ContextKeyExpr.has(`${viewDescriptor.id}.active`),
							weight: KeybindingWeight.WorkbenchContrib,
							primary: viewDescriptor.focusCommand?.keybindings?.primary,
							secondary: viewDescriptor.focusCommand?.keybindings?.secondary,
							linux: viewDescriptor.focusCommand?.keybindings?.linux,
							mac: viewDescriptor.focusCommand?.keybindings?.mac,
							win: viewDescriptor.focusCommand?.keybindings?.win
						}
					});
				}
				run(accessor: ServicesAccessor): void {
					accessor.get(IViewsService).openView(viewDescriptor.id, true);
				}
			}));

			disposables.add(registerAction2(class ResetViewLocationAction extends Action2 {
				constructor() {
					super({
						id: `${viewDescriptor.id}.resetViewLocation`,
						title: {
							original: 'Reset Location',
							value: localize('resetViewLocation', "Reset Location")
						},
						menu: [{
							id: MenuId.ViewTitleContext,
							when: ContextKeyExpr.or(
								ContextKeyExpr.and(
									ContextKeyExpr.equals('view', viewDescriptor.id),
									ContextKeyExpr.equals(`${viewDescriptor.id}.defaultViewLocation`, false)
								)
							),
							group: '1_hide',
							order: 2
						}],
					});
				}
				run(accessor: ServicesAccessor): void {
					const viewDescriptorService = accessor.get(IViewDescriptorService);
					const defaultContainer = viewDescriptorService.getDefaultContainerById(viewDescriptor.id)!;
					const containerModel = viewDescriptorService.getViewContainerModel(defaultContainer)!;

					// The default container is hidden so we should try to reset its location first
					if (defaultContainer.hideIfEmpty && containerModel.visibleViewDescriptors.length === 0) {
						const defaultLocation = viewDescriptorService.getDefaultViewContainerLocation(defaultContainer)!;
						viewDescriptorService.moveViewContainerToLocation(defaultContainer, defaultLocation);
					}

					viewDescriptorService.moveViewsToContainer([viewDescriptor], viewDescriptorService.getDefaultContainerById(viewDescriptor.id)!);
					accessor.get(IViewsService).openView(viewDescriptor.id, true);
				}
			}));

			this.viewDisposable.set(viewDescriptor, disposables);
		}
	}

	private onViewDescriptorsRemoved(views: ReadonlyArray<IViewDescriptor>): void {
		for (const view of views) {
			const disposable = this.viewDisposable.get(view);
			if (disposable) {
				disposable.dispose();
				this.viewDisposable.delete(view);
			}
		}
	}

	private async openComposite(compositeId: string, location: ViewContainerLocation, focus?: boolean): Promise<IPaneComposite | undefined> {
		if (location === ViewContainerLocation.Sidebar) {
			return this.viewletService.openViewlet(compositeId, focus);
		} else if (location === ViewContainerLocation.Panel) {
			return this.panelService.openPanel(compositeId, focus) as Promise<IPaneComposite>;
		}
		return undefined;
	}

	private getComposite(compositeId: string, location: ViewContainerLocation): { id: string, name: string } | undefined {
		if (location === ViewContainerLocation.Sidebar) {
			return this.viewletService.getViewlet(compositeId);
		} else if (location === ViewContainerLocation.Panel) {
			return this.panelService.getPanel(compositeId);
		}

		return undefined;
	}

	isViewContainerVisible(id: string): boolean {
		const viewContainer = this.viewDescriptorService.getViewContainerById(id);
		if (viewContainer) {
			const viewContainerLocation = this.viewDescriptorService.getViewContainerLocation(viewContainer);
			switch (viewContainerLocation) {
				case ViewContainerLocation.Panel:
					return this.panelService.getActivePanel()?.getId() === id;
				case ViewContainerLocation.Sidebar:
					return this.viewletService.getActiveViewlet()?.getId() === id;
			}
		}
		return false;
	}

	getVisibleViewContainer(location: ViewContainerLocation): ViewContainer | null {
		let viewContainerId: string | undefined = undefined;
		switch (location) {
			case ViewContainerLocation.Panel:
				viewContainerId = this.panelService.getActivePanel()?.getId();
				break;
			case ViewContainerLocation.Sidebar:
				viewContainerId = this.viewletService.getActiveViewlet()?.getId();
				break;
		}
		return viewContainerId ? this.viewDescriptorService.getViewContainerById(viewContainerId) : null;
	}

	getActiveViewPaneContainerWithId(viewContainerId: string): IViewPaneContainer | null {
		const viewContainer = this.viewDescriptorService.getViewContainerById(viewContainerId);
		return viewContainer ? this.getActiveViewPaneContainer(viewContainer) : null;
	}

	async openViewContainer(id: string, focus?: boolean): Promise<IPaneComposite | null> {
		const viewContainer = this.viewDescriptorService.getViewContainerById(id);
		if (viewContainer) {
			const viewContainerLocation = this.viewDescriptorService.getViewContainerLocation(viewContainer);
			switch (viewContainerLocation) {
				case ViewContainerLocation.Panel:
					const panel = await this.panelService.openPanel(id, focus);
					return panel as IPaneComposite;
				case ViewContainerLocation.Sidebar:
					const viewlet = await this.viewletService.openViewlet(id, focus);
					return viewlet || null;
			}
		}
		return null;
	}

	async closeViewContainer(id: string): Promise<void> {
		const viewContainer = this.viewDescriptorService.getViewContainerById(id);
		if (viewContainer) {
			const viewContainerLocation = this.viewDescriptorService.getViewContainerLocation(viewContainer);
			switch (viewContainerLocation) {
				case ViewContainerLocation.Panel:
					return this.panelService.getActivePanel()?.getId() === id ? this.layoutService.setPanelHidden(true) : undefined;
				case ViewContainerLocation.Sidebar:
					return this.viewletService.getActiveViewlet()?.getId() === id ? this.layoutService.setSideBarHidden(true) : undefined;
			}
		}
	}

	isViewVisible(id: string): boolean {
		const activeView = this.getActiveViewWithId(id);
		return activeView?.isBodyVisible() || false;
	}

	getActiveViewWithId<T extends IView>(id: string): T | null {
		const viewContainer = this.viewDescriptorService.getViewContainerByViewId(id);
		if (viewContainer) {
			const activeViewPaneContainer = this.getActiveViewPaneContainer(viewContainer);
			if (activeViewPaneContainer) {
				return activeViewPaneContainer.getView(id) as T;
			}
		}
		return null;
	}

	async openView<T extends IView>(id: string, focus?: boolean): Promise<T | null> {
		const viewContainer = this.viewDescriptorService.getViewContainerByViewId(id);
		if (!viewContainer) {
			return null;
		}

		if (!this.viewDescriptorService.getViewContainerModel(viewContainer).activeViewDescriptors.some(viewDescriptor => viewDescriptor.id === id)) {
			return null;
		}

		const location = this.viewDescriptorService.getViewContainerLocation(viewContainer);
		const compositeDescriptor = this.getComposite(viewContainer.id, location!);
		if (compositeDescriptor) {
			const paneComposite = await this.openComposite(compositeDescriptor.id, location!) as IPaneComposite | undefined;
			if (paneComposite && paneComposite.openView) {
				return paneComposite.openView<T>(id, focus) || null;
			} else if (focus) {
				paneComposite?.focus();
			}
		}

		return null;
	}

	closeView(id: string): void {
		const viewContainer = this.viewDescriptorService.getViewContainerByViewId(id);
		if (viewContainer) {
			const activeViewPaneContainer = this.getActiveViewPaneContainer(viewContainer);
			if (activeViewPaneContainer) {
				const view = activeViewPaneContainer.getView(id);
				if (view) {
					if (activeViewPaneContainer.views.length === 1) {
						const location = this.viewDescriptorService.getViewContainerLocation(viewContainer);
						if (location === ViewContainerLocation.Sidebar) {
							this.layoutService.setSideBarHidden(true);
						} else if (location === ViewContainerLocation.Panel) {
							this.panelService.hideActivePanel();
						}
					} else {
						view.setExpanded(false);
					}
				}
			}
		}
	}

	private getActiveViewPaneContainer(viewContainer: ViewContainer): IViewPaneContainer | null {
		const location = this.viewDescriptorService.getViewContainerLocation(viewContainer);

		if (location === ViewContainerLocation.Sidebar) {
			const activeViewlet = this.viewletService.getActiveViewlet();
			if (activeViewlet?.getId() === viewContainer.id) {
				return activeViewlet.getViewPaneContainer() || null;
			}
		} else if (location === ViewContainerLocation.Panel) {
			const activePanel = this.panelService.getActivePanel();
			if (activePanel?.getId() === viewContainer.id) {
				return (activePanel as IPaneComposite).getViewPaneContainer() || null;
			}
		}

		return null;
	}

	getViewProgressIndicator(viewId: string): IProgressIndicator | undefined {
		const viewContainer = this.viewDescriptorService.getViewContainerByViewId(viewId);
		if (!viewContainer) {
			return undefined;
		}

		const viewPaneContainer = this.viewPaneContainers.get(viewContainer.id)?.viewPaneContainer;
		if (!viewPaneContainer) {
			return undefined;
		}

		const view = viewPaneContainer.getView(viewId);
		if (!view) {
			return undefined;
		}

		if (viewPaneContainer.isViewMergedWithContainer()) {
			return this.getViewContainerProgressIndicator(viewContainer);
		}

		return view.getProgressIndicator();
	}

	private getViewContainerProgressIndicator(viewContainer: ViewContainer): IProgressIndicator | undefined {
		return this.viewDescriptorService.getViewContainerLocation(viewContainer) === ViewContainerLocation.Sidebar ? this.viewletService.getProgressIndicator(viewContainer.id) : this.panelService.getProgressIndicator(viewContainer.id);
	}

	private registerViewletOrPanel(viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation): void {
		switch (viewContainerLocation) {
			case ViewContainerLocation.Panel:
				this.registerPanel(viewContainer);
				break;
			case ViewContainerLocation.Sidebar:
				if (viewContainer.ctorDescriptor) {
					this.registerViewlet(viewContainer);
				}
				break;
		}
	}

	private deregisterViewletOrPanel(viewContainer: ViewContainer, viewContainerLocation: ViewContainerLocation): void {
		switch (viewContainerLocation) {
			case ViewContainerLocation.Panel:
				this.deregisterPanel(viewContainer);
				break;
			case ViewContainerLocation.Sidebar:
				if (viewContainer.ctorDescriptor) {
					this.deregisterViewlet(viewContainer);
				}
				break;
		}
	}

	private registerPanel(viewContainer: ViewContainer): void {
		const that = this;
		class PaneContainerPanel extends Panel {
			constructor(
				@ITelemetryService telemetryService: ITelemetryService,
				@IStorageService storageService: IStorageService,
				@IInstantiationService instantiationService: IInstantiationService,
				@IThemeService themeService: IThemeService,
				@IContextMenuService contextMenuService: IContextMenuService,
				@IExtensionService extensionService: IExtensionService,
				@IWorkspaceContextService contextService: IWorkspaceContextService,
			) {
				// Use composite's instantiation service to get the editor progress service for any editors instantiated within the composite
				const viewPaneContainer = (instantiationService as any).createInstance(viewContainer.ctorDescriptor!.ctor, ...(viewContainer.ctorDescriptor!.staticArguments || []));
				super(viewContainer.id, viewPaneContainer, telemetryService, storageService, instantiationService, themeService, contextMenuService, extensionService, contextService);
				that.registerViewPaneContainer(this.viewPaneContainer);
			}
		}
		Registry.as<PanelRegistry>(PanelExtensions.Panels).registerPanel(PanelDescriptor.create(
			PaneContainerPanel,
			viewContainer.id,
			viewContainer.title,
			undefined,
			viewContainer.order,
			viewContainer.requestedIndex,
		));
	}

	private deregisterPanel(viewContainer: ViewContainer): void {
		this.deregisterViewPaneContainer(viewContainer.id);
		Registry.as<PanelRegistry>(PanelExtensions.Panels).deregisterPanel(viewContainer.id);
	}

	private registerViewlet(viewContainer: ViewContainer): void {
		const that = this;
		class PaneContainerViewlet extends Viewlet {
			constructor(
				@IConfigurationService configurationService: IConfigurationService,
				@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
				@ITelemetryService telemetryService: ITelemetryService,
				@IWorkspaceContextService contextService: IWorkspaceContextService,
				@IStorageService storageService: IStorageService,
				@IInstantiationService instantiationService: IInstantiationService,
				@IThemeService themeService: IThemeService,
				@IContextMenuService contextMenuService: IContextMenuService,
				@IExtensionService extensionService: IExtensionService,
			) {
				// Use composite's instantiation service to get the editor progress service for any editors instantiated within the composite
				const viewPaneContainer = (instantiationService as any).createInstance(viewContainer.ctorDescriptor!.ctor, ...(viewContainer.ctorDescriptor!.staticArguments || []));
				super(viewContainer.id, viewPaneContainer, telemetryService, storageService, instantiationService, themeService, contextMenuService, extensionService, contextService, layoutService, configurationService);
				that.registerViewPaneContainer(this.viewPaneContainer);
			}
		}
		Registry.as<ViewletRegistry>(ViewletExtensions.Viewlets).registerViewlet(ViewletDescriptor.create(
			PaneContainerViewlet,
			viewContainer.id,
			viewContainer.title,
			isString(viewContainer.icon) ? viewContainer.icon : undefined,
			viewContainer.order,
			viewContainer.requestedIndex,
			viewContainer.icon instanceof URI ? viewContainer.icon : undefined
		));
	}

	private deregisterViewlet(viewContainer: ViewContainer): void {
		this.deregisterViewPaneContainer(viewContainer.id);
		Registry.as<ViewletRegistry>(ViewletExtensions.Viewlets).deregisterViewlet(viewContainer.id);
	}
}

registerSingleton(IViewsService, ViewsService);
