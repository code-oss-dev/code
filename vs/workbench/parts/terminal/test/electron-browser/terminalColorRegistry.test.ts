/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import { Extensions as ThemeingExtensions, IColorRegistry, ColorIdentifier } from 'vs/platform/theme/common/colorRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { ansiColorIdentifiers, registerColors } from 'vs/workbench/parts/terminal/electron-browser/terminalColorRegistry';
import { ITheme, ThemeType } from 'vs/platform/theme/common/themeService';
import { Color } from 'vs/base/common/color';

registerColors();

let themingRegistry = <IColorRegistry>Registry.as(ThemeingExtensions.ColorContribution);
function getMockTheme(type: ThemeType): ITheme {
	let theme = {
		selector: '',
		label: '',
		type: type,
		getColor: (colorId: ColorIdentifier): Color => themingRegistry.resolveDefaultColor(colorId, theme),
		defines: () => true
	};
	return theme;
}

suite('Workbench - TerminalColorRegistry', () => {

	test('hc colors', function () {
		let theme = getMockTheme('hc');
		let colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId), true));

		assert.deepEqual(colors, [
			'#000000',
			'#cd0000',
			'#00cd00',
			'#cdcd00',
			'#0000ee',
			'#cd00cd',
			'#00cdcd',
			'#e5e5e5',
			'#7f7f7f',
			'#ff0000',
			'#00ff00',
			'#ffff00',
			'#5c5cff',
			'#ff00ff',
			'#00ffff',
			'#ffffff'
		], 'The high contrast terminal colors should be used when the hc theme is active');

	});

	test('light colors', function () {
		let theme = getMockTheme('light');
		let colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId), true));

		assert.deepEqual(colors, [
			'#000000',
			'#cd3131',
			'#00bc00',
			'#949800',
			'#0451a5',
			'#bc05bc',
			'#0598bc',
			'#555555',
			'#666666',
			'#cd3131',
			'#14ce14',
			'#b5ba00',
			'#0451a5',
			'#bc05bc',
			'#0598bc',
			'#a5a5a5'
		], 'The light terminal colors should be used when the light theme is active');

	});

	test('dark colors', function () {
		let theme = getMockTheme('dark');
		let colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId), true));

		assert.deepEqual(colors, [
			'#000000',
			'#cd3131',
			'#0dbc79',
			'#e5e510',
			'#2472c8',
			'#bc3fbc',
			'#11a8cd',
			'#e5e5e5',
			'#666666',
			'#f14c4c',
			'#23d18b',
			'#f5f543',
			'#3b8eea',
			'#d670d6',
			'#29b8db',
			'#e5e5e5'
		], 'The dark terminal colors should be used when a dark theme is active');
	});
});