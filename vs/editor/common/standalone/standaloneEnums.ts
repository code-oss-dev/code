/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// THIS IS A GENERATED FILE. DO NOT EDIT DIRECTLY.


export enum AccessibilitySupport {
	/**
	 * This should be the browser case where it is not known if a screen reader is attached or no.
	 */
	Unknown = 0,
	Disabled = 1,
	Enabled = 2
}

export enum CompletionItemInsertTextRule {
	/**
	 * Adjust whitespace/indentation of multiline insert texts to
	 * match the current line indentation.
	 */
	KeepWhitespace = 1,
	/**
	 * `insertText` is a snippet.
	 */
	InsertAsSnippet = 4
}

export enum CompletionItemKind {
	Method = 0,
	Function = 1,
	Constructor = 2,
	Field = 3,
	Variable = 4,
	Class = 5,
	Struct = 6,
	Interface = 7,
	Module = 8,
	Property = 9,
	Event = 10,
	Operator = 11,
	Unit = 12,
	Value = 13,
	Constant = 14,
	Enum = 15,
	EnumMember = 16,
	Keyword = 17,
	Text = 18,
	Color = 19,
	File = 20,
	Reference = 21,
	Customcolor = 22,
	Folder = 23,
	TypeParameter = 24,
	User = 25,
	Issue = 26,
	Snippet = 27
}

export enum CompletionItemTag {
	Deprecated = 1
}

/**
 * How a suggest provider was triggered.
 */
export enum CompletionTriggerKind {
	Invoke = 0,
	TriggerCharacter = 1,
	TriggerForIncompleteCompletions = 2
}

/**
 * A positioning preference for rendering content widgets.
 */
export enum ContentWidgetPositionPreference {
	/**
	 * Place the content widget exactly at a position
	 */
	EXACT = 0,
	/**
	 * Place the content widget above a position
	 */
	ABOVE = 1,
	/**
	 * Place the content widget below a position
	 */
	BELOW = 2
}

/**
 * Describes the reason the cursor has changed its position.
 */
export enum CursorChangeReason {
	/**
	 * Unknown or not set.
	 */
	NotSet = 0,
	/**
	 * A `model.setValue()` was called.
	 */
	ContentFlush = 1,
	/**
	 * The `model` has been changed outside of this cursor and the cursor recovers its position from associated markers.
	 */
	RecoverFromMarkers = 2,
	/**
	 * There was an explicit user gesture.
	 */
	Explicit = 3,
	/**
	 * There was a Paste.
	 */
	Paste = 4,
	/**
	 * There was an Undo.
	 */
	Undo = 5,
	/**
	 * There was a Redo.
	 */
	Redo = 6
}

/**
 * The default end of line to use when instantiating models.
 */
export enum DefaultEndOfLine {
	/**
	 * Use line feed (\n) as the end of line character.
	 */
	LF = 1,
	/**
	 * Use carriage return and line feed (\r\n) as the end of line character.
	 */
	CRLF = 2
}

/**
 * A document highlight kind.
 */
export enum DocumentHighlightKind {
	/**
	 * A textual occurrence.
	 */
	Text = 0,
	/**
	 * Read-access of a symbol, like reading a variable.
	 */
	Read = 1,
	/**
	 * Write-access of a symbol, like writing to a variable.
	 */
	Write = 2
}

/**
 * Configuration options for auto indentation in the editor
 */
export enum EditorAutoIndentStrategy {
	None = 0,
	Keep = 1,
	Brackets = 2,
	Advanced = 3,
	Full = 4
}

