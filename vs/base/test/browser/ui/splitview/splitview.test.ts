/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter } from 'vs/base/common/event';
import { SplitView, IView, Orientation } from 'vs/base/browser/ui/splitview/splitview2';
import { Sash } from 'vs/base/browser/ui/sash/sash';

class TestView implements IView {

	private _onDidChange = new Emitter<void>();
	readonly onDidChange = this._onDidChange.event;

	get minimumSize(): number { return this._minimumSize; }
	set minimumSize(size: number) { this._minimumSize = size; this._onDidChange.fire(); }

	get maximumSize(): number { return this._maximumSize; }
	set maximumSize(size: number) { this._maximumSize = size; this._onDidChange.fire(); }

	private _onDidRender = new Emitter<{ container: HTMLElement; orientation: Orientation }>();
	readonly onDidRender = this._onDidRender.event;

	private _size = 0;
	get size(): number { return this._size; }
	private _onDidLayout = new Emitter<{ size: number; orientation: Orientation }>();
	readonly onDidLayout = this._onDidLayout.event;

	private _onDidFocus = new Emitter<void>();
	readonly onDidFocus = this._onDidFocus.event;

	constructor(
		private _minimumSize: number,
		private _maximumSize: number
	) {
		assert(_minimumSize <= _maximumSize, 'splitview view minimum size must be <= maximum size');
	}

	render(container: HTMLElement, orientation: Orientation): void {
		this._onDidRender.fire({ container, orientation });
	}

	layout(size: number, orientation: Orientation): void {
		this._size = size;
		this._onDidLayout.fire({ size, orientation });
	}

	focus(): void {
		this._onDidFocus.fire();
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._onDidRender.dispose();
		this._onDidLayout.dispose();
		this._onDidFocus.dispose();
	}
}

function getSashes(splitview: SplitView): Sash[] {
	return (splitview as any).sashItems.map(i => i.sash) as Sash[];
}

