/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/views';
import { Disposable, IDisposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IViewDescriptorService, ViewContainer, IViewDescriptor, IViewContainersRegistry, Extensions as ViewExtensions, IView, ViewContainerLocation, IViewsService } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Event, Emitter } from 'vs/base/common/event';
import { firstIndex, move } from 'vs/base/common/arrays';
import { isUndefinedOrNull, isUndefined } from 'vs/base/common/types';
import { MenuId, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { values } from 'vs/base/common/map';
import { IFileIconTheme, IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { toggleClass, addClass } from 'vs/base/browser/dom';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPaneComposite } from 'vs/workbench/common/panecomposite';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import type { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export interface IViewState {
	visibleGlobal: boolean | undefined;
	visibleWorkspace: boolean | undefined;
	collapsed: boolean | undefined;
	order?: number;
	size?: number;
}

export interface IViewDescriptorRef {
	viewDescriptor: IViewDescriptor;
	index: number;
}

export interface IAddedViewDescriptorRef extends IViewDescriptorRef {
	collapsed: boolean;
	size?: number;
}

export class ContributableViewsModel extends Disposable {

	private _viewDescriptors: IViewDescriptor[] = [];
	get viewDescriptors(): ReadonlyArray<IViewDescriptor> {
		return this._viewDescriptors;
	}

	get visibleViewDescriptors(): IViewDescriptor[] {
		return this.viewDescriptors.filter(v => this.isViewDescriptorVisible(v));
	}

	private _onDidAdd = this._register(new Emitter<IAddedViewDescriptorRef[]>());
	readonly onDidAdd: Event<IAddedViewDescriptorRef[]> = this._onDidAdd.event;

	private _onDidRemove = this._register(new Emitter<IViewDescriptorRef[]>());
	readonly onDidRemove: Event<IViewDescriptorRef[]> = this._onDidRemove.event;

	private _onDidMove = this._register(new Emitter<{ from: IViewDescriptorRef; to: IViewDescriptorRef; }>());
	readonly onDidMove: Event<{ from: IViewDescriptorRef; to: IViewDescriptorRef; }> = this._onDidMove.event;

	private _onDidChangeViewState = this._register(new Emitter<IViewDescriptorRef>());
	protected readonly onDidChangeViewState: Event<IViewDescriptorRef> = this._onDidChangeViewState.event;

	private _onDidChangeActiveViews = this._register(new Emitter<ReadonlyArray<IViewDescriptor>>());
	readonly onDidChangeActiveViews: Event<ReadonlyArray<IViewDescriptor>> = this._onDidChangeActiveViews.event;

	constructor(
		container: ViewContainer,
		viewsService: IViewDescriptorService,
		protected viewStates = new Map<string, IViewState>(),
	) {
		super();
		const viewDescriptorCollection = viewsService.getViewDescriptors(container);
		this._register(viewDescriptorCollection.onDidChangeActiveViews(() => this.onDidChangeViewDescriptors(viewDescriptorCollection.activeViewDescriptors)));
		this.onDidChangeViewDescriptors(viewDescriptorCollection.activeViewDescriptors);
	}

	isVisible(id: string): boolean {
		const viewDescriptor = this.viewDescriptors.filter(v => v.id === id)[0];

		if (!viewDescriptor) {
			throw new Error(`Unknown view ${id}`);
		}

		return this.isViewDescriptorVisible(viewDescriptor);
	}

	setVisible(id: string, visible: boolean, size?: number): void {
		const { visibleIndex, viewDescriptor, state } = this.find(id);

		if (!viewDescriptor.canToggleVisibility) {
			throw new Error(`Can't toggle this view's visibility`);
		}

		if (this.isViewDescriptorVisible(viewDescriptor) === visible) {
			return;
		}

		if (viewDescriptor.workspace) {
			state.visibleWorkspace = visible;
		} else {
			state.visibleGlobal = visible;
		}

		if (typeof size === 'number') {
			state.size = size;
		}

		if (visible) {
			this._onDidAdd.fire([{ index: visibleIndex, viewDescriptor, size: state.size, collapsed: !!state.collapsed }]);
		} else {
			this._onDidRemove.fire([{ index: visibleIndex, viewDescriptor }]);
		}
	}

	isCollapsed(id: string): boolean {
		const state = this.viewStates.get(id);

		if (!state) {
			throw new Error(`Unknown view ${id}`);
		}

		return !!state.collapsed;
	}

	setCollapsed(id: string, collapsed: boolean): void {
		const { index, state, viewDescriptor } = this.find(id);
		if (state.collapsed !== collapsed) {
			state.collapsed = collapsed;
			this._onDidChangeViewState.fire({ viewDescriptor, index });
		}
	}

	getSize(id: string): number | undefined {
		const state = this.viewStates.get(id);

		if (!state) {
			throw new Error(`Unknown view ${id}`);
		}

		return state.size;
	}

	setSize(id: string, size: number): void {
		const { index, state, viewDescriptor } = this.find(id);
		if (state.size !== size) {
			state.size = size;
			this._onDidChangeViewState.fire({ viewDescriptor, index });
		}
	}

	move(from: string, to: string): void {
		const fromIndex = firstIndex(this.viewDescriptors, v => v.id === from);
		const toIndex = firstIndex(this.viewDescriptors, v => v.id === to);

		const fromViewDescriptor = this.viewDescriptors[fromIndex];
		const toViewDescriptor = this.viewDescriptors[toIndex];

		move(this._viewDescriptors, fromIndex, toIndex);

		for (let index = 0; index < this.viewDescriptors.length; index++) {
			const state = this.viewStates.get(this.viewDescriptors[index].id)!;
			state.order = index;
		}

		this._onDidMove.fire({
			from: { index: fromIndex, viewDescriptor: fromViewDescriptor },
			to: { index: toIndex, viewDescriptor: toViewDescriptor }
		});
	}

	private isViewDescriptorVisible(viewDescriptor: IViewDescriptor): boolean {
		const viewState = this.viewStates.get(viewDescriptor.id);
		if (!viewState) {
			throw new Error(`Unknown view ${viewDescriptor.id}`);
		}
		return viewDescriptor.workspace ? !!viewState.visibleWorkspace : !!viewState.visibleGlobal;
	}

	private find(id: string): { index: number, visibleIndex: number, viewDescriptor: IViewDescriptor, state: IViewState; } {
		for (let i = 0, visibleIndex = 0; i < this.viewDescriptors.length; i++) {
			const viewDescriptor = this.viewDescriptors[i];
			const state = this.viewStates.get(viewDescriptor.id);
			if (!state) {
				throw new Error(`View state for ${id} not found`);
			}

			if (viewDescriptor.id === id) {
				return { index: i, visibleIndex, viewDescriptor, state };
			}

			if (viewDescriptor.workspace ? state.visibleWorkspace : state.visibleGlobal) {
				visibleIndex++;
			}
		}

		throw new Error(`view descriptor ${id} not found`);
	}

	private compareViewDescriptors(a: IViewDescriptor, b: IViewDescriptor): number {
		if (a.id === b.id) {
			return 0;
		}

		return (this.getViewOrder(a) - this.getViewOrder(b)) || this.getGroupOrderResult(a, b);
	}

	private getGroupOrderResult(a: IViewDescriptor, b: IViewDescriptor) {
		if (!a.group || !b.group) {
			return 0;
		}

		if (a.group === b.group) {
			return 0;
		}

		return a.group < b.group ? -1 : 1;
	}

	private getViewOrder(viewDescriptor: IViewDescriptor): number {
		const viewState = this.viewStates.get(viewDescriptor.id);
		const viewOrder = viewState && typeof viewState.order === 'number' ? viewState.order : viewDescriptor.order;
		return typeof viewOrder === 'number' ? viewOrder : Number.MAX_VALUE;
	}

	private onDidChangeViewDescriptors(viewDescriptors: IViewDescriptor[]): void {
		for (const viewDescriptor of viewDescriptors) {
			const viewState = this.viewStates.get(viewDescriptor.id);
			if (viewState) {
				// set defaults if not set
				if (viewDescriptor.workspace) {
					viewState.visibleWorkspace = isUndefinedOrNull(viewState.visibleWorkspace) ? !viewDescriptor.hideByDefault : viewState.visibleWorkspace;
				} else {
					viewState.visibleGlobal = isUndefinedOrNull(viewState.visibleGlobal) ? !viewDescriptor.hideByDefault : viewState.visibleGlobal;
				}
				viewState.collapsed = isUndefinedOrNull(viewState.collapsed) ? !!viewDescriptor.collapsed : viewState.collapsed;
			} else {
				this.viewStates.set(viewDescriptor.id, {
					visibleGlobal: !viewDescriptor.hideByDefault,
					visibleWorkspace: !viewDescriptor.hideByDefault,
					collapsed: !!viewDescriptor.collapsed
				});
			}
		}

		viewDescriptors = viewDescriptors.sort(this.compareViewDescriptors.bind(this));

		const toRemove: { index: number, viewDescriptor: IViewDescriptor; }[] = [];
		for (let index = 0; index < this._viewDescriptors.length; index++) {
			const previousViewDescriptor = this._viewDescriptors[index];
			if (this.isViewDescriptorVisible(previousViewDescriptor) && viewDescriptors.every(viewDescriptor => viewDescriptor.id !== previousViewDescriptor.id)) {
				const { visibleIndex } = this.find(previousViewDescriptor.id);
				toRemove.push({ index: visibleIndex, viewDescriptor: previousViewDescriptor });
			}
		}

		const previous = this._viewDescriptors;
		this._viewDescriptors = viewDescriptors.slice(0);

		const toAdd: { index: number, viewDescriptor: IViewDescriptor, size?: number, collapsed: boolean; }[] = [];
		for (let i = 0; i < this._viewDescriptors.length; i++) {
			const viewDescriptor = this._viewDescriptors[i];
			if (this.isViewDescriptorVisible(viewDescriptor) && previous.every(previousViewDescriptor => previousViewDescriptor.id !== viewDescriptor.id)) {
				const { visibleIndex, state } = this.find(viewDescriptor.id);
				toAdd.push({ index: visibleIndex, viewDescriptor, size: state.size, collapsed: !!state.collapsed });
			}
		}

		if (toRemove.length) {
			this._onDidRemove.fire(toRemove);
		}

		if (toAdd.length) {
			this._onDidAdd.fire(toAdd);
		}

		this._onDidChangeActiveViews.fire(this.viewDescriptors);
	}
}

interface IStoredWorkspaceViewState {
	collapsed: boolean;
	isHidden: boolean;
	size?: number;
	order?: number;
}

interface IStoredGlobalViewState {
	id: string;
	isHidden: boolean;
	order?: number;
}

export class PersistentContributableViewsModel extends ContributableViewsModel {

	private readonly workspaceViewsStateStorageId: string;
	private readonly globalViewsStateStorageId: string;

	private storageService: IStorageService;

	constructor(
		container: ViewContainer,
		viewletStateStorageId: string,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IStorageService storageService: IStorageService,
	) {
		const globalViewsStateStorageId = `${viewletStateStorageId}.hidden`;
		const viewStates = PersistentContributableViewsModel.loadViewsStates(viewletStateStorageId, globalViewsStateStorageId, storageService);

		super(container, viewDescriptorService, viewStates);

		this.workspaceViewsStateStorageId = viewletStateStorageId;
		this.globalViewsStateStorageId = globalViewsStateStorageId;
		this.storageService = storageService;

		this._register(Event.any(
			this.onDidAdd,
			this.onDidRemove,
			Event.map(this.onDidMove, ({ from, to }) => [from, to]),
			Event.map(this.onDidChangeViewState, viewDescriptorRef => [viewDescriptorRef]))
			(viewDescriptorRefs => this.saveViewsStates()));
	}

	private saveViewsStates(): void {
		this.saveWorkspaceViewsStates();
		this.saveGlobalViewsStates();
	}

	private saveWorkspaceViewsStates(): void {
		const storedViewsStates: { [id: string]: IStoredWorkspaceViewState; } = JSON.parse(this.storageService.get(this.workspaceViewsStateStorageId, StorageScope.WORKSPACE, '{}'));
		for (const viewDescriptor of this.viewDescriptors) {
			const viewState = this.viewStates.get(viewDescriptor.id);
			if (viewState) {
				storedViewsStates[viewDescriptor.id] = {
					collapsed: !!viewState.collapsed,
					isHidden: !viewState.visibleWorkspace,
					size: viewState.size,
					order: viewDescriptor.workspace && viewState ? viewState.order : undefined
				};
			}
		}

		if (Object.keys(storedViewsStates).length > 0) {
			this.storageService.store(this.workspaceViewsStateStorageId, JSON.stringify(storedViewsStates), StorageScope.WORKSPACE);
		} else {
			this.storageService.remove(this.workspaceViewsStateStorageId, StorageScope.WORKSPACE);
		}
	}

	private saveGlobalViewsStates(): void {
		const storedViewsVisibilityStates = PersistentContributableViewsModel.loadGlobalViewsState(this.globalViewsStateStorageId, this.storageService, StorageScope.GLOBAL);
		for (const viewDescriptor of this.viewDescriptors) {
			const viewState = this.viewStates.get(viewDescriptor.id);
			storedViewsVisibilityStates.set(viewDescriptor.id, {
				id: viewDescriptor.id,
				isHidden: viewState && viewDescriptor.canToggleVisibility ? !viewState.visibleGlobal : false,
				order: !viewDescriptor.workspace && viewState ? viewState.order : undefined
			});
		}
		this.storageService.store(this.globalViewsStateStorageId, JSON.stringify(values(storedViewsVisibilityStates)), StorageScope.GLOBAL);
	}


	private static loadViewsStates(workspaceViewsStateStorageId: string, globalViewsStateStorageId: string, storageService: IStorageService): Map<string, IViewState> {
		const viewStates = new Map<string, IViewState>();
		const workspaceViewsStates = <{ [id: string]: IStoredWorkspaceViewState; }>JSON.parse(storageService.get(workspaceViewsStateStorageId, StorageScope.WORKSPACE, '{}'));
		for (const id of Object.keys(workspaceViewsStates)) {
			const workspaceViewState = workspaceViewsStates[id];
			viewStates.set(id, {
				visibleGlobal: undefined,
				visibleWorkspace: isUndefined(workspaceViewState.isHidden) ? undefined : !workspaceViewState.isHidden,
				collapsed: workspaceViewState.collapsed,
				order: workspaceViewState.order,
				size: workspaceViewState.size
			});
		}

		// Migrate to `viewletStateStorageId`
		const workspaceVisibilityStates = this.loadGlobalViewsState(globalViewsStateStorageId, storageService, StorageScope.WORKSPACE);
		if (workspaceVisibilityStates.size > 0) {
			for (const { id, isHidden } of values(workspaceVisibilityStates)) {
				let viewState = viewStates.get(id);
				// Not migrated to `viewletStateStorageId`
				if (viewState) {
					if (isUndefined(viewState.visibleWorkspace)) {
						viewState.visibleWorkspace = !isHidden;
					}
				} else {
					viewStates.set(id, {
						collapsed: undefined,
						visibleGlobal: undefined,
						visibleWorkspace: !isHidden,
					});
				}
			}
			storageService.remove(globalViewsStateStorageId, StorageScope.WORKSPACE);
		}

		const globalViewsStates = this.loadGlobalViewsState(globalViewsStateStorageId, storageService, StorageScope.GLOBAL);
		for (const { id, isHidden, order } of values(globalViewsStates)) {
			let viewState = viewStates.get(id);
			if (viewState) {
				viewState.visibleGlobal = !isHidden;
				if (!isUndefined(order)) {
					viewState.order = order;
				}
			} else {
				viewStates.set(id, {
					visibleGlobal: !isHidden,
					order,
					collapsed: undefined,
					visibleWorkspace: undefined,
				});
			}
		}
		return viewStates;
	}

	private static loadGlobalViewsState(globalViewsStateStorageId: string, storageService: IStorageService, scope: StorageScope): Map<string, IStoredGlobalViewState> {
		const storedValue = <Array<string | IStoredGlobalViewState>>JSON.parse(storageService.get(globalViewsStateStorageId, scope, '[]'));
		let hasDuplicates = false;
		const storedGlobalViewsState = storedValue.reduce((result, storedState) => {
			if (typeof storedState === 'string' /* migration */) {
				hasDuplicates = hasDuplicates || result.has(storedState);
				result.set(storedState, { id: storedState, isHidden: true });
			} else {
				hasDuplicates = hasDuplicates || result.has(storedState.id);
				result.set(storedState.id, storedState);
			}
			return result;
		}, new Map<string, IStoredGlobalViewState>());

		if (hasDuplicates) {
			storageService.store(globalViewsStateStorageId, JSON.stringify(values(storedGlobalViewsState)), scope);
		}

		return storedGlobalViewsState;
	}
}

export class ViewsService extends Disposable implements IViewsService {

	_serviceBrand: undefined;

	private readonly viewContainersRegistry: IViewContainersRegistry;
	private readonly viewDisposable: Map<IViewDescriptor, IDisposable>;

	constructor(
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IPanelService private readonly panelService: IPanelService,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super();

		this.viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		this.viewDisposable = new Map<IViewDescriptor, IDisposable>();

		this._register(toDisposable(() => {
			this.viewDisposable.forEach(disposable => disposable.dispose());
			this.viewDisposable.clear();
		}));

		this.viewContainersRegistry.all.forEach(viewContainer => this.onViewContainerRegistered(viewContainer));
		this._register(this.viewContainersRegistry.onDidRegister(({ viewContainer }) => this.onViewContainerRegistered(viewContainer)));
	}

	private onViewContainerRegistered(viewContainer: ViewContainer): void {
		const viewDescriptorCollection = this.viewDescriptorService.getViewDescriptors(viewContainer);
		this.onViewsAdded(viewDescriptorCollection.allViewDescriptors, viewContainer);
		this._register(viewDescriptorCollection.onDidChangeViews(({ added, removed }) => {
			this.onViewsAdded(added, viewContainer);
			this.onViewsRemoved(removed);
		}));
	}

	private onViewsAdded(views: IViewDescriptor[], container: ViewContainer): void {
		const location = this.viewContainersRegistry.getViewContainerLocation(container);
		if (location === undefined) {
			return;
		}

		const composite = this.getComposite(container.id, location);
		for (const viewDescriptor of views) {
			const disposables = new DisposableStore();
			disposables.add(registerAction2(class FocusViewAction extends Action2 {
				constructor() {
					super({
						id: viewDescriptor.focusCommand ? viewDescriptor.focusCommand.id : `${viewDescriptor.id}.focus`,
						title: { original: `Focus on ${viewDescriptor.name} View`, value: localize('focus view', "Focus on {0} View", viewDescriptor.name) },
						category: composite ? composite.name : localize('view category', "View"),
						menu: [{
							id: MenuId.CommandPalette,
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
				run(accessor: ServicesAccessor): any {
					accessor.get(IViewsService).openView(viewDescriptor.id, true);
				}
			}));

			const newLocation = location === ViewContainerLocation.Panel ? ViewContainerLocation.Sidebar : ViewContainerLocation.Panel;
			disposables.add(registerAction2(class MoveViewAction extends Action2 {
				constructor() {
					super({
						id: `${viewDescriptor.id}.moveView`,
						title: {
							original: newLocation === ViewContainerLocation.Sidebar ? 'Move to Sidebar' : 'Move to Panel',
							value: newLocation === ViewContainerLocation.Sidebar ? localize('moveViewToSidebar', "Move to Sidebar") : localize('moveViewToPanel', "Move to Panel")
						},
						menu: [{
							id: MenuId.ViewTitleContext,
							when: ContextKeyExpr.and(ContextKeyExpr.equals('view', viewDescriptor.id), ContextKeyExpr.has(`${viewDescriptor.id}.canMove`)),
						}],
					});
				}
				run(accessor: ServicesAccessor): any {
					accessor.get(IViewDescriptorService).moveViewToLocation(viewDescriptor, newLocation);
					accessor.get(IViewsService).openView(viewDescriptor.id);
				}
			}));

			this.viewDisposable.set(viewDescriptor, disposables);
		}
	}

	private onViewsRemoved(views: IViewDescriptor[]): void {
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
			return this.panelService.openPanel(compositeId, focus) as IPaneComposite;
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

	async openView(id: string, focus: boolean): Promise<IView | null> {
		const viewContainer = this.viewDescriptorService.getViewContainer(id);
		if (viewContainer) {
			const location = this.viewContainersRegistry.getViewContainerLocation(viewContainer);
			const compositeDescriptor = this.getComposite(viewContainer.id, location!);
			if (compositeDescriptor) {
				const paneComposite = await this.openComposite(compositeDescriptor.id, location!, focus) as IPaneComposite | undefined;
				if (paneComposite && paneComposite.openView) {
					return paneComposite.openView(id, focus);
				}
			}
		}

		return null;
	}
}

export function createFileIconThemableTreeContainerScope(container: HTMLElement, themeService: IWorkbenchThemeService): IDisposable {
	addClass(container, 'file-icon-themable-tree');
	addClass(container, 'show-file-icons');

	const onDidChangeFileIconTheme = (theme: IFileIconTheme) => {
		toggleClass(container, 'align-icons-and-twisties', theme.hasFileIcons && !theme.hasFolderIcons);
		toggleClass(container, 'hide-arrows', theme.hidesExplorerArrows === true);
	};

	onDidChangeFileIconTheme(themeService.getFileIconTheme());
	return themeService.onDidFileIconThemeChange(onDidChangeFileIconTheme);
}

registerSingleton(IViewsService, ViewsService);
