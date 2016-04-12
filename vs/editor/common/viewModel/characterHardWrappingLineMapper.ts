/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as strings from 'vs/base/common/strings';
import {WrappingIndent} from 'vs/editor/common/editorCommon';
import {PrefixSumComputer} from 'vs/editor/common/viewModel/prefixSumComputer';
import {ILineMapperFactory, ILineMapping, OutputPosition} from 'vs/editor/common/viewModel/splitLinesCollection';

enum CharacterClass {
	NONE = 0,
	BREAK_BEFORE = 1,
	BREAK_AFTER = 2,
	BREAK_OBTRUSIVE = 3,
	BREAK_IDEOGRAPHIC = 4 // for Han and Kana.
}

class CharacterClassifier {

	/**
	 * Maintain a compact (fully initialized ASCII map for quickly classifying ASCII characters - used more often in code).
	 */
	private _asciiMap: CharacterClass[];

	/**
	 * The entire map (sparse array).
	 */
	private _map: CharacterClass[];

	constructor(BREAK_BEFORE:string, BREAK_AFTER:string, BREAK_OBTRUSIVE:string) {

		this._asciiMap = [];
		for (let i = 0; i < 256; i++) {
			this._asciiMap[i] = CharacterClass.NONE;
		}

		this._map = [];

		for (let i = 0; i < BREAK_BEFORE.length; i++) {
			this._set(BREAK_BEFORE.charCodeAt(i), CharacterClass.BREAK_BEFORE);
		}

		for (let i = 0; i < BREAK_AFTER.length; i++) {
			this._set(BREAK_AFTER.charCodeAt(i), CharacterClass.BREAK_AFTER);
		}

		for (let i = 0; i < BREAK_OBTRUSIVE.length; i++) {
			this._set(BREAK_OBTRUSIVE.charCodeAt(i), CharacterClass.BREAK_OBTRUSIVE);
		}
	}

	private _set(charCode:number, charClass:CharacterClass): void {
		if (charCode < 256) {
			this._asciiMap[charCode] = charClass;
		}
		this._map[charCode] = charClass;
	}

	public classify(charCode:number): CharacterClass {
		if (charCode < 256) {
			return this._asciiMap[charCode];
		}

		let charClass = this._map[charCode];
		if (charClass) {
			return charClass;
		}

		// Initialize CharacterClass.BREAK_IDEOGRAPHIC for these Unicode ranges:
		// 1. CJK Unified Ideographs (0x4E00 -- 0x9FFF)
		// 2. CJK Unified Ideographs Extension A (0x3400 -- 0x4DBF)
		// 3. Hiragana and Katakana (0x3040 -- 0x30FF)
		if (
			(charCode >= 0x3040 && charCode <= 0x30FF)
			|| (charCode >= 0x3400 && charCode <= 0x4DBF)
			|| (charCode >= 0x4E00 && charCode <= 0x9FFF)
		) {
			return CharacterClass.BREAK_IDEOGRAPHIC;
		}

		return CharacterClass.NONE;
	}
}

export class CharacterHardWrappingLineMapperFactory implements ILineMapperFactory {

	private classifier:CharacterClassifier;

	constructor(breakBeforeChars:string, breakAfterChars:string, breakObtrusiveChars:string) {
		this.classifier = new CharacterClassifier(breakBeforeChars, breakAfterChars, breakObtrusiveChars);
	}

	// TODO@Alex -> duplicated in lineCommentCommand
	private static nextVisibleColumn(currentVisibleColumn:number, tabSize:number, isTab:boolean, columnSize:number): number {
		currentVisibleColumn = +currentVisibleColumn; //@perf
		tabSize = +tabSize; //@perf
		columnSize = +columnSize; //@perf

		if (isTab) {
			return currentVisibleColumn + (tabSize - (currentVisibleColumn % tabSize));
		}
		return currentVisibleColumn + columnSize;
	}

