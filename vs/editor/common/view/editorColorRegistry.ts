/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Color, RGBA } from 'vs/base/common/color';
import { activeContrastBorder, editorBackground, editorForeground, registerColor, editorWarningForeground, editorInfoForeground, editorWarningBorder, editorInfoBorder, contrastBorder, editorFindMatchHighlight } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';

/**
 * Definition of the editor colors
 */
export const editorLineHighlight = registerColor('editor.lineHighlightBackground', { dark: null, light: null, hc: null }, nls.localize('lineHighlight', 'Background color for the highlight of line at the cursor position.'));
export const editorLineHighlightBorder = registerColor('editor.lineHighlightBorder', { dark: '#282828', light: '#eeeeee', hc: '#f38518' }, nls.localize('lineHighlightBorderBox', 'Background color for the border around the line at the cursor position.'));
export const editorRangeHighlight = registerColor('editor.rangeHighlightBackground', { dark: '#ffffff0b', light: '#fdff0033', hc: null }, nls.localize('rangeHighlight', 'Background color of highlighted ranges, like by quick open and find features. The color must not be opaque so as not to hide underlying decorations.'), true);
export const editorRangeHighlightBorder = registerColor('editor.rangeHighlightBorder', { dark: null, light: null, hc: activeContrastBorder }, nls.localize('rangeHighlightBorder', 'Background color of the border around highlighted ranges.'), true);
export const editorSymbolHighlight = registerColor('editor.symbolHighlightBackground', { dark: editorFindMatchHighlight, light: editorFindMatchHighlight, hc: null }, nls.localize('symbolHighlight', 'Background color of highlighted symbol, like for go to definition or go next/previous symbol. The color must not be opaque so as not to hide underlying decorations.'), true);
export const editorSymbolHighlightBorder = registerColor('editor.symbolHighlightBorder', { dark: null, light: null, hc: activeContrastBorder }, nls.localize('symbolHighlightBorder', 'Background color of the border around highlighted symbols.'), true);

export const editorCursorForeground = registerColor('editorCursor.foreground', { dark: '#AEAFAD', light: Color.black, hc: Color.white }, nls.localize('caret', 'Color of the editor cursor.'));
export const editorCursorBackground = registerColor('editorCursor.background', null, nls.localize('editorCursorBackground', 'The background color of the editor cursor. Allows customizing the color of a character overlapped by a block cursor.'));
export const editorWhitespaces = registerColor('editorWhitespace.foreground', { dark: '#e3e4e229', light: '#33333333', hc: '#e3e4e229' }, nls.localize('editorWhitespaces', 'Color of whitespace characters in the editor.'));
export const editorIndentGuides = registerColor('editorIndentGuide.background', { dark: editorWhitespaces, light: editorWhitespaces, hc: editorWhitespaces }, nls.localize('editorIndentGuides', 'Color of the editor indentation guides.'));
export const editorActiveIndentGuides = registerColor('editorIndentGuide.activeBackground', { dark: editorWhitespaces, light: editorWhitespaces, hc: editorWhitespaces }, nls.localize('editorActiveIndentGuide', 'Color of the active editor indentation guides.'));
export const editorLineNumbers = registerColor('editorLineNumber.foreground', { dark: '#858585', light: '#237893', hc: Color.white }, nls.localize('editorLineNumbers', 'Color of editor line numbers.'));

const deprecatedEditorActiveLineNumber = registerColor('editorActiveLineNumber.foreground', { dark: '#c6c6c6', light: '#0B216F', hc: activeContrastBorder }, nls.localize('editorActiveLineNumber', 'Color of editor active line number'), false, nls.localize('deprecatedEditorActiveLineNumber', 'Id is deprecated. Use \'editorLineNumber.activeForeground\' instead.'));
export const editorActiveLineNumber = registerColor('editorLineNumber.activeForeground', { dark: deprecatedEditorActiveLineNumber, light: deprecatedEditorActiveLineNumber, hc: deprecatedEditorActiveLineNumber }, nls.localize('editorActiveLineNumber', 'Color of editor active line number'));

export const editorRuler = registerColor('editorRuler.foreground', { dark: '#5A5A5A', light: Color.lightgrey, hc: Color.white }, nls.localize('editorRuler', 'Color of the editor rulers.'));

export const editorCodeLensForeground = registerColor('editorCodeLens.foreground', { dark: '#999999', light: '#919191', hc: '#999999' }, nls.localize('editorCodeLensForeground', 'Foreground color of editor CodeLens'));

export const editorBracketMatchBackground = registerColor('editorBracketMatch.background', { dark: '#0064001a', light: '#0064001a', hc: '#0064001a' }, nls.localize('editorBracketMatchBackground', 'Background color behind matching brackets'));
export const editorBracketMatchBorder = registerColor('editorBracketMatch.border', { dark: '#888', light: '#B9B9B9', hc: contrastBorder }, nls.localize('editorBracketMatchBorder', 'Color for matching brackets boxes'));

