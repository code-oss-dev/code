/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { IEventEmitter } from 'vs/base/common/eventEmitter';
import { INewScrollPosition, IViewWhitespaceViewportData, Viewport, IModelDecoration, EndOfLinePreference, IPosition } from 'vs/editor/common/editorCommon';
import { ViewLineToken } from 'vs/editor/common/core/viewLineToken';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';

export interface IViewLayout {

	onMaxLineWidthChanged(width: number): void;

	getScrollLeft(): number;
	getScrollWidth(): number;
	getScrollHeight(): number;
	getScrollTop(): number;
	getCurrentViewport(): Viewport;
	getScrolledTopFromAbsoluteTop(top: number): number;
	getVerticalOffsetForLineNumber(lineNumber: number): number;
	setScrollPosition(position: INewScrollPosition): void;

	// --------------- Begin vertical whitespace management

	/**
	 * Reserve rendering space.
	 * @return an identifier that can be later used to remove or change the whitespace.
	 */
	addWhitespace(afterLineNumber: number, ordinal: number, height: number): number;
	/**
	 * Change the properties of a whitespace.
	 */
	changeWhitespace(id: number, newAfterLineNumber: number, newHeight: number): boolean;
	/**
	 * Remove rendering space
	 */
	removeWhitespace(id: number): boolean;
	/**
	 * Get the layout information for whitespaces currently in the viewport
	 */
	getWhitespaceViewportData(): IViewWhitespaceViewportData[];

	// --------------- End vertical whitespace management
}

export interface ICoordinatesConverter {
	// View -> Model conversion and related methods
	convertViewPositionToModelPosition(viewPosition: Position): Position;
	convertViewRangeToModelRange(viewRange: Range): Range;
	convertViewSelectionToModelSelection(viewSelection: Selection): Selection;
	validateViewPosition(viewPosition: Position, expectedModelPosition: Position): Position;
	validateViewRange(viewRange: Range, expectedModelRange: Range): Range;

	// Model -> View conversion and related methods
	convertModelPositionToViewPosition(modelPosition: Position): Position;
	convertModelRangeToViewRange(modelRange: Range): Range;
	modelPositionIsVisible(modelPosition: Position): boolean;
}

export interface IViewModel extends IEventEmitter {

	readonly coordinatesConverter: ICoordinatesConverter;

	/**
	 * Gives a hint that a lot of requests are about to come in for these line numbers.
	 */
	setViewport(startLineNumber: number, endLineNumber: number, centeredLineNumber: number): void;

	getDecorationsInViewport(visibleRange: Range): ViewModelDecoration[];
	getViewLineRenderingData(visibleRange: Range, lineNumber: number): ViewLineRenderingData;

	getTabSize(): number;
	getLineCount(): number;
	getLineContent(lineNumber: number): string;
	getLineIndentGuide(lineNumber: number): number;
	getLineMinColumn(lineNumber: number): number;
	getLineMaxColumn(lineNumber: number): number;
	getLineRenderLineNumber(lineNumber: number): string;
	getAllOverviewRulerDecorations(): ViewModelDecoration[];
	getEOL(): string;
	getValueInRange(range: Range, eol: EndOfLinePreference): string;

	getModelLineContent(modelLineNumber: number): string;
	getModelLineMaxColumn(modelLineNumber: number): number;
	validateModelPosition(modelPosition: IPosition): Position;

	getPlainTextToCopy(ranges: Range[], enableEmptySelectionClipboard: boolean): string;
	getHTMLToCopy(ranges: Range[], enableEmptySelectionClipboard: boolean): string;
}

export class ViewLineRenderingData {
	/**
	 * The minimum allowed column at this view line.
	 */
	public readonly minColumn: number;
	/**
	 * The maximum allowed column at this view line.
	 */
	public readonly maxColumn: number;
	/**
	 * The content at this view line.
	 */
	public readonly content: string;
	/**
	 * If set to false, it is guaranteed that `content` contains only LTR chars.
	 */
	public readonly mightContainRTL: boolean;
	/**
	 * If set to false, it is guaranteed that `content` contains only basic ASCII chars.
	 */
	public readonly mightContainNonBasicASCII: boolean;
	/**
	 * The tokens at this view line.
	 */
	public readonly tokens: ViewLineToken[];
	/**
	 * Inline decorations at this view line.
	 */
	public readonly inlineDecorations: InlineDecoration[];
	/**
	 * The tab size for this view model.
	 */
	public readonly tabSize: number;

	constructor(
		minColumn: number,
		maxColumn: number,
		content: string,
		mightContainRTL: boolean,
		mightContainNonBasicASCII: boolean,
		tokens: ViewLineToken[],
		inlineDecorations: InlineDecoration[],
		tabSize: number
	) {
		this.minColumn = minColumn;
		this.maxColumn = maxColumn;
		this.content = content;
		this.mightContainRTL = mightContainRTL;
		this.mightContainNonBasicASCII = mightContainNonBasicASCII;
		this.tokens = tokens;
		this.inlineDecorations = inlineDecorations;
		this.tabSize = tabSize;
	}
}

export class InlineDecoration {
	_inlineDecorationBrand: void;

	readonly range: Range;
	readonly inlineClassName: string;
	readonly insertsBeforeOrAfter: boolean;

	constructor(range: Range, inlineClassName: string, insertsBeforeOrAfter: boolean) {
		this.range = range;
		this.inlineClassName = inlineClassName;
		this.insertsBeforeOrAfter = insertsBeforeOrAfter;
	}
}

export class ViewModelDecoration {
	_viewModelDecorationBrand: void;

	public range: Range;
	public readonly source: IModelDecoration;

	constructor(source: IModelDecoration) {
		this.range = null;
		this.source = source;
	}
}
