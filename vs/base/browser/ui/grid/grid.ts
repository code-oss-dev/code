/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./gridview';
import { Orientation } from 'vs/base/browser/ui/sash/sash';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { tail2 as tail } from 'vs/base/common/arrays';
import { orthogonal, IView, GridView, Sizing as GridViewSizing } from './gridview';

export { Orientation } from './gridview';

export enum Direction {
	Up,
	Down,
	Left,
	Right
}

function oppositeDirection(direction: Direction): Direction {
	switch (direction) {
		case Direction.Up: return Direction.Down;
		case Direction.Down: return Direction.Up;
		case Direction.Left: return Direction.Right;
		case Direction.Right: return Direction.Left;
	}
}

export interface GridLeafNode<T extends IView> {
	readonly view: T;
	readonly size: number;
}

export interface GridBranchNode<T extends IView> {
	readonly children: GridNode<T>[];
	readonly size: number;
}

export type GridNode<T extends IView> = GridLeafNode<T> | GridBranchNode<T>;

export function isGridBranchNode<T extends IView>(node: GridNode<T>): node is GridBranchNode<T> {
	return !!(node as any).children;
}

interface Box {
	top: number;
	left: number;
	width: number;
	height: number;
}

interface BoxLeafNode<T extends IView> {
	readonly node: GridLeafNode<T>;
	readonly box: Box;
}

interface BoxBranchNode<T extends IView> {
	readonly children: BoxNode<T>[];
	readonly box: Box;
}

type BoxNode<T extends IView> = BoxLeafNode<T> | BoxBranchNode<T>;

function isBoxBranchNode<T extends IView>(node: BoxNode<T>): node is BoxBranchNode<T> {
	return !!(node as any).children;
}

function toBoxNode<T extends IView>(node: GridNode<T>, orientation: Orientation, box: Box): BoxNode<T> {
	if (!isGridBranchNode(node)) {
		return { node, box };
	}

	const children: BoxNode<T>[] = [];
	let offset = 0;

	for (let i = 0; i < node.children.length; i++) {
		const child = node.children[i];
		const childOrientation = orthogonal(orientation);
		const childBox: Box = orientation === Orientation.HORIZONTAL
			? { top: box.top, left: box.left + offset, width: child.size, height: box.height }
			: { top: box.top + offset, left: box.left, width: box.width, height: child.size };

		children.push(toBoxNode(child, childOrientation, childBox));
		offset += child.size;
	}

	return { children, box };
}

function getBoxNode<T extends IView>(node: BoxNode<T>, location: number[]): BoxNode<T> {
	if (location.length === 0) {
		return node;
	}

	if (!isBoxBranchNode(node)) {
		throw new Error('Invalid location');
	}

	const [index, ...rest] = location;
	return getBoxNode(node.children[index], rest);
}

interface Range {
	readonly start: number;
	readonly end: number;
}

function intersects(one: Range, other: Range): boolean {
	return !(one.start >= other.end || other.start >= one.end);
}

interface Boundary {
	readonly offset: number;
	readonly range: Range;
}

function getBoxBoundary(box: Box, direction: Direction): Boundary {
	const orientation = getDirectionOrientation(direction);
	const offset = direction === Direction.Up ? box.top :
		direction === Direction.Right ? box.left + box.width :
			direction === Direction.Down ? box.top + box.height :
				box.left;

	const range = {
		start: orientation === Orientation.HORIZONTAL ? box.top : box.left,
		end: orientation === Orientation.HORIZONTAL ? box.top + box.height : box.left + box.width
	};

	return { offset, range };
}

function findAdjacentBoxLeafNodes<T extends IView>(boxNode: BoxNode<T>, direction: Direction, boundary: Boundary): BoxLeafNode<T>[] {
	const result: BoxLeafNode<T>[] = [];

	function _(boxNode: BoxNode<T>, direction: Direction, boundary: Boundary): void {
		if (isBoxBranchNode(boxNode)) {
			for (const child of boxNode.children) {
				_(child, direction, boundary);
			}
		} else {
			const { offset, range } = getBoxBoundary(boxNode.box, direction);

			if (offset === boundary.offset && intersects(range, boundary.range)) {
				result.push(boxNode);
			}
		}
	}

	_(boxNode, direction, boundary);
	return result;
}

function getLocationOrientation(rootOrientation: Orientation, location: number[]): Orientation {
	return location.length % 2 === 0 ? orthogonal(rootOrientation) : rootOrientation;
}

