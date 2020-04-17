/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewContainerLocation, IViewDescriptorService, ViewContainer, IViewsRegistry, IViewContainersRegistry, IViewDescriptor, Extensions as ViewExtensions, IViewDescriptorCollection, IAddedViewDescriptorRef, IViewDescriptorRef } from 'vs/workbench/common/views';
import { IContextKey, RawContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IStorageService, StorageScope, IWorkspaceStorageChangeEvent } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { toDisposable, DisposableStore, Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Event, Emitter } from 'vs/base/common/event';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { generateUuid } from 'vs/base/common/uuid';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { PersistentContributableViewsModel, ViewDescriptorsModel } from 'vs/workbench/services/views/common/viewsModel';

class ViewDescriptorCollection extends Disposable implements IViewDescriptorCollection {

	private readonly viewDescriptorsModel: ViewDescriptorsModel;
	private readonly viewsModel: PersistentContributableViewsModel;

	constructor(
		container: ViewContainer,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this.viewDescriptorsModel = instantiationService.createInstance(ViewDescriptorsModel);
		this.viewsModel = instantiationService.createInstance(PersistentContributableViewsModel, container.storageId || `${container.id}.state`, this.viewDescriptorsModel);
	}

	get allViewDescriptors(): IViewDescriptor[] { return this.viewDescriptorsModel.allViewDescriptors; }
	get onDidChangeViews(): Event<{ added: IViewDescriptor[], removed: IViewDescriptor[] }> { return this.viewDescriptorsModel.onDidChangeViews; }

	get activeViewDescriptors(): IViewDescriptor[] { return this.viewDescriptorsModel.activeViewDescriptors; }
	get _onDidChangeActiveViews(): Event<{ added: IViewDescriptor[], removed: IViewDescriptor[]; }> { return this.viewDescriptorsModel.onDidChangeActiveViews; }
	get onDidChangeActiveViews(): Event<ReadonlyArray<IViewDescriptor>> { return this.viewsModel.onDidChangeActiveViews; }

	addViews(viewDescriptors: IViewDescriptor[]): void { return this.viewDescriptorsModel.addViews(viewDescriptors); }
	removeViews(viewDescriptors: IViewDescriptor[]): void { return this.viewDescriptorsModel.removeViews(viewDescriptors); }

	get visibleViewDescriptors(): IViewDescriptor[] { return this.viewsModel.visibleViewDescriptors; }
	get onDidAdd(): Event<IAddedViewDescriptorRef[]> { return this.viewsModel.onDidAdd; }
	get onDidRemove(): Event<IViewDescriptorRef[]> { return this.viewsModel.onDidRemove; }
	get onDidMove(): Event<{ from: IViewDescriptorRef; to: IViewDescriptorRef; }> { return this.viewsModel.onDidMove; }

	isVisible(id: string): boolean { return this.viewsModel.isVisible(id); }
	setVisible(id: string, visible: boolean, size?: number): void { return this.viewsModel.setVisible(id, visible, size); }

	isCollapsed(id: string): boolean { return this.viewsModel.isCollapsed(id); }
	setCollapsed(id: string, collapsed: boolean): void { return this.viewsModel.setCollapsed(id, collapsed); }

	getSize(id: string): number | undefined { return this.viewsModel.getSize(id); }
	setSize(id: string, size: number): void { return this.viewsModel.setSize(id, size); }

	move(from: string, to: string): void { return this.viewsModel.move(from, to); }

}

interface ICachedViewContainerInfo {
	containerId: string;
	location?: ViewContainerLocation;
}

export class ViewDescriptorService extends Disposable implements IViewDescriptorService {

	_serviceBrand: undefined;

	private static readonly CACHED_VIEW_POSITIONS = 'views.cachedViewPositions';
	private static readonly COMMON_CONTAINER_ID_PREFIX = 'workbench.views.service';

