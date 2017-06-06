/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

/**
 * The minimal size of the slider (such that it can still be clickable) -- it is artificially enlarged.
 */
const MINIMUM_SLIDER_SIZE = 20;

export class ScrollbarState {

	/**
	 * For the vertical scrollbar: the width.
	 * For the horizontal scrollbar: the height.
	 */
	private readonly _scrollbarSize: number;

	/**
	 * For the vertical scrollbar: the height of the pair horizontal scrollbar.
	 * For the horizontal scrollbar: the width of the pair vertical scrollbar.
	 */
	private readonly _oppositeScrollbarSize: number;

	/**
	 * For the vertical scrollbar: the height of the scrollbar's arrows.
	 * For the horizontal scrollbar: the width of the scrollbar's arrows.
	 */
	private readonly _arrowSize: number;

	// --- variables
	/**
	 * For the vertical scrollbar: the viewport height.
	 * For the horizontal scrollbar: the viewport width.
	 */
	private _visibleSize: number;

	/**
	 * For the vertical scrollbar: the scroll height.
	 * For the horizontal scrollbar: the scroll width.
	 */
	private _scrollSize: number;

	/**
	 * For the vertical scrollbar: the scroll top.
	 * For the horizontal scrollbar: the scroll left.
	 */
	private _scrollPosition: number;

	// --- computed variables

	/**
	 * `visibleSize` - `oppositeScrollbarSize`
	 */
	private _computedAvailableSize: number;

	/**
	 * `computedAvailableSize` - 2 * `arrowSize`
	 */
	private _computedRepresentableSize: number;

	/**
	 * `computedRepresentableSize` / `scrollSize`
	 */
	private _computedRatio: number;

	/**
	 * (`scrollSize` > `visibleSize`)
	 */
	private _computedIsNeeded: boolean;

	private _computedSliderSize: number;
	private _computedSliderPosition: number;

	constructor(arrowSize: number, scrollbarSize: number, oppositeScrollbarSize: number) {
		this._scrollbarSize = Math.round(scrollbarSize);
		this._oppositeScrollbarSize = Math.round(oppositeScrollbarSize);
		this._arrowSize = Math.round(arrowSize);

		this._visibleSize = 0;
		this._scrollSize = 0;
		this._scrollPosition = 0;

		this._computedAvailableSize = 0;
		this._computedRepresentableSize = 0;
		this._computedRatio = 0.1;
		this._computedIsNeeded = false;
		this._computedSliderSize = 0;
		this._computedSliderPosition = 0;

		this._refreshComputedValues();
	}

	public clone(): ScrollbarState {
		let r = new ScrollbarState(this._arrowSize, this._scrollbarSize, this._oppositeScrollbarSize);
		r.setVisibleSize(this._visibleSize);
		r.setScrollSize(this._scrollSize);
		r.setScrollPosition(this._scrollPosition);
		return r;
	}

	public setVisibleSize(visibleSize: number): boolean {
		let iVisibleSize = Math.round(visibleSize);
		if (this._visibleSize !== iVisibleSize) {
			this._visibleSize = iVisibleSize;
			this._refreshComputedValues();
			return true;
		}
		return false;
	}

	public setScrollSize(scrollSize: number): boolean {
		let iScrollSize = Math.round(scrollSize);
		if (this._scrollSize !== iScrollSize) {
			this._scrollSize = iScrollSize;
			this._refreshComputedValues();
			return true;
		}
		return false;
	}

	public setScrollPosition(scrollPosition: number): boolean {
		let iScrollPosition = Math.round(scrollPosition);
		if (this._scrollPosition !== iScrollPosition) {
			this._scrollPosition = iScrollPosition;
			this._refreshComputedValues();
			return true;
		}
		return false;
	}

	private _refreshComputedValues(): void {
		const oppositeScrollbarSize = this._oppositeScrollbarSize;
		const arrowSize = this._arrowSize;
		const visibleSize = this._visibleSize;
		const scrollSize = this._scrollSize;
		const scrollPosition = this._scrollPosition;

		let computedAvailableSize = Math.max(0, visibleSize - oppositeScrollbarSize);
		let computedRepresentableSize = Math.max(0, computedAvailableSize - 2 * arrowSize);
		let computedRatio = scrollSize > 0 ? (computedRepresentableSize / scrollSize) : 0;
		let computedIsNeeded = (scrollSize > visibleSize);

		let computedSliderSize: number;
		let computedSliderPosition: number;

		if (!computedIsNeeded) {
			computedSliderSize = computedRepresentableSize;
			computedSliderPosition = 0;
		} else {
			computedSliderSize = Math.floor(visibleSize * computedRatio);
			computedSliderPosition = Math.floor(scrollPosition * computedRatio);

			if (computedSliderSize < MINIMUM_SLIDER_SIZE) {
				// We must artificially increase the size of the slider, since the slider would be too small otherwise
				// The effort is to keep the slider centered around the original position, but we must take into
				// account the cases when the slider is too close to the top or too close to the bottom

				let sliderArtificialOffset = (MINIMUM_SLIDER_SIZE - computedSliderSize) / 2;
				computedSliderSize = MINIMUM_SLIDER_SIZE;

				computedSliderPosition -= sliderArtificialOffset;

				if (computedSliderPosition + computedSliderSize > computedRepresentableSize) {
					// Slider is too close to the bottom, so we glue it to the bottom
					computedSliderPosition = computedRepresentableSize - computedSliderSize;
				}

				if (computedSliderPosition < 0) {
					// Slider is too close to the top, so we glue it to the top
					computedSliderPosition = 0;
				}
			}
		}

		this._computedAvailableSize = Math.round(computedAvailableSize);
		this._computedRepresentableSize = Math.round(computedRepresentableSize);
		this._computedRatio = computedRatio;
		this._computedIsNeeded = computedIsNeeded;
		this._computedSliderSize = Math.round(computedSliderSize);
		this._computedSliderPosition = Math.round(computedSliderPosition);
	}

	public getArrowSize(): number {
		return this._arrowSize;
	}

	public getScrollPosition(): number {
		return this._scrollPosition;
	}

	public getRectangleLargeSize(): number {
		return this._computedAvailableSize;
	}

	public getRectangleSmallSize(): number {
		return this._scrollbarSize;
	}

	public isNeeded(): boolean {
		return this._computedIsNeeded;
	}

	public getSliderSize(): number {
		return this._computedSliderSize;
	}

	public getSliderPosition(): number {
		return this._computedSliderPosition;
	}

	public getSliderCenter(): number {
		return (this._computedSliderPosition + this._computedSliderSize / 2);
	}

	private _convertSliderPositionToScrollPosition(desiredSliderPosition: number): number {
		return desiredSliderPosition / this._computedRatio;
	}

	/**
	 * Compute a desired `scrollPosition` such that `offset` ends up in the center of the slider.
	 * `offset` is based on the same coordinate system as the `sliderPosition`.
	 */
	public getDesiredScrollPositionFromOffset(offset: number): number {
		let desiredSliderPosition = offset - this._arrowSize - this._computedSliderSize / 2;
		return this._convertSliderPositionToScrollPosition(desiredSliderPosition);
	}

	/**
	 * Compute a desired `scrollPosition` such that the slider moves by `delta`.
	 */
	public getDesiredScrollPositionFromDelta(delta: number): number {
		let desiredSliderPosition = this._computedSliderPosition + delta;
		return this._convertSliderPositionToScrollPosition(desiredSliderPosition);
	}
}