export enum EditorOption {
	acceptSuggestionOnCommitCharacter = 0,
	acceptSuggestionOnEnter = 1,
	accessibilitySupport = 2,
	accessibilityPageSize = 3,
	ariaLabel = 4,
	autoClosingBrackets = 5,
	autoClosingDelete = 6,
	autoClosingOvertype = 7,
	autoClosingQuotes = 8,
	autoIndent = 9,
	automaticLayout = 10,
	autoSurround = 11,
	bracketPairColorization = 12,
	bracketPairGuides = 13,
	codeLens = 14,
	codeLensFontFamily = 15,
	codeLensFontSize = 16,
	colorDecorators = 17,
	columnSelection = 18,
	comments = 19,
	contextmenu = 20,
	copyWithSyntaxHighlighting = 21,
	cursorBlinking = 22,
	cursorSmoothCaretAnimation = 23,
	cursorStyle = 24,
	cursorSurroundingLines = 25,
	cursorSurroundingLinesStyle = 26,
	cursorWidth = 27,
	disableLayerHinting = 28,
	disableMonospaceOptimizations = 29,
	domReadOnly = 30,
	dragAndDrop = 31,
	emptySelectionClipboard = 32,
	extraEditorClassName = 33,
	fastScrollSensitivity = 34,
	find = 35,
	fixedOverflowWidgets = 36,
	folding = 37,
	foldingStrategy = 38,
	foldingHighlight = 39,
	foldingImportsByDefault = 40,
	unfoldOnClickAfterEndOfLine = 41,
	fontFamily = 42,
	fontInfo = 43,
	fontLigatures = 44,
	fontSize = 45,
	fontWeight = 46,
	formatOnPaste = 47,
	formatOnType = 48,
	glyphMargin = 49,
	gotoLocation = 50,
	hideCursorInOverviewRuler = 51,
	highlightActiveIndentGuide = 52,
	hover = 53,
	inDiffEditor = 54,
	inlineSuggest = 55,
	letterSpacing = 56,
	lightbulb = 57,
	lineDecorationsWidth = 58,
	lineHeight = 59,
	lineNumbers = 60,
	lineNumbersMinChars = 61,
	linkedEditing = 62,
	links = 63,
	matchBrackets = 64,
	minimap = 65,
	mouseStyle = 66,
	mouseWheelScrollSensitivity = 67,
	mouseWheelZoom = 68,
	multiCursorMergeOverlapping = 69,
	multiCursorModifier = 70,
	multiCursorPaste = 71,
	occurrencesHighlight = 72,
	overviewRulerBorder = 73,
	overviewRulerLanes = 74,
	padding = 75,
	parameterHints = 76,
	peekWidgetDefaultFocus = 77,
	definitionLinkOpensInPeek = 78,
	quickSuggestions = 79,
	quickSuggestionsDelay = 80,
	readOnly = 81,
	renameOnType = 82,
	renderControlCharacters = 83,
	renderIndentGuides = 84,
	renderFinalNewline = 85,
	renderLineHighlight = 86,
	renderLineHighlightOnlyWhenFocus = 87,
	renderValidationDecorations = 88,
	renderWhitespace = 89,
	revealHorizontalRightPadding = 90,
	roundedSelection = 91,
	rulers = 92,
	scrollbar = 93,
	scrollBeyondLastColumn = 94,
	scrollBeyondLastLine = 95,
	scrollPredominantAxis = 96,
	selectionClipboard = 97,
	selectionHighlight = 98,
	selectOnLineNumbers = 99,
	showFoldingControls = 100,
	showUnused = 101,
	snippetSuggestions = 102,
	smartSelect = 103,
	smoothScrolling = 104,
	stickyTabStops = 105,
	stopRenderingLineAfter = 106,
	suggest = 107,
	suggestFontSize = 108,
	suggestLineHeight = 109,
	suggestOnTriggerCharacters = 110,
	suggestSelection = 111,
	tabCompletion = 112,
	tabIndex = 113,
	unusualLineTerminators = 114,
	useShadowDOM = 115,
	useTabStops = 116,
	wordSeparators = 117,
	wordWrap = 118,
	wordWrapBreakAfterCharacters = 119,
	wordWrapBreakBeforeCharacters = 120,
	wordWrapColumn = 121,
	wordWrapOverride1 = 122,
	wordWrapOverride2 = 123,
	wrappingIndent = 124,
	wrappingStrategy = 125,
	showDeprecated = 126,
	inlayHints = 127,
	editorClassName = 128,
	pixelRatio = 129,
	tabFocusMode = 130,
	layoutInfo = 131,
	wrappingInfo = 132
}

/**
 * End of line character preference.
 */
export enum EndOfLinePreference {
	/**
	 * Use the end of line character identified in the text buffer.
	 */
	TextDefined = 0,
	/**
	 * Use line feed (\n) as the end of line character.
	 */
	LF = 1,
	/**
	 * Use carriage return and line feed (\r\n) as the end of line character.
	 */
	CRLF = 2
}

/**
 * End of line character preference.
 */
export enum EndOfLineSequence {
	/**
	 * Use line feed (\n) as the end of line character.
	 */
	LF = 0,
	/**
	 * Use carriage return and line feed (\r\n) as the end of line character.
	 */
	CRLF = 1
}

