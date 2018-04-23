/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Event, anyEvent, Emitter } from 'vs/base/common/event';
import { Orientation } from 'vs/base/browser/ui/sash/sash';
import { SplitView, IView } from 'vs/base/browser/ui/splitview/splitview';
import { empty as EmptyDisposable, IDisposable } from 'vs/base/common/lifecycle';
export { Orientation } from 'vs/base/browser/ui/sash/sash';

function orthogonal(orientation: Orientation): Orientation {
	return orientation === Orientation.VERTICAL ? Orientation.HORIZONTAL : Orientation.VERTICAL;
}

export interface IGrid {
	layout(width: number, height: number): void;
	addView(view: IView, size: number, location: number[]): void;
	removeView(location: number[]): void;
	moveView(from: number[], to: number[]): void;
	resizeView(location: number[], size: number): void;
	getViewSize(location: number[]): number;
	// getViews(): ITreeNode<T>[];
}

function tail<T>(arr: T[]): [T[], T] {
	return [arr.slice(0, arr.length - 1), arr[length - 1]];
}

abstract class AbstractNode implements IView {

	abstract minimumSize: number;
	abstract maximumSize: number;
	abstract onDidChange: Event<number>;
	abstract render(container: HTMLElement, orientation: Orientation): void;

	protected size: number | undefined;
	protected orthogonalSize: number | undefined;
	readonly orientation;

	layout(size: number): void {
		this.size = size;
	}

	orthogonalLayout(size: number): void {
		this.orthogonalSize = size;
	}
}

class BranchNode extends AbstractNode {

	private children: Node[] = [];
	private splitview: SplitView;

	get minimumSize(): number {
		let result = 0;

		for (const child of this.children) {
			if (!(child instanceof BranchNode)) {
				continue;
			}

			for (const grandchild of child.children) {
				result += grandchild.minimumSize;
			}
		}

		return result;
	}

	get maximumSize(): number {
		let result = 0;

		for (const child of this.children) {
			if (!(child instanceof BranchNode)) {
				continue;
			}

			for (const grandchild of child.children) {
				result += grandchild.maximumSize;
			}
		}

		return result;
	}

	get length(): number {
		return this.children.length;
	}

	private _onDidChange = new Emitter<number | undefined>();
	get onDidChange(): Event<number | undefined> { return this._onDidChange.event; }
	private _onDidChangeDisposable: IDisposable = EmptyDisposable;

	constructor(readonly orientation: Orientation) {
		super();
	}

	layout(size: number): void {
		super.layout(size);

		for (const child of this.children) {
			child.orthogonalLayout(size);
		}
	}

	orthogonalLayout(size: number): void {
		super.orthogonalLayout(size);
		this.splitview.layout(size);
	}

	render(container: HTMLElement): void {
		this.splitview = new SplitView(container, { orientation: this.orientation });
		this.layout(this.size);
		this.orthogonalLayout(this.orthogonalSize);
	}

	getChild(index: number): Node {
		return this.children[index];
	}

	addChild(node: Node, size: number, index: number): void {
		this.splitview.addView(node, size, index);
		this.children.splice(index, 0, node);
		this.onDidChildrenChange();
	}

	removeChild(index: number): Node {
		const child = this.children[index];
		this.splitview.removeView(index);
		this.children.splice(index, 1);
		this.onDidChildrenChange();
		return child;
	}

	private onDidChildrenChange(): void {
		const onDidChildrenChange = anyEvent(...this.children.map(c => c.onDidChange));
		this._onDidChangeDisposable.dispose();
		this._onDidChangeDisposable = onDidChildrenChange(this._onDidChange.fire, this._onDidChange);
	}
}

class LeafNode extends AbstractNode {

	constructor(private view: IView, readonly orientation: Orientation) {
		super();
	}

	get minimumSize(): number { return this.view.minimumSize; }
	get maximumSize(): number { return this.view.maximumSize; }
	get onDidChange(): Event<number> { return this.view.onDidChange; }

	render(container: HTMLElement, orientation: Orientation): void {
		return this.view.render(container, orientation);
	}

	layout(size: number): void {
		super.layout(size);
		return this.view.layout(size, this.orientation);
	}
}

type Node = BranchNode | LeafNode;

/**
 * Explanation:
 *
 * it appears at first that grid nodes should be treated as tree nodes,
 * but that's not the case.
 * the tree is composed of two types of nodes: branch nodes and leaf nodes!
 *
 *	  |	B						*---A
 *  A |---    =>		 \---*---B
 * 		| C								 \---C
 */

export class GridView {

	private root: BranchNode;

	constructor(container: HTMLElement) {
		this.root = new BranchNode(Orientation.VERTICAL);
		this.root.render(container);
	}

	addView(view: IView, size: number, location: number[]): void {
		const [rest, index] = tail(location);
		const [pathToParent, parent] = this.getNode(rest);
		const node = new LeafNode(view, orthogonal(parent.orientation));

		if (parent instanceof BranchNode) {
			parent.addChild(node, size, index);
		} else {
			// we must split!
			const [, grandParent] = tail(pathToParent);
			const [, parentIndex] = tail(rest);
			// 1. remove parent from grandparent
			grandParent.removeChild(parentIndex);
			// 2. convert parent to Branch Node
			const newParent = new BranchNode(parent.orientation);
			// 3. add parent to grandparent
			grandParent.addChild(newParent, 20, parentIndex);
			// 4. add node to parent
			newParent.addChild(node, size, index);
		}
	}

	removeView(location: number[]): void {
		const [rest, index] = tail(location);
		const [pathToParent, parent] = this.getNode(rest);

		if (!(parent instanceof BranchNode)) {
			throw new Error('Invalid location');
		}

		parent.removeChild(index);

		if (parent.length === 0) {
			throw new Error('Invalid grid state');
		}

		if (parent.length > 1) {
			return;
		}

		const [, grandParent] = tail(pathToParent);
		const [, parentIndex] = tail(rest);

		// parent only has one child
		// 0. remove sibling from parent
		const sibling = parent.removeChild(0);
		// 1. remove parent from grandParent
		grandParent.removeChild(parentIndex);
		// 2. add sibling to grandparent
		grandParent.addChild(sibling, 20, parentIndex);
	}

	layout(width: number, height: number): void {
		this.root.layout(width);
		this.root.orthogonalLayout(height);
	}

	private getNode(location: number[], node: Node = this.root, path: BranchNode[] = []): [BranchNode[], Node] {
		if (location.length === 0) {
			return [path, node];
		}

		if (!(node instanceof BranchNode)) {
			throw new Error('Invalid location');
		}

		const [index, ...rest] = location;
		const child = node.getChild(index);
		path.push(node);

		return this.getNode(rest, child, path);
	}
}