/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { MinimapTokensColorTracker, ParsedColor, Constants } from 'vs/editor/common/view/minimapCharRenderer';
import { MinimapCharRendererFactory } from 'vs/editor/test/common/view/minimapCharRendererFactory';
import { createMinimapCharRenderer } from 'vs/editor/common/view/runtimeMinimapCharRenderer';

suite('MinimapColors', () => {

	function assertParseColor(input: string, expected: ParsedColor): void {
		let actual = MinimapTokensColorTracker._parseColor(input);
		assert.deepEqual(actual, expected, input);
	}

	function assertInvalidParseColor(input: string): void {
		assertParseColor(input, new ParsedColor(0, 0, 0));
	}

	test('parseColor', () => {
		assertInvalidParseColor(null);
		assertInvalidParseColor('');
		assertParseColor('FFFFG0', new ParsedColor(255, 255, 0));
		assertParseColor('FFFFg0', new ParsedColor(255, 255, 0));
		assertParseColor('-FFF00', new ParsedColor(15, 255, 0));
		assertParseColor('0102030', new ParsedColor(1, 2, 3));

		assertParseColor('000000', new ParsedColor(0, 0, 0));
		assertParseColor('010203', new ParsedColor(1, 2, 3));
		assertParseColor('040506', new ParsedColor(4, 5, 6));
		assertParseColor('070809', new ParsedColor(7, 8, 9));
		assertParseColor('0a0A0a', new ParsedColor(10, 10, 10));
		assertParseColor('0b0B0b', new ParsedColor(11, 11, 11));
		assertParseColor('0c0C0c', new ParsedColor(12, 12, 12));
		assertParseColor('0d0D0d', new ParsedColor(13, 13, 13));
		assertParseColor('0e0E0e', new ParsedColor(14, 14, 14));
		assertParseColor('0f0F0f', new ParsedColor(15, 15, 15));
		assertParseColor('a0A0a0', new ParsedColor(160, 160, 160));
		assertParseColor('FFFFFF', new ParsedColor(255, 255, 255));
	});
});