/**
 * Describes what to do with the indentation when pressing Enter.
 */
export enum IndentAction {
	/**
	 * Insert new line and copy the previous line's indentation.
	 */
	None = 0,
	/**
	 * Insert new line and indent once (relative to the previous line's indentation).
	 */
	Indent = 1,
	/**
	 * Insert two new lines:
	 *  - the first one indented which will hold the cursor
	 *  - the second one at the same indentation level
	 */
	IndentOutdent = 2,
	/**
	 * Insert new line and outdent once (relative to the previous line's indentation).
	 */
	Outdent = 3
}

export enum InlayHintKind {
	Other = 0,
	Type = 1,
	Parameter = 2
}

/**
 * How an {@link InlineCompletionsProvider inline completion provider} was triggered.
 */
export enum InlineCompletionTriggerKind {
	/**
	 * Completion was triggered automatically while editing.
	 * It is sufficient to return a single completion item in this case.
	 */
	Automatic = 0,
	/**
	 * Completion was triggered explicitly by a user gesture.
	 * Return multiple completion items to enable cycling through them.
	 */
	Explicit = 1
}

/**
 * Virtual Key Codes, the value does not hold any inherent meaning.
 * Inspired somewhat from https://msdn.microsoft.com/en-us/library/windows/desktop/dd375731(v=vs.85).aspx
 * But these are "more general", as they should work across browsers & OS`s.
 */
export enum KeyCode {
	DependsOnKbLayout = -1,
	/**
	 * Placed first to cover the 0 value of the enum.
	 */
	Unknown = 0,
	Backspace = 1,
	Tab = 2,
	Enter = 3,
	Shift = 4,
	Ctrl = 5,
	Alt = 6,
	PauseBreak = 7,
	CapsLock = 8,
	Escape = 9,
	Space = 10,
	PageUp = 11,
	PageDown = 12,
	End = 13,
	Home = 14,
	LeftArrow = 15,
	UpArrow = 16,
	RightArrow = 17,
	DownArrow = 18,
	Insert = 19,
	Delete = 20,
	KEY_0 = 21,
	KEY_1 = 22,
	KEY_2 = 23,
	KEY_3 = 24,
	KEY_4 = 25,
	KEY_5 = 26,
	KEY_6 = 27,
	KEY_7 = 28,
	KEY_8 = 29,
	KEY_9 = 30,
	KEY_A = 31,
	KEY_B = 32,
	KEY_C = 33,
	KEY_D = 34,
	KEY_E = 35,
	KEY_F = 36,
	KEY_G = 37,
	KEY_H = 38,
	KEY_I = 39,
	KEY_J = 40,
	KEY_K = 41,
	KEY_L = 42,
	KEY_M = 43,
	KEY_N = 44,
	KEY_O = 45,
	KEY_P = 46,
	KEY_Q = 47,
	KEY_R = 48,
	KEY_S = 49,
	KEY_T = 50,
	KEY_U = 51,
	KEY_V = 52,
	KEY_W = 53,
	KEY_X = 54,
	KEY_Y = 55,
	KEY_Z = 56,
	Meta = 57,
	ContextMenu = 58,
	F1 = 59,
	F2 = 60,
	F3 = 61,
	F4 = 62,
	F5 = 63,
	F6 = 64,
	F7 = 65,
	F8 = 66,
	F9 = 67,
	F10 = 68,
	F11 = 69,
	F12 = 70,
	F13 = 71,
	F14 = 72,
	F15 = 73,
	F16 = 74,
	F17 = 75,
	F18 = 76,
	F19 = 77,
	NumLock = 78,
	ScrollLock = 79,
	/**
	 * Used for miscellaneous characters; it can vary by keyboard.
	 * For the US standard keyboard, the ';:' key
	 */
	US_SEMICOLON = 80,
	/**
	 * For any country/region, the '+' key
	 * For the US standard keyboard, the '=+' key
	 */
	US_EQUAL = 81,
	/**
	 * For any country/region, the ',' key
	 * For the US standard keyboard, the ',<' key
	 */
	US_COMMA = 82,
	/**
	 * For any country/region, the '-' key
	 * For the US standard keyboard, the '-_' key
	 */
	US_MINUS = 83,
	/**
	 * For any country/region, the '.' key
	 * For the US standard keyboard, the '.>' key
	 */
	US_DOT = 84,
	/**
	 * Used for miscellaneous characters; it can vary by keyboard.
	 * For the US standard keyboard, the '/?' key
	 */
	US_SLASH = 85,
	/**
	 * Used for miscellaneous characters; it can vary by keyboard.
	 * For the US standard keyboard, the '`~' key
	 */
	US_BACKTICK = 86,
	/**
	 * Used for miscellaneous characters; it can vary by keyboard.
	 * For the US standard keyboard, the '[{' key
	 */
	US_OPEN_SQUARE_BRACKET = 87,
	/**
	 * Used for miscellaneous characters; it can vary by keyboard.
	 * For the US standard keyboard, the '\|' key
	 */
	US_BACKSLASH = 88,
	/**
	 * Used for miscellaneous characters; it can vary by keyboard.
	 * For the US standard keyboard, the ']}' key
	 */
	US_CLOSE_SQUARE_BRACKET = 89,
	/**
	 * Used for miscellaneous characters; it can vary by keyboard.
	 * For the US standard keyboard, the ''"' key
	 */
	US_QUOTE = 90,
	/**
	 * Used for miscellaneous characters; it can vary by keyboard.
	 */
	OEM_8 = 91,
	/**
	 * Either the angle bracket key or the backslash key on the RT 102-key keyboard.
	 */
	OEM_102 = 92,
	NUMPAD_0 = 93,
	NUMPAD_1 = 94,
	NUMPAD_2 = 95,
	NUMPAD_3 = 96,
	NUMPAD_4 = 97,
	NUMPAD_5 = 98,
	NUMPAD_6 = 99,
	NUMPAD_7 = 100,
	NUMPAD_8 = 101,
	NUMPAD_9 = 102,
	NUMPAD_MULTIPLY = 103,
	NUMPAD_ADD = 104,
	NUMPAD_SEPARATOR = 105,
	NUMPAD_SUBTRACT = 106,
	NUMPAD_DECIMAL = 107,
	NUMPAD_DIVIDE = 108,
	/**
	 * Cover all key codes when IME is processing input.
	 */
	KEY_IN_COMPOSITION = 109,
	ABNT_C1 = 110,
	ABNT_C2 = 111,
	/**
	 * Placed last to cover the length of the enum.
	 * Please do not depend on this value!
	 */
	MAX_VALUE = 112
}

