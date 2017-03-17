/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { KeyCode, KeyMod, KeyChord, KeyCodeUtils, createKeybinding } from 'vs/base/common/keyCodes';
import { KeybindingIO } from 'vs/workbench/services/keybinding/common/keybindingIO';
import { OS, OperatingSystem } from 'vs/base/common/platform';
import { IUserFriendlyKeybinding } from 'vs/platform/keybinding/common/keybinding';
import { USLayoutResolvedKeybinding } from 'vs/platform/keybinding/common/usLayoutResolvedKeybinding';

suite('keybindingIO', () => {
	test('getUserSettingsKeybindingRegex', () => {
		let regex = new RegExp(KeybindingIO.getUserSettingsKeybindingRegex());

		function testIsGood(userSettingsLabel: string, message: string = userSettingsLabel): void {
			let userSettings = '"' + userSettingsLabel.replace(/\\/g, '\\\\') + '"';
			let isGood = regex.test(userSettings);
			assert.ok(isGood, message);
		}

		// check that all key codes are covered by the regex
		let ignore: boolean[] = [];
		ignore[KeyCode.Shift] = true;
		ignore[KeyCode.Ctrl] = true;
		ignore[KeyCode.Alt] = true;
		ignore[KeyCode.Meta] = true;
		for (let keyCode = KeyCode.Unknown + 1; keyCode < KeyCode.MAX_VALUE; keyCode++) {
			if (ignore[keyCode]) {
				continue;
			}
			let usLayoutResolvedKeybinding = new USLayoutResolvedKeybinding(createKeybinding(keyCode, OS), OS);
			let userSettings = usLayoutResolvedKeybinding.getUserSettingsLabel();
			testIsGood(userSettings, keyCode + ' - ' + KeyCodeUtils.toString(keyCode) + ' - ' + userSettings);
		}

		// one modifier
		testIsGood('ctrl+a');
		testIsGood('shift+a');
		testIsGood('alt+a');
		testIsGood('cmd+a');
		testIsGood('meta+a');
		testIsGood('win+a');

		// more modifiers
		testIsGood('ctrl+shift+a');
		testIsGood('shift+alt+a');
		testIsGood('ctrl+shift+alt+a');

		// chords
		testIsGood('ctrl+a ctrl+a');
	});


	test('serialize/deserialize', function () {

		function testOneSerialization(keybinding: number, expected: string, msg: string, OS: OperatingSystem): void {
			let usLayoutResolvedKeybinding = new USLayoutResolvedKeybinding(createKeybinding(keybinding, OS), OS);
			let actualSerialized = usLayoutResolvedKeybinding.getUserSettingsLabel();
			assert.equal(actualSerialized, expected, expected + ' - ' + msg);
		}
		function testSerialization(keybinding: number, expectedWin: string, expectedMac: string, expectedLinux: string): void {
			testOneSerialization(keybinding, expectedWin, 'win', OperatingSystem.Windows);
			testOneSerialization(keybinding, expectedMac, 'mac', OperatingSystem.Macintosh);
			testOneSerialization(keybinding, expectedLinux, 'linux', OperatingSystem.Linux);
		}

		function testOneDeserialization(keybinding: string, expected: number, msg: string, OS: OperatingSystem): void {
			let actualDeserialized = KeybindingIO.readKeybinding(keybinding, OS);
			assert.equal(actualDeserialized, expected, keybinding + ' - ' + msg);
		}
		function testDeserialization(inWin: string, inMac: string, inLinux: string, expected: number): void {
			testOneDeserialization(inWin, expected, 'win', OperatingSystem.Windows);
			testOneDeserialization(inMac, expected, 'mac', OperatingSystem.Macintosh);
			testOneDeserialization(inLinux, expected, 'linux', OperatingSystem.Linux);
		}

		function testRoundtrip(keybinding: number, expectedWin: string, expectedMac: string, expectedLinux: string): void {
			testSerialization(keybinding, expectedWin, expectedMac, expectedLinux);
			testDeserialization(expectedWin, expectedMac, expectedLinux, keybinding);
		}

		testRoundtrip(KeyCode.KEY_0, '0', '0', '0');
		testRoundtrip(KeyCode.KEY_A, 'a', 'a', 'a');
		testRoundtrip(KeyCode.UpArrow, 'up', 'up', 'up');
		testRoundtrip(KeyCode.RightArrow, 'right', 'right', 'right');
		testRoundtrip(KeyCode.DownArrow, 'down', 'down', 'down');
		testRoundtrip(KeyCode.LeftArrow, 'left', 'left', 'left');

		// one modifier
		testRoundtrip(KeyMod.Alt | KeyCode.KEY_A, 'alt+a', 'alt+a', 'alt+a');
		testRoundtrip(KeyMod.CtrlCmd | KeyCode.KEY_A, 'ctrl+a', 'cmd+a', 'ctrl+a');
		testRoundtrip(KeyMod.Shift | KeyCode.KEY_A, 'shift+a', 'shift+a', 'shift+a');
		testRoundtrip(KeyMod.WinCtrl | KeyCode.KEY_A, 'win+a', 'ctrl+a', 'meta+a');

		// two modifiers
		testRoundtrip(KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_A, 'ctrl+alt+a', 'alt+cmd+a', 'ctrl+alt+a');
		testRoundtrip(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_A, 'ctrl+shift+a', 'shift+cmd+a', 'ctrl+shift+a');
		testRoundtrip(KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_A, 'ctrl+win+a', 'ctrl+cmd+a', 'ctrl+meta+a');
		testRoundtrip(KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_A, 'shift+alt+a', 'shift+alt+a', 'shift+alt+a');
		testRoundtrip(KeyMod.Shift | KeyMod.WinCtrl | KeyCode.KEY_A, 'shift+win+a', 'ctrl+shift+a', 'shift+meta+a');
		testRoundtrip(KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KEY_A, 'alt+win+a', 'ctrl+alt+a', 'alt+meta+a');

		// three modifiers
		testRoundtrip(KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_A, 'ctrl+shift+alt+a', 'shift+alt+cmd+a', 'ctrl+shift+alt+a');
		testRoundtrip(KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.WinCtrl | KeyCode.KEY_A, 'ctrl+shift+win+a', 'ctrl+shift+cmd+a', 'ctrl+shift+meta+a');
		testRoundtrip(KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KEY_A, 'shift+alt+win+a', 'ctrl+shift+alt+a', 'shift+alt+meta+a');

		// all modifiers
		testRoundtrip(KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KEY_A, 'ctrl+shift+alt+win+a', 'ctrl+shift+alt+cmd+a', 'ctrl+shift+alt+meta+a');

		// chords
		testRoundtrip(KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_A, KeyMod.CtrlCmd | KeyCode.KEY_A), 'ctrl+a ctrl+a', 'cmd+a cmd+a', 'ctrl+a ctrl+a');
		testRoundtrip(KeyChord(KeyMod.CtrlCmd | KeyCode.UpArrow, KeyMod.CtrlCmd | KeyCode.UpArrow), 'ctrl+up ctrl+up', 'cmd+up cmd+up', 'ctrl+up ctrl+up');

		// OEM keys
		testRoundtrip(KeyCode.US_SEMICOLON, ';', ';', ';');
		testRoundtrip(KeyCode.US_EQUAL, '=', '=', '=');
		testRoundtrip(KeyCode.US_COMMA, ',', ',', ',');
		testRoundtrip(KeyCode.US_MINUS, '-', '-', '-');
		testRoundtrip(KeyCode.US_DOT, '.', '.', '.');
		testRoundtrip(KeyCode.US_SLASH, '/', '/', '/');
		testRoundtrip(KeyCode.US_BACKTICK, '`', '`', '`');
		testRoundtrip(KeyCode.US_OPEN_SQUARE_BRACKET, '[', '[', '[');
		testRoundtrip(KeyCode.US_BACKSLASH, '\\', '\\', '\\');
		testRoundtrip(KeyCode.US_CLOSE_SQUARE_BRACKET, ']', ']', ']');
		testRoundtrip(KeyCode.US_QUOTE, '\'', '\'', '\'');
		testRoundtrip(KeyCode.OEM_8, 'oem_8', 'oem_8', 'oem_8');
		testRoundtrip(KeyCode.OEM_102, 'oem_102', 'oem_102', 'oem_102');

		// OEM aliases
		testDeserialization('OEM_1', 'OEM_1', 'OEM_1', KeyCode.US_SEMICOLON);
		testDeserialization('OEM_PLUS', 'OEM_PLUS', 'OEM_PLUS', KeyCode.US_EQUAL);
		testDeserialization('OEM_COMMA', 'OEM_COMMA', 'OEM_COMMA', KeyCode.US_COMMA);
		testDeserialization('OEM_MINUS', 'OEM_MINUS', 'OEM_MINUS', KeyCode.US_MINUS);
		testDeserialization('OEM_PERIOD', 'OEM_PERIOD', 'OEM_PERIOD', KeyCode.US_DOT);
		testDeserialization('OEM_2', 'OEM_2', 'OEM_2', KeyCode.US_SLASH);
		testDeserialization('OEM_3', 'OEM_3', 'OEM_3', KeyCode.US_BACKTICK);
		testDeserialization('OEM_4', 'OEM_4', 'OEM_4', KeyCode.US_OPEN_SQUARE_BRACKET);
		testDeserialization('OEM_5', 'OEM_5', 'OEM_5', KeyCode.US_BACKSLASH);
		testDeserialization('OEM_6', 'OEM_6', 'OEM_6', KeyCode.US_CLOSE_SQUARE_BRACKET);
		testDeserialization('OEM_7', 'OEM_7', 'OEM_7', KeyCode.US_QUOTE);
		testDeserialization('OEM_8', 'OEM_8', 'OEM_8', KeyCode.OEM_8);
		testDeserialization('OEM_102', 'OEM_102', 'OEM_102', KeyCode.OEM_102);

		// accepts '-' as separator
		testDeserialization('ctrl-shift-alt-win-a', 'ctrl-shift-alt-cmd-a', 'ctrl-shift-alt-meta-a', KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KEY_A);

		// various input mistakes
		testDeserialization(' ctrl-shift-alt-win-A ', ' shift-alt-cmd-Ctrl-A ', ' ctrl-shift-alt-META-A ', KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KEY_A);
	});

	test('issue #10452 - invalid command', () => {
		let strJSON = `[{ "key": "ctrl+k ctrl+f", "command": ["firstcommand", "seccondcommand"] }]`;
		let userKeybinding = <IUserFriendlyKeybinding>JSON.parse(strJSON)[0];
		let keybindingItem = KeybindingIO.readKeybindingItem(userKeybinding, 0, OS);
		assert.equal(keybindingItem.command, null);
	});

	test('issue #10452 - invalid when', () => {
		let strJSON = `[{ "key": "ctrl+k ctrl+f", "command": "firstcommand", "when": [] }]`;
		let userKeybinding = <IUserFriendlyKeybinding>JSON.parse(strJSON)[0];
		let keybindingItem = KeybindingIO.readKeybindingItem(userKeybinding, 0, OS);
		assert.equal(keybindingItem.when, null);
	});

	test('issue #10452 - invalid key', () => {
		let strJSON = `[{ "key": [], "command": "firstcommand" }]`;
		let userKeybinding = <IUserFriendlyKeybinding>JSON.parse(strJSON)[0];
		let keybindingItem = KeybindingIO.readKeybindingItem(userKeybinding, 0, OS);
		assert.equal(keybindingItem.keybinding, null);
	});

	test('test commands args', () => {
		let strJSON = `[{ "key": "ctrl+k ctrl+f", "command": "firstcommand", "when": [], "args": { "text": "theText" } }]`;
		let userKeybinding = <IUserFriendlyKeybinding>JSON.parse(strJSON)[0];
		let keybindingItem = KeybindingIO.readKeybindingItem(userKeybinding, 0, OS);
		assert.equal(keybindingItem.commandArgs.text, 'theText');
	});
});