function getDirectionOrientation(direction: Direction): Orientation {
	return direction === Direction.Up || direction === Direction.Down ? Orientation.VERTICAL : Orientation.HORIZONTAL;
}

function getSize(dimensions: { width: number; height: number; }, orientation: Orientation) {
	return orientation === Orientation.HORIZONTAL ? dimensions.width : dimensions.height;
}

export function getRelativeLocation(rootOrientation: Orientation, location: number[], direction: Direction): number[] {
	const orientation = getLocationOrientation(rootOrientation, location);
	const directionOrientation = getDirectionOrientation(direction);

	if (orientation === directionOrientation) {
		let [rest, index] = tail(location);

		if (direction === Direction.Right || direction === Direction.Down) {
			index += 1;
		}

		return [...rest, index];
	} else {
		const index = (direction === Direction.Right || direction === Direction.Down) ? 1 : 0;
		return [...location, index];
	}
}

function indexInParent(element: HTMLElement): number {
	const parentElement = element.parentElement;
	let el = parentElement.firstElementChild;
	let index = 0;

	while (el !== element && el !== parentElement.lastElementChild) {
		el = el.nextElementSibling;
		index++;
	}

	return index;
}

/**
 * Find the grid location of a specific DOM element by traversing the parent
 * chain and finding each child index on the way.
 *
 * This will break as soon as DOM structures of the Splitview or Gridview change.
 */
function getGridLocation(element: HTMLElement): number[] {
	if (/\bmonaco-grid-view\b/.test(element.parentElement.className)) {
		return [];
	}

	const index = indexInParent(element.parentElement);
	const ancestor = element.parentElement.parentElement.parentElement.parentElement;
	return [...getGridLocation(ancestor), index];
}

export enum Sizing {
	Distribute = 'distribute',
	Split = 'split'
}

export class Grid<T extends IView> implements IDisposable {

	protected gridview: GridView;
	private views = new Map<T, HTMLElement>();
	private disposables: IDisposable[] = [];

	get orientation(): Orientation { return this.gridview.orientation; }
	set orientation(orientation: Orientation) { this.gridview.orientation = orientation; }

	get width(): number { return this.gridview.width; }
	get height(): number { return this.gridview.height; }

	get minimumWidth(): number { return this.gridview.minimumWidth; }
	get minimumHeight(): number { return this.gridview.minimumHeight; }

	get maximumWidth(): number { return this.gridview.maximumWidth; }
	get maximumHeight(): number { return this.gridview.maximumHeight; }

	public sashResetSizing: Sizing = Sizing.Distribute;

	constructor(container: HTMLElement, view: T) {
		this.gridview = new GridView(container);
		this.disposables.push(this.gridview);

		this.gridview.onDidSashReset(this.doResetViewSize, this, this.disposables);

		this._addView(view, 0, [0]);
	}

	layout(width: number, height: number): void {
		this.gridview.layout(width, height);
	}

	addView(newView: T, size: number | Sizing, referenceView: T, direction: Direction): void {
		if (this.views.has(newView)) {
			throw new Error('Can\'t add same view twice');
		}

		const orientation = getDirectionOrientation(direction);

		if (this.views.size === 1 && this.orientation !== orientation) {
			this.orientation = orientation;
		}

		const referenceLocation = this.getViewLocation(referenceView);
		const location = getRelativeLocation(this.gridview.orientation, referenceLocation, direction);

		let viewSize: number | GridViewSizing;

		if (size === Sizing.Split) {
			const [, index] = tail(referenceLocation);
			viewSize = GridViewSizing.Split(index);
		} else if (size === Sizing.Distribute) {
			viewSize = GridViewSizing.Distribute;
		} else {
			viewSize = size;
		}

		this._addView(newView, viewSize, location);
	}

	protected _addView(newView: T, size: number | GridViewSizing, location): void {
		this.views.set(newView, newView.element);
		this.gridview.addView(newView, size, location);
	}

	removeView(view: T, sizing?: Sizing): void {
		if (this.views.size === 1) {
			throw new Error('Can\'t remove last view');
		}

		if (!this.views.has(view)) {
			throw new Error('View not found');
		}

		const location = this.getViewLocation(view);
		this.gridview.removeView(location, sizing === Sizing.Distribute ? GridViewSizing.Distribute : undefined);
		this.views.delete(view);
	}

