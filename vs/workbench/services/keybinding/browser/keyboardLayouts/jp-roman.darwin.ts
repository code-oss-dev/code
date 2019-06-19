/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardLayoutContribution } from 'vs/workbench/services/keybinding/browser/keyboardLayouts/_.contribution';
import { KeymapInfo } from 'vs/workbench/services/keybinding/common/keymapInfo';

KeyboardLayoutContribution.INSTANCE.registerKeyboardLayout(new KeymapInfo(
	{ id: 'com.google.inputmethod.Japanese.Roman', lang: 'en' },
	[],
	{
		KeyA: ['a', 'A', '¯', '̄', 4],
		KeyB: ['b', 'B', '˘', '̆', 4],
		KeyC: ['c', 'C', '¸', '̧', 4],
		KeyD: ['d', 'D', 'ð', 'Ð', 0],
		KeyE: ['e', 'E', '´', '́', 4],
		KeyF: ['f', 'F', 'ƒ', '', 0],
		KeyG: ['g', 'G', '©', '‸', 8],
		KeyH: ['h', 'H', 'ˍ', '̱', 4],
		KeyI: ['i', 'I', 'ʼ', '̛', 4],
		KeyJ: ['j', 'J', '˝', '̋', 4],
		KeyK: ['k', 'K', '˚', '̊', 4],
		KeyL: ['l', 'L', '-', '̵', 4],
		KeyM: ['m', 'M', '˛', '̨', 4],
		KeyN: ['n', 'N', '˜', '̃', 4],
		KeyO: ['o', 'O', 'ø', 'Ø', 0],
		KeyP: ['p', 'P', ',', '̦', 4],
		KeyQ: ['q', 'Q', 'œ', 'Œ', 0],
		KeyR: ['r', 'R', '®', '‰', 0],
		KeyS: ['s', 'S', 'ß', '', 0],
		KeyT: ['t', 'T', 'þ', 'Þ', 0],
		KeyU: ['u', 'U', '¨', '̈', 4],
		KeyV: ['v', 'V', 'ˇ', '̌', 4],
		KeyW: ['w', 'W', '˙', '̇', 4],
		KeyX: ['x', 'X', '.', '̣', 4],
		KeyY: ['y', 'Y', '¥', '', 0],
		KeyZ: ['z', 'Z', 'ˀ', '̉', 4],
		Digit1: ['1', '!', '¡', '⁄', 0],
		Digit2: ['2', '@', '™', '€', 0],
		Digit3: ['3', '#', '£', '‹', 0],
		Digit4: ['4', '$', '¢', '›', 0],
		Digit5: ['5', '%', '§', '†', 0],
		Digit6: ['6', '^', 'ˆ', '̂', 4],
		Digit7: ['7', '&', '¶', '‡', 0],
		Digit8: ['8', '*', '•', '°', 0],
		Digit9: ['9', '(', 'ª', '·', 0],
		Digit0: ['0', ')', 'º', '‚', 0],
		Enter: [],
		Escape: [],
		Backspace: [],
		Tab: [],
		Space: [' ', ' ', ' ', ' ', 0],
		Minus: ['-', '_', '–', '—', 0],
		Equal: ['=', '+', '≠', '±', 0],
		BracketLeft: ['[', '{', '“', '”', 0],
		BracketRight: [']', '}', '‘', '’', 0],
		Backslash: ['\\', '|', '«', '»', 0],
		Semicolon: [';', ':', '…', '№', 8],
		Quote: ['\'', '"', 'æ', 'Æ', 0],
		Backquote: ['`', '~', '`', '̀', 4],
		Comma: [',', '<', '≤', '„', 0],
		Period: ['.', '>', '≥', 'ʔ', 8],
		Slash: ['/', '?', '÷', '¿', 0],
		CapsLock: [],
		F1: [],
		F2: [],
		F3: [],
		F4: [],
		F5: [],
		F6: [],
		F7: [],
		F8: [],
		F9: [],
		F10: [],
		F11: [],
		F12: [],
		Insert: [],
		Home: [],
		PageUp: [],
		Delete: [],
		End: [],
		PageDown: [],
		ArrowRight: [],
		ArrowLeft: [],
		ArrowDown: [],
		ArrowUp: [],
		NumLock: [],
		NumpadDivide: ['/', '/', '/', '/', 0],
		NumpadMultiply: ['*', '*', '*', '*', 0],
		NumpadSubtract: ['-', '-', '-', '-', 0],
		NumpadAdd: ['+', '+', '+', '+', 0],
		NumpadEnter: [],
		Numpad1: ['1', '1', '1', '1', 0],
		Numpad2: ['2', '2', '2', '2', 0],
		Numpad3: ['3', '3', '3', '3', 0],
		Numpad4: ['4', '4', '4', '4', 0],
		Numpad5: ['5', '5', '5', '5', 0],
		Numpad6: ['6', '6', '6', '6', 0],
		Numpad7: ['7', '7', '7', '7', 0],
		Numpad8: ['8', '8', '8', '8', 0],
		Numpad9: ['9', '9', '9', '9', 0],
		Numpad0: ['0', '0', '0', '0', 0],
		NumpadDecimal: ['.', '.', '.', '.', 0],
		IntlBackslash: ['§', '±', '§', '±', 0],
		ContextMenu: [],
		NumpadEqual: ['=', '=', '=', '=', 0],
		F13: [],
		F14: [],
		F15: [],
		F16: [],
		F17: [],
		F18: [],
		F19: [],
		F20: [],
		AudioVolumeMute: [],
		AudioVolumeUp: ['', '=', '', '=', 0],
		AudioVolumeDown: [],
		NumpadComma: [],
		IntlRo: [],
		KanaMode: [],
		IntlYen: [],
		ControlLeft: [],
		ShiftLeft: [],
		AltLeft: [],
		MetaLeft: [],
		ControlRight: [],
		ShiftRight: [],
		AltRight: [],
		MetaRight: []
	}
));