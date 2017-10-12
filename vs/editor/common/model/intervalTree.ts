/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

//
// The red-black tree is based on the "Introduction to Algorithms" by Cormen, Leiserson and Rivest.
//

export class Interval {
	_intervalBrand: void;

	public start: number;
	public end: number;

	constructor(start: number, end: number) {
		this.start = start;
		this.end = end;
	}

	public compareToRelative(otherStart: number, otherEnd: number): number {
		if (this.start === otherStart) {
			return this.end - otherEnd;
		}
		return this.start - otherStart;
	}
}

export const enum NodeColor {
	Red,
	Black
}

export class IntervalNode {

	public left: IntervalNode;
	public right: IntervalNode;
	public parent: IntervalNode;
	public color: NodeColor;

	public start: number;
	public end: number;
	public delta: number;
	public maxEnd: number;

	public resultInterval: Interval;

	constructor(start: number, end: number) {
		this.parent = null;
		this.left = null;
		this.right = null;
		this.color = NodeColor.Red;

		this.start = start;
		this.end = end;
		this.delta = start;
		this.maxEnd = end;

		this.resultInterval = new Interval(0, 0);
	}

	public detach(): void {
		this.parent = null;
		this.left = null;
		this.right = null;
	}
}

const SENTINEL: IntervalNode = new IntervalNode(0, 0);
SENTINEL.parent = SENTINEL;
SENTINEL.left = SENTINEL;
SENTINEL.right = SENTINEL;
SENTINEL.color = NodeColor.Black;

function leftRotate(T: IntervalTree, x: IntervalNode): void {
	const y = x.right;				// set y.

	y.delta += x.delta;				// y's delta is no longer influenced by x's delta
	y.start += x.delta;
	y.end += x.delta;

	x.right = y.left;				// turn y's left subtree into x's right subtree.
	if (y.left !== SENTINEL) {
		y.left.parent = x;
	}
	y.parent = x.parent;			// link x's parent to y.
	if (x.parent === SENTINEL) {
		T.root = y;
	} else if (x === x.parent.left) {
		x.parent.left = y;
	} else {
		x.parent.right = y;
	}

	y.left = x;						// put x on y's left.
	x.parent = y;

	recomputeMaxEnd(x);
	recomputeMaxEnd(y);
}

function rightRotate(T: IntervalTree, y: IntervalNode): void {
	const x = y.left;

	y.delta -= x.delta;
	y.start -= x.delta;
	y.end -= x.delta;

	y.left = x.right;
	if (x.right !== SENTINEL) {
		x.right.parent = y;
	}
	x.parent = y.parent;
	if (y.parent === SENTINEL) {
		T.root = x;
	} else if (y === y.parent.right) {
		y.parent.right = x;
	} else {
		y.parent.left = x;
	}

	x.right = y;
	y.parent = x;

	recomputeMaxEnd(y);
	recomputeMaxEnd(x);
}

function treeInsert(T: IntervalTree, interval: Interval): IntervalNode {
	let delta: number = 0;
	let z = SENTINEL;
	let x = T.root;
	while (true) {
		let cmp = interval.compareToRelative(x.start + delta, x.end + delta);
		if (cmp < 0) {
			// this node should be inserted to the left
			// => it is not affected by the node's delta
			if (x.left === SENTINEL) {
				z = new IntervalNode(interval.start - delta, interval.end - delta);
				x.left = z;
				break;
			} else {
				x = x.left;
			}
		} else {
			// this node should be inserted to the right
			// => it is not affected by the node's delta
			if (x.right === SENTINEL) {
				z = new IntervalNode(interval.start - delta - x.delta, interval.end - delta - x.delta);
				x.right = z;
				break;
			} else {
				delta += x.delta;
				x = x.right;
			}
		}
	}

	z.parent = x;
	z.left = SENTINEL;
	z.right = SENTINEL;
	z.color = NodeColor.Red;
	return z;
}

function leftest(node: IntervalNode): IntervalNode {
	while (node.left !== SENTINEL) {
		node = node.left;
	}
	return node;
}

function resetSentinel(): void {
	SENTINEL.parent = SENTINEL;
	SENTINEL.delta = 0; // optional
	SENTINEL.start = 0; // optional
	SENTINEL.end = 0; // optional
}