	public createLineMapping(lineText: string, tabSize: number, breakingColumn: number, columnsForFullWidthChar:number, hardWrappingIndent:WrappingIndent): ILineMapping {
		if (breakingColumn === -1) {
			return null;
		}

		tabSize = +tabSize; //@perf
		breakingColumn = +breakingColumn; //@perf
		columnsForFullWidthChar = +columnsForFullWidthChar; //@perf
		hardWrappingIndent = +hardWrappingIndent; //@perf

		let wrappedTextIndentVisibleColumn = 0;
		let wrappedTextIndent = '';
		const TAB_CHAR_CODE = '\t'.charCodeAt(0);

		if (hardWrappingIndent !== WrappingIndent.None) {
			let firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(lineText);
			if (firstNonWhitespaceIndex !== -1) {
				wrappedTextIndent = lineText.substring(0, firstNonWhitespaceIndex);
				for (let i = 0; i < firstNonWhitespaceIndex; i++) {
					wrappedTextIndentVisibleColumn = CharacterHardWrappingLineMapperFactory.nextVisibleColumn(wrappedTextIndentVisibleColumn, tabSize, lineText.charCodeAt(i) === TAB_CHAR_CODE, 1);
				}
				if (hardWrappingIndent === WrappingIndent.Indent) {
					wrappedTextIndent += '\t';
					wrappedTextIndentVisibleColumn = CharacterHardWrappingLineMapperFactory.nextVisibleColumn(wrappedTextIndentVisibleColumn, tabSize, true, 1);
				}
				// Force sticking to beginning of line if indentColumn > 66% breakingColumn
				if (wrappedTextIndentVisibleColumn > 1/2 * breakingColumn) {
					wrappedTextIndent = '';
					wrappedTextIndentVisibleColumn = 0;
				}
			}
		}

		let classifier = this.classifier;
		let lastBreakingOffset = 0; // Last 0-based offset in the lineText at which a break happened
		let breakingLengths:number[] = []; // The length of each broken-up line text
		let breakingLengthsIndex:number = 0; // The count of breaks already done
		let visibleColumn = 0; // Visible column since the beginning of the current line
		let breakBeforeOffset:number; // 0-based offset in the lineText before which breaking
		let restoreVisibleColumnFrom:number;
		let niceBreakOffset = -1; // Last index of a character that indicates a break should happen before it (more desirable)
		let niceBreakVisibleColumn = 0; // visible column if a break were to be later introduced before `niceBreakOffset`
		let obtrusiveBreakOffset = -1; // Last index of a character that indicates a break should happen before it (less desirable)
		let obtrusiveBreakVisibleColumn = 0; // visible column if a break were to be later introduced before `obtrusiveBreakOffset`
		let len = lineText.length;

		for (let i = 0; i < len; i++) {
			// At this point, there is a certainty that the character before `i` fits on the current line,
			// but the character at `i` might not fit

			let charCode = lineText.charCodeAt(i);
			let charCodeIsTab = (charCode === TAB_CHAR_CODE);
			let charCodeClass = classifier.classify(charCode);

			if (charCodeClass === CharacterClass.BREAK_BEFORE) {
				// This is a character that indicates that a break should happen before it
				// Since we are certain the character before `i` fits, there's no extra checking needed,
				// just mark it as a nice breaking opportunity
				niceBreakOffset = i;
				niceBreakVisibleColumn = 0;
			}

			// CJK breaking : before break
			if (charCodeClass === CharacterClass.BREAK_IDEOGRAPHIC && i > 0) {
				let prevCode = lineText.charCodeAt(i - 1);
				let prevClass = classifier.classify(prevCode);
				if (prevClass !== CharacterClass.BREAK_BEFORE) { // Kinsoku Shori: Don't break after a leading character, like an open bracket
					niceBreakOffset = i;
					niceBreakVisibleColumn = 0;
				}
			}

			let charColumnSize = 1;
			if (strings.isFullWidthCharacter(charCode)) {
				charColumnSize = columnsForFullWidthChar;
			}

			// Advance visibleColumn with character at `i`
			visibleColumn = CharacterHardWrappingLineMapperFactory.nextVisibleColumn(visibleColumn, tabSize, charCodeIsTab, charColumnSize);

			if (visibleColumn > breakingColumn && i !== 0) {
				// We need to break at least before character at `i`:
				//  - break before niceBreakLastOffset if it exists (and re-establish a correct visibleColumn by using niceBreakVisibleColumn + charAt(i))
				//  - otherwise, break before obtrusiveBreakLastOffset if it exists (and re-establish a correct visibleColumn by using obtrusiveBreakVisibleColumn + charAt(i))
				//  - otherwise, break before i (and re-establish a correct visibleColumn by charAt(i))

				if (niceBreakOffset !== -1) {

					// We will break before `niceBreakLastOffset`
					breakBeforeOffset = niceBreakOffset;
					restoreVisibleColumnFrom = niceBreakVisibleColumn + wrappedTextIndentVisibleColumn;

				} else if (obtrusiveBreakOffset !== -1) {

					// We will break before `obtrusiveBreakLastOffset`
					breakBeforeOffset = obtrusiveBreakOffset;
					restoreVisibleColumnFrom = obtrusiveBreakVisibleColumn + wrappedTextIndentVisibleColumn;

				} else {

					// We will break before `i`
					breakBeforeOffset = i;
					restoreVisibleColumnFrom = 0 + wrappedTextIndentVisibleColumn;

				}

				// Break before character at `breakBeforeOffset`
				breakingLengths[breakingLengthsIndex++] = breakBeforeOffset - lastBreakingOffset;
				lastBreakingOffset = breakBeforeOffset;

				// Re-establish visibleColumn by taking character at `i` into account
				visibleColumn = CharacterHardWrappingLineMapperFactory.nextVisibleColumn(restoreVisibleColumnFrom, tabSize, charCodeIsTab, charColumnSize);

				// Reset markers
				niceBreakOffset = -1;
				niceBreakVisibleColumn = 0;
				obtrusiveBreakOffset = -1;
				obtrusiveBreakVisibleColumn = 0;
			}

			// At this point, there is a certainty that the character at `i` fits on the current line

			if (niceBreakOffset !== -1) {
				// Advance niceBreakVisibleColumn
				niceBreakVisibleColumn = CharacterHardWrappingLineMapperFactory.nextVisibleColumn(niceBreakVisibleColumn, tabSize, charCodeIsTab, charColumnSize);
			}
			if (obtrusiveBreakOffset !== -1) {
				// Advance obtrusiveBreakVisibleColumn
				obtrusiveBreakVisibleColumn = CharacterHardWrappingLineMapperFactory.nextVisibleColumn(obtrusiveBreakVisibleColumn, tabSize, charCodeIsTab, charColumnSize);
			}

			if (charCodeClass === CharacterClass.BREAK_AFTER) {
				// This is a character that indicates that a break should happen after it
				niceBreakOffset = i + 1;
				niceBreakVisibleColumn = 0;
			}

			// CJK breaking : after break
			if (charCodeClass === CharacterClass.BREAK_IDEOGRAPHIC && i < len - 1) {
				let nextCode = lineText.charCodeAt(i + 1);
				let nextClass = classifier.classify(nextCode);
				if (nextClass !== CharacterClass.BREAK_AFTER) { // Kinsoku Shori: Don't break before a trailing character, like a period
					niceBreakOffset = i + 1;
					niceBreakVisibleColumn = 0;
				}
			}

			if (charCodeClass === CharacterClass.BREAK_OBTRUSIVE) {
				// This is an obtrusive character that indicates that a break should happen after it
				obtrusiveBreakOffset = i + 1;
				obtrusiveBreakVisibleColumn = 0;
			}
		}

		if (breakingLengthsIndex === 0) {
			return null;
		}

		// Add last segment
		breakingLengths[breakingLengthsIndex++] = len - lastBreakingOffset;

		return new CharacterHardWrappingLineMapping(new PrefixSumComputer(breakingLengths), wrappedTextIndent);
	}
}

export class CharacterHardWrappingLineMapping implements ILineMapping {

	private _prefixSums:PrefixSumComputer;
	private _wrappedLinesIndent:string;

	constructor(prefixSums:PrefixSumComputer, wrappedLinesIndent:string) {
		this._prefixSums = prefixSums;
		this._wrappedLinesIndent = wrappedLinesIndent;
	}

	public getOutputLineCount(): number {
		return this._prefixSums.getCount();
	}

	public getWrappedLinesIndent(): string {
		return this._wrappedLinesIndent;
	}

	public getInputOffsetOfOutputPosition(outputLineIndex:number, outputOffset:number): number {
		if (outputLineIndex === 0) {
			return outputOffset;
		} else {
			return this._prefixSums.getAccumulatedValue(outputLineIndex - 1) + outputOffset;
		}
	}

	public getOutputPositionOfInputOffset(inputOffset:number): OutputPosition {
		let r = this._prefixSums.getIndexOf(inputOffset);
		return new OutputPosition(r.index, r.remainder);
	}
}
