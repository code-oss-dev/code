/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellViewModelStateChangeEvent } from 'vs/workbench/contrib/notebook/browser/notebookViewEvents';
import { ICellExecutionStateChangedEvent } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';

export abstract class CellContentPart extends Disposable {
	protected currentCell: ICellViewModel | undefined;
	protected cellDisposables = new DisposableStore();

	constructor() {
		super();
	}

	/**
	 * Prepare model for cell part rendering
	 * No DOM operations recommended within this operation
	 */
	prepareRenderCell(element: ICellViewModel): void { }

	/**
	 * Update the DOM for the cell `element`
	 */
	renderCell(element: ICellViewModel): void {
		this.currentCell = element;
		this.didRenderCell(element);
	}

	protected didRenderCell(element: ICellViewModel): void { }

	/**
	 * Dispose any disposables generated from `didRenderCell`
	 */
	unrenderCell(element: ICellViewModel): void {
		this.currentCell = undefined;
		this.cellDisposables.clear();
	}

	/**
	 * Perform DOM read operations to prepare for the list/cell layout update.
	 */
	prepareLayout(): void { }

	/**
	 * Update internal DOM (top positions) per cell layout info change
	 * Note that a cell part doesn't need to call `DOM.scheduleNextFrame`,
	 * the list view will ensure that layout call is invoked in the right frame
	 */
	updateInternalLayoutNow(element: ICellViewModel): void { }

	/**
	 * Update per cell state change
	 */
	updateState(element: ICellViewModel, e: CellViewModelStateChangeEvent): void { }

	/**
	 * Update per execution state change.
	 */
	updateForExecutionState(element: ICellViewModel, e: ICellExecutionStateChangedEvent): void { }
}

export abstract class CellOverlayPart extends Disposable {
	protected currentCell: ICellViewModel | undefined;
	protected cellDisposables = new DisposableStore();

	constructor() {
		super();
	}

	/**
	 * Prepare model for cell part rendering
	 * No DOM operations recommended within this operation
	 */
	prepareRenderCell(element: ICellViewModel): void { }

	/**
	 * Update the DOM for the cell `element`
	 */
	renderCell(element: ICellViewModel): void {
		this.currentCell = element;
		this.didRenderCell(element);
	}

	protected didRenderCell(element: ICellViewModel): void { }

	/**
	 * Dispose any disposables generated from `didRenderCell`
	 */
	unrenderCell(element: ICellViewModel): void {
		this.currentCell = undefined;
		this.cellDisposables.clear();
	}

	/**
	 * Update internal DOM (top positions) per cell layout info change
	 * Note that a cell part doesn't need to call `DOM.scheduleNextFrame`,
	 * the list view will ensure that layout call is invoked in the right frame
	 */
	updateInternalLayoutNow(element: ICellViewModel): void { }

	/**
	 * Update per cell state change
	 */
	updateState(element: ICellViewModel, e: CellViewModelStateChangeEvent): void { }

	/**
	 * Update per execution state change.
	 */
	updateForExecutionState(element: ICellViewModel, e: ICellExecutionStateChangedEvent): void { }
}

export class CellPartsCollection {
	private _scheduledOverlayRendering: IDisposable | undefined;
	private _scheduledOverlayUpdateState: IDisposable | undefined;
	private _scheduledOverlayUpdateExecutionState: IDisposable | undefined;

	constructor(
		private readonly contentParts: readonly CellContentPart[],
		private readonly overlayParts: readonly CellOverlayPart[]
	) { }

	concatContentPart(other: readonly CellContentPart[]): CellPartsCollection {
		return new CellPartsCollection(this.contentParts.concat(other), this.overlayParts);
	}

	concatOverlayPart(other: readonly CellOverlayPart[]): CellPartsCollection {
		return new CellPartsCollection(this.contentParts, this.overlayParts.concat(other));
	}

	scheduleRenderCell(element: ICellViewModel): void {
		// prepare model
		for (const part of this.contentParts) {
			part.prepareRenderCell(element);
		}

		for (const part of this.overlayParts) {
			part.prepareRenderCell(element);
		}

		// render content parts
		for (const part of this.contentParts) {
			part.renderCell(element);
		}

		// schedule overlay parts rendering
		this._scheduledOverlayRendering?.dispose();

		this._scheduledOverlayRendering = DOM.modify(() => {
			for (const part of this.overlayParts) {
				part.renderCell(element);
			}
		});
	}

	unrenderCell(element: ICellViewModel): void {
		for (const part of this.contentParts) {
			part.unrenderCell(element);
		}

		this._scheduledOverlayRendering?.dispose();
		this._scheduledOverlayUpdateState?.dispose();
		this._scheduledOverlayUpdateExecutionState?.dispose();

		for (const part of this.overlayParts) {
			part.unrenderCell(element);
		}
	}

	updateInternalLayoutNow(viewCell: ICellViewModel) {
		for (const part of this.contentParts) {
			part.updateInternalLayoutNow(viewCell);
		}
	}

	prepareLayout() {
		for (const part of this.contentParts) {
			part.prepareLayout();
		}
	}

	updateState(viewCell: ICellViewModel, e: CellViewModelStateChangeEvent) {
		for (const part of this.contentParts) {
			part.updateState(viewCell, e);
		}

		this._scheduledOverlayUpdateState?.dispose();

		this._scheduledOverlayUpdateState = DOM.modify(() => {
			for (const part of this.overlayParts) {
				part.updateState(viewCell, e);
			}
		});
	}

	updateForExecutionState(viewCell: ICellViewModel, e: ICellExecutionStateChangedEvent) {
		for (const part of this.contentParts) {
			part.updateForExecutionState(viewCell, e);
		}

		this._scheduledOverlayUpdateExecutionState?.dispose();
		this._scheduledOverlayUpdateExecutionState = DOM.modify(() => {
			for (const part of this.overlayParts) {
				part.updateForExecutionState(viewCell, e);
			}
		});
	}
}