function computeMaxEnd(node: IntervalNode): number {
	let maxEnd = node.end;
	if (node.left !== SENTINEL) {
		const leftMaxEnd = node.left.maxEnd;
		if (leftMaxEnd > maxEnd) {
			maxEnd = leftMaxEnd;
		}
	}
	if (node.right !== SENTINEL) {
		const rightMaxEnd = node.right.maxEnd + node.delta;
		if (rightMaxEnd > maxEnd) {
			maxEnd = rightMaxEnd;
		}
	}
	return maxEnd;
}

function recomputeMaxEnd(node: IntervalNode): void {
	node.maxEnd = computeMaxEnd(node);
}

function recomputeMaxEndToRoot(node: IntervalNode): void {
	while (node !== SENTINEL) {

		const maxEnd = computeMaxEnd(node);

		if (node.maxEnd === maxEnd) {
			// no need to go further
			return;
		}

		node.maxEnd = maxEnd;
		node = node.parent;
	}
}

function treeDelete(T: IntervalTree, z: IntervalNode): void {

	let x: IntervalNode;
	let y: IntervalNode;

	// RB-DELETE except we don't swap z and y in case c)
	// i.e. we always delete what's pointed at by z.

	if (z.left === SENTINEL) {
		x = z.right;
		y = z;

		// x's delta is no longer influenced by z's delta
		x.delta += z.delta;
		x.start += z.delta;
		x.end += z.delta;

	} else if (z.right === SENTINEL) {
		x = z.left;
		y = z;

	} else {
		y = leftest(z.right);
		x = y.right;

		// y's delta is no longer influenced by z's delta,
		// but we don't want to walk the entire right-hand-side subtree of x.
		// we therefore maintain z's delta in y, and adjust only x
		x.start += y.delta;
		x.end += y.delta;
		x.delta += y.delta;

		y.start += z.delta;
		y.end += z.delta;
		y.delta = z.delta;
	}

	if (y === T.root) {
		T.root = x;
		x.color = NodeColor.Black;

		z.detach();
		resetSentinel();
		recomputeMaxEnd(x);
		return;
	}

	let yWasRed = (y.color === NodeColor.Red);

	if (y === y.parent.left) {
		y.parent.left = x;
	} else {
		y.parent.right = x;
	}

	if (y === z) {
		x.parent = y.parent;
	} else {

		if (y.parent === z) {
			x.parent = y;
		} else {
			x.parent = y.parent;
		}

		y.left = z.left;
		y.right = z.right;
		y.parent = z.parent;
		y.color = z.color;

		if (z === T.root) {
			T.root = y;
		} else {
			if (z === z.parent.left) {
				z.parent.left = y;
			} else {
				z.parent.right = y;
			}
		}

		if (y.left !== SENTINEL) {
			y.left.parent = y;
		}
		if (y.right !== SENTINEL) {
			y.right.parent = y;
		}
	}

	z.detach();

	if (yWasRed) {
		recomputeMaxEndToRoot(x.parent);
		if (y !== z) {
			recomputeMaxEndToRoot(y);
			recomputeMaxEndToRoot(y.parent);
		}
		resetSentinel();
		return;
	}

	recomputeMaxEndToRoot(x);
	recomputeMaxEndToRoot(x.parent);
	if (y !== z) {
		recomputeMaxEndToRoot(y);
		recomputeMaxEndToRoot(y.parent);
	}

	// RB-DELETE-FIXUP
	let w: IntervalNode;
	while (x !== T.root && x.color === NodeColor.Black) {

		if (x === x.parent.left) {
			w = x.parent.right;

			if (w.color === NodeColor.Red) {
				w.color = NodeColor.Black;
				x.parent.color = NodeColor.Red;
				leftRotate(T, x.parent);
				w = x.parent.right;
			}

			if (w.left.color === NodeColor.Black && w.right.color === NodeColor.Black) {
				w.color = NodeColor.Red;
				x = x.parent;
			} else {
				if (w.right.color === NodeColor.Black) {
					w.left.color = NodeColor.Black;
					w.color = NodeColor.Red;
					rightRotate(T, w);
					w = x.parent.right;
				}

				w.color = x.parent.color;
				x.parent.color = NodeColor.Black;
				w.right.color = NodeColor.Black;
				leftRotate(T, x.parent);
				x = T.root;
			}

		} else {
			w = x.parent.left;

			if (w.color === NodeColor.Red) {
				w.color = NodeColor.Black;
				x.parent.color = NodeColor.Red;
				rightRotate(T, x.parent);
				w = x.parent.left;
			}

			if (w.left.color === NodeColor.Black && w.right.color === NodeColor.Black) {
				w.color = NodeColor.Red;
				x = x.parent;

			} else {
				if (w.left.color === NodeColor.Black) {
					w.right.color = NodeColor.Black;
					w.color = NodeColor.Red;
					leftRotate(T, w);
					w = x.parent.left;
				}

				w.color = x.parent.color;
				x.parent.color = NodeColor.Black;
				w.left.color = NodeColor.Black;
				rightRotate(T, x.parent);
				x = T.root;
			}
		}
	}

	x.color = NodeColor.Black;
	resetSentinel();
}

