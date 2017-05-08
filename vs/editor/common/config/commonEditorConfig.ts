/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import Event, { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import * as platform from 'vs/base/common/platform';
import { Extensions, IConfigurationRegistry, IConfigurationNode } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/platform';
import { DefaultConfig, DEFAULT_INDENTATION, DEFAULT_TRIM_AUTO_WHITESPACE } from 'vs/editor/common/config/defaultConfig';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { FontInfo, BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';
import * as editorOptions from 'vs/editor/common/config/editorOptions';

/**
 * Control what pressing Tab does.
 * If it is false, pressing Tab or Shift-Tab will be handled by the editor.
 * If it is true, pressing Tab or Shift-Tab will move the browser focus.
 * Defaults to false.
 */
export interface ITabFocus {
	onDidChangeTabFocus: Event<boolean>;
	getTabFocusMode(): boolean;
	setTabFocusMode(tabFocusMode: boolean): void;
}

export const TabFocus: ITabFocus = new class {
	private _tabFocus: boolean = false;

	private _onDidChangeTabFocus: Emitter<boolean> = new Emitter<boolean>();
	public onDidChangeTabFocus: Event<boolean> = this._onDidChangeTabFocus.event;

	public getTabFocusMode(): boolean {
		return this._tabFocus;
	}

	public setTabFocusMode(tabFocusMode: boolean): void {
		if (this._tabFocus === tabFocusMode) {
			return;
		}

		this._tabFocus = tabFocusMode;
		this._onDidChangeTabFocus.fire(this._tabFocus);
	}
};

export class ConfigurationWithDefaults {

	private _editor: editorOptions.IEditorOptions;

	constructor(options: editorOptions.IEditorOptions) {
		this._editor = <editorOptions.IEditorOptions>objects.clone(DefaultConfig.editor);

		this._mergeOptionsIn(options);
	}

	public getEditorOptions(): editorOptions.IEditorOptions {
		return this._editor;
	}

	private _mergeOptionsIn(newOptions: editorOptions.IEditorOptions): void {
		this._editor = objects.mixin(this._editor, newOptions || {});
	}

	public updateOptions(newOptions: editorOptions.IEditorOptions): void {
		// Apply new options
		this._mergeOptionsIn(newOptions);
	}
}

function toBoolean(value: any): boolean {
	return value === 'false' ? false : Boolean(value);
}

export interface IElementSizeObserver {
	startObserving(): void;
	observe(dimension?: editorCommon.IDimension): void;
	dispose(): void;
	getWidth(): number;
	getHeight(): number;
}

export abstract class CommonEditorConfiguration extends Disposable implements editorCommon.IConfiguration {

	public editor: editorOptions.InternalEditorOptions;

	protected _configWithDefaults: ConfigurationWithDefaults;
	protected _elementSizeObserver: IElementSizeObserver;
	private _isDominatedByLongLines: boolean;
	private _lineNumbersDigitCount: number;

	private _onDidChange = this._register(new Emitter<editorOptions.IConfigurationChangedEvent>());
	public onDidChange: Event<editorOptions.IConfigurationChangedEvent> = this._onDidChange.event;

	constructor(options: editorOptions.IEditorOptions, elementSizeObserver: IElementSizeObserver = null) {
		super();
		this._configWithDefaults = new ConfigurationWithDefaults(options);
		this._elementSizeObserver = elementSizeObserver;
		this._isDominatedByLongLines = false;
		this._lineNumbersDigitCount = 1;
		this.editor = this._computeInternalOptions();
		this._register(EditorZoom.onDidChangeZoomLevel(_ => this._recomputeOptions()));
		this._register(TabFocus.onDidChangeTabFocus(_ => this._recomputeOptions()));
	}

	public dispose(): void {
		super.dispose();
	}

	protected _recomputeOptions(): void {
		this._setOptions(this._computeInternalOptions());
	}

	private _setOptions(newOptions: editorOptions.InternalEditorOptions): void {
		if (this.editor && this.editor.equals(newOptions)) {
			return;
		}

		let changeEvent = this.editor.createChangeEvent(newOptions);
		this.editor = newOptions;
		this._onDidChange.fire(changeEvent);
	}

	public getRawOptions(): editorOptions.IEditorOptions {
		return this._configWithDefaults.getEditorOptions();
	}

	private _computeInternalOptions(): editorOptions.InternalEditorOptions {
		let opts = this._configWithDefaults.getEditorOptions();

		let editorClassName = this._getEditorClassName(opts.theme, toBoolean(opts.fontLigatures), opts.mouseStyle);

		let bareFontInfo = BareFontInfo.createFromRawSettings(opts, this.getZoomLevel());

		const env = new editorOptions.EnvironmentalOptions({
			outerWidth: this.getOuterWidth(),
			outerHeight: this.getOuterHeight(),
			fontInfo: this.readConfiguration(bareFontInfo),
			editorClassName: editorClassName,
			isDominatedByLongLines: this._isDominatedByLongLines,
			lineNumbersDigitCount: this._lineNumbersDigitCount,
			canUseTranslate3d: this._getCanUseTranslate3d(),
			pixelRatio: this._getPixelRatio(),
			tabFocusMode: TabFocus.getTabFocusMode()
		});

		return editorOptions.InternalEditorOptionsFactory.createInternalEditorOptions(env, opts);
	}

	public updateOptions(newOptions: editorOptions.IEditorOptions): void {
		this._configWithDefaults.updateOptions(newOptions);
		this._recomputeOptions();
	}

	public setIsDominatedByLongLines(isDominatedByLongLines: boolean): void {
		this._isDominatedByLongLines = isDominatedByLongLines;
		this._recomputeOptions();
	}

	public setMaxLineNumber(maxLineNumber: number): void {
		let digitCount = CommonEditorConfiguration._digitCount(maxLineNumber);
		if (this._lineNumbersDigitCount === digitCount) {
			return;
		}
		this._lineNumbersDigitCount = digitCount;
		this._recomputeOptions();
	}

	private static _digitCount(n: number): number {
		var r = 0;
		while (n) {
			n = Math.floor(n / 10);
			r++;
		}
		return r ? r : 1;
	}

	protected abstract _getEditorClassName(theme: string, fontLigatures: boolean, mouseDrag: 'text' | 'default' | 'copy'): string;

	protected abstract getOuterWidth(): number;

	protected abstract getOuterHeight(): number;

	protected abstract _getCanUseTranslate3d(): boolean;

	protected abstract _getPixelRatio(): number;

	protected abstract readConfiguration(styling: BareFontInfo): FontInfo;

	protected abstract getZoomLevel(): number;
}

const configurationRegistry = <IConfigurationRegistry>Registry.as(Extensions.Configuration);
const editorConfiguration: IConfigurationNode = {
	'id': 'editor',
	'order': 5,
	'type': 'object',
	'title': nls.localize('editorConfigurationTitle', "Editor"),
	'overridable': true,
	'properties': {
		'editor.fontFamily': {
			'type': 'string',
			'default': DefaultConfig.editor.fontFamily,
			'description': nls.localize('fontFamily', "Controls the font family.")
		},
		'editor.fontWeight': {
			'type': 'string',
			'enum': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
			'default': DefaultConfig.editor.fontWeight,
			'description': nls.localize('fontWeight', "Controls the font weight.")
		},
		'editor.fontSize': {
			'type': 'number',
			'default': DefaultConfig.editor.fontSize,
			'description': nls.localize('fontSize', "Controls the font size in pixels.")
		},
		'editor.lineHeight': {
			'type': 'number',
			'default': DefaultConfig.editor.lineHeight,
			'description': nls.localize('lineHeight', "Controls the line height. Use 0 to compute the lineHeight from the fontSize.")
		},
		'editor.lineNumbers': {
			'type': 'string',
			'enum': ['off', 'on', 'relative'],
			'default': DefaultConfig.editor.lineNumbers,
			'description': nls.localize('lineNumbers', "Controls the display of line numbers. Possible values are 'on', 'off', and 'relative'. 'relative' shows the line count from the current cursor position.")
		},
		'editor.rulers': {
			'type': 'array',
			'items': {
				'type': 'number'
			},
			'default': DefaultConfig.editor.rulers,
			'description': nls.localize('rulers', "Columns at which to show vertical rulers")
		},
		'editor.wordSeparators': {
			'type': 'string',
			'default': DefaultConfig.editor.wordSeparators,
			'description': nls.localize('wordSeparators', "Characters that will be used as word separators when doing word related navigations or operations")
		},
		'editor.tabSize': {
			'type': 'number',
			'default': DEFAULT_INDENTATION.tabSize,
			'minimum': 1,
			'description': nls.localize('tabSize', "The number of spaces a tab is equal to. This setting is overriden based on the file contents when `editor.detectIndentation` is on."),
			'errorMessage': nls.localize('tabSize.errorMessage', "Expected 'number'. Note that the value \"auto\" has been replaced by the `editor.detectIndentation` setting.")
		},
		'editor.insertSpaces': {
			'type': 'boolean',
			'default': DEFAULT_INDENTATION.insertSpaces,
			'description': nls.localize('insertSpaces', "Insert spaces when pressing Tab. This setting is overriden based on the file contents when `editor.detectIndentation` is on."),
			'errorMessage': nls.localize('insertSpaces.errorMessage', "Expected 'boolean'. Note that the value \"auto\" has been replaced by the `editor.detectIndentation` setting.")
		},
		'editor.detectIndentation': {
			'type': 'boolean',
			'default': DEFAULT_INDENTATION.detectIndentation,
			'description': nls.localize('detectIndentation', "When opening a file, `editor.tabSize` and `editor.insertSpaces` will be detected based on the file contents.")
		},
		'editor.roundedSelection': {
			'type': 'boolean',
			'default': DefaultConfig.editor.roundedSelection,
			'description': nls.localize('roundedSelection', "Controls if selections have rounded corners")
		},
		'editor.scrollBeyondLastLine': {
			'type': 'boolean',
			'default': DefaultConfig.editor.scrollBeyondLastLine,
			'description': nls.localize('scrollBeyondLastLine', "Controls if the editor will scroll beyond the last line")
		},
		'editor.minimap.enabled': {
			'type': 'boolean',
			'default': DefaultConfig.editor.minimap.enabled,
			'description': nls.localize('minimap.enabled', "Controls if the minimap is shown")
		},
		'editor.minimap.renderCharacters': {
			'type': 'boolean',
			'default': DefaultConfig.editor.minimap.renderCharacters,
			'description': nls.localize('minimap.renderCharacters', "Render the actual characters on a line (as opposed to color blocks)")
		},
		'editor.minimap.maxColumn': {
			'type': 'number',
			'default': DefaultConfig.editor.minimap.maxColumn,
			'description': nls.localize('minimap.maxColumn', "Limit the width of the minimap to render at most a certain number of columns")
		},
		'editor.wordWrap': {
			'type': 'string',
			'enum': ['off', 'on', 'wordWrapColumn', 'bounded'],
			'enumDescriptions': [
				nls.localize('wordWrap.off', "Lines will never wrap."),
				nls.localize('wordWrap.on', "Lines will wrap at the viewport width."),
				nls.localize({
					key: 'wordWrap.wordWrapColumn',
					comment: [
						'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
					]
				}, "Lines will wrap at `editor.wordWrapColumn`."),
				nls.localize({
					key: 'wordWrap.bounded',
					comment: [
						'- viewport means the edge of the visible window size.',
						'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
					]
				}, "Lines will wrap at the minimum of viewport and `editor.wordWrapColumn`."),
			],
			'default': DefaultConfig.editor.wordWrap,
			'description': nls.localize({
				key: 'wordWrap',
				comment: [
					'- \'off\', \'on\', \'wordWrapColumn\' and \'bounded\' refer to values the setting can take and should not be localized.',
					'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
				]
			}, "Controls how lines should wrap. Can be:\n - 'off' (disable wrapping),\n - 'on' (viewport wrapping),\n - 'wordWrapColumn' (wrap at `editor.wordWrapColumn`) or\n - 'bounded' (wrap at minimum of viewport and `editor.wordWrapColumn`).")
		},
		'editor.wordWrapColumn': {
			'type': 'integer',
			'default': DefaultConfig.editor.wordWrapColumn,
			'minimum': 1,
			'description': nls.localize({
				key: 'wordWrapColumn',
				comment: [
					'- `editor.wordWrap` refers to a different setting and should not be localized.',
					'- \'wordWrapColumn\' and \'bounded\' refer to values the different setting can take and should not be localized.'
				]
			}, "Controls the wrapping column of the editor when `editor.wordWrap` is 'wordWrapColumn' or 'bounded'.")
		},
		'editor.wrappingIndent': {
			'type': 'string',
			'enum': ['none', 'same', 'indent'],
			'default': DefaultConfig.editor.wrappingIndent,
			'description': nls.localize('wrappingIndent', "Controls the indentation of wrapped lines. Can be one of 'none', 'same' or 'indent'.")
		},
		'editor.mouseWheelScrollSensitivity': {
			'type': 'number',
			'default': DefaultConfig.editor.mouseWheelScrollSensitivity,
			'description': nls.localize('mouseWheelScrollSensitivity', "A multiplier to be used on the `deltaX` and `deltaY` of mouse wheel scroll events")
		},
		'editor.quickSuggestions': {
			'anyOf': [
				{
					type: 'boolean',
				},
				{
					type: 'object',
					properties: {
						strings: {
							type: 'boolean',
							default: false,
							description: nls.localize('quickSuggestions.strings', "Enable quick suggestions inside strings.")
						},
						comments: {
							type: 'boolean',
							default: false,
							description: nls.localize('quickSuggestions.comments', "Enable quick suggestions inside comments.")
						},
						other: {
							type: 'boolean',
							default: true,
							description: nls.localize('quickSuggestions.other', "Enable quick suggestions outside of strings and comments.")
						},
					}
				}
			],
			'default': DefaultConfig.editor.quickSuggestions,
			'description': nls.localize('quickSuggestions', "Controls if suggestions should automatically show up while typing")
		},
		'editor.quickSuggestionsDelay': {
			'type': 'integer',
			'default': DefaultConfig.editor.quickSuggestionsDelay,
			'minimum': 0,
			'description': nls.localize('quickSuggestionsDelay', "Controls the delay in ms after which quick suggestions will show up")
		},
		'editor.parameterHints': {
			'type': 'boolean',
			'default': DefaultConfig.editor.parameterHints,
			'description': nls.localize('parameterHints', "Enables parameter hints")
		},
		'editor.autoClosingBrackets': {
			'type': 'boolean',
			'default': DefaultConfig.editor.autoClosingBrackets,
			'description': nls.localize('autoClosingBrackets', "Controls if the editor should automatically close brackets after opening them")
		},
		'editor.formatOnType': {
			'type': 'boolean',
			'default': DefaultConfig.editor.formatOnType,
			'description': nls.localize('formatOnType', "Controls if the editor should automatically format the line after typing")
		},
		'editor.formatOnPaste': {
			'type': 'boolean',
			'default': DefaultConfig.editor.formatOnPaste,
			'description': nls.localize('formatOnPaste', "Controls if the editor should automatically format the pasted content. A formatter must be available and the formatter should be able to format a range in a document.")
		},
		'editor.suggestOnTriggerCharacters': {
			'type': 'boolean',
			'default': DefaultConfig.editor.suggestOnTriggerCharacters,
			'description': nls.localize('suggestOnTriggerCharacters', "Controls if suggestions should automatically show up when typing trigger characters")
		},
		'editor.acceptSuggestionOnEnter': {
			'type': 'boolean',
			'default': DefaultConfig.editor.acceptSuggestionOnEnter,
			'description': nls.localize('acceptSuggestionOnEnter', "Controls if suggestions should be accepted on 'Enter' - in addition to 'Tab'. Helps to avoid ambiguity between inserting new lines or accepting suggestions.")
		},
		'editor.acceptSuggestionOnCommitCharacter': {
			'type': 'boolean',
			'default': DefaultConfig.editor.acceptSuggestionOnCommitCharacter,
			'description': nls.localize('acceptSuggestionOnCommitCharacter', "Controls if suggestions should be accepted on commit characters. For instance in JavaScript the semi-colon (';') can be a commit character that accepts a suggestion and types that character.")
		},
		'editor.snippetSuggestions': {
			'type': 'string',
			'enum': ['top', 'bottom', 'inline', 'none'],
			'default': DefaultConfig.editor.snippetSuggestions,
			'description': nls.localize('snippetSuggestions', "Controls whether snippets are shown with other suggestions and how they are sorted.")
		},
		'editor.emptySelectionClipboard': {
			'type': 'boolean',
			'default': DefaultConfig.editor.emptySelectionClipboard,
			'description': nls.localize('emptySelectionClipboard', "Controls whether copying without a selection copies the current line.")
		},
		'editor.wordBasedSuggestions': {
			'type': 'boolean',
			'default': DefaultConfig.editor.wordBasedSuggestions,
			'description': nls.localize('wordBasedSuggestions', "Controls whether completions should be computed based on words in the document.")
		},
		'editor.suggestFontSize': {
			'type': 'integer',
			'default': 0,
			'minimum': 0,
			'description': nls.localize('suggestFontSize', "Font size for the suggest widget")
		},
		'editor.suggestLineHeight': {
			'type': 'integer',
			'default': 0,
			'minimum': 0,
			'description': nls.localize('suggestLineHeight', "Line height for the suggest widget")
		},
		'editor.selectionHighlight': {
			'type': 'boolean',
			'default': DefaultConfig.editor.selectionHighlight,
			'description': nls.localize('selectionHighlight', "Controls whether the editor should highlight similar matches to the selection")
		},
		'editor.occurrencesHighlight': {
			'type': 'boolean',
			'default': DefaultConfig.editor.occurrencesHighlight,
			'description': nls.localize('occurrencesHighlight', "Controls whether the editor should highlight semantic symbol occurrences")
		},
		'editor.overviewRulerLanes': {
			'type': 'integer',
			'default': 3,
			'description': nls.localize('overviewRulerLanes', "Controls the number of decorations that can show up at the same position in the overview ruler")
		},
		'editor.overviewRulerBorder': {
			'type': 'boolean',
			'default': DefaultConfig.editor.overviewRulerBorder,
			'description': nls.localize('overviewRulerBorder', "Controls if a border should be drawn around the overview ruler.")
		},
		'editor.cursorBlinking': {
			'type': 'string',
			'enum': ['blink', 'smooth', 'phase', 'expand', 'solid'],
			'default': DefaultConfig.editor.cursorBlinking,
			'description': nls.localize('cursorBlinking', "Control the cursor animation style, possible values are 'blink', 'smooth', 'phase', 'expand' and 'solid'")
		},
		'editor.mouseWheelZoom': {
			'type': 'boolean',
			'default': DefaultConfig.editor.mouseWheelZoom,
			'description': nls.localize('mouseWheelZoom', "Zoom the font of the editor when using mouse wheel and holding Ctrl")
		},
		'editor.cursorStyle': {
			'type': 'string',
			'enum': ['block', 'block-outline', 'line', 'line-thin', 'underline', 'underline-thin'],
			'default': DefaultConfig.editor.cursorStyle,
			'description': nls.localize('cursorStyle', "Controls the cursor style, accepted values are 'block', 'block-outline', 'line', 'line-thin', 'underline' and 'underline-thin'")
		},
		'editor.fontLigatures': {
			'type': 'boolean',
			'default': DefaultConfig.editor.fontLigatures,
			'description': nls.localize('fontLigatures', "Enables font ligatures")
		},
		'editor.hideCursorInOverviewRuler': {
			'type': 'boolean',
			'default': DefaultConfig.editor.hideCursorInOverviewRuler,
			'description': nls.localize('hideCursorInOverviewRuler', "Controls if the cursor should be hidden in the overview ruler.")
		},
		'editor.renderWhitespace': {
			'type': 'string',
			'enum': ['none', 'boundary', 'all'],
			default: DefaultConfig.editor.renderWhitespace,
			description: nls.localize('renderWhitespace', "Controls how the editor should render whitespace characters, possibilities are 'none', 'boundary', and 'all'. The 'boundary' option does not render single spaces between words.")
		},
		'editor.renderControlCharacters': {
			'type': 'boolean',
			default: DefaultConfig.editor.renderControlCharacters,
			description: nls.localize('renderControlCharacters', "Controls whether the editor should render control characters")
		},
		'editor.renderIndentGuides': {
			'type': 'boolean',
			default: DefaultConfig.editor.renderIndentGuides,
			description: nls.localize('renderIndentGuides', "Controls whether the editor should render indent guides")
		},
		'editor.renderLineHighlight': {
			'type': 'string',
			'enum': ['none', 'gutter', 'line', 'all'],
			default: DefaultConfig.editor.renderLineHighlight,
			description: nls.localize('renderLineHighlight', "Controls how the editor should render the current line highlight, possibilities are 'none', 'gutter', 'line', and 'all'.")
		},
		'editor.codeLens': {
			'type': 'boolean',
			'default': DefaultConfig.editor.codeLens,
			'description': nls.localize('codeLens', "Controls if the editor shows code lenses")
		},
		'editor.folding': {
			'type': 'boolean',
			'default': DefaultConfig.editor.folding,
			'description': nls.localize('folding', "Controls whether the editor has code folding enabled")
		},
		'editor.hideFoldIcons': {
			'type': 'boolean',
			'default': DefaultConfig.editor.hideFoldIcons,
			'description': nls.localize('hideFoldIcons', "Controls whether the fold icons on the gutter are automatically hidden.")
		},
		'editor.matchBrackets': {
			'type': 'boolean',
			'default': DefaultConfig.editor.matchBrackets,
			'description': nls.localize('matchBrackets', "Highlight matching brackets when one of them is selected.")
		},
		'editor.glyphMargin': {
			'type': 'boolean',
			'default': DefaultConfig.editor.glyphMargin,
			'description': nls.localize('glyphMargin', "Controls whether the editor should render the vertical glyph margin. Glyph margin is mostly used for debugging.")
		},
		'editor.useTabStops': {
			'type': 'boolean',
			'default': DefaultConfig.editor.useTabStops,
			'description': nls.localize('useTabStops', "Inserting and deleting whitespace follows tab stops")
		},
		'editor.trimAutoWhitespace': {
			'type': 'boolean',
			'default': DEFAULT_TRIM_AUTO_WHITESPACE,
			'description': nls.localize('trimAutoWhitespace', "Remove trailing auto inserted whitespace")
		},
		'editor.stablePeek': {
			'type': 'boolean',
			'default': false,
			'description': nls.localize('stablePeek', "Keep peek editors open even when double clicking their content or when hitting Escape.")
		},
		'editor.dragAndDrop': {
			'type': 'boolean',
			'default': DefaultConfig.editor.dragAndDrop,
			'description': nls.localize('dragAndDrop', "Controls if the editor should allow to move selections via drag and drop.")
		},
		'diffEditor.renderSideBySide': {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('sideBySide', "Controls if the diff editor shows the diff side by side or inline")
		},
		'diffEditor.ignoreTrimWhitespace': {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('ignoreTrimWhitespace', "Controls if the diff editor shows changes in leading or trailing whitespace as diffs")
		},
		'diffEditor.renderIndicators': {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('renderIndicators', "Controls if the diff editor shows +/- indicators for added/removed changes")
		}
	}
};

if (platform.isLinux) {
	editorConfiguration['properties']['editor.selectionClipboard'] = {
		'type': 'boolean',
		'default': DefaultConfig.editor.selectionClipboard,
		'description': nls.localize('selectionClipboard', "Controls if the Linux primary clipboard should be supported.")
	};
}

configurationRegistry.registerConfiguration(editorConfiguration);