export enum MarkerSeverity {
	Hint = 1,
	Info = 2,
	Warning = 4,
	Error = 8
}

export enum MarkerTag {
	Unnecessary = 1,
	Deprecated = 2
}

/**
 * Position in the minimap to render the decoration.
 */
export enum MinimapPosition {
	Inline = 1,
	Gutter = 2
}

/**
 * Type of hit element with the mouse in the editor.
 */
export enum MouseTargetType {
	/**
	 * Mouse is on top of an unknown element.
	 */
	UNKNOWN = 0,
	/**
	 * Mouse is on top of the textarea used for input.
	 */
	TEXTAREA = 1,
	/**
	 * Mouse is on top of the glyph margin
	 */
	GUTTER_GLYPH_MARGIN = 2,
	/**
	 * Mouse is on top of the line numbers
	 */
	GUTTER_LINE_NUMBERS = 3,
	/**
	 * Mouse is on top of the line decorations
	 */
	GUTTER_LINE_DECORATIONS = 4,
	/**
	 * Mouse is on top of the whitespace left in the gutter by a view zone.
	 */
	GUTTER_VIEW_ZONE = 5,
	/**
	 * Mouse is on top of text in the content.
	 */
	CONTENT_TEXT = 6,
	/**
	 * Mouse is on top of empty space in the content (e.g. after line text or below last line)
	 */
	CONTENT_EMPTY = 7,
	/**
	 * Mouse is on top of a view zone in the content.
	 */
	CONTENT_VIEW_ZONE = 8,
	/**
	 * Mouse is on top of a content widget.
	 */
	CONTENT_WIDGET = 9,
	/**
	 * Mouse is on top of the decorations overview ruler.
	 */
	OVERVIEW_RULER = 10,
	/**
	 * Mouse is on top of a scrollbar.
	 */
	SCROLLBAR = 11,
	/**
	 * Mouse is on top of an overlay widget.
	 */
	OVERLAY_WIDGET = 12,
	/**
	 * Mouse is outside of the editor.
	 */
	OUTSIDE_EDITOR = 13
}

