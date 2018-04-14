/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { RawContextKey, ContextKeyExpr, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { TPromise } from 'vs/base/common/winjs.base';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const TERMINAL_PANEL_ID = 'workbench.panel.terminal';

export const TERMINAL_SERVICE_ID = 'terminalService';

/**  A context key that is set when the integrated terminal has focus. */
export const KEYBINDING_CONTEXT_TERMINAL_FOCUS = new RawContextKey<boolean>('terminalFocus', undefined);
/**  A context key that is set when the integrated terminal does not have focus. */
export const KEYBINDING_CONTEXT_TERMINAL_NOT_FOCUSED: ContextKeyExpr = KEYBINDING_CONTEXT_TERMINAL_FOCUS.toNegated();

/** A keybinding context key that is set when the integrated terminal has text selected. */
export const KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED = new RawContextKey<boolean>('terminalTextSelected', undefined);
/** A keybinding context key that is set when the integrated terminal does not have text selected. */
export const KEYBINDING_CONTEXT_TERMINAL_TEXT_NOT_SELECTED: ContextKeyExpr = KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED.toNegated();

/**  A context key that is set when the find widget in integrated terminal is visible. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_VISIBLE = new RawContextKey<boolean>('terminalFindWidgetVisible', undefined);
/**  A context key that is set when the find widget in integrated terminal is not visible. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_NOT_VISIBLE: ContextKeyExpr = KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_VISIBLE.toNegated();
/**  A context key that is set when the find widget find input in integrated terminal is focused. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_INPUT_FOCUSED = new RawContextKey<boolean>('terminalFindWidgetInputFocused', false);
/**  A context key that is set when the find widget find input in integrated terminal is not focused. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_INPUT_NOT_FOCUSED: ContextKeyExpr = KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_INPUT_FOCUSED.toNegated();

export const IS_WORKSPACE_SHELL_ALLOWED_STORAGE_KEY = 'terminal.integrated.isWorkspaceShellAllowed';
export const NEVER_SUGGEST_SELECT_WINDOWS_SHELL_STORAGE_KEY = 'terminal.integrated.neverSuggestSelectWindowsShell';

export const ITerminalService = createDecorator<ITerminalService>(TERMINAL_SERVICE_ID);

export const TerminalCursorStyle = {
	BLOCK: 'block',
	LINE: 'line',
	UNDERLINE: 'underline'
};

export const TERMINAL_CONFIG_SECTION = 'terminal.integrated';

export type FontWeight = 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

export interface ITerminalConfiguration {
	shell: {
		linux: string;
		osx: string;
		windows: string;
	};
	shellArgs: {
		linux: string[];
		osx: string[];
		windows: string[];
	};
	macOptionIsMeta: boolean;
	rightClickBehavior: 'default' | 'copyPaste' | 'selectWord';
	cursorBlinking: boolean;
	cursorStyle: string;
	fontFamily: string;
	fontWeight: FontWeight;
	fontWeightBold: FontWeight;
	// fontLigatures: boolean;
	fontSize: number;
	lineHeight: number;
	setLocaleVariables: boolean;
	scrollback: number;
	commandsToSkipShell: string[];
	cwd: string;
	confirmOnExit: boolean;
	enableBell: boolean;
	env: {
		linux: { [key: string]: string };
		osx: { [key: string]: string };
		windows: { [key: string]: string };
	};
	showExitAlert: boolean;
	experimentalRestore: boolean;
}

export interface ITerminalConfigHelper {
	config: ITerminalConfiguration;
	getFont(): ITerminalFont;
	/**
	 * Merges the default shell path and args into the provided launch configuration
	 */
	mergeDefaultShellPathAndArgs(shell: IShellLaunchConfig): void;
	/** Sets whether a workspace shell configuration is allowed or not */
	setWorkspaceShellAllowed(isAllowed: boolean): void;
}