suite('MinimapCharRenderer', () => {

	let sampleData: Uint8ClampedArray = null;

	suiteSetup(() => {
		sampleData = new Uint8ClampedArray(Constants.SAMPLED_CHAR_HEIGHT * Constants.SAMPLED_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT * Constants.CHAR_COUNT);
	});

	suiteTeardown(() => {
		sampleData = null;
	});

	setup(() => {
		for (let i = 0; i < sampleData.length; i++) {
			sampleData[i] = 0;
		}

	});

	const sampleD = [
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xd0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xd0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xd0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x0d, 0xff, 0xff, 0xff, 0xa3, 0xff, 0xff, 0xff, 0xf3, 0xff, 0xff, 0xff, 0xe5, 0xff, 0xff, 0xff, 0x5e, 0xff, 0xff, 0xff, 0xd0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xa4, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xf7, 0xff, 0xff, 0xff, 0xfc, 0xff, 0xff, 0xff, 0xf0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0xff, 0xff, 0xff, 0x10, 0xff, 0xff, 0xff, 0xfb, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x94, 0xff, 0xff, 0xff, 0x02, 0xff, 0xff, 0xff, 0x6a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0xff, 0xff, 0xff, 0x3b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x22, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x03, 0xff, 0xff, 0xff, 0xf0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0xff, 0xff, 0xff, 0x47, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xd6, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0xff, 0xff, 0xff, 0x31, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x16, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xe7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0xff, 0xff, 0xff, 0x0e, 0xff, 0xff, 0xff, 0xf7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x69, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x3d, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x9b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xf9, 0xff, 0xff, 0xff, 0xb9, 0xff, 0xff, 0xff, 0xf0, 0xff, 0xff, 0xff, 0xf7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x0e, 0xff, 0xff, 0xff, 0xa7, 0xff, 0xff, 0xff, 0xf5, 0xff, 0xff, 0xff, 0xe8, 0xff, 0xff, 0xff, 0x71, 0xff, 0xff, 0xff, 0xd0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x78, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	];

	function setSampleData(charCode: number, data: number[]) {
		const rowWidth = Constants.SAMPLED_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT * Constants.CHAR_COUNT;
		let chIndex = charCode - Constants.START_CH_CODE;

		let globalOutputOffset = chIndex * Constants.SAMPLED_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT;
		let inputOffset = 0;
		for (let i = 0; i < Constants.SAMPLED_CHAR_HEIGHT; i++) {
			let outputOffset = globalOutputOffset;
			for (let j = 0; j < Constants.SAMPLED_CHAR_WIDTH; j++) {
				for (let channel = 0; channel < Constants.RGBA_CHANNELS_CNT; channel++) {
					sampleData[outputOffset] = data[inputOffset];
					inputOffset++;
					outputOffset++;
				}
			}
			globalOutputOffset += rowWidth;
		}
	}

	test('letter d @ 2x', () => {
		setSampleData('d'.charCodeAt(0), sampleD);
		let renderer = MinimapCharRendererFactory.create(sampleData);

		let dest = new Uint8ClampedArray(Constants.x2_CHAR_HEIGHT * Constants.x2_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT);
		renderer.x2RenderChar(dest, 1, 0, 0, 'd'.charCodeAt(0));

		let actual: number[] = [];
		for (let i = 0; i < dest.length; i++) {
			actual[i] = dest[i];
		}
		assert.deepEqual(actual, [
			0x00, 0x00, 0x00, 0x00, 0xbf, 0xbf, 0xbf, 0x92,
			0xff, 0xff, 0xff, 0xbb, 0xff, 0xff, 0xff, 0xbe,
			0xff, 0xff, 0xff, 0x94, 0xd4, 0xd4, 0xd4, 0x97,
			0xff, 0xff, 0xff, 0xb1, 0xff, 0xff, 0xff, 0xbb,
		]);
	});

	test('letter d @ 2x at runtime', () => {
		let renderer = createMinimapCharRenderer();

		let dest = new Uint8ClampedArray(Constants.x2_CHAR_HEIGHT * Constants.x2_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT);
		renderer.x2RenderChar(dest, 1, 0, 0, 'd'.charCodeAt(0));

		let actual: number[] = [];
		for (let i = 0; i < dest.length; i++) {
			actual[i] = dest[i];
		}
		assert.deepEqual(actual, [
			0x00, 0x00, 0x00, 0x00, 0xbf, 0xbf, 0xbf, 0x92,
			0xff, 0xff, 0xff, 0xbb, 0xff, 0xff, 0xff, 0xbe,
			0xff, 0xff, 0xff, 0x94, 0xd4, 0xd4, 0xd4, 0x97,
			0xff, 0xff, 0xff, 0xb1, 0xff, 0xff, 0xff, 0xbb,
		]);
	});

	test('letter d @ 1x', () => {
		setSampleData('d'.charCodeAt(0), sampleD);
		let renderer = MinimapCharRendererFactory.create(sampleData);

		let dest = new Uint8ClampedArray(Constants.x1_CHAR_HEIGHT * Constants.x1_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT);
		renderer.x1RenderChar(dest, 1, 0, 0, 'd'.charCodeAt(0));

		let actual: number[] = [];
		for (let i = 0; i < dest.length; i++) {
			actual[i] = dest[i];
		}
		assert.deepEqual(actual, [
			0xad, 0xad, 0xad, 0x7d,
			0xeb, 0xeb, 0xeb, 0x9f,
		]);
	});

	test('letter d @ 1x at runtime', () => {
		let renderer = createMinimapCharRenderer();

		let dest = new Uint8ClampedArray(Constants.x1_CHAR_HEIGHT * Constants.x1_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT);
		renderer.x1RenderChar(dest, 1, 0, 0, 'd'.charCodeAt(0));

		let actual: number[] = [];
		for (let i = 0; i < dest.length; i++) {
			actual[i] = dest[i];
		}
		assert.deepEqual(actual, [
			0xad, 0xad, 0xad, 0x7d,
			0xeb, 0xeb, 0xeb, 0x9f,
		]);
	});

});