export const editorOverviewRulerBorder = registerColor('editorOverviewRuler.border', { dark: '#7f7f7f4d', light: '#7f7f7f4d', hc: '#7f7f7f4d' }, nls.localize('editorOverviewRulerBorder', 'Color of the overview ruler border.'));
export const editorOverviewRulerBackground = registerColor('editorOverviewRuler.background', null, nls.localize('editorOverviewRulerBackground', 'Background color of the editor overview ruler. Only used when the minimap is enabled and placed on the right side of the editor.'));

export const editorGutter = registerColor('editorGutter.background', { dark: editorBackground, light: editorBackground, hc: editorBackground }, nls.localize('editorGutter', 'Background color of the editor gutter. The gutter contains the glyph margins and the line numbers.'));

export const editorUnnecessaryCodeBorder = registerColor('editorUnnecessaryCode.border', { dark: null, light: null, hc: Color.fromHex('#fff').transparent(0.8) }, nls.localize('unnecessaryCodeBorder', 'Border color of unnecessary (unused) source code in the editor.'));
export const editorUnnecessaryCodeOpacity = registerColor('editorUnnecessaryCode.opacity', { dark: Color.fromHex('#000a'), light: Color.fromHex('#0007'), hc: null }, nls.localize('unnecessaryCodeOpacity', 'Opacity of unnecessary (unused) source code in the editor. For example, "#000000c0" will render the code with 75% opacity. For high contrast themes, use the  \'editorUnnecessaryCode.border\' theme color to underline unnecessary code instead of fading it out.'));

export const ghostTextBorder = registerColor('editorGhostText.border', { dark: null, light: null, hc: Color.fromHex('#fff').transparent(0.8) }, nls.localize('editorGhostTextBorder', 'Border color of ghost text in the editor.'));
export const ghostTextForeground = registerColor('editorGhostText.foreground', { dark: Color.fromHex('#ffffff56'), light: Color.fromHex('#0007'), hc: null }, nls.localize('editorGhostTextForeground', 'Foreground color of the ghost text in the editor.'));
export const ghostTextBackground = registerColor('editorGhostText.background', { dark: null, light: null, hc: null }, nls.localize('editorGhostTextBackground', 'Background color of the ghost text in the editor.'));

const rulerRangeDefault = new Color(new RGBA(0, 122, 204, 0.6));
export const overviewRulerRangeHighlight = registerColor('editorOverviewRuler.rangeHighlightForeground', { dark: rulerRangeDefault, light: rulerRangeDefault, hc: rulerRangeDefault }, nls.localize('overviewRulerRangeHighlight', 'Overview ruler marker color for range highlights. The color must not be opaque so as not to hide underlying decorations.'), true);
export const overviewRulerError = registerColor('editorOverviewRuler.errorForeground', { dark: new Color(new RGBA(255, 18, 18, 0.7)), light: new Color(new RGBA(255, 18, 18, 0.7)), hc: new Color(new RGBA(255, 50, 50, 1)) }, nls.localize('overviewRuleError', 'Overview ruler marker color for errors.'));
export const overviewRulerWarning = registerColor('editorOverviewRuler.warningForeground', { dark: editorWarningForeground, light: editorWarningForeground, hc: editorWarningBorder }, nls.localize('overviewRuleWarning', 'Overview ruler marker color for warnings.'));
export const overviewRulerInfo = registerColor('editorOverviewRuler.infoForeground', { dark: editorInfoForeground, light: editorInfoForeground, hc: editorInfoBorder }, nls.localize('overviewRuleInfo', 'Overview ruler marker color for infos.'));

