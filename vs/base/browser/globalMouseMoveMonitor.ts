/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as DomUtils from 'vs/base/browser/dom';
import {IDisposable, disposeAll} from 'vs/base/common/lifecycle';
import {StandardMouseEvent} from 'vs/base/browser/mouseEvent';
import {IframeUtils} from 'vs/base/browser/iframe';

export interface IStandardMouseMoveEventData {
	leftButton:boolean;
	posx:number;
	posy:number;
}

export interface IEventMerger<R> {
	(lastEvent:R, currentEvent:MouseEvent):R;
}

export interface IMouseMoveCallback<R> {
	(mouseMoveData:R):void;
}

export interface IOnStopCallback {
	():void;
}

export function standardMouseMoveMerger(lastEvent:IStandardMouseMoveEventData, currentEvent:MouseEvent):IStandardMouseMoveEventData {
	let ev = new StandardMouseEvent(currentEvent);
	ev.preventDefault();
	return {
		leftButton: ev.leftButton,
		posx: ev.posx,
		posy: ev.posy
	};
}

export class GlobalMouseMoveMonitor<R> implements IDisposable {

	private hooks:IDisposable[];
	private mouseMoveEventMerger:IEventMerger<R>;
	private mouseMoveCallback:IMouseMoveCallback<R>;
	private onStopCallback:IOnStopCallback;

	constructor() {
		this.hooks = [];
		this.mouseMoveEventMerger = null;
		this.mouseMoveCallback = null;
		this.onStopCallback = null;
	}

	public dispose(): void {
		this.stopMonitoring(false);
	}

	public stopMonitoring(invokeStopCallback:boolean): void {
		if (!this.isMonitoring()) {
			// Not monitoring
			return;
		}

		// Unhook
		this.hooks = disposeAll(this.hooks);
		this.mouseMoveEventMerger = null;
		this.mouseMoveCallback = null;
		let onStopCallback = this.onStopCallback;
		this.onStopCallback = null;

		if (invokeStopCallback) {
			onStopCallback();
		}
	}

	public isMonitoring() {
		return this.hooks.length > 0;
	}

	public startMonitoring(
				mouseMoveEventMerger:IEventMerger<R>,
				mouseMoveCallback:IMouseMoveCallback<R>,
				onStopCallback:IOnStopCallback
			): void {
		if (this.isMonitoring()) {
			// I am already hooked
			return;
		}
		this.mouseMoveEventMerger = mouseMoveEventMerger;
		this.mouseMoveCallback = mouseMoveCallback;
		this.onStopCallback = onStopCallback;

		let windowChain = IframeUtils.getSameOriginWindowChain();
		for (let i = 0; i < windowChain.length; i++) {
			this.hooks.push(DomUtils.addDisposableThrottledListener(windowChain[i].window.document, 'mousemove',
				(data:R) => this.mouseMoveCallback(data),
				(lastEvent:R, currentEvent:MouseEvent) => this.mouseMoveEventMerger(lastEvent, currentEvent)
			));
			this.hooks.push(DomUtils.addDisposableListener(windowChain[i].window.document, 'mouseup', (e:MouseEvent) => this.stopMonitoring(true)));
		}

		if (IframeUtils.hasDifferentOriginAncestor()) {
			let lastSameOriginAncestor = windowChain[windowChain.length - 1];
			// We might miss a mouse up if it happens outside the iframe
			// This one is for Chrome
			this.hooks.push(DomUtils.addDisposableListener(lastSameOriginAncestor.window.document, 'mouseout', (browserEvent:MouseEvent) => {
				let e = new StandardMouseEvent(browserEvent);
				if (e.target.tagName.toLowerCase() === 'html') {
					this.stopMonitoring(true);
				}
			}));
			// This one is for FF
			this.hooks.push(DomUtils.addDisposableListener(lastSameOriginAncestor.window.document, 'mouseover', (browserEvent:MouseEvent) => {
				let e = new StandardMouseEvent(browserEvent);
				if (e.target.tagName.toLowerCase() === 'html') {
					this.stopMonitoring(true);
				}
			}));
			// This one is for IE
			this.hooks.push(DomUtils.addDisposableListener(lastSameOriginAncestor.window.document.body, 'mouseleave', (browserEvent:MouseEvent) => {
				this.stopMonitoring(true);
			}));
		}
	}
}