	private readonly _onDidChangeContainer: Emitter<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }> = this._register(new Emitter<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }>());
	readonly onDidChangeContainer: Event<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }> = this._onDidChangeContainer.event;

	private readonly _onDidChangeLocation: Emitter<{ views: IViewDescriptor[], from: ViewContainerLocation, to: ViewContainerLocation }> = this._register(new Emitter<{ views: IViewDescriptor[], from: ViewContainerLocation, to: ViewContainerLocation }>());
	readonly onDidChangeLocation: Event<{ views: IViewDescriptor[], from: ViewContainerLocation, to: ViewContainerLocation }> = this._onDidChangeLocation.event;

	private readonly viewDescriptorCollections: Map<ViewContainer, { viewDescriptorCollection: ViewDescriptorCollection, disposable: IDisposable; }>;
	private readonly activeViewContextKeys: Map<string, IContextKey<boolean>>;
	private readonly movableViewContextKeys: Map<string, IContextKey<boolean>>;
	private readonly defaultViewLocationContextKeys: Map<string, IContextKey<boolean>>;

	private readonly viewsRegistry: IViewsRegistry;
	private readonly viewContainersRegistry: IViewContainersRegistry;

	private cachedViewInfo: Map<string, ICachedViewContainerInfo>;

	private _cachedViewPositionsValue: string | undefined;
	private get cachedViewPositionsValue(): string {
		if (!this._cachedViewPositionsValue) {
			this._cachedViewPositionsValue = this.getStoredCachedViewPositionsValue();
		}

		return this._cachedViewPositionsValue;
	}

	private set cachedViewPositionsValue(value: string) {
		if (this.cachedViewPositionsValue !== value) {
			this._cachedViewPositionsValue = value;
			this.setStoredCachedViewPositionsValue(value);
		}
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
	) {
		super();

		storageKeysSyncRegistryService.registerStorageKey({ key: ViewDescriptorService.CACHED_VIEW_POSITIONS, version: 1 });
		this.viewDescriptorCollections = new Map<ViewContainer, { viewDescriptorCollection: ViewDescriptorCollection, disposable: IDisposable; }>();
		this.activeViewContextKeys = new Map<string, IContextKey<boolean>>();
		this.movableViewContextKeys = new Map<string, IContextKey<boolean>>();
		this.defaultViewLocationContextKeys = new Map<string, IContextKey<boolean>>();

		this.viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		this.viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

		this.cachedViewInfo = this.getCachedViewPositions();

		// Register all containers that were registered before this ctor
		this.viewContainersRegistry.all.forEach(viewContainer => this.onDidRegisterViewContainer(viewContainer));

		// Try generating all generated containers that don't need extensions
		this.tryGenerateContainers();

		this._register(this.viewsRegistry.onViewsRegistered(({ views, viewContainer }) => this.onDidRegisterViews(views, viewContainer)));
		this._register(this.viewsRegistry.onViewsDeregistered(({ views, viewContainer }) => this.onDidDeregisterViews(views, viewContainer)));

		this._register(this.viewsRegistry.onDidChangeContainer(({ views, from, to }) => this.moveViews(views, from, to)));

		this._register(this.viewContainersRegistry.onDidRegister(({ viewContainer }) => this.onDidRegisterViewContainer(viewContainer)));
		this._register(this.viewContainersRegistry.onDidDeregister(({ viewContainer }) => this.onDidDeregisterViewContainer(viewContainer)));
		this._register(toDisposable(() => {
			this.viewDescriptorCollections.forEach(({ disposable }) => disposable.dispose());
			this.viewDescriptorCollections.clear();
		}));

		this._register(this.storageService.onDidChangeStorage((e) => { this.onDidStorageChange(e); }));

		this._register(this.extensionService.onDidRegisterExtensions(() => this.onDidRegisterExtensions()));
	}

	private registerGroupedViews(groupedViews: Map<string, { cachedContainerInfo?: ICachedViewContainerInfo, views: IViewDescriptor[] }>): void {
		// Register views that have already been registered to their correct view containers
		for (const containerId of groupedViews.keys()) {
			const viewContainer = this.viewContainersRegistry.get(containerId);
			const containerData = groupedViews.get(containerId)!;

			// The container has not been registered yet
			if (!viewContainer || !this.viewDescriptorCollections.has(viewContainer)) {
				if (containerData.cachedContainerInfo && this.shouldGenerateContainer(containerData.cachedContainerInfo)) {
					const containerInfo = containerData.cachedContainerInfo;

					if (!this.viewContainersRegistry.get(containerId)) {
						this.registerGeneratedViewContainer(containerInfo.location!, containerId);
					}
				}

				continue;
			}

			this.addViews(viewContainer, containerData.views);
		}
	}

	private deregisterGroupedViews(groupedViews: Map<string, { cachedContainerInfo?: ICachedViewContainerInfo, views: IViewDescriptor[] }>): void {
		// Register views that have already been registered to their correct view containers
		for (const viewContainerId of groupedViews.keys()) {
			const viewContainer = this.viewContainersRegistry.get(viewContainerId);

			// The container has not been registered yet
			if (!viewContainer || !this.viewDescriptorCollections.has(viewContainer)) {
				continue;
			}

			this.removeViews(viewContainer, groupedViews.get(viewContainerId)!.views);
		}
	}

	private tryGenerateContainers(fallbackToDefault?: boolean): void {
		for (const [viewId, containerInfo] of this.cachedViewInfo.entries()) {
			const containerId = containerInfo.containerId;

			// check if cached view container is registered
			if (this.viewContainersRegistry.get(containerId)) {
				continue;
			}

			// check if we should generate this container
			if (this.shouldGenerateContainer(containerInfo)) {
				this.registerGeneratedViewContainer(containerInfo.location!, containerId);
				continue;
			}

			if (fallbackToDefault) {
				// check if view has been registered to default location
				const viewContainer = this.viewsRegistry.getViewContainer(viewId);
				const viewDescriptor = this.getViewDescriptor(viewId);
				if (viewContainer && viewDescriptor) {
					this.addViews(viewContainer, [viewDescriptor]);

					const newLocation = this.getViewContainerLocation(viewContainer);
					if (containerInfo.location && containerInfo.location !== newLocation) {
						this._onDidChangeLocation.fire({ views: [viewDescriptor], from: containerInfo.location, to: newLocation });
					}
				}
			}
		}

		if (fallbackToDefault) {
			this.saveViewPositionsToCache();
		}
	}

	private onDidRegisterExtensions(): void {
		this.tryGenerateContainers(true);
	}

	private onDidRegisterViews(views: IViewDescriptor[], viewContainer: ViewContainer): void {
		// When views are registered, we need to regroup them based on the cache
		const regroupedViews = this.regroupViews(viewContainer.id, views);

		// Once they are grouped, try registering them which occurs
		// if the container has already been registered within this service
		// or we can generate the container from the source view id
		this.registerGroupedViews(regroupedViews);

		views.forEach(viewDescriptor => this.getOrCreateMovableViewContextKey(viewDescriptor).set(!!viewDescriptor.canMoveView));
	}

	private shouldGenerateContainer(containerInfo: ICachedViewContainerInfo): boolean {
		return containerInfo.containerId.startsWith(ViewDescriptorService.COMMON_CONTAINER_ID_PREFIX) && containerInfo.location !== undefined;
	}

	private onDidDeregisterViews(views: IViewDescriptor[], viewContainer: ViewContainer): void {
		// When views are registered, we need to regroup them based on the cache
		const regroupedViews = this.regroupViews(viewContainer.id, views);
		this.deregisterGroupedViews(regroupedViews);
		views.forEach(viewDescriptor => this.getOrCreateMovableViewContextKey(viewDescriptor).set(false));
	}

	private regroupViews(containerId: string, views: IViewDescriptor[]): Map<string, { cachedContainerInfo?: ICachedViewContainerInfo, views: IViewDescriptor[] }> {
		const ret = new Map<string, { cachedContainerInfo?: ICachedViewContainerInfo, views: IViewDescriptor[] }>();

		views.forEach(viewDescriptor => {
			const containerInfo = this.cachedViewInfo.get(viewDescriptor.id);
			const correctContainerId = containerInfo?.containerId || containerId;

			const containerData = ret.get(correctContainerId) || { cachedContainerInfo: containerInfo, views: [] };
			containerData.views.push(viewDescriptor);
			ret.set(correctContainerId, containerData);
		});

		return ret;
	}

	getViewDescriptor(viewId: string): IViewDescriptor | null {
		return this.viewsRegistry.getView(viewId);
	}

	getViewLocation(viewId: string): ViewContainerLocation | null {
		const cachedInfo = this.cachedViewInfo.get(viewId);

		if (cachedInfo && cachedInfo.location) {
			return cachedInfo.location;
		}

		const container = cachedInfo?.containerId ?
			this.viewContainersRegistry.get(cachedInfo.containerId) ?? null :
			this.viewsRegistry.getViewContainer(viewId);

		if (!container) {
			return null;
		}

		return this.getViewContainerLocation(container);
	}

	getViewContainer(viewId: string): ViewContainer | null {
		const containerId = this.cachedViewInfo.get(viewId)?.containerId;

		return containerId ?
			this.viewContainersRegistry.get(containerId) ?? null :
			this.viewsRegistry.getViewContainer(viewId);
	}

	getViewContainerLocation(viewContainer: ViewContainer): ViewContainerLocation {
		return this.viewContainersRegistry.getViewContainerLocation(viewContainer);
	}

	getDefaultContainer(viewId: string): ViewContainer | null {
		return this.viewsRegistry.getViewContainer(viewId) ?? null;
	}

	getViewDescriptors(container: ViewContainer): ViewDescriptorCollection {
		return this.getOrRegisterViewDescriptorCollection(container);
	}

	moveViewToLocation(view: IViewDescriptor, location: ViewContainerLocation): void {
		let container = this.registerGeneratedViewContainer(location);
		this.moveViewsToContainer([view], container);
	}

	moveViewsToContainer(views: IViewDescriptor[], viewContainer: ViewContainer): void {
		if (!views.length) {
			return;
		}

		const from = this.getViewContainer(views[0].id);
		const to = viewContainer;

		if (from && to && from !== to) {
			this.moveViews(views, from, to);
		}
	}

	private moveViews(views: IViewDescriptor[], from: ViewContainer, to: ViewContainer, skipCacheUpdate?: boolean): void {
		this.removeViews(from, views);
		this.addViews(to, views);

		const oldLocation = this.getViewContainerLocation(from);
		const newLocation = this.getViewContainerLocation(to);

		if (oldLocation !== newLocation) {
			this._onDidChangeLocation.fire({ views, from: oldLocation, to: newLocation });
		}

		this._onDidChangeContainer.fire({ views, from, to });

		if (!skipCacheUpdate) {
			this.saveViewPositionsToCache();

			const containerToString = (container: ViewContainer): string => {
				if (container.id.startsWith(ViewDescriptorService.COMMON_CONTAINER_ID_PREFIX)) {
					return 'custom';
				}

				if (!container.extensionId) {
					return container.id;
				}

				return 'extension';
			};

			// Log on cache update to avoid duplicate events in other windows
			const viewCount = views.length;
			const fromContainer = containerToString(from);
			const toContainer = containerToString(to);
			const fromLocation = oldLocation === ViewContainerLocation.Panel ? 'panel' : 'sidebar';
			const toLocation = newLocation === ViewContainerLocation.Panel ? 'panel' : 'sidebar';

			interface ViewDescriptorServiceMoveViewsEvent {
				viewCount: number;
				fromContainer: string;
				toContainer: string;
				fromLocation: string;
				toLocation: string;
			}

			type ViewDescriptorServiceMoveViewsClassification = {
				viewCount: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				fromContainer: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				toContainer: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				fromLocation: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				toLocation: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			};

			this.telemetryService.publicLog2<ViewDescriptorServiceMoveViewsEvent, ViewDescriptorServiceMoveViewsClassification>('viewDescriptorService.moveViews', { viewCount, fromContainer, toContainer, fromLocation, toLocation });
		}
	}

	private registerGeneratedViewContainer(location: ViewContainerLocation, existingId?: string): ViewContainer {
		const id = existingId || this.generateContainerId(location);

		return this.viewContainersRegistry.registerViewContainer({
			id,
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [id, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
			name: 'Custom Views', // we don't want to see this, so no need to localize
			icon: location === ViewContainerLocation.Sidebar ? 'codicon-window' : undefined,
			storageId: `${id}.state`,
			hideIfEmpty: true
		}, location);
	}

	private getCachedViewPositions(): Map<string, ICachedViewContainerInfo> {
		const result = new Map<string, ICachedViewContainerInfo>(JSON.parse(this.cachedViewPositionsValue));

		// Sanitize cache
		for (const [viewId, containerInfo] of result.entries()) {
			if (!containerInfo) {
				result.delete(viewId);
			}
		}

		return result;
	}

	private onDidStorageChange(e: IWorkspaceStorageChangeEvent): void {
		if (e.key === ViewDescriptorService.CACHED_VIEW_POSITIONS && e.scope === StorageScope.GLOBAL
			&& this.cachedViewPositionsValue !== this.getStoredCachedViewPositionsValue() /* This checks if current window changed the value or not */) {
			this._cachedViewPositionsValue = this.getStoredCachedViewPositionsValue();

			const newCachedPositions = this.getCachedViewPositions();

			for (let viewId of newCachedPositions.keys()) {
				const viewDescriptor = this.getViewDescriptor(viewId);
				if (!viewDescriptor) {
					continue;
				}

				const prevViewContainer = this.getViewContainer(viewId);
				const newViewContainerInfo = newCachedPositions.get(viewId)!;
				// Verify if we need to create the destination container
				if (!this.viewContainersRegistry.get(newViewContainerInfo.containerId)) {
					this.registerGeneratedViewContainer(newViewContainerInfo.location!, newViewContainerInfo.containerId);
				}

				// Try moving to the new container
				const newViewContainer = this.viewContainersRegistry.get(newViewContainerInfo.containerId);
				if (prevViewContainer && newViewContainer && newViewContainer !== prevViewContainer) {
					const viewDescriptor = this.getViewDescriptor(viewId);
					if (viewDescriptor) {
						this.moveViews([viewDescriptor], prevViewContainer, newViewContainer);
					}
				}
			}

			// If a value is not present in the cache, it must be reset to default
			this.viewContainersRegistry.all.forEach(viewContainer => {
				const viewDescriptorCollection = this.getViewDescriptors(viewContainer);
				viewDescriptorCollection.allViewDescriptors.forEach(viewDescriptor => {
					if (!newCachedPositions.has(viewDescriptor.id)) {
						const currentContainer = this.getViewContainer(viewDescriptor.id);
						const defaultContainer = this.getDefaultContainer(viewDescriptor.id);
						if (currentContainer && defaultContainer && currentContainer !== defaultContainer) {
							this.moveViews([viewDescriptor], currentContainer, defaultContainer);
						}

						this.cachedViewInfo.delete(viewDescriptor.id);
					}
				});
			});

			this.cachedViewInfo = this.getCachedViewPositions();
		}
	}

	// Generated Container Id Format
	// {Common Prefix}.{Location}.{Uniqueness Id}
	// Old Format (deprecated)
	// {Common Prefix}.{Uniqueness Id}.{Source View Id}
	private generateContainerId(location: ViewContainerLocation): string {
		return `${ViewDescriptorService.COMMON_CONTAINER_ID_PREFIX}.${location === ViewContainerLocation.Panel ? 'panel' : 'sidebar'}.${generateUuid()}`;
	}

	private getStoredCachedViewPositionsValue(): string {
		return this.storageService.get(ViewDescriptorService.CACHED_VIEW_POSITIONS, StorageScope.GLOBAL, '[]');
	}

	private setStoredCachedViewPositionsValue(value: string): void {
		this.storageService.store(ViewDescriptorService.CACHED_VIEW_POSITIONS, value, StorageScope.GLOBAL);
	}

	private saveViewPositionsToCache(): void {
		this.viewContainersRegistry.all.forEach(viewContainer => {
			const viewDescriptorCollection = this.getViewDescriptors(viewContainer);
			viewDescriptorCollection.allViewDescriptors.forEach(viewDescriptor => {
				const containerLocation = this.getViewContainerLocation(viewContainer);
				this.cachedViewInfo.set(viewDescriptor.id, {
					containerId: viewContainer.id,
					location: containerLocation
				});
			});
		});

		// Do no save default positions to the cache
		// so that default changes can be recognized
		// https://github.com/microsoft/vscode/issues/90414
		for (const [viewId, containerInfo] of this.cachedViewInfo) {
			const defaultContainer = this.getDefaultContainer(viewId);
			if (defaultContainer?.id === containerInfo.containerId) {
				this.cachedViewInfo.delete(viewId);
			}
		}

		this.cachedViewPositionsValue = JSON.stringify([...this.cachedViewInfo]);
	}

	private getViewsByContainer(viewContainer: ViewContainer): IViewDescriptor[] {
		const result = this.viewsRegistry.getViews(viewContainer).filter(viewDescriptor => {
			const cachedContainer = this.cachedViewInfo.get(viewDescriptor.id)?.containerId || viewContainer.id;
			return cachedContainer === viewContainer.id;
		});

		for (const [viewId, containerInfo] of this.cachedViewInfo.entries()) {
			if (!containerInfo || containerInfo.containerId !== viewContainer.id) {
				continue;
			}

			if (this.viewsRegistry.getViewContainer(viewId) === viewContainer) {
				continue;
			}

			const viewDescriptor = this.getViewDescriptor(viewId);
			if (viewDescriptor) {
				result.push(viewDescriptor);
			}
		}

		return result;
	}

	private onDidRegisterViewContainer(viewContainer: ViewContainer): void {
		this.getOrRegisterViewDescriptorCollection(viewContainer);
	}

	private getOrRegisterViewDescriptorCollection(viewContainer: ViewContainer): ViewDescriptorCollection {
		let viewDescriptorCollection = this.viewDescriptorCollections.get(viewContainer)?.viewDescriptorCollection;

		if (!viewDescriptorCollection) {
			const disposables = new DisposableStore();
			viewDescriptorCollection = disposables.add(this.instantiationService.createInstance(ViewDescriptorCollection, viewContainer));

			this.onDidChangeActiveViews({ added: viewDescriptorCollection.activeViewDescriptors, removed: [] });
			viewDescriptorCollection._onDidChangeActiveViews(changed => this.onDidChangeActiveViews(changed), this, disposables);

			this.viewDescriptorCollections.set(viewContainer, { viewDescriptorCollection, disposable: disposables });

			const viewsToRegister = this.getViewsByContainer(viewContainer);
			if (viewsToRegister.length) {
				this.addViews(viewContainer, viewsToRegister);
				viewsToRegister.forEach(viewDescriptor => this.getOrCreateMovableViewContextKey(viewDescriptor).set(!!viewDescriptor.canMoveView));
			}
		}

		return viewDescriptorCollection;
	}

	private onDidDeregisterViewContainer(viewContainer: ViewContainer): void {
		const viewDescriptorCollectionItem = this.viewDescriptorCollections.get(viewContainer);
		if (viewDescriptorCollectionItem) {
			viewDescriptorCollectionItem.disposable.dispose();
			this.viewDescriptorCollections.delete(viewContainer);
		}
	}

	private onDidChangeActiveViews({ added, removed }: { added: IViewDescriptor[], removed: IViewDescriptor[]; }): void {
		added.forEach(viewDescriptor => this.getOrCreateActiveViewContextKey(viewDescriptor).set(true));
		removed.forEach(viewDescriptor => this.getOrCreateActiveViewContextKey(viewDescriptor).set(false));
	}

	private addViews(container: ViewContainer, views: IViewDescriptor[]): void {
		// Update in memory cache
		const location = this.getViewContainerLocation(container);
		views.forEach(view => {
			this.cachedViewInfo.set(view.id, { containerId: container.id, location });
			this.getOrCreateDefaultViewLocationContextKey(view).set(this.getDefaultContainer(view.id) === container);
		});

		this.getViewDescriptors(container).addViews(views);
	}

	private removeViews(container: ViewContainer, views: IViewDescriptor[]): void {
		// Set view default location keys to false
		views.forEach(view => this.getOrCreateDefaultViewLocationContextKey(view).set(false));

		// Remove the views
		this.getViewDescriptors(container).removeViews(views);
	}

	private getOrCreateActiveViewContextKey(viewDescriptor: IViewDescriptor): IContextKey<boolean> {
		const activeContextKeyId = `${viewDescriptor.id}.active`;
		let contextKey = this.activeViewContextKeys.get(activeContextKeyId);
		if (!contextKey) {
			contextKey = new RawContextKey(activeContextKeyId, false).bindTo(this.contextKeyService);
			this.activeViewContextKeys.set(activeContextKeyId, contextKey);
		}
		return contextKey;
	}

	private getOrCreateMovableViewContextKey(viewDescriptor: IViewDescriptor): IContextKey<boolean> {
		const movableViewContextKeyId = `${viewDescriptor.id}.canMove`;
		let contextKey = this.movableViewContextKeys.get(movableViewContextKeyId);
		if (!contextKey) {
			contextKey = new RawContextKey(movableViewContextKeyId, false).bindTo(this.contextKeyService);
			this.movableViewContextKeys.set(movableViewContextKeyId, contextKey);
		}
		return contextKey;
	}

	private getOrCreateDefaultViewLocationContextKey(viewDescriptor: IViewDescriptor): IContextKey<boolean> {
		const defaultViewLocationContextKeyId = `${viewDescriptor.id}.defaultViewLocation`;
		let contextKey = this.defaultViewLocationContextKeys.get(defaultViewLocationContextKeyId);
		if (!contextKey) {
			contextKey = new RawContextKey(defaultViewLocationContextKeyId, false).bindTo(this.contextKeyService);
			this.defaultViewLocationContextKeys.set(defaultViewLocationContextKeyId, contextKey);
		}
		return contextKey;
	}
}

registerSingleton(IViewDescriptorService, ViewDescriptorService);