export interface ITerminalFont {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	charWidth?: number;
	charHeight?: number;
}

export interface IShellLaunchConfig {
	/** The name of the terminal, if this is not set the name of the process will be used. */
	name?: string;
	/** The shell executable (bash, cmd, etc.). */
	executable?: string;
	/**
	 * The CLI arguments to use with executable, a string[] is in argv format and will be escaped,
	 * a string is in "CommandLine" pre-escaped format and will be used as is. The string option is
	 * only supported on Windows and will throw an exception if used on macOS or Linux.
	 */
	args?: string[] | string;
	/**
	 * The current working directory of the terminal, this overrides the `terminal.integrated.cwd`
	 * settings key.
	 */
	cwd?: string;
	/**
	 * A custom environment for the terminal, if this is not set the environment will be inherited
	 * from the VS Code process.
	 */
	env?: { [key: string]: string };
	/**
	 * Whether to ignore a custom cwd from the `terminal.integrated.cwd` settings key (eg. if the
	 * shell is being launched by an extension).
	 */
	ignoreConfigurationCwd?: boolean;

	/** Whether to wait for a key press before closing the terminal. */
	waitOnExit?: boolean | string;

	/**
	 * A string including ANSI escape sequences that will be written to the terminal emulator
	 * _before_ the terminal process has launched, a trailing \n is added at the end of the string.
	 * This allows for example the terminal instance to display a styled message as the first line
	 * of the terminal. Use \x1b over \033 or \e for the escape control character.
	 */
	initialText?: string;
}

export interface ITerminalService {
	_serviceBrand: any;

	activeTabIndex: number;
	configHelper: ITerminalConfigHelper;
	onActiveTabChanged: Event<void>;
	onTabDisposed: Event<ITerminalTab>;
	onInstanceCreated: Event<ITerminalInstance>;
	onInstanceDisposed: Event<ITerminalInstance>;
	onInstanceProcessIdReady: Event<ITerminalInstance>;
	onInstancesChanged: Event<void>;
	onInstanceTitleChanged: Event<string>;
	terminalInstances: ITerminalInstance[];
	terminalTabs: ITerminalTab[];

	createInstance(shell?: IShellLaunchConfig, wasNewTerminalAction?: boolean): ITerminalInstance;
	getInstanceFromId(terminalId: number): ITerminalInstance;
	getInstanceFromIndex(terminalIndex: number): ITerminalInstance;
	getTabLabels(): string[];
	getActiveInstance(): ITerminalInstance;
	setActiveInstance(terminalInstance: ITerminalInstance): void;
	setActiveInstanceByIndex(terminalIndex: number): void;
	getActiveOrCreateInstance(wasNewTerminalAction?: boolean): ITerminalInstance;
	splitInstance(instance: ITerminalInstance, shell?: IShellLaunchConfig): void;

	getActiveTab(): ITerminalTab;
	setActiveTabToNext(): void;
	setActiveTabToPrevious(): void;
	setActiveTabByIndex(tabIndex: number): void;

	showPanel(focus?: boolean): TPromise<void>;
	hidePanel(): void;
	focusFindWidget(): TPromise<void>;
	hideFindWidget(): void;
	showNextFindTermFindWidget(): void;
	showPreviousFindTermFindWidget(): void;

	setContainers(panelContainer: HTMLElement, terminalContainer: HTMLElement): void;
	selectDefaultWindowsShell(): TPromise<string>;
	setWorkspaceShellAllowed(isAllowed: boolean): void;
}

export const enum Direction {
	Left = 0,
	Right = 1,
	Up = 2,
	Down = 3
}

export interface ITerminalTab {
	activeInstance: ITerminalInstance;
	terminalInstances: ITerminalInstance[];
	title: string;
	onDisposed: Event<ITerminalTab>;
	onInstancesChanged: Event<void>;

