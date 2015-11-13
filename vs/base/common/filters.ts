/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import Strings = require('vs/base/common/strings');

export interface IFilter {
	// Returns null if word doesn't match.
	(word:string, wordToMatchAgainst:string):IMatch[];
}

export interface IMatch {
	start:number;
	end:number;
}

// Combined filters

/**
 * Returns a filter which combines the provided set
 * of filters with an or. The *first* filters that
 * matches defined the return value of the returned
 * filter.
 */
export function or(...filter:IFilter[]):IFilter {
	return function (word:string, wordToMatchAgainst:string):IMatch[] {
		for(var i = 0, len = filter.length; i < len; i++) {
			var match = filter[i](word, wordToMatchAgainst);
			if(match) {
				return match;
			}
		}
		return null;
	};
}

/**
 * Returns a filter which combines the provided set
 * of filters with an and. The combines matches are
 * returned if *all* filters match.
 */
export function and(...filter:IFilter[]):IFilter {
	return function (word:string, wordToMatchAgainst:string):IMatch[] {
		var result:IMatch[] = [];
		for(var i = 0, len = filter.length; i < len; i++) {
			var match = filter[i](word, wordToMatchAgainst);
			if(!match) {
				return null;
			}
			result = result.concat(match);
		}
		return result;
	};
}

// Prefix

export var matchesStrictPrefix:IFilter = (word:string, wordToMatchAgainst:string):IMatch[] => { return _matchesPrefix(false, word, wordToMatchAgainst); };
export var matchesPrefix:IFilter = (word:string, wordToMatchAgainst:string):IMatch[] => { return _matchesPrefix(true, word, wordToMatchAgainst); };

function _matchesPrefix(ignoreCase:boolean, word:string, wordToMatchAgainst:string):IMatch[] {
	if (wordToMatchAgainst.length === 0 || wordToMatchAgainst.length < word.length) {
		return null;
	}
	if (ignoreCase) {
		word = word.toLowerCase();
		wordToMatchAgainst = wordToMatchAgainst.toLowerCase();
	}
	for (var i = 0; i < word.length; i++) {
		if (word[i] !== wordToMatchAgainst[i]) {
			return null;
		}
	}
	return word.length > 0 ? [{ start: 0, end: word.length }] : [];
}

// Contiguous Substring

export function matchesContiguousSubString(word:string, wordToMatchAgainst:string):IMatch[] {
	var index = wordToMatchAgainst.toLowerCase().indexOf(word.toLowerCase());

	if (index === -1) {
		return null;
	}

	return [{ start: index, end: index + word.length }];
}

// Substring

export function matchesSubString(word:string, wordToMatchAgainst:string):IMatch[] {
	return _matchesSubString(word.toLowerCase(), wordToMatchAgainst.toLowerCase(), 0, 0);
}

function _matchesSubString(word:string, wordToMatchAgainst:string, i:number, j:number):IMatch[] {
	if (i === word.length) {
		return [];
	} else if (j === wordToMatchAgainst.length) {
		return null;
	} else {
		if (word[i] === wordToMatchAgainst[j]) {
			var result: IMatch[] = null;
			if (result = _matchesSubString(word, wordToMatchAgainst, i + 1, j + 1)) {
				return join({ start: j, end: j + 1 }, result);
			}
		}

		return _matchesSubString(word, wordToMatchAgainst, i, j + 1);
	}
}

// CamelCase

function isLower(code:number):boolean {
	return 97 <= code && code <= 122;
}

function isUpper(code:number):boolean {
	return 65 <= code && code <= 90;
}

function isNumber(code:number):boolean {
	return 48 <= code && code <= 57;
}

function isWhitespace(code:number):boolean {
	return [32, 9, 10, 13].indexOf(code) > -1;
}

function isAlphanumeric(code:number):boolean {
	return isLower(code) || isUpper(code) || isNumber(code);
}

function join(head:IMatch, tail:IMatch[]):IMatch[] {
	if (tail.length === 0) {
		tail = [head];
	} else if (head.end === tail[0].start) {
		tail[0].start = head.start;
	} else {
		tail.unshift(head);
	}
	return tail;
}

