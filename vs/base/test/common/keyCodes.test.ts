/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EVENT_KEY_CODE_MAP, IMMUTABLE_CODE_TO_KEY_CODE, IMMUTABLE_KEY_CODE_TO_CODE, KeyChord, KeyCode, KeyCodeUtils, KeyMod, NATIVE_WINDOWS_KEY_CODE_TO_KEY_CODE, ScanCode, ScanCodeUtils } from 'vs/base/common/keyCodes';
import { ChordKeybinding, createKeybinding, Keybinding, SimpleKeybinding } from 'vs/base/common/keybindings';
import { OperatingSystem } from 'vs/base/common/platform';

suite('keyCodes', () => {

	function testBinaryEncoding(expected: Keybinding | null, k: number, OS: OperatingSystem): void {
		assert.deepStrictEqual(createKeybinding(k, OS), expected);
	}

	test('mapping for Minus', () => {
		// [147, 83, 0, ScanCode.Minus, 'Minus', KeyCode.US_MINUS, '-', 189, 'VK_OEM_MINUS', '-', 'OEM_MINUS'],
		assert.strictEqual(EVENT_KEY_CODE_MAP[189], KeyCode.Minus);
		assert.strictEqual(NATIVE_WINDOWS_KEY_CODE_TO_KEY_CODE['VK_OEM_MINUS'], KeyCode.Minus);
		assert.strictEqual(ScanCodeUtils.lowerCaseToEnum('minus'), ScanCode.Minus);
		assert.strictEqual(ScanCodeUtils.toEnum('Minus'), ScanCode.Minus);
		assert.strictEqual(ScanCodeUtils.toString(ScanCode.Minus), 'Minus');
		assert.strictEqual(IMMUTABLE_CODE_TO_KEY_CODE[ScanCode.Minus], KeyCode.DependsOnKbLayout);
		assert.strictEqual(IMMUTABLE_KEY_CODE_TO_CODE[KeyCode.Minus], ScanCode.DependsOnKbLayout);
		assert.strictEqual(KeyCodeUtils.toString(KeyCode.Minus), '-');
		assert.strictEqual(KeyCodeUtils.fromString('-'), KeyCode.Minus);
		assert.strictEqual(KeyCodeUtils.toUserSettingsUS(KeyCode.Minus), '-');
		assert.strictEqual(KeyCodeUtils.toUserSettingsGeneral(KeyCode.Minus), 'OEM_MINUS');
		assert.strictEqual(KeyCodeUtils.fromUserSettings('-'), KeyCode.Minus);
		assert.strictEqual(KeyCodeUtils.fromUserSettings('OEM_MINUS'), KeyCode.Minus);
		assert.strictEqual(KeyCodeUtils.fromUserSettings('oem_minus'), KeyCode.Minus);
	});

	test('mapping for Space', () => {
		// [21, 10, 1, ScanCode.Space, 'Space', KeyCode.Space, 'Space', 32, 'VK_SPACE', empty, empty],
		assert.strictEqual(EVENT_KEY_CODE_MAP[32], KeyCode.Space);
		assert.strictEqual(NATIVE_WINDOWS_KEY_CODE_TO_KEY_CODE['VK_SPACE'], KeyCode.Space);
		assert.strictEqual(ScanCodeUtils.lowerCaseToEnum('space'), ScanCode.Space);
		assert.strictEqual(ScanCodeUtils.toEnum('Space'), ScanCode.Space);
		assert.strictEqual(ScanCodeUtils.toString(ScanCode.Space), 'Space');
		assert.strictEqual(IMMUTABLE_CODE_TO_KEY_CODE[ScanCode.Space], KeyCode.Space);
		assert.strictEqual(IMMUTABLE_KEY_CODE_TO_CODE[KeyCode.Space], ScanCode.Space);
		assert.strictEqual(KeyCodeUtils.toString(KeyCode.Space), 'Space');
		assert.strictEqual(KeyCodeUtils.fromString('Space'), KeyCode.Space);
		assert.strictEqual(KeyCodeUtils.toUserSettingsUS(KeyCode.Space), 'Space');
		assert.strictEqual(KeyCodeUtils.toUserSettingsGeneral(KeyCode.Space), 'Space');
		assert.strictEqual(KeyCodeUtils.fromUserSettings('Space'), KeyCode.Space);
		assert.strictEqual(KeyCodeUtils.fromUserSettings('space'), KeyCode.Space);
	});

	test('MAC binary encoding', () => {

		function test(expected: Keybinding | null, k: number): void {
			testBinaryEncoding(expected, k, OperatingSystem.Macintosh);
		}

		test(null, 0);
		test(new SimpleKeybinding(false, false, false, false, KeyCode.Enter).toChord(), KeyCode.Enter);
		test(new SimpleKeybinding(true, false, false, false, KeyCode.Enter).toChord(), KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, false, true, false, KeyCode.Enter).toChord(), KeyMod.Alt | KeyCode.Enter);
		test(new SimpleKeybinding(true, false, true, false, KeyCode.Enter).toChord(), KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, true, false, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyCode.Enter);
		test(new SimpleKeybinding(true, true, false, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, true, true, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.Alt | KeyCode.Enter);
		test(new SimpleKeybinding(true, true, true, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, false, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyCode.Enter);
		test(new SimpleKeybinding(true, false, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, false, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter);
		test(new SimpleKeybinding(true, false, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, true, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter);
		test(new SimpleKeybinding(true, true, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, true, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.Enter);
		test(new SimpleKeybinding(true, true, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);

		test(
			new ChordKeybinding([
				new SimpleKeybinding(false, false, false, false, KeyCode.Enter),
				new SimpleKeybinding(false, false, false, false, KeyCode.Tab)
			]),
			KeyChord(KeyCode.Enter, KeyCode.Tab)
		);
		test(
			new ChordKeybinding([
				new SimpleKeybinding(false, false, false, true, KeyCode.KeyY),
				new SimpleKeybinding(false, false, false, false, KeyCode.KeyZ)
			]),
			KeyChord(KeyMod.CtrlCmd | KeyCode.KeyY, KeyCode.KeyZ)
		);
	});

	test('WINDOWS & LINUX binary encoding', () => {

		[OperatingSystem.Linux, OperatingSystem.Windows].forEach((OS) => {

			function test(expected: Keybinding | null, k: number): void {
				testBinaryEncoding(expected, k, OS);
			}

			test(null, 0);
			test(new SimpleKeybinding(false, false, false, false, KeyCode.Enter).toChord(), KeyCode.Enter);
			test(new SimpleKeybinding(false, false, false, true, KeyCode.Enter).toChord(), KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(false, false, true, false, KeyCode.Enter).toChord(), KeyMod.Alt | KeyCode.Enter);
			test(new SimpleKeybinding(false, false, true, true, KeyCode.Enter).toChord(), KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(false, true, false, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyCode.Enter);
			test(new SimpleKeybinding(false, true, false, true, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(false, true, true, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.Alt | KeyCode.Enter);
			test(new SimpleKeybinding(false, true, true, true, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(true, false, false, false, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyCode.Enter);
			test(new SimpleKeybinding(true, false, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(true, false, true, false, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter);
			test(new SimpleKeybinding(true, false, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(true, true, false, false, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter);
			test(new SimpleKeybinding(true, true, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(true, true, true, false, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.Enter);
			test(new SimpleKeybinding(true, true, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);

			test(
				new ChordKeybinding([
					new SimpleKeybinding(false, false, false, false, KeyCode.Enter),
					new SimpleKeybinding(false, false, false, false, KeyCode.Tab)
				]),
				KeyChord(KeyCode.Enter, KeyCode.Tab)
			);
			test(
				new ChordKeybinding([
					new SimpleKeybinding(true, false, false, false, KeyCode.KeyY),
					new SimpleKeybinding(false, false, false, false, KeyCode.KeyZ)
				]),
				KeyChord(KeyMod.CtrlCmd | KeyCode.KeyY, KeyCode.KeyZ)
			);

		});
	});
});