	focusPreviousPane(): void;
	focusNextPane(): void;
	resizePane(direction: Direction): void;
	setActiveInstanceByIndex(index: number): void;
	attachToElement(element: HTMLElement): void;
	setVisible(visible: boolean): void;
	layout(width: number, height: number): void;
	addDisposable(disposable: IDisposable): void;
	split(terminalFocusContextKey: IContextKey<boolean>, configHelper: ITerminalConfigHelper, shellLaunchConfig: IShellLaunchConfig): ITerminalInstance;
}

export interface ITerminalInstance {
	/**
	 * The ID of the terminal instance, this is an arbitrary number only used to identify the
	 * terminal instance.
	 */
	id: number;

	/**
	 * The process ID of the shell process.
	 */
	processId: number;

	/**
	 * An event that fires when the terminal instance's title changes.
	 */
	onTitleChanged: Event<string>;

	/**
	 * An event that fires when the terminal instance is disposed.
	 */
	onDisposed: Event<ITerminalInstance>;

	onFocused: Event<ITerminalInstance>;

	onProcessIdReady: Event<ITerminalInstance>;

	processReady: TPromise<void>;

	/**
	 * The title of the terminal. This is either title or the process currently running or an
	 * explicit name given to the terminal instance through the extension API.
	 *
	 * @readonly
	 */
	title: string;

	/**
	 * The focus state of the terminal before exiting.
	 *
	 * @readonly
	 */
	hadFocusOnExit: boolean;

	/**
	 * False when the title is set by an API or the user. We check this to make sure we
	 * do not override the title when the process title changes in the terminal.
	 */
	isTitleSetByProcess: boolean;

	/**
	 * The shell launch config used to launch the shell.
	 */
	shellLaunchConfig: IShellLaunchConfig;

	/**
	 * Whether to disable layout for the terminal. This is useful when the size of the terminal is
	 * being manipulating (eg. adding a split pane) and we want the terminal to ignore particular
	 * resize events.
	 */
	disableLayout: boolean;

	/**
	 * An object that tracks when commands are run and enables navigating and selecting between
	 * them.
	 */
	readonly commandTracker: ITerminalCommandTracker;

	/**
	 * Dispose the terminal instance, removing it from the panel/service and freeing up resources.
	 */
	dispose(): void;

	/**
	 * Registers a link matcher, allowing custom link patterns to be matched and handled.
	 * @param regex The regular expression the search for, specifically this searches the
	 * textContent of the rows. You will want to use \s to match a space ' ' character for example.
	 * @param handler The callback when the link is called.
	 * @param matchIndex The index of the link from the regex.match(html) call. This defaults to 0
	 * (for regular expressions without capture groups).
	 * @param validationCallback A callback which can be used to validate the link after it has been
	 * added to the DOM.
	 * @return The ID of the new matcher, this can be used to deregister.
	 */
	registerLinkMatcher(regex: RegExp, handler: (url: string) => void, matchIndex?: number, validationCallback?: (uri: string, callback: (isValid: boolean) => void) => void): number;

	/**
	 * Deregisters a link matcher if it has been registered.
	 * @param matcherId The link matcher's ID (returned after register)
	 * @return Whether a link matcher was found and deregistered.
	 */
	deregisterLinkMatcher(matcherId: number): void;

	/**
	 * Check if anything is selected in terminal.
	 */
	hasSelection(): boolean;

	/**
	 * Copies the terminal selection to the clipboard.
	 */
	copySelection(): void;

	/**
	 * Current selection in the terminal.
	 */
	readonly selection: string | undefined;

	/**
	 * Clear current selection.
	 */
	clearSelection(): void;

	/**
	 * Select all text in the terminal.
	 */
	selectAll(): void;

	/**
	 * Find the next instance of the term
	*/
	findNext(term: string): boolean;

	/**
	 * Find the previous instance of the term
	 */
	findPrevious(term: string): boolean;