	swapViews(from: T, to: T): void {
		const fromLocation = this.getViewLocation(from);
		const toLocation = this.getViewLocation(to);
		return this.gridview.swapViews(fromLocation, toLocation);
	}

	resizeView(view: T, size: number): void {
		const location = this.getViewLocation(view);
		return this.gridview.resizeView(location, size);
	}

	getViewSize(view: T): number {
		const location = this.getViewLocation(view);
		const viewSize = this.gridview.getViewSize(location);

		return getLocationOrientation(this.orientation, location) === Orientation.HORIZONTAL ? viewSize.width : viewSize.height;
	}

	getViews(): GridBranchNode<T> {
		return this.gridview.getViews() as GridBranchNode<T>;
	}

	getOrientation(view: T): Orientation {
		const location = this.getViewLocation(view);

		return getLocationOrientation(this.orientation, location);
	}

	resetViewSize(view: T): void {
		const location = this.getViewLocation(view);

		this.doResetViewSize(location);
	}

	getNeighborViews(view: T, direction: Direction, wrap: boolean = false): T[] {
		const location = this.getViewLocation(view);
		const root = this.getViews();
		const boxRoot = toBoxNode(root, this.orientation, { top: 0, left: 0, width: this.width, height: this.height });
		const boxNode = getBoxNode(boxRoot, location);
		let boundary = getBoxBoundary(boxNode.box, direction);

		if (wrap) {
			if (direction === Direction.Up && boxNode.box.top === 0) {
				boundary = { offset: boxRoot.box.top + boxRoot.box.height, range: boundary.range };
			} else if (direction === Direction.Right && boxNode.box.left + boxNode.box.width === boxRoot.box.width) {
				boundary = { offset: 0, range: boundary.range };
			} else if (direction === Direction.Down && boxNode.box.top + boxNode.box.height === boxRoot.box.height) {
				boundary = { offset: 0, range: boundary.range };
			} else if (direction === Direction.Left && boxNode.box.left === 0) {
				boundary = { offset: boxRoot.box.left + boxRoot.box.width, range: boundary.range };
			}
		}

		return findAdjacentBoxLeafNodes(boxRoot, oppositeDirection(direction), boundary)
			.map(boxNode => boxNode.node.view);
	}

	private getViewLocation(view: T): number[] {
		const element = this.views.get(view);

		if (!element) {
			throw new Error('View not found');
		}

		return getGridLocation(element);
	}

	private doResetViewSize(location: number[]): void {
		if (this.sashResetSizing === Sizing.Split) {
			const orientation = getLocationOrientation(this.orientation, location);
			const firstViewSize = getSize(this.gridview.getViewSize(location), orientation);
			const [parentLocation, index] = tail(location);
			const secondViewSize = getSize(this.gridview.getViewSize([...parentLocation, index + 1]), orientation);
			const totalSize = firstViewSize + secondViewSize;
			this.gridview.resizeView(location, Math.floor(totalSize / 2));

		} else {
			const [parentLocation,] = tail(location);
			this.gridview.distributeViewSizes(parentLocation);
		}
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}

export interface ISerializableView extends IView {
	toJSON(): object;
}

export interface IViewDeserializer<T extends ISerializableView> {
	fromJSON(json: object): T;
}

interface InitialLayoutContext<T extends ISerializableView> {
	width: number;
	height: number;
	root: GridBranchNode<T>;
}

export interface ISerializedNode {
	type: 'branch' | 'leaf';
	data: ISerializedNode[] | object;
	size: number;
}

export interface ISerializedGrid {
	root: ISerializedNode;
	orientation: Orientation;
	width: number;
	height: number;
}

export class SerializableGrid<T extends ISerializableView> extends Grid<T> {

	private static serializeNode<T extends ISerializableView>(node: GridNode<T>): ISerializedNode {
		if (isGridBranchNode(node)) {
			return { type: 'branch', data: node.children.map(c => SerializableGrid.serializeNode(c)), size: node.size };
		} else {
			return { type: 'leaf', data: node.view.toJSON(), size: node.size };
		}
	}