export const editorBracketHighlightingForeground1 = registerColor('editorBracketHighlight.foreground1', { dark: '#FFD700', light: '#0431FAFF', hc: '#FFD700' }, nls.localize('editorBracketHighlightForeground1', 'Foreground color of brackets (1). Requires enabling bracket pair colorization.'));
export const editorBracketHighlightingForeground2 = registerColor('editorBracketHighlight.foreground2', { dark: '#DA70D6', light: '#319331FF', hc: '#DA70D6' }, nls.localize('editorBracketHighlightForeground2', 'Foreground color of brackets (2). Requires enabling bracket pair colorization.'));
export const editorBracketHighlightingForeground3 = registerColor('editorBracketHighlight.foreground3', { dark: '#179FFF', light: '#7B3814FF', hc: '#87CEFA' }, nls.localize('editorBracketHighlightForeground3', 'Foreground color of brackets (3). Requires enabling bracket pair colorization.'));
export const editorBracketHighlightingForeground4 = registerColor('editorBracketHighlight.foreground4', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketHighlightForeground4', 'Foreground color of brackets (4). Requires enabling bracket pair colorization.'));
export const editorBracketHighlightingForeground5 = registerColor('editorBracketHighlight.foreground5', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketHighlightForeground5', 'Foreground color of brackets (5). Requires enabling bracket pair colorization.'));
export const editorBracketHighlightingForeground6 = registerColor('editorBracketHighlight.foreground6', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketHighlightForeground6', 'Foreground color of brackets (6). Requires enabling bracket pair colorization.'));

export const editorBracketHighlightingUnexpectedBracketForeground = registerColor('editorBracketHighlight.unexpectedBracket.foreground', { dark: new Color(new RGBA(255, 18, 18, 0.8)), light: new Color(new RGBA(255, 18, 18, 0.8)), hc: new Color(new RGBA(255, 50, 50, 1)) }, nls.localize('editorBracketHighlightUnexpectedBracketForeground', 'Foreground color of unexpected brackets.'));

export const editorBracketPairGuideBackground1 = registerColor('editorBracketPairGuide.background1', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.background1', 'Background color of inactive bracket pair guides (1). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideBackground2 = registerColor('editorBracketPairGuide.background2', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.background2', 'Background color of inactive bracket pair guides (2). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideBackground3 = registerColor('editorBracketPairGuide.background3', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.background3', 'Background color of inactive bracket pair guides (3). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideBackground4 = registerColor('editorBracketPairGuide.background4', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.background4', 'Background color of inactive bracket pair guides (4). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideBackground5 = registerColor('editorBracketPairGuide.background5', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.background5', 'Background color of inactive bracket pair guides (5). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideBackground6 = registerColor('editorBracketPairGuide.background6', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.background6', 'Background color of inactive bracket pair guides (6). Requires enabling bracket pair guides.'));

export const editorBracketPairGuideActiveBackground1 = registerColor('editorBracketPairGuide.activeBackground1', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.activeBackground1', 'Background color of active bracket pair guides (1). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideActiveBackground2 = registerColor('editorBracketPairGuide.activeBackground2', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.activeBackground2', 'Background color of active bracket pair guides (2). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideActiveBackground3 = registerColor('editorBracketPairGuide.activeBackground3', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.activeBackground3', 'Background color of active bracket pair guides (3). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideActiveBackground4 = registerColor('editorBracketPairGuide.activeBackground4', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.activeBackground4', 'Background color of active bracket pair guides (4). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideActiveBackground5 = registerColor('editorBracketPairGuide.activeBackground5', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.activeBackground5', 'Background color of active bracket pair guides (5). Requires enabling bracket pair guides.'));
export const editorBracketPairGuideActiveBackground6 = registerColor('editorBracketPairGuide.activeBackground6', { dark: '#00000000', light: '#00000000', hc: '#00000000' }, nls.localize('editorBracketPairGuide.activeBackground6', 'Background color of active bracket pair guides (6). Requires enabling bracket pair guides.'));


// contains all color rules that used to defined in editor/browser/widget/editor.css
registerThemingParticipant((theme, collector) => {
	const background = theme.getColor(editorBackground);
	if (background) {
		collector.addRule(`.monaco-editor, .monaco-editor-background, .monaco-editor .inputarea.ime-input { background-color: ${background}; }`);
	}

	const foreground = theme.getColor(editorForeground);
	if (foreground) {
		collector.addRule(`.monaco-editor, .monaco-editor .inputarea.ime-input { color: ${foreground}; }`);
	}

	const gutter = theme.getColor(editorGutter);
	if (gutter) {
		collector.addRule(`.monaco-editor .margin { background-color: ${gutter}; }`);
	}

	const rangeHighlight = theme.getColor(editorRangeHighlight);
	if (rangeHighlight) {
		collector.addRule(`.monaco-editor .rangeHighlight { background-color: ${rangeHighlight}; }`);
	}

	const rangeHighlightBorder = theme.getColor(editorRangeHighlightBorder);
	if (rangeHighlightBorder) {
		collector.addRule(`.monaco-editor .rangeHighlight { border: 1px ${theme.type === 'hc' ? 'dotted' : 'solid'} ${rangeHighlightBorder}; }`);
	}

	const symbolHighlight = theme.getColor(editorSymbolHighlight);
	if (symbolHighlight) {
		collector.addRule(`.monaco-editor .symbolHighlight { background-color: ${symbolHighlight}; }`);
	}

	const symbolHighlightBorder = theme.getColor(editorSymbolHighlightBorder);
	if (symbolHighlightBorder) {
		collector.addRule(`.monaco-editor .symbolHighlight { border: 1px ${theme.type === 'hc' ? 'dotted' : 'solid'} ${symbolHighlightBorder}; }`);
	}

	const invisibles = theme.getColor(editorWhitespaces);
	if (invisibles) {
		collector.addRule(`.monaco-editor .mtkw { color: ${invisibles} !important; }`);
		collector.addRule(`.monaco-editor .mtkz { color: ${invisibles} !important; }`);
	}
});