function nextAnchor(camelCaseWord: string, start: number): number {
	for (var i = start; i < camelCaseWord.length; i++) {
		var c = camelCaseWord.charCodeAt(i);
		if (isUpper(c) || isNumber(c) || (i>0 && !isAlphanumeric(camelCaseWord.charCodeAt(i-1)))) {
			return i;
		}
	}
	return camelCaseWord.length;
}

function _matchesCamelCase(word:string, camelCaseWord:string, i:number, j:number):IMatch[] {
	if (i === word.length) {
		return [];
	} else if (j === camelCaseWord.length) {
		return null;
	} else if (word[i] !== camelCaseWord[j].toLowerCase()) {
		return null;
	} else {
		var result = null;
		var nextUpperIndex = j + 1;
		result = _matchesCamelCase(word, camelCaseWord, i + 1, j + 1);
		while (!result && (nextUpperIndex = nextAnchor(camelCaseWord, nextUpperIndex)) < camelCaseWord.length) {
			result = _matchesCamelCase(word, camelCaseWord, i + 1, nextUpperIndex);
			nextUpperIndex++;
		}
		return result === null ? null : join({ start: j, end: j + 1 }, result);
	}
}

// Heuristic to avoid computing camel case matcher for words that don't
// look like camelCaseWords.
function isCamelCaseWord(word: string): boolean {
	if (word.length > 40) {
		return false;
	}

	var upper = 0, lower = 0, alpha = 0, code = 0;

	for (var i = 0; i < word.length; i++) {
		code = word.charCodeAt(i);

		isUpper(code) && upper++;
		isLower(code) && lower++;
		isAlphanumeric(code) && alpha++;
	}

	var upperPercent = upper / word.length;
	var lowerPercent = lower / word.length;
	var alphaPercent = alpha / word.length;

	return lowerPercent > 0.2 && upperPercent < 0.8 && alphaPercent > 0.6;
}

// Heuristic to avoid computing camel case matcher for words that don't
// look like camel case patterns.
function isCamelCasePattern(word: string): boolean {
	var upper = 0, lower = 0, code = 0, whitespace = 0;

	for (var i = 0; i < word.length; i++) {
		code = word.charCodeAt(i);

		isUpper(code) && upper++;
		isLower(code) && lower++;
		isWhitespace(code) && whitespace++;
	}

	if ((upper === 0 || lower === 0) && whitespace === 0) {
		return word.length <= 30;
	} else {
		return upper <= 5;
	}
}

export function matchesCamelCase(word:string, camelCaseWord:string):IMatch[] {
	if (camelCaseWord.length === 0) {
		return null;
	}

	if (!isCamelCasePattern(word)) {
		return null;
	}

	if (!isCamelCaseWord(camelCaseWord)) {
		return null;
	}

	var result: IMatch[] = null;
	var i = 0;

	while (i < camelCaseWord.length && (result = _matchesCamelCase(word.toLowerCase(), camelCaseWord, 0, i)) === null) {
		i = nextAnchor(camelCaseWord, i + 1);
	}

	return result;
}

// Fuzzy

var fuzzyDefaultFilter = or(matchesPrefix, matchesCamelCase, matchesContiguousSubString);
var fuzzyRegExpCache:{[key:string]:RegExp;} = {};

export function matchesFuzzy(word:string, wordToMatchAgainst:string):IMatch[] {
	// Form RegExp for wildcard matches
	var regexp = fuzzyRegExpCache[word];
	if (!regexp) {
		regexp = new RegExp(Strings.convertSimple2RegExpPattern(word), 'i');
		fuzzyRegExpCache[word] = regexp;
	}

	// RegExp Filter
	var match:RegExpExecArray = regexp.exec(wordToMatchAgainst);
	if (match) {
		return [ { start: match.index , end: match.index + match[0].length } ];
	}

	// Default Filter
	return fuzzyDefaultFilter(word, wordToMatchAgainst);
}