/**
 * A positioning preference for rendering overlay widgets.
 */
export enum OverlayWidgetPositionPreference {
	/**
	 * Position the overlay widget in the top right corner
	 */
	TOP_RIGHT_CORNER = 0,
	/**
	 * Position the overlay widget in the bottom right corner
	 */
	BOTTOM_RIGHT_CORNER = 1,
	/**
	 * Position the overlay widget in the top center
	 */
	TOP_CENTER = 2
}

/**
 * Vertical Lane in the overview ruler of the editor.
 */
export enum OverviewRulerLane {
	Left = 1,
	Center = 2,
	Right = 4,
	Full = 7
}

export enum RenderLineNumbersType {
	Off = 0,
	On = 1,
	Relative = 2,
	Interval = 3,
	Custom = 4
}

export enum RenderMinimap {
	None = 0,
	Text = 1,
	Blocks = 2
}

export enum ScrollType {
	Smooth = 0,
	Immediate = 1
}

export enum ScrollbarVisibility {
	Auto = 1,
	Hidden = 2,
	Visible = 3
}

/**
 * The direction of a selection.
 */
export enum SelectionDirection {
	/**
	 * The selection starts above where it ends.
	 */
	LTR = 0,
	/**
	 * The selection starts below where it ends.
	 */
	RTL = 1
}

export enum SignatureHelpTriggerKind {
	Invoke = 1,
	TriggerCharacter = 2,
	ContentChange = 3
}

/**
 * A symbol kind.
 */
export enum SymbolKind {
	File = 0,
	Module = 1,
	Namespace = 2,
	Package = 3,
	Class = 4,
	Method = 5,
	Property = 6,
	Field = 7,
	Constructor = 8,
	Enum = 9,
	Interface = 10,
	Function = 11,
	Variable = 12,
	Constant = 13,
	String = 14,
	Number = 15,
	Boolean = 16,
	Array = 17,
	Object = 18,
	Key = 19,
	Null = 20,
	EnumMember = 21,
	Struct = 22,
	Event = 23,
	Operator = 24,
	TypeParameter = 25
}

export enum SymbolTag {
	Deprecated = 1
}

/**
 * The kind of animation in which the editor's cursor should be rendered.
 */
export enum TextEditorCursorBlinkingStyle {
	/**
	 * Hidden
	 */
	Hidden = 0,
	/**
	 * Blinking
	 */
	Blink = 1,
	/**
	 * Blinking with smooth fading
	 */
	Smooth = 2,
	/**
	 * Blinking with prolonged filled state and smooth fading
	 */
	Phase = 3,
	/**
	 * Expand collapse animation on the y axis
	 */
	Expand = 4,
	/**
	 * No-Blinking
	 */
	Solid = 5
}

/**
 * The style in which the editor's cursor should be rendered.
 */
export enum TextEditorCursorStyle {
	/**
	 * As a vertical line (sitting between two characters).
	 */
	Line = 1,
	/**
	 * As a block (sitting on top of a character).
	 */
	Block = 2,
	/**
	 * As a horizontal line (sitting under a character).
	 */
	Underline = 3,
	/**
	 * As a thin vertical line (sitting between two characters).
	 */
	LineThin = 4,
	/**
	 * As an outlined block (sitting on top of a character).
	 */
	BlockOutline = 5,
	/**
	 * As a thin horizontal line (sitting under a character).
	 */
	UnderlineThin = 6
}

/**
 * Describes the behavior of decorations when typing/editing near their edges.
 * Note: Please do not edit the values, as they very carefully match `DecorationRangeBehavior`
 */
export enum TrackedRangeStickiness {
	AlwaysGrowsWhenTypingAtEdges = 0,
	NeverGrowsWhenTypingAtEdges = 1,
	GrowsOnlyWhenTypingBefore = 2,
	GrowsOnlyWhenTypingAfter = 3
}

/**
 * Describes how to indent wrapped lines.
 */
export enum WrappingIndent {
	/**
	 * No indentation => wrapped lines begin at column 1.
	 */
	None = 0,
	/**
	 * Same => wrapped lines get the same indentation as the parent.
	 */
	Same = 1,
	/**
	 * Indent => wrapped lines get +1 indentation toward the parent.
	 */
	Indent = 2,
	/**
	 * DeepIndent => wrapped lines get +2 indentation toward the parent.
	 */
	DeepIndent = 3
}