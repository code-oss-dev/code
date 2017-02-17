/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import { Color, RGBA, HSLA } from 'vs/base/common/color';

suite('Color', () => {

	test('rgba2hsla', function () {
		assert.deepEqual(new HSLA(0, 0, 0, 1), Color.fromRGBA(new RGBA(0, 0, 0, 1)).toHSLA());
		assert.deepEqual(new HSLA(0, 0, 1, 1), Color.fromRGBA(new RGBA(255, 255, 255, 1)).toHSLA());

		assert.deepEqual(new HSLA(0, 1, 0.5, 1), Color.fromRGBA(new RGBA(255, 0, 0, 1)).toHSLA());
		assert.deepEqual(new HSLA(120, 1, 0.5, 1), Color.fromRGBA(new RGBA(0, 255, 0, 1)).toHSLA());
		assert.deepEqual(new HSLA(240, 1, 0.5, 1), Color.fromRGBA(new RGBA(0, 0, 255, 1)).toHSLA());

		assert.deepEqual(new HSLA(60, 1, 0.5, 1), Color.fromRGBA(new RGBA(255, 255, 0, 1)).toHSLA());
		assert.deepEqual(new HSLA(180, 1, 0.5, 1), Color.fromRGBA(new RGBA(0, 255, 255, 1)).toHSLA());
		assert.deepEqual(new HSLA(300, 1, 0.5, 1), Color.fromRGBA(new RGBA(255, 0, 255, 1)).toHSLA());

		assert.deepEqual(new HSLA(0, 0, 0.753, 1), Color.fromRGBA(new RGBA(192, 192, 192, 1)).toHSLA());

		assert.deepEqual(new HSLA(0, 0, 0.502, 1), Color.fromRGBA(new RGBA(128, 128, 128, 1)).toHSLA());
		assert.deepEqual(new HSLA(0, 1, 0.251, 1), Color.fromRGBA(new RGBA(128, 0, 0, 1)).toHSLA());
		assert.deepEqual(new HSLA(60, 1, 0.251, 1), Color.fromRGBA(new RGBA(128, 128, 0, 1)).toHSLA());
		assert.deepEqual(new HSLA(120, 1, 0.251, 1), Color.fromRGBA(new RGBA(0, 128, 0, 1)).toHSLA());
		assert.deepEqual(new HSLA(300, 1, 0.251, 1), Color.fromRGBA(new RGBA(128, 0, 128, 1)).toHSLA());
		assert.deepEqual(new HSLA(180, 1, 0.251, 1), Color.fromRGBA(new RGBA(0, 128, 128, 1)).toHSLA());
		assert.deepEqual(new HSLA(240, 1, 0.251, 1), Color.fromRGBA(new RGBA(0, 0, 128, 1)).toHSLA());
	});

	test('hsla2rgba', function () {
		assert.deepEqual(new RGBA(0, 0, 0, 1), Color.fromHSLA(new HSLA(0, 0, 0, 1)).toRGBA());
		assert.deepEqual(new RGBA(255, 255, 255, 1), Color.fromHSLA(new HSLA(0, 0, 1, 1)).toRGBA());

		assert.deepEqual(new RGBA(255, 0, 0, 1), Color.fromHSLA(new HSLA(0, 1, 0.5, 1)).toRGBA());
		assert.deepEqual(new RGBA(0, 255, 0, 1), Color.fromHSLA(new HSLA(120, 1, 0.5, 1)).toRGBA());
		assert.deepEqual(new RGBA(0, 0, 255, 1), Color.fromHSLA(new HSLA(240, 1, 0.5, 1)).toRGBA());

		assert.deepEqual(new RGBA(255, 255, 0, 1), Color.fromHSLA(new HSLA(60, 1, 0.5, 1)).toRGBA());
		assert.deepEqual(new RGBA(0, 255, 255, 1), Color.fromHSLA(new HSLA(180, 1, 0.5, 1)).toRGBA());
		assert.deepEqual(new RGBA(255, 0, 255, 1), Color.fromHSLA(new HSLA(300, 1, 0.5, 1)).toRGBA());

		assert.deepEqual(new RGBA(192, 192, 192, 1), Color.fromHSLA(new HSLA(0, 0, 0.753, 1)).toRGBA());

		assert.deepEqual(new RGBA(128, 128, 128, 1), Color.fromHSLA(new HSLA(0, 0, 0.502, 1)).toRGBA());
		assert.deepEqual(new RGBA(128, 0, 0, 1), Color.fromHSLA(new HSLA(0, 1, 0.251, 1)).toRGBA());
		assert.deepEqual(new RGBA(128, 128, 0, 1), Color.fromHSLA(new HSLA(60, 1, 0.251, 1)).toRGBA());
		assert.deepEqual(new RGBA(0, 128, 0, 1), Color.fromHSLA(new HSLA(120, 1, 0.251, 1)).toRGBA());
		assert.deepEqual(new RGBA(128, 0, 128, 1), Color.fromHSLA(new HSLA(300, 1, 0.251, 1)).toRGBA());
		assert.deepEqual(new RGBA(0, 128, 128, 1), Color.fromHSLA(new HSLA(180, 1, 0.251, 1)).toRGBA());
		assert.deepEqual(new RGBA(0, 0, 128, 1), Color.fromHSLA(new HSLA(240, 1, 0.251, 1)).toRGBA());
	});

	test('hex2rgba', function () {
		assert.deepEqual(new RGBA(0, 0, 0, 1), Color.fromHex('#000000').toRGBA());
		assert.deepEqual(new RGBA(255, 255, 255, 1), Color.fromHex('#FFFFFF').toRGBA());

		assert.deepEqual(new RGBA(255, 0, 0, 1), Color.fromHex('#FF0000').toRGBA());
		assert.deepEqual(new RGBA(0, 255, 0, 1), Color.fromHex('#00FF00').toRGBA());
		assert.deepEqual(new RGBA(0, 0, 255, 1), Color.fromHex('#0000FF').toRGBA());

		assert.deepEqual(new RGBA(255, 255, 0, 1), Color.fromHex('#FFFF00').toRGBA());
		assert.deepEqual(new RGBA(0, 255, 255, 1), Color.fromHex('#00FFFF').toRGBA());
		assert.deepEqual(new RGBA(255, 0, 255, 1), Color.fromHex('#FF00FF').toRGBA());

		assert.deepEqual(new RGBA(192, 192, 192, 1), Color.fromHex('#C0C0C0').toRGBA());

		assert.deepEqual(new RGBA(128, 128, 128, 1), Color.fromHex('#808080').toRGBA());
		assert.deepEqual(new RGBA(128, 0, 0, 1), Color.fromHex('#800000').toRGBA());
		assert.deepEqual(new RGBA(128, 128, 0, 1), Color.fromHex('#808000').toRGBA());
		assert.deepEqual(new RGBA(0, 128, 0, 1), Color.fromHex('#008000').toRGBA());
		assert.deepEqual(new RGBA(128, 0, 128, 1), Color.fromHex('#800080').toRGBA());
		assert.deepEqual(new RGBA(0, 128, 128, 1), Color.fromHex('#008080').toRGBA());
		assert.deepEqual(new RGBA(0, 0, 128, 1), Color.fromHex('#000080').toRGBA());
	});

	test('isLighterColor', function () {
		let color1 = Color.fromHSLA(new HSLA(60, 1, 0.5, 1)), color2 = Color.fromHSLA(new HSLA(0, 0, 0.753, 1));

		assert.ok(color1.isLighterThan(color2));

		// Abyss theme
		assert.ok(Color.fromHex('#770811').isLighterThan(Color.fromHex('#000c18')));
	});

	test('getLighterColor', function () {
		let color1 = Color.fromHSLA(new HSLA(60, 1, 0.5, 1)), color2 = Color.fromHSLA(new HSLA(0, 0, 0.753, 1));

		assert.deepEqual(color1.toHSLA(), Color.getLighterColor(color1, color2).toHSLA());
		assert.deepEqual(new HSLA(0, 0, 0.914, 1), Color.getLighterColor(color2, color1).toHSLA());
		assert.deepEqual(new HSLA(0, 0, 0.851, 1), Color.getLighterColor(color2, color1, 0.3).toHSLA());
		assert.deepEqual(new HSLA(0, 0, 0.98, 1), Color.getLighterColor(color2, color1, 0.7).toHSLA());
		assert.deepEqual(new HSLA(0, 0, 1, 1), Color.getLighterColor(color2, color1, 1).toHSLA());

	});

	test('isDarkerColor', function () {
		let color1 = Color.fromHSLA(new HSLA(60, 1, 0.5, 1)), color2 = Color.fromHSLA(new HSLA(0, 0, 0.753, 1));

		assert.ok(color2.isDarkerThan(color1));

	});

	test('getDarkerColor', function () {
		let color1 = Color.fromHSLA(new HSLA(60, 1, 0.5, 1)), color2 = Color.fromHSLA(new HSLA(0, 0, 0.753, 1));

		assert.deepEqual(color2.toHSLA(), Color.getDarkerColor(color2, color1).toHSLA());
		assert.deepEqual(new HSLA(60, 1, 0.392, 1), Color.getDarkerColor(color1, color2).toHSLA());
		assert.deepEqual(new HSLA(60, 1, 0.435, 1), Color.getDarkerColor(color1, color2, 0.3).toHSLA());
		assert.deepEqual(new HSLA(60, 1, 0.349, 1), Color.getDarkerColor(color1, color2, 0.7).toHSLA());
		assert.deepEqual(new HSLA(60, 1, 0.284, 1), Color.getDarkerColor(color1, color2, 1).toHSLA());

		// Abyss theme
		assert.deepEqual(new HSLA(355, 0.874, 0.157, 1), Color.getDarkerColor(Color.fromHex('#770811'), Color.fromHex('#000c18'), 0.4).toHSLA());
	});

	test('luminosity', function () {
		assert.deepEqual(0, Color.fromRGBA(new RGBA(0, 0, 0, 1)).getLuminosity());
		assert.deepEqual(1, Color.fromRGBA(new RGBA(255, 255, 255, 1)).getLuminosity());

		assert.deepEqual(0.2126, Color.fromRGBA(new RGBA(255, 0, 0, 1)).getLuminosity());
		assert.deepEqual(0.7152, Color.fromRGBA(new RGBA(0, 255, 0, 1)).getLuminosity());
		assert.deepEqual(0.0722, Color.fromRGBA(new RGBA(0, 0, 255, 1)).getLuminosity());

		assert.deepEqual(0.9278, Color.fromRGBA(new RGBA(255, 255, 0, 1)).getLuminosity());
		assert.deepEqual(0.7874, Color.fromRGBA(new RGBA(0, 255, 255, 1)).getLuminosity());
		assert.deepEqual(0.2848, Color.fromRGBA(new RGBA(255, 0, 255, 1)).getLuminosity());

		assert.deepEqual(0.5271, Color.fromRGBA(new RGBA(192, 192, 192, 1)).getLuminosity());

		assert.deepEqual(0.2159, Color.fromRGBA(new RGBA(128, 128, 128, 1)).getLuminosity());
		assert.deepEqual(0.0459, Color.fromRGBA(new RGBA(128, 0, 0, 1)).getLuminosity());
		assert.deepEqual(0.2003, Color.fromRGBA(new RGBA(128, 128, 0, 1)).getLuminosity());
		assert.deepEqual(0.1544, Color.fromRGBA(new RGBA(0, 128, 0, 1)).getLuminosity());
		assert.deepEqual(0.0615, Color.fromRGBA(new RGBA(128, 0, 128, 1)).getLuminosity());
		assert.deepEqual(0.17, Color.fromRGBA(new RGBA(0, 128, 128, 1)).getLuminosity());
		assert.deepEqual(0.0156, Color.fromRGBA(new RGBA(0, 0, 128, 1)).getLuminosity());
	});

	test('contrast', function () {
		assert.deepEqual(0, Color.fromRGBA(new RGBA(0, 0, 0, 1)).getLuminosity());
		assert.deepEqual(1, Color.fromRGBA(new RGBA(255, 255, 255, 1)).getLuminosity());

		assert.deepEqual(0.2126, Color.fromRGBA(new RGBA(255, 0, 0, 1)).getLuminosity());
		assert.deepEqual(0.7152, Color.fromRGBA(new RGBA(0, 255, 0, 1)).getLuminosity());
		assert.deepEqual(0.0722, Color.fromRGBA(new RGBA(0, 0, 255, 1)).getLuminosity());

		assert.deepEqual(0.9278, Color.fromRGBA(new RGBA(255, 255, 0, 1)).getLuminosity());
		assert.deepEqual(0.7874, Color.fromRGBA(new RGBA(0, 255, 255, 1)).getLuminosity());
		assert.deepEqual(0.2848, Color.fromRGBA(new RGBA(255, 0, 255, 1)).getLuminosity());

		assert.deepEqual(0.5271, Color.fromRGBA(new RGBA(192, 192, 192, 1)).getLuminosity());

		assert.deepEqual(0.2159, Color.fromRGBA(new RGBA(128, 128, 128, 1)).getLuminosity());
		assert.deepEqual(0.0459, Color.fromRGBA(new RGBA(128, 0, 0, 1)).getLuminosity());
		assert.deepEqual(0.2003, Color.fromRGBA(new RGBA(128, 128, 0, 1)).getLuminosity());
		assert.deepEqual(0.1544, Color.fromRGBA(new RGBA(0, 128, 0, 1)).getLuminosity());
		assert.deepEqual(0.0615, Color.fromRGBA(new RGBA(128, 0, 128, 1)).getLuminosity());
		assert.deepEqual(0.17, Color.fromRGBA(new RGBA(0, 128, 128, 1)).getLuminosity());
		assert.deepEqual(0.0156, Color.fromRGBA(new RGBA(0, 0, 128, 1)).getLuminosity());
	});

});
