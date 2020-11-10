/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ITextSearchPreviewOptions, OneLineRange, TextSearchMatch, SearchRange } from 'vs/workbench/services/search/common/search';

suite('TextSearchResult', () => {

	const previewOptions1: ITextSearchPreviewOptions = {
		matchLines: 1,
		charsPerLine: 100
	};

	function assertOneLinePreviewRangeText(text: string, result: TextSearchMatch): void {
		assert.equal(
			result.preview.text.substring((<SearchRange>result.preview.matches).startColumn, (<SearchRange>result.preview.matches).endColumn),
			text);
	}

	test('empty without preview options', () => {
		const range = new OneLineRange(5, 0, 0);
		const result = new TextSearchMatch('', range);
		assert.deepEqual(result.ranges, range);
		assertOneLinePreviewRangeText('', result);
	});

	test('empty with preview options', () => {
		const range = new OneLineRange(5, 0, 0);
		const result = new TextSearchMatch('', range, previewOptions1);
		assert.deepEqual(result.ranges, range);
		assertOneLinePreviewRangeText('', result);
	});

	test('short without preview options', () => {
		const range = new OneLineRange(5, 4, 7);
		const result = new TextSearchMatch('foo bar', range);
		assert.deepEqual(result.ranges, range);
		assertOneLinePreviewRangeText('bar', result);
	});

	test('short with preview options', () => {
		const range = new OneLineRange(5, 4, 7);
		const result = new TextSearchMatch('foo bar', range, previewOptions1);
		assert.deepEqual(result.ranges, range);
		assertOneLinePreviewRangeText('bar', result);
	});

	test('leading', () => {
		const range = new OneLineRange(5, 25, 28);
		const result = new TextSearchMatch('long text very long text foo', range, previewOptions1);
		assert.deepEqual(result.ranges, range);
		assertOneLinePreviewRangeText('foo', result);
	});

	test('trailing', () => {
		const range = new OneLineRange(5, 0, 3);
		const result = new TextSearchMatch('foo long text very long text long text very long text long text very long text long text very long text long text very long text', range, previewOptions1);
		assert.deepEqual(result.ranges, range);
		assertOneLinePreviewRangeText('foo', result);
	});

	test('middle', () => {
		const range = new OneLineRange(5, 30, 33);
		const result = new TextSearchMatch('long text very long text long foo text very long text long text very long text long text very long text long text very long text', range, previewOptions1);
		assert.deepEqual(result.ranges, range);
		assertOneLinePreviewRangeText('foo', result);
	});

	test('truncating match', () => {
		const previewOptions: ITextSearchPreviewOptions = {
			matchLines: 1,
			charsPerLine: 1
		};

		const range = new OneLineRange(0, 4, 7);
		const result = new TextSearchMatch('foo bar', range, previewOptions);
		assert.deepEqual(result.ranges, range);
		assertOneLinePreviewRangeText('b', result);
	});

	test('one line of multiline match', () => {
		const previewOptions: ITextSearchPreviewOptions = {
			matchLines: 1,
			charsPerLine: 10000
		};

		const range = new SearchRange(5, 4, 6, 3);
		const result = new TextSearchMatch('foo bar\nfoo bar', range, previewOptions);
		assert.deepEqual(result.ranges, range);
		assert.equal(result.preview.text, 'foo bar\nfoo bar');
		assert.equal((<SearchRange>result.preview.matches).startLineNumber, 0);
		assert.equal((<SearchRange>result.preview.matches).startColumn, 4);
		assert.equal((<SearchRange>result.preview.matches).endLineNumber, 1);
		assert.equal((<SearchRange>result.preview.matches).endColumn, 3);
	});

	test('compacts multiple ranges on long lines', () => {
		const previewOptions: ITextSearchPreviewOptions = {
			matchLines: 1,
			charsPerLine: 10
		};

		const range1 = new SearchRange(5, 4, 5, 7);
		const range2 = new SearchRange(5, 53, 5, 56);
		const range3 = new SearchRange(5, 61, 5, 64);
		const result = new TextSearchMatch('foo bar 1234567890123456789012345678901234567890 foo bar baz bar', [range1, range2, range3], previewOptions);
		assert.deepEqual(result.preview.matches, [new SearchRange(0, 4, 0, 7), new SearchRange(0, 19, 0, 22), new SearchRange(0, 27, 0, 30)]);
		assert.equal(result.preview.text, 'foo bar 123456...o bar baz bar');
	});

	// test('all lines of multiline match', () => {
	// 	const previewOptions: ITextSearchPreviewOptions = {
	// 		matchLines: 5,
	// 		charsPerLine: 10000
	// 	};

	// 	const range = new SearchRange(5, 4, 6, 3);
	// 	const result = new TextSearchResult('foo bar\nfoo bar', range, previewOptions);
	// 	assert.deepEqual(result.range, range);
	// 	assertPreviewRangeText('bar\nfoo', result);
	// });
});
