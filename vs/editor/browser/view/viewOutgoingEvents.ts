/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { EventEmitter, IEventEmitter } from 'vs/base/common/eventEmitter';
import { Disposable } from 'vs/base/common/lifecycle';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IViewModel } from 'vs/editor/common/viewModel/viewModel';
import { EventType, EditorLayoutInfo, IScrollEvent } from 'vs/editor/common/editorCommon';
import { IEditorMouseEvent, IMouseTarget } from 'vs/editor/browser/editorBrowser';

export class ViewOutgoingEvents extends Disposable {

	private _viewModel: IViewModel;
	private _actual: EventEmitter;

	constructor(viewModel: IViewModel) {
		super();
		this._actual = this._register(new EventEmitter());
	}

	public getInternalEventBus(): IEventEmitter {
		return this._actual;
	}

	public deferredEmit<T>(callback: () => T): T {
		return this._actual.deferredEmit(callback);
	}

	public emitViewLayoutChanged(layoutInfo: EditorLayoutInfo): void {
		this._actual.emit(EventType.ViewLayoutChanged, layoutInfo);
	}

	public emitScrollChanged(e: IScrollEvent): void {
		this._actual.emit('scroll', e);
	}

	public emitViewFocusGained(): void {
		this._actual.emit(EventType.ViewFocusGained, {});
	}

	public emitViewFocusLost(): void {
		this._actual.emit(EventType.ViewFocusLost, {});
	}

	public emitKeyDown(e: IKeyboardEvent): void {
		this._actual.emit(EventType.KeyDown, e);
	}

	public emitKeyUp(e: IKeyboardEvent): void {
		this._actual.emit(EventType.KeyUp, e);
	}

	public emitContextMenu(e: IEditorMouseEvent): void {
		this._actual.emit(EventType.ContextMenu, this._convertViewToModelMouseEvent(e));
	}

	public emitMouseMove(e: IEditorMouseEvent): void {
		this._actual.emit(EventType.MouseMove, this._convertViewToModelMouseEvent(e));
	}

	public emitMouseLeave(e: IEditorMouseEvent): void {
		this._actual.emit(EventType.MouseLeave, this._convertViewToModelMouseEvent(e));
	}

	public emitMouseUp(e: IEditorMouseEvent): void {
		this._actual.emit(EventType.MouseUp, this._convertViewToModelMouseEvent(e));
	}

	public emitMouseDown(e: IEditorMouseEvent): void {
		this._actual.emit(EventType.MouseDown, this._convertViewToModelMouseEvent(e));
	}

	private _convertViewToModelMouseEvent(e: IEditorMouseEvent): IEditorMouseEvent {
		if (e.target) {
			return {
				event: e.event,
				target: this._convertViewToModelMouseTarget(e.target)
			};
		}
		return e;
	}

	private _convertViewToModelMouseTarget(target: IMouseTarget): IMouseTarget {
		return {
			element: target.element,
			type: target.type,
			position: target.position ? this._convertViewToModelPosition(target.position) : null,
			mouseColumn: target.mouseColumn,
			range: target.range ? this._convertViewToModelRange(target.range) : null,
			detail: target.detail
		};
	}

	private _convertViewToModelPosition(viewPosition: Position): Position {
		return this._viewModel.convertViewPositionToModelPosition(viewPosition.lineNumber, viewPosition.column);
	}

	private _convertViewToModelRange(viewRange: Range): Range {
		return this._viewModel.convertViewRangeToModelRange(viewRange);
	}
}