export class IntervalTree {

	public root: IntervalNode;

	constructor() {
		this.root = SENTINEL;
	}

	public intervalSearch(interval: Interval): IntervalNode[] {
		let result: IntervalNode[] = [];
		if (this.root !== SENTINEL) {
			this._intervalSearch(this.root, 0, interval.start, interval.end, result);
		}
		return result;
	}

	private _intervalSearch(node: IntervalNode, delta: number, intervalStart: number, intervalEnd: number, result: IntervalNode[]): void {
		// https://en.wikipedia.org/wiki/Interval_tree#Augmented_tree
		// Now, it is known that two intervals A and B overlap only when both
		// A.low <= B.high and A.high >= B.low. When searching the trees for
		// nodes overlapping with a given interval, you can immediately skip:
		//  a) all nodes to the right of nodes whose low value is past the end of the given interval.
		//  b) all nodes that have their maximum 'high' value below the start of the given interval.

		const nodeMaxEnd = delta + node.maxEnd;
		if (nodeMaxEnd < intervalStart) {
			// Cover b) from above
			return;
		}

		if (node.left !== SENTINEL) {
			this._intervalSearch(node.left, delta, intervalStart, intervalEnd, result);
		}

		const nodeStart = delta + node.start;

		if (nodeStart > intervalEnd) {
			// Cover a) from above
			return;
		}

		const nodeEnd = delta + node.end;
		if (nodeEnd >= intervalStart) {
			// There is overlap
			node.resultInterval.start = nodeStart;
			node.resultInterval.end = nodeEnd;
			result.push(node);
		}

		if (node.right !== SENTINEL) {
			this._intervalSearch(node.right, delta + node.delta, intervalStart, intervalEnd, result);
		}
	}

	public insert(interval: Interval): IntervalNode {
		if (this.root === SENTINEL) {
			const newNode = new IntervalNode(interval.start, interval.end);
			newNode.parent = SENTINEL;
			newNode.left = SENTINEL;
			newNode.right = SENTINEL;
			newNode.color = NodeColor.Black;
			this.root = newNode;
			return this.root;
		}

		const newNode = treeInsert(this, interval);

		recomputeMaxEndToRoot(newNode.parent);

		// repair tree
		let x = newNode;
		while (x !== this.root && x.parent.color === NodeColor.Red) {
			if (x.parent === x.parent.parent.left) {
				const y = x.parent.parent.right;

				if (y.color === NodeColor.Red) {
					x.parent.color = NodeColor.Black;
					y.color = NodeColor.Black;
					x.parent.parent.color = NodeColor.Red;
					x = x.parent.parent;
				} else {
					if (x === x.parent.right) {
						x = x.parent;
						leftRotate(this, x);
					}
					x.parent.color = NodeColor.Black;
					x.parent.parent.color = NodeColor.Red;
					rightRotate(this, x.parent.parent);
				}
			} else {
				const y = x.parent.parent.left;

				if (y.color === NodeColor.Red) {
					x.parent.color = NodeColor.Black;
					y.color = NodeColor.Black;
					x.parent.parent.color = NodeColor.Red;
					x = x.parent.parent;
				} else {
					if (x === x.parent.left) {
						x = x.parent;
						rightRotate(this, x);
					}
					x.parent.color = NodeColor.Black;
					x.parent.parent.color = NodeColor.Red;
					leftRotate(this, x.parent.parent);
				}
			}
		}

		this.root.color = NodeColor.Black;

		return newNode;
	}