	private static deserializeNode<T extends ISerializableView>(json: ISerializedNode, deserializer: IViewDeserializer<T>): GridNode<T> {
		if (!json || typeof json !== 'object') {
			throw new Error('Invalid JSON');
		}

		const type = json.type;
		const data = json.data;

		if (type === 'branch') {
			if (!Array.isArray(data)) {
				throw new Error('Invalid JSON: \'data\' property of branch must be an array.');
			} else if (typeof json.size !== 'number') {
				throw new Error('Invalid JSON: \'size\' property of branch must be a number.');
			}

			const nodes = data as ISerializedNode[];
			const children = nodes.map(c => SerializableGrid.deserializeNode(c, deserializer));
			const size = json.size as number;

			return { children, size };

		} else if (type === 'leaf') {
			if (typeof json.size !== 'number') {
				throw new Error('Invalid JSON: \'size\' property of leaf must be a number.');
			}

			const view = deserializer.fromJSON(data) as T;
			const size = json.size as number;

			return { view, size };
		}

		throw new Error('Invalid JSON: \'type\' property must be either \'branch\' or \'leaf\'.');
	}

	private static getFirstLeaf<T extends IView>(node: GridNode<T>): GridLeafNode<T> | undefined {
		if (!isGridBranchNode(node)) {
			return node;
		}

		return SerializableGrid.getFirstLeaf(node.children[0]);
	}

	static deserialize<T extends ISerializableView>(container: HTMLElement, json: ISerializedGrid, deserializer: IViewDeserializer<T>): SerializableGrid<T> {
		if (typeof json.orientation !== 'number') {
			throw new Error('Invalid JSON: \'orientation\' property must be a number.');
		} else if (typeof json.width !== 'number') {
			throw new Error('Invalid JSON: \'width\' property must be a number.');
		} else if (typeof json.height !== 'number') {
			throw new Error('Invalid JSON: \'height\' property must be a number.');
		}

		const root = SerializableGrid.deserializeNode(json.root, deserializer) as GridBranchNode<T>;
		const firstLeaf = SerializableGrid.getFirstLeaf(root);

		if (!firstLeaf) {
			throw new Error('Invalid serialized state, first leaf not found');
		}

		const orientation = json.orientation as Orientation;
		const width = json.width as number;
		const height = json.height as number;

		const result = new SerializableGrid<T>(container, firstLeaf.view);
		result.orientation = orientation;
		result.restoreViews(firstLeaf.view, orientation, root);
		result.initialLayoutContext = { width, height, root };

		return result;
	}

	/**
	 * Useful information in order to proportionally restore view sizes
	 * upon the very first layout call.
	 */
	private initialLayoutContext: InitialLayoutContext<T> | undefined;

	serialize(): ISerializedGrid {
		return {
			root: SerializableGrid.serializeNode(this.getViews()),
			orientation: this.orientation,
			width: this.width,
			height: this.height
		};
	}

	layout(width: number, height: number): void {
		super.layout(width, height);

		if (this.initialLayoutContext) {
			const widthScale = width / this.initialLayoutContext.width;
			const heightScale = height / this.initialLayoutContext.height;

			this.restoreViewsSize([], this.initialLayoutContext.root, this.orientation, widthScale, heightScale);
			this.initialLayoutContext = undefined;
		}
	}

	/**
	 * Recursively restores views which were just deserialized.
	 */
	private restoreViews(referenceView: T, orientation: Orientation, node: GridNode<T>): void {
		if (!isGridBranchNode(node)) {
			return;
		}

		const direction = orientation === Orientation.VERTICAL ? Direction.Down : Direction.Right;
		const firstLeaves = node.children.map(c => SerializableGrid.getFirstLeaf(c));

		for (let i = 1; i < firstLeaves.length; i++) {
			this.addView(firstLeaves[i].view, firstLeaves[i].size, referenceView, direction);
			referenceView = firstLeaves[i].view;
		}

		for (let i = 0; i < node.children.length; i++) {
			this.restoreViews(firstLeaves[i].view, orthogonal(orientation), node.children[i]);
		}
	}

	/**
	 * Recursively restores view sizes.
	 * This should be called only after the very first layout call.
	 */
	private restoreViewsSize(location: number[], node: GridNode<T>, orientation: Orientation, widthScale: number, heightScale: number): void {
		if (!isGridBranchNode(node)) {
			return;
		}

		const scale = orientation === Orientation.VERTICAL ? heightScale : widthScale;

		for (let i = 0; i < node.children.length; i++) {
			const child = node.children[i];
			const childLocation = [...location, i];

			if (i < node.children.length - 1) {
				this.gridview.resizeView(childLocation, Math.floor(child.size * scale));
			}

			this.restoreViewsSize(childLocation, child, orthogonal(orientation), widthScale, heightScale);
		}
	}
}