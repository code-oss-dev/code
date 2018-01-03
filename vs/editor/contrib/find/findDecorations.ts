/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { IDisposable } from 'vs/base/common/lifecycle';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ModelDecorationOptions } from 'vs/editor/common/model/model';
import { editorFindMatchHighlight, editorFindMatch } from 'vs/platform/theme/common/colorRegistry';
import { themeColorFromId } from 'vs/platform/theme/common/themeService';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

export class FindDecorations implements IDisposable {

	private _editor: ICodeEditor;
	private _decorations: string[];
	private _overviewRulerApproximateDecorations: string[];
	private _findScopeDecorationId: string;
	private _rangeHighlightDecorationId: string;
	private _highlightedDecorationId: string;
	private _startPosition: Position;

	constructor(editor: ICodeEditor) {
		this._editor = editor;
		this._decorations = [];
		this._overviewRulerApproximateDecorations = [];
		this._findScopeDecorationId = null;
		this._rangeHighlightDecorationId = null;
		this._highlightedDecorationId = null;
		this._startPosition = this._editor.getPosition();
	}

	public dispose(): void {
		this._editor.deltaDecorations(this._allDecorations(), []);

		this._editor = null;
		this._decorations = [];
		this._overviewRulerApproximateDecorations = [];
		this._findScopeDecorationId = null;
		this._rangeHighlightDecorationId = null;
		this._highlightedDecorationId = null;
		this._startPosition = null;
	}

	public reset(): void {
		this._decorations = [];
		this._overviewRulerApproximateDecorations = [];
		this._findScopeDecorationId = null;
		this._rangeHighlightDecorationId = null;
		this._highlightedDecorationId = null;
	}

	public getCount(): number {
		return this._decorations.length;
	}

	public getFindScope(): Range {
		if (this._findScopeDecorationId) {
			return this._editor.getModel().getDecorationRange(this._findScopeDecorationId);
		}
		return null;
	}

	public getStartPosition(): Position {
		return this._startPosition;
	}

	public setStartPosition(newStartPosition: Position): void {
		this._startPosition = newStartPosition;
		this.setCurrentFindMatch(null);
	}

	private _getDecorationIndex(decorationId: string): number {
		const index = this._decorations.indexOf(decorationId);
		if (index >= 0) {
			return index + 1;
		}
		return 1;
	}

	public getCurrentMatchesPosition(desiredRange: Range): number {
		let candidates = this._editor.getModel().getDecorationsInRange(desiredRange);
		for (let i = 0, len = candidates.length; i < len; i++) {
			const candidate = candidates[i];
			const candidateOpts = candidate.options;
			if (candidateOpts === FindDecorations._FIND_MATCH_DECORATION || candidateOpts === FindDecorations._CURRENT_FIND_MATCH_DECORATION) {
				return this._getDecorationIndex(candidate.id);
			}
		}
		return 1;
	}

	public setCurrentFindMatch(nextMatch: Range): number {
		let newCurrentDecorationId: string = null;
		let matchPosition = 0;
		if (nextMatch) {
			for (let i = 0, len = this._decorations.length; i < len; i++) {
				let range = this._editor.getModel().getDecorationRange(this._decorations[i]);
				if (nextMatch.equalsRange(range)) {
					newCurrentDecorationId = this._decorations[i];
					matchPosition = (i + 1);
					break;
				}
			}
		}

		if (this._highlightedDecorationId !== null || newCurrentDecorationId !== null) {
			this._editor.changeDecorations((changeAccessor: editorCommon.IModelDecorationsChangeAccessor) => {
				if (this._highlightedDecorationId !== null) {
					changeAccessor.changeDecorationOptions(this._highlightedDecorationId, FindDecorations._FIND_MATCH_DECORATION);
					this._highlightedDecorationId = null;
				}
				if (newCurrentDecorationId !== null) {
					this._highlightedDecorationId = newCurrentDecorationId;
					changeAccessor.changeDecorationOptions(this._highlightedDecorationId, FindDecorations._CURRENT_FIND_MATCH_DECORATION);
				}
				if (this._rangeHighlightDecorationId !== null) {
					changeAccessor.removeDecoration(this._rangeHighlightDecorationId);
					this._rangeHighlightDecorationId = null;
				}
				if (newCurrentDecorationId !== null) {
					let rng = this._editor.getModel().getDecorationRange(newCurrentDecorationId);
					if (rng.startLineNumber !== rng.endLineNumber && rng.endColumn === 1) {
						let lineBeforeEnd = rng.endLineNumber - 1;
						let lineBeforeEndMaxColumn = this._editor.getModel().getLineMaxColumn(lineBeforeEnd);
						rng = new Range(rng.startLineNumber, rng.startColumn, lineBeforeEnd, lineBeforeEndMaxColumn);
					}
					this._rangeHighlightDecorationId = changeAccessor.addDecoration(rng, FindDecorations._RANGE_HIGHLIGHT_DECORATION);
				}
			});
		}

		return matchPosition;
	}

	public set(findMatches: editorCommon.FindMatch[], findScope: Range): void {
		this._editor.changeDecorations((accessor) => {

			let findMatchesOptions: ModelDecorationOptions = FindDecorations._FIND_MATCH_DECORATION;
			let newOverviewRulerApproximateDecorations: editorCommon.IModelDeltaDecoration[] = [];

			if (findMatches.length > 1000) {
				// we go into a mode where the overview ruler gets "approximate" decorations
				// the reason is that the overview ruler paints all the decorations in the file and we don't want to cause freezes
				findMatchesOptions = FindDecorations._FIND_MATCH_NO_OVERVIEW_DECORATION;

				// approximate a distance in lines where matches should be merged
				const lineCount = this._editor.getModel().getLineCount();
				const height = this._editor.getLayoutInfo().height;
				const approxPixelsPerLine = height / lineCount;
				const mergeLinesDelta = Math.max(2, Math.ceil(3 / approxPixelsPerLine));

				// merge decorations as much as possible
				let prevStartLineNumber = findMatches[0].range.startLineNumber;
				let prevEndLineNumber = findMatches[0].range.endLineNumber;
				for (let i = 1, len = findMatches.length; i < len; i++) {
					const range = findMatches[i].range;
					if (prevEndLineNumber + mergeLinesDelta >= range.startLineNumber) {
						if (range.endLineNumber > prevEndLineNumber) {
							prevEndLineNumber = range.endLineNumber;
						}
					} else {
						newOverviewRulerApproximateDecorations.push({
							range: new Range(prevStartLineNumber, 1, prevEndLineNumber, 1),
							options: FindDecorations._FIND_MATCH_ONLY_OVERVIEW_DECORATION
						});
						prevStartLineNumber = range.startLineNumber;
						prevEndLineNumber = range.endLineNumber;
					}
				}

				newOverviewRulerApproximateDecorations.push({
					range: new Range(prevStartLineNumber, 1, prevEndLineNumber, 1),
					options: FindDecorations._FIND_MATCH_ONLY_OVERVIEW_DECORATION
				});
			}

			// Find matches
			let newFindMatchesDecorations: editorCommon.IModelDeltaDecoration[] = new Array<editorCommon.IModelDeltaDecoration>(findMatches.length);
			for (let i = 0, len = findMatches.length; i < len; i++) {
				newFindMatchesDecorations[i] = {
					range: findMatches[i].range,
					options: findMatchesOptions
				};
			}
			this._decorations = accessor.deltaDecorations(this._decorations, newFindMatchesDecorations);

			// Overview ruler approximate decorations
			this._overviewRulerApproximateDecorations = accessor.deltaDecorations(this._overviewRulerApproximateDecorations, newOverviewRulerApproximateDecorations);

			// Range highlight
			if (this._rangeHighlightDecorationId) {
				accessor.removeDecoration(this._rangeHighlightDecorationId);
				this._rangeHighlightDecorationId = null;
			}

			// Find scope
			if (this._findScopeDecorationId) {
				accessor.removeDecoration(this._findScopeDecorationId);
				this._findScopeDecorationId = null;
			}
			if (findScope) {
				this._findScopeDecorationId = accessor.addDecoration(findScope, FindDecorations._FIND_SCOPE_DECORATION);
			}
		});
	}

	private _allDecorations(): string[] {
		let result: string[] = [];
		result = result.concat(this._decorations);
		result = result.concat(this._overviewRulerApproximateDecorations);
		if (this._findScopeDecorationId) {
			result.push(this._findScopeDecorationId);
		}
		if (this._rangeHighlightDecorationId) {
			result.push(this._rangeHighlightDecorationId);
		}
		return result;
	}

	private static readonly _CURRENT_FIND_MATCH_DECORATION = ModelDecorationOptions.register({
		stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'currentFindMatch',
		showIfCollapsed: true,
		overviewRuler: {
			color: themeColorFromId(editorFindMatch),
			darkColor: themeColorFromId(editorFindMatch),
			position: editorCommon.OverviewRulerLane.Center
		}
	});

	private static readonly _FIND_MATCH_DECORATION = ModelDecorationOptions.register({
		stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'findMatch',
		showIfCollapsed: true,
		overviewRuler: {
			color: themeColorFromId(editorFindMatchHighlight),
			darkColor: themeColorFromId(editorFindMatchHighlight),
			position: editorCommon.OverviewRulerLane.Center
		}
	});

	private static readonly _FIND_MATCH_NO_OVERVIEW_DECORATION = ModelDecorationOptions.register({
		stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'findMatch',
		showIfCollapsed: true
	});

	private static readonly _FIND_MATCH_ONLY_OVERVIEW_DECORATION = ModelDecorationOptions.register({
		stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		overviewRuler: {
			color: themeColorFromId(editorFindMatchHighlight),
			darkColor: themeColorFromId(editorFindMatchHighlight),
			position: editorCommon.OverviewRulerLane.Center
		}
	});

	private static readonly _RANGE_HIGHLIGHT_DECORATION = ModelDecorationOptions.register({
		stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'rangeHighlight',
		isWholeLine: true
	});

	private static readonly _FIND_SCOPE_DECORATION = ModelDecorationOptions.register({
		className: 'findScope',
		isWholeLine: true
	});
}