suite('Splitview', () => {
	let container: HTMLElement;

	setup(() => {
		container = document.createElement('div');
		container.style.position = 'absolute';
		container.style.width = `${200}px`;
		container.style.height = `${200}px`;
	});

	teardown(() => {
		container = null;
	});

	test('empty splitview has empty DOM', () => {
		const splitview = new SplitView(container);
		assert.equal(container.firstElementChild.childElementCount, 0, 'split view should be empty');
		splitview.dispose();
	});

	test('has views and sashes as children', () => {
		const view1 = new TestView(20, 20);
		const view2 = new TestView(20, 20);
		const view3 = new TestView(20, 20);
		const splitview = new SplitView(container);

		splitview.addView(view1, 20);
		splitview.addView(view2, 20);
		splitview.addView(view3, 20);

		let viewQuery = container.querySelectorAll('.monaco-split-view2 > .split-view-view');
		assert.equal(viewQuery.length, 3, 'split view should have 3 views');

		let sashQuery = container.querySelectorAll('.monaco-split-view2 > .monaco-sash');
		assert.equal(sashQuery.length, 2, 'split view should have 2 sashes');

		splitview.removeView(2);

		viewQuery = container.querySelectorAll('.monaco-split-view2 > .split-view-view');
		assert.equal(viewQuery.length, 2, 'split view should have 2 views');

		sashQuery = container.querySelectorAll('.monaco-split-view2 > .monaco-sash');
		assert.equal(sashQuery.length, 1, 'split view should have 1 sash');

		splitview.removeView(0);

		viewQuery = container.querySelectorAll('.monaco-split-view2 > .split-view-view');
		assert.equal(viewQuery.length, 1, 'split view should have 1 view');

		sashQuery = container.querySelectorAll('.monaco-split-view2 > .monaco-sash');
		assert.equal(sashQuery.length, 0, 'split view should have no sashes');

		splitview.removeView(0);

		viewQuery = container.querySelectorAll('.monaco-split-view2 > .split-view-view');
		assert.equal(viewQuery.length, 0, 'split view should have no views');

		sashQuery = container.querySelectorAll('.monaco-split-view2 > .monaco-sash');
		assert.equal(sashQuery.length, 0, 'split view should have no sashes');

		splitview.dispose();
		view1.dispose();
		view2.dispose();
		view3.dispose();
	});

	test('calls view methods on addView and removeView', () => {
		const view = new TestView(20, 20);
		const splitview = new SplitView(container);

		let didLayout = false;
		const layoutDisposable = view.onDidLayout(() => didLayout = true);

		let didRender = false;
		const renderDisposable = view.onDidRender(() => didRender = true);

		splitview.addView(view, 20);

		assert.equal(view.size, 20, 'view has right size');
		assert(didLayout, 'layout is called');
		assert(didLayout, 'render is called');

		splitview.dispose();
		layoutDisposable.dispose();
		renderDisposable.dispose();
		view.dispose();
	});

	test('stretches view to viewport', () => {
		const view = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view, 20);
		assert.equal(view.size, 200, 'view is stretched');

		splitview.layout(200);
		assert.equal(view.size, 200, 'view stayed the same');

		splitview.layout(100);
		assert.equal(view.size, 100, 'view is collapsed');

		splitview.layout(20);
		assert.equal(view.size, 20, 'view is collapsed');

		splitview.layout(10);
		assert.equal(view.size, 20, 'view is clamped');

		splitview.layout(200);
		assert.equal(view.size, 200, 'view is stretched');

		splitview.dispose();
		view.dispose();
	});

	test('can resize views', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, 20);
		splitview.addView(view2, 20);
		splitview.addView(view3, 20);

		assert.equal(view1.size, 160, 'view1 is stretched');
		assert.equal(view2.size, 20, 'view2 size is 20');
		assert.equal(view3.size, 20, 'view3 size is 20');

		splitview.resizeView(1, 40);

		assert.equal(view1.size, 140, 'view1 is collapsed');
		assert.equal(view2.size, 40, 'view2 is stretched');
		assert.equal(view3.size, 20, 'view3 stays the same');

		splitview.resizeView(0, 70);

		assert.equal(view1.size, 70, 'view1 is collapsed');
		assert.equal(view2.size, 110, 'view2 is expanded');
		assert.equal(view3.size, 20, 'view3 stays the same');

		splitview.resizeView(2, 40);

		assert.equal(view1.size, 70, 'view1 stays the same');
		assert.equal(view2.size, 90, 'view2 is collapsed');
		assert.equal(view3.size, 40, 'view3 is stretched');

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('reacts to view changes', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, 20);
		splitview.addView(view2, 20);
		splitview.addView(view3, 20);

		assert.equal(view1.size, 160, 'view1 is stretched');
		assert.equal(view2.size, 20, 'view2 size is 20');
		assert.equal(view3.size, 20, 'view3 size is 20');

		view1.maximumSize = 20;

		assert.equal(view1.size, 20, 'view1 is collapsed');
		assert.equal(view2.size, 20, 'view2 stays the same');
		assert.equal(view3.size, 160, 'view3 is stretched');

		view3.maximumSize = 40;

		assert.equal(view1.size, 20, 'view1 stays the same');
		assert.equal(view2.size, 140, 'view2 is stretched');
		assert.equal(view3.size, 40, 'view3 is collapsed');

		view2.maximumSize = 200;

		assert.equal(view1.size, 20, 'view1 stays the same');
		assert.equal(view2.size, 140, 'view2 stays the same');
		assert.equal(view3.size, 40, 'view3 stays the same');

		view3.maximumSize = Number.POSITIVE_INFINITY;
		view3.minimumSize = 100;

		assert.equal(view1.size, 20, 'view1 is collapsed');
		assert.equal(view2.size, 80, 'view2 is collapsed');
		assert.equal(view3.size, 100, 'view3 is stretched');

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('sashes are properly enabled/disabled', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, 20);
		splitview.addView(view2, 20);
		splitview.addView(view3, 20);

		let sashes = getSashes(splitview);
		assert.equal(sashes.length, 2, 'there are two sashes');
		assert.equal(sashes[0].enabled, true, 'first sash is enabled');
		assert.equal(sashes[1].enabled, true, 'second sash is enabled');

		splitview.layout(60);
		assert.equal(sashes[0].enabled, false, 'first sash is disabled');
		assert.equal(sashes[1].enabled, false, 'second sash is disabled');

		splitview.layout(20);
		assert.equal(sashes[0].enabled, false, 'first sash is disabled');
		assert.equal(sashes[1].enabled, false, 'second sash is disabled');

		splitview.layout(200);
		assert.equal(sashes[0].enabled, true, 'first sash is enabled');
		assert.equal(sashes[1].enabled, true, 'second sash is enabled');

		view1.maximumSize = 20;
		assert.equal(sashes[0].enabled, false, 'first sash is disabled');
		assert.equal(sashes[1].enabled, true, 'second sash is enabled');

		view2.maximumSize = 20;
		assert.equal(sashes[0].enabled, false, 'first sash is disabled');
		assert.equal(sashes[1].enabled, false, 'second sash is disabled');

		view1.maximumSize = 300;
		assert.equal(sashes[0].enabled, true, 'first sash is enabled');
		assert.equal(sashes[1].enabled, true, 'second sash is enabled');

		view2.maximumSize = 200;
		assert.equal(sashes[0].enabled, true, 'first sash is enabled');
		assert.equal(sashes[1].enabled, true, 'second sash is enabled');

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});
});