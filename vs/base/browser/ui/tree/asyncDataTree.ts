/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ComposedTreeDelegate, IAbstractTreeOptions } from 'vs/base/browser/ui/tree/abstractTree';
import { ObjectTree, IObjectTreeOptions } from 'vs/base/browser/ui/tree/objectTree';
import { IListVirtualDelegate, IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { ITreeElement, ITreeNode, ITreeRenderer, ITreeEvent, ITreeMouseEvent, ITreeContextMenuEvent, ITreeFilter } from 'vs/base/browser/ui/tree/tree';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { Emitter, Event, mapEvent } from 'vs/base/common/event';
import { timeout, always } from 'vs/base/common/async';
import { ISequence } from 'vs/base/common/iterator';
import { IListStyles, IMultipleSelectionController, IAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { toggleClass } from 'vs/base/browser/dom';

export interface IDataSource<T extends NonNullable<any>> {
	hasChildren(element: T | null): boolean;
	getChildren(element: T | null): Thenable<T[]>;
}

enum AsyncDataTreeNodeState {
	Uninitialized,
	Loaded,
	Loading,
	Slow
}

interface IAsyncDataTreeNode<T extends NonNullable<any>> {
	readonly element: T | null;
	readonly parent: IAsyncDataTreeNode<T> | null;
	state: AsyncDataTreeNodeState;
}

interface IDataTreeListTemplateData<T> {
	templateData: T;
}

class AsyncDataTreeNodeWrapper<T, TFilterData> implements ITreeNode<T, TFilterData> {

	get element(): T { return this.node.element!.element!; }
	get parent(): ITreeNode<T, TFilterData> | undefined { return this.node.parent && new AsyncDataTreeNodeWrapper(this.node.parent); }
	get children(): ITreeNode<T, TFilterData>[] { return this.node.children.map(node => new AsyncDataTreeNodeWrapper(node)); }
	get depth(): number { return this.node.depth; }
	get collapsible(): boolean { return this.node.collapsible; }
	get collapsed(): boolean { return this.node.collapsed; }
	get visible(): boolean { return this.node.visible; }
	get filterData(): TFilterData | undefined { return this.node.filterData; }

	constructor(private node: ITreeNode<IAsyncDataTreeNode<T> | null, TFilterData>) { }
}

class DataTreeRenderer<T, TFilterData, TTemplateData> implements ITreeRenderer<IAsyncDataTreeNode<T>, TFilterData, IDataTreeListTemplateData<TTemplateData>> {

	readonly templateId: string;
	private renderedNodes = new Map<IAsyncDataTreeNode<T>, IDataTreeListTemplateData<TTemplateData>>();
	private disposables: IDisposable[] = [];

	constructor(
		private renderer: ITreeRenderer<T, TFilterData, TTemplateData>,
		readonly onDidChangeTwistieState: Event<IAsyncDataTreeNode<T>>
	) {
		this.templateId = renderer.templateId;
	}

	renderTemplate(container: HTMLElement): IDataTreeListTemplateData<TTemplateData> {
		const templateData = this.renderer.renderTemplate(container);
		return { templateData };
	}

	renderElement(node: ITreeNode<IAsyncDataTreeNode<T>, TFilterData>, index: number, templateData: IDataTreeListTemplateData<TTemplateData>): void {
		this.renderer.renderElement(new AsyncDataTreeNodeWrapper(node), index, templateData.templateData);
	}

	renderTwistie(element: IAsyncDataTreeNode<T>, twistieElement: HTMLElement): boolean {
		toggleClass(twistieElement, 'loading', element.state === AsyncDataTreeNodeState.Slow);
		return false;
	}

	disposeElement(node: ITreeNode<IAsyncDataTreeNode<T>, TFilterData>, index: number, templateData: IDataTreeListTemplateData<TTemplateData>): void {
		this.renderer.disposeElement(new AsyncDataTreeNodeWrapper(node), index, templateData.templateData);
	}

	disposeTemplate(templateData: IDataTreeListTemplateData<TTemplateData>): void {
		this.renderer.disposeTemplate(templateData.templateData);
	}

	dispose(): void {
		this.renderedNodes.clear();
		this.disposables = dispose(this.disposables);
	}
}

function asTreeEvent<T>(e: ITreeEvent<IAsyncDataTreeNode<T>>): ITreeEvent<T> {
	return {
		browserEvent: e.browserEvent,
		elements: e.elements.map(e => e.element!)
	};
}

function asTreeMouseEvent<T>(e: ITreeMouseEvent<IAsyncDataTreeNode<T>>): ITreeMouseEvent<T> {
	return {
		browserEvent: e.browserEvent,
		element: e.element && e.element.element!
	};
}

function asTreeContextMenuEvent<T>(e: ITreeContextMenuEvent<IAsyncDataTreeNode<T>>): ITreeContextMenuEvent<T> {
	return {
		browserEvent: e.browserEvent,
		element: e.element && e.element.element!,
		anchor: e.anchor
	};
}

export enum ChildrenResolutionReason {
	Refresh,
	Expand
}

export interface IChildrenResolutionEvent<T> {
	readonly element: T | null;
	readonly reason: ChildrenResolutionReason;
}

export interface IAsyncDataTreeOptions<T, TFilterData = void> extends IAbstractTreeOptions<T, TFilterData> { }

function asObjectTreeOptions<T, TFilterData>(options?: IAsyncDataTreeOptions<T, TFilterData>): IObjectTreeOptions<IAsyncDataTreeNode<T>, TFilterData> | undefined {
	if (!options) {
		return undefined;
	}

	let identityProvider: IIdentityProvider<IAsyncDataTreeNode<T>> | undefined = undefined;

	if (options.identityProvider) {
		const ip = options.identityProvider;
		identityProvider = {
			getId(el) {
				return ip.getId(el.element!);
			}
		};
	}

	let multipleSelectionController: IMultipleSelectionController<IAsyncDataTreeNode<T>> | undefined = undefined;

	if (options.multipleSelectionController) {
		const msc = options.multipleSelectionController;
		multipleSelectionController = {
			isSelectionSingleChangeEvent(e) {
				return msc.isSelectionSingleChangeEvent({ ...e, element: e.element } as any);
			},
			isSelectionRangeChangeEvent(e) {
				return msc.isSelectionRangeChangeEvent({ ...e, element: e.element } as any);
			}
		};
	}

	let accessibilityProvider: IAccessibilityProvider<IAsyncDataTreeNode<T>> | undefined = undefined;

	if (options.accessibilityProvider) {
		const ap = options.accessibilityProvider;
		accessibilityProvider = {
			getAriaLabel(e) {
				return ap.getAriaLabel(e.element!);
			}
		};
	}

	let filter: ITreeFilter<IAsyncDataTreeNode<T>, TFilterData> | undefined = undefined;

	if (options.filter) {
		const f = options.filter;
		filter = {
			filter(element, parentVisibility) {
				return f.filter(element.element!, parentVisibility);
			}
		};
	}

	return {
		...options,
		identityProvider,
		multipleSelectionController,
		accessibilityProvider,
		filter
	};
}


export class AsyncDataTree<T extends NonNullable<any>, TFilterData = void> implements IDisposable {

	private tree: ObjectTree<IAsyncDataTreeNode<T>, TFilterData>;
	private root: IAsyncDataTreeNode<T>;
	private nodes = new Map<T | null, IAsyncDataTreeNode<T>>();
	private refreshPromises = new Map<IAsyncDataTreeNode<T>, Thenable<void>>();

	private _onDidChangeNodeState = new Emitter<IAsyncDataTreeNode<T>>();

	protected disposables: IDisposable[] = [];

	get onDidChangeFocus(): Event<ITreeEvent<T>> { return mapEvent(this.tree.onDidChangeFocus, asTreeEvent); }
	get onDidChangeSelection(): Event<ITreeEvent<T>> { return mapEvent(this.tree.onDidChangeSelection, asTreeEvent); }
	get onDidChangeCollapseState(): Event<T> { return mapEvent(this.tree.onDidChangeCollapseState, e => e.element!.element!); }

	private _onDidResolveChildren = new Emitter<IChildrenResolutionEvent<T>>();
	readonly onDidResolveChildren: Event<IChildrenResolutionEvent<T>> = this._onDidResolveChildren.event;

	get onMouseClick(): Event<ITreeMouseEvent<T>> { return mapEvent(this.tree.onMouseClick, asTreeMouseEvent); }
	get onMouseDblClick(): Event<ITreeMouseEvent<T>> { return mapEvent(this.tree.onMouseDblClick, asTreeMouseEvent); }
	get onContextMenu(): Event<ITreeContextMenuEvent<T>> { return mapEvent(this.tree.onContextMenu, asTreeContextMenuEvent); }
	get onDidFocus(): Event<void> { return this.tree.onDidFocus; }
	get onDidBlur(): Event<void> { return this.tree.onDidBlur; }

	get onDidDispose(): Event<void> { return this.tree.onDidDispose; }

	constructor(
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: ITreeRenderer<any /* TODO@joao */, TFilterData, any>[],
		private dataSource: IDataSource<T>,
		options?: IAsyncDataTreeOptions<T, TFilterData>
	) {
		const objectTreeDelegate = new ComposedTreeDelegate<T | null, IAsyncDataTreeNode<T>>(delegate);
		const objectTreeRenderers = renderers.map(r => new DataTreeRenderer(r, this._onDidChangeNodeState.event));
		const objectTreeOptions = asObjectTreeOptions(options) || {};
		objectTreeOptions.collapseByDefault = true;

		this.tree = new ObjectTree(container, objectTreeDelegate, objectTreeRenderers, objectTreeOptions);
		this.root = {
			element: null,
			parent: null,
			state: AsyncDataTreeNodeState.Uninitialized,
		};

		this.nodes.set(null, this.root);

		this.tree.onDidChangeCollapseState(this._onDidChangeCollapseState, this, this.disposables);
	}

	// Widget

	getHTMLElement(): HTMLElement {
		return this.tree.getHTMLElement();
	}

	get scrollTop(): number {
		return this.tree.scrollTop;
	}

	set scrollTop(scrollTop: number) {
		this.tree.scrollTop = scrollTop;
	}

	get scrollHeight(): number {
		return this.tree.scrollHeight;
	}

	domFocus(): void {
		this.tree.domFocus();
	}

	layout(height?: number): void {
		this.tree.layout(height);
	}

	style(styles: IListStyles): void {
		this.tree.style(styles);
	}

	// Data Tree

	refresh(element: T | null): Thenable<void> {
		return this.refreshNode(this.getDataNode(element), ChildrenResolutionReason.Refresh);
	}

	// Tree

	getNode(element: T | null): ITreeNode<T | null, TFilterData> {
		const dataNode = this.getDataNode(element);
		const node = this.tree.getNode(dataNode === this.root ? null : dataNode);
		return new AsyncDataTreeNodeWrapper<T | null, TFilterData>(node);
	}

	collapse(element: T): boolean {
		return this.tree.collapse(this.getDataNode(element));
	}

	expand(element: T): Thenable<boolean> {
		const node = this.getDataNode(element);

		if (!this.tree.isCollapsed(node)) {
			return Promise.resolve(false);
		}

		if (node.element!.state === AsyncDataTreeNodeState.Uninitialized) {
			const result = this.refreshNode(node, ChildrenResolutionReason.Expand);
			this.tree.expand(node);
			return result.then(() => true);
		}

		this.tree.expand(node);
		return Promise.resolve(true);
	}

	toggleCollapsed(element: T): void {
		this.tree.toggleCollapsed(this.getDataNode(element));
	}

	collapseAll(): void {
		this.tree.collapseAll();
	}

	isCollapsed(element: T): boolean {
		return this.tree.isCollapsed(this.getDataNode(element));
	}

	isExpanded(element: T): boolean {
		return this.tree.isExpanded(this.getDataNode(element));
	}

	refilter(): void {
		this.tree.refilter();
	}

	setSelection(elements: T[], browserEvent?: UIEvent): void {
		const nodes = elements.map(e => this.getDataNode(e));
		this.tree.setSelection(nodes, browserEvent);
	}

	getSelection(): T[] {
		const nodes = this.tree.getSelection();
		return nodes.map(n => n!.element!);
	}

	setFocus(elements: T[], browserEvent?: UIEvent): void {
		const nodes = elements.map(e => this.getDataNode(e));
		this.tree.setFocus(nodes, browserEvent);
	}

	focusNext(n = 1, loop = false, browserEvent?: UIEvent): void {
		this.tree.focusNext(n, loop, browserEvent);
	}

	focusPrevious(n = 1, loop = false, browserEvent?: UIEvent): void {
		this.tree.focusPrevious(n, loop, browserEvent);
	}

	focusNextPage(browserEvent?: UIEvent): void {
		this.tree.focusNextPage(browserEvent);
	}

	focusPreviousPage(browserEvent?: UIEvent): void {
		this.tree.focusPreviousPage(browserEvent);
	}

	focusLast(browserEvent?: UIEvent): void {
		this.tree.focusLast(browserEvent);
	}

	focusFirst(browserEvent?: UIEvent): void {
		this.tree.focusFirst(browserEvent);
	}

	getFocus(): T[] {
		const nodes = this.tree.getFocus();
		return nodes.map(n => n!.element!);
	}

	open(elements: T[]): void {
		const nodes = elements.map(e => this.getDataNode(e));
		this.tree.open(nodes);
	}

	reveal(element: T, relativeTop?: number): void {
		this.tree.reveal(this.getDataNode(element), relativeTop);
	}

	getRelativeTop(element: T): number | null {
		return this.tree.getRelativeTop(this.getDataNode(element));
	}

	// Tree navigation

	getParentElement(element: T): T | null {
		const node = this.tree.getParentElement(this.getDataNode(element));
		return node && node.element;
	}

	getFirstElementChild(element: T | null = null): T | null {
		const dataNode = this.getDataNode(element);
		const node = this.tree.getFirstElementChild(dataNode === this.root ? null : dataNode);
		return node && node.element;
	}

	getLastElementAncestor(element: T | null = null): T | null {
		const dataNode = this.getDataNode(element);
		const node = this.tree.getLastElementAncestor(dataNode === this.root ? null : dataNode);
		return node && node.element;
	}

	// List

	get visibleNodeCount(): number {
		return this.tree.visibleNodeCount;
	}

	// Implementation

	private getDataNode(element: T | null): IAsyncDataTreeNode<T> {
		const node: IAsyncDataTreeNode<T> = this.nodes.get(element);

		if (typeof node === 'undefined') {
			throw new Error(`Data tree node not found: ${element}`);
		}

		return node;
	}

	private refreshNode(node: IAsyncDataTreeNode<T>, reason: ChildrenResolutionReason): Thenable<void> {
		let result = this.refreshPromises.get(node);

		if (result) {
			return result;
		}

		result = this.doRefresh(node, reason);
		this.refreshPromises.set(node, result);
		return always(result, () => this.refreshPromises.delete(node));
	}

	private doRefresh(node: IAsyncDataTreeNode<T>, reason: ChildrenResolutionReason): Thenable<void> {
		const hasChildren = this.dataSource.hasChildren(node.element);

		if (!hasChildren) {
			this.setChildren(node === this.root ? null : node);
			return Promise.resolve();
		} else {
			node.state = AsyncDataTreeNodeState.Loading;
			this._onDidChangeNodeState.fire(node);

			const slowTimeout = timeout(800);

			slowTimeout.then(() => {
				node.state = AsyncDataTreeNodeState.Slow;
				this._onDidChangeNodeState.fire(node);
			}, _ => null);

			return this.dataSource.getChildren(node.element)
				.then(children => {
					slowTimeout.cancel();
					node.state = AsyncDataTreeNodeState.Loaded;
					this._onDidChangeNodeState.fire(node);

					const createTreeElement = (element: T): ITreeElement<IAsyncDataTreeNode<T>> => {
						const collapsible = this.dataSource.hasChildren(element);

						return {
							element: {
								element: element,
								state: AsyncDataTreeNodeState.Uninitialized,
								parent: node
							},
							collapsible
						};
					};

					const nodeChildren = children.map<ITreeElement<IAsyncDataTreeNode<T>>>(createTreeElement);
					this.setChildren(node === this.root ? null : node, nodeChildren);
					this._onDidResolveChildren.fire({ element: node.element, reason });
				}, err => {
					slowTimeout.cancel();
					node.state = AsyncDataTreeNodeState.Uninitialized;
					this._onDidChangeNodeState.fire(node);

					if (node !== this.root) {
						this.tree.collapse(node);
					}

					return Promise.reject(err);
				});
		}
	}

	private _onDidChangeCollapseState(treeNode: ITreeNode<IAsyncDataTreeNode<T>, any>): void {
		if (!treeNode.collapsed && treeNode.element.state === AsyncDataTreeNodeState.Uninitialized) {
			this.refreshNode(treeNode.element, ChildrenResolutionReason.Expand);
		}
	}

	private setChildren(element: IAsyncDataTreeNode<T> | null, children?: ISequence<ITreeElement<IAsyncDataTreeNode<T>>>): void {
		const insertedElements = new Set<T>();

		const onDidCreateNode = (node: ITreeNode<IAsyncDataTreeNode<T>, TFilterData>) => {
			if (node.element.element) {
				insertedElements.add(node.element.element);
				this.nodes.set(node.element.element, node.element);
			}
		};

		const onDidDeleteNode = (node: ITreeNode<IAsyncDataTreeNode<T>, TFilterData>) => {
			if (node.element.element) {
				if (!insertedElements.has(node.element.element)) {
					this.nodes.delete(node.element.element);
				}
			}
		};

		this.tree.setChildren(element, children, onDidCreateNode, onDidDeleteNode);
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}