	public delete(node: IntervalNode) {
		treeDelete(this, node);
	}

	public assertInvariants(): void {
		assert(SENTINEL.color === NodeColor.Black);
		assert(SENTINEL.parent === SENTINEL);
		assert(SENTINEL.left === SENTINEL);
		assert(SENTINEL.right === SENTINEL);
		assert(SENTINEL.start === 0);
		assert(SENTINEL.end === 0);
		assert(SENTINEL.delta === 0);
		assertValidTree(this);
	}

	public getAllInOrder(): Interval[] {
		let r: Interval[] = [], rLength = 0;
		this.visitInOrder((n, delta) => {
			r[rLength++] = new Interval(n.start + delta, n.end + delta);
		});
		return r;
	}

	public visitInOrder(visitor: (n: IntervalNode, delta: number) => void): void {
		this._visitInOrder(this.root, 0, visitor);
	}

	private _visitInOrder(n: IntervalNode, delta: number, visitor: (n: IntervalNode, delta: number) => void): void {
		if (n.left !== SENTINEL) {
			this._visitInOrder(n.left, delta, visitor);
		}

		if (n !== SENTINEL) {
			visitor(n, delta);
		}

		if (n.right !== SENTINEL) {
			this._visitInOrder(n.right, delta + n.delta, visitor);
		}
	}

	public print(): void {
		let out: string[] = [];
		this._print(this.root, '', 0, out);
		console.log(out.join(''));
	}

	private _print(n: IntervalNode, indent: string, delta: number, out: string[]): void {
		out.push(`${indent}[${n.color === NodeColor.Red ? 'R' : 'B'},${n.delta}, ${n.start}->${n.end}, ${n.maxEnd}] : {${delta + n.start}->${delta + n.end}}, maxEnd: ${n.maxEnd + delta}\n`);
		if (n.left !== SENTINEL) {
			this._print(n.left, indent + '    ', delta, out);
		} else {
			out.push(`${indent}    NIL\n`);
		}
		if (n.right !== SENTINEL) {
			this._print(n.right, indent + '    ', delta + n.delta, out);
		} else {
			out.push(`${indent}    NIL\n`);
		}
	}
}

function depth(n: IntervalNode): number {
	if (n === SENTINEL) {
		// The leafs are black
		return 1;
	}
	assert(depth(n.left) === depth(n.right));
	return (n.color === NodeColor.Black ? 1 : 0) + depth(n.left);
}

function assertValidNode(n: IntervalNode, delta): void {
	if (n === SENTINEL) {
		return;
	}

	let l = n.left;
	let r = n.right;

	if (n.color === NodeColor.Red) {
		if (l.color !== NodeColor.Black) {
			assert(false);
		}
		if (r.color !== NodeColor.Black) {
			assert(false);
		}
	}

	let expectedMaxEnd = n.end;
	if (l !== SENTINEL) {
		const lValue = new Interval(l.start + delta, l.end + delta);
		assert(lValue.compareToRelative(n.start + delta, n.end + delta) <= 0);
		expectedMaxEnd = Math.max(expectedMaxEnd, l.maxEnd);
	}
	if (r !== SENTINEL) {
		const nValue = new Interval(n.start + delta, n.end + delta);
		assert(nValue.compareToRelative(r.start + delta + n.delta, r.end + delta + n.delta) <= 0);
		expectedMaxEnd = Math.max(expectedMaxEnd, r.maxEnd + n.delta);
	}
	assert(n.maxEnd === expectedMaxEnd);

	assertValidNode(l, delta);
	assertValidNode(r, delta + n.delta);
}

function assertValidTree(tree: IntervalTree): void {
	if (tree.root === SENTINEL) {
		return;
	}
	if (tree.root.color !== NodeColor.Black) {
		assert(false);
	}
	if (depth(tree.root.left) !== depth(tree.root.right)) {
		assert(false);
	}
	assertValidNode(tree.root, 0);
}

function assert(condition: boolean): void {
	if (!condition) {
		throw new Error('Assertion violation');
	}
}