	/**
	 * Notifies the terminal that the find widget's focus state has been changed.
	 */
	notifyFindWidgetFocusChanged(isFocused: boolean): void;

	/**
	 * Focuses the terminal instance.
	 *
	 * @param focus Force focus even if there is a selection.
	 */
	focus(force?: boolean): void;

	/**
	 * Focuses and pastes the contents of the clipboard into the terminal instance.
	 */
	paste(): void;

	/**
	 * Send text to the terminal instance. The text is written to the stdin of the underlying pty
	 * process (shell) of the terminal instance.
	 *
	 * @param text The text to send.
	 * @param addNewLine Whether to add a new line to the text being sent, this is normally
	 * required to run a command in the terminal. The character(s) added are \n or \r\n
	 * depending on the platform. This defaults to `true`.
	 */
	sendText(text: string, addNewLine: boolean): void;

	/** Scroll the terminal buffer down 1 line. */
	scrollDownLine(): void;
	/** Scroll the terminal buffer down 1 page. */
	scrollDownPage(): void;
	/** Scroll the terminal buffer to the bottom. */
	scrollToBottom(): void;
	/** Scroll the terminal buffer up 1 line. */
	scrollUpLine(): void;
	/** Scroll the terminal buffer up 1 page. */
	scrollUpPage(): void;
	/** Scroll the terminal buffer to the top. */
	scrollToTop(): void;

	/**
	 * Clears the terminal buffer, leaving only the prompt line.
	 */
	clear(): void;

	/**
	 * Attaches the terminal instance to an element on the DOM, before this is called the terminal
	 * instance process may run in the background but cannot be displayed on the UI.
	 *
	 * @param container The element to attach the terminal instance to.
	 */
	attachToElement(container: HTMLElement): void;

	/**
	 * Updates the configuration of the terminal instance.
	 */
	updateConfig(): void;

	/**
	 * Updates the accessibility support state of the terminal instance.
	 * @param isEnabled Whether it's enabled.
	 */
	updateAccessibilitySupport(isEnabled: boolean): void;

	/**
	 * Configure the dimensions of the terminal instance.
	 *
	 * @param dimension The dimensions of the container.
	 */
	layout(dimension: { width: number, height: number }): void;

	/**
	 * Sets whether the terminal instance's element is visible in the DOM.
	 *
	 * @param visible Whether the element is visible.
	 */
	setVisible(visible: boolean): void;

	/**
	 * Attach a listener to listen for new lines added to this terminal instance.
	 *
	 * @param listener The listener function which takes new line strings added to the terminal,
	 * excluding ANSI escape sequences. The line event will fire when an LF character is added to
	 * the terminal (ie. the line is not wrapped). Note that this means that the line data will
	 * not fire for the last line, until either the line is ended with a LF character of the process
	 * is exited. The lineData string will contain the fully wrapped line, not containing any LF/CR
	 * characters.
	 */
	onLineData(listener: (lineData: string) => void): IDisposable;

	/**
	 * Attach a listener that fires when the terminal's pty process exits.
	 *
	 * @param listener The listener function which takes the processes' exit code, an exit code of
	 * null means the process was killed as a result of the ITerminalInstance being disposed.
	 */
	onExit(listener: (exitCode: number) => void): IDisposable;

	/**
	 * Immediately kills the terminal's current pty process and launches a new one to replace it.
	 *
	 * @param shell The new launch configuration.
	 */
	reuseTerminal(shell?: IShellLaunchConfig): void;

	/**
	 * Sets the title of the terminal instance.
	 */
	setTitle(title: string, eventFromProcess: boolean): void;

	addDisposable(disposable: IDisposable): void;
}

export interface ITerminalCommandTracker {
	scrollToPreviousCommand(): void;
	scrollToNextCommand(): void;
	selectToPreviousCommand(): void;
	selectToNextCommand(): void;
}

export interface ITerminalProcessManager extends IDisposable {
	addDisposable(disposable: IDisposable);
}