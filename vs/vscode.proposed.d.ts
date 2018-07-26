/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is the place for API experiments and proposal.

import { QuickPickItem } from 'vscode';

declare module 'vscode' {

	export namespace window {
		export function sampleFunction(): Thenable<any>;
	}

	//#region Rob: search provider

	/**
	 * The parameters of a query for text search.
	 */
	export interface TextSearchQuery {
		/**
		 * The text pattern to search for.
		 */
		pattern: string;

		/**
		 * Whether or not `pattern` should be interpreted as a regular expression.
		 */
		isRegExp?: boolean;

		/**
		 * Whether or not the search should be case-sensitive.
		 */
		isCaseSensitive?: boolean;

		/**
		 * Whether or not to search for whole word matches only.
		 */
		isWordMatch?: boolean;
	}

	/**
	 * A file glob pattern to match file paths against.
	 * TODO@roblou - merge this with the GlobPattern docs/definition in vscode.d.ts.
	 * @see [GlobPattern](#GlobPattern)
	 */
	export type GlobString = string;

	/**
	 * Options common to file and text search
	 */
	export interface SearchOptions {
		/**
		 * The root folder to search within.
		 */
		folder: Uri;

		/**
		 * Files that match an `includes` glob pattern should be included in the search.
		 */
		includes: GlobString[];

		/**
		 * Files that match an `excludes` glob pattern should be excluded from the search.
		 */
		excludes: GlobString[];

		/**
		 * Whether external files that exclude files, like .gitignore, should be respected.
		 * See the vscode setting `"search.useIgnoreFiles"`.
		 */
		useIgnoreFiles?: boolean;

		/**
		 * Whether symlinks should be followed while searching.
		 * See the vscode setting `"search.followSymlinks"`.
		 */
		followSymlinks?: boolean;

		/**
		 * The maximum number of results to be returned.
		 */
		maxResults?: number;
	}

	/**
	 * Options that apply to text search.
	 */
	export interface TextSearchOptions extends SearchOptions {
		/**
		 *  TODO@roblou - total length? # of context lines? leading and trailing # of chars?
		 */
		previewOptions?: any;

		/**
		 * Exclude files larger than `maxFileSize` in bytes.
		 */
		maxFileSize?: number;

		/**
		 * Interpret files using this encoding.
		 * See the vscode setting `"files.encoding"`
		 */
		encoding?: string;
	}

	/**
	 * The parameters of a query for file search.
	 */
	export interface FileSearchQuery {
		/**
		 * The search pattern to match against file paths.
		 */
		pattern: string;

		/**
		 * `cacheKey` has the same value when `provideFileSearchResults` is invoked multiple times during a single quickopen session.
		 * Providers can optionally use this to cache results at the beginning of a quickopen session and filter results as the user types.
		 * It will have a different value for each folder searched.
		 */
		cacheKey?: string;
	}

	/**
	 * Options that apply to file search.
	 */
	export interface FileSearchOptions extends SearchOptions { }

	export interface TextSearchResultPreview {
		/**
		 * The matching line of text, or a portion of the matching line that contains the match.
		 * For now, this can only be a single line.
		 */
		text: string;

		/**
		 * The Range within `text` corresponding to the text of the match.
		 */
		match: Range;
	}

	/**
	 * A match from a text search
	 */
	export interface TextSearchResult {
		/**
		 * The uri for the matching document.
		 */
		uri: Uri;

		/**
		 * The range of the match within the document.
		 */
		range: Range;

		/**
		 * A preview of the matching line
		 */
		preview: TextSearchResultPreview;
	}

	/**
	 * A SearchProvider provides search results for files or text in files. It can be invoked by quickopen, the search viewlet, and other extensions.
	 */
	export interface SearchProvider {
		/**
		 * Provide the set of files that match a certain file path pattern.
		 * @param query The parameters for this query.
		 * @param options A set of options to consider while searching files.
		 * @param progress A progress callback that must be invoked for all results.
		 * @param token A cancellation token.
		 */
		provideFileSearchResults?(query: FileSearchQuery, options: FileSearchOptions, progress: Progress<Uri>, token: CancellationToken): Thenable<void>;

		/**
		 * Optional - if the provider makes use of `query.cacheKey`, it can implement this method which is invoked when the cache can be cleared.
		 * @param cacheKey The same key that was passed as `query.cacheKey`.
		 */
		clearCache?(cacheKey: string): void;

		/**
		 * Provide results that match the given text pattern.
		 * @param query The parameters for this query.
		 * @param options A set of options to consider while searching.
		 * @param progress A progress callback that must be invoked for all results.
		 * @param token A cancellation token.
		 */
		provideTextSearchResults?(query: TextSearchQuery, options: TextSearchOptions, progress: Progress<TextSearchResult>, token: CancellationToken): Thenable<void>;
	}

	/**
	 * Options that can be set on a findTextInFiles search.
	 */
	export interface FindTextInFilesOptions {
		/**
		 * A [glob pattern](#GlobPattern) that defines the files to search for. The glob pattern
		 * will be matched against the file paths of files relative to their workspace. Use a [relative pattern](#RelativePattern)
		 * to restrict the search results to a [workspace folder](#WorkspaceFolder).
		 */
		include?: GlobPattern;

		/**
		 * A [glob pattern](#GlobPattern) that defines files and folders to exclude. The glob pattern
		 * will be matched against the file paths of resulting matches relative to their workspace. When `undefined` only default excludes will
		 * apply, when `null` no excludes will apply.
		 */
		exclude?: GlobPattern | null;

		/**
		 * The maximum number of results to search for
		 */
		maxResults?: number;

		/**
		 * Whether external files that exclude files, like .gitignore, should be respected.
		 * See the vscode setting `"search.useIgnoreFiles"`.
		 */
		useIgnoreFiles?: boolean;

		/**
		 * Whether symlinks should be followed while searching.
		 * See the vscode setting `"search.followSymlinks"`.
		 */
		followSymlinks?: boolean;

		/**
		 * Interpret files using this encoding.
		 * See the vscode setting `"files.encoding"`
		 */
		encoding?: string;
	}

	export namespace workspace {
		/**
		 * Register a search provider.
		 *
		 * Only one provider can be registered per scheme.
		 *
		 * @param scheme The provider will be invoked for workspace folders that have this file scheme.
		 * @param provider The provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerSearchProvider(scheme: string, provider: SearchProvider): Disposable;


		/**
		 * Search text in files across all [workspace folders](#workspace.workspaceFolders) in the workspace.
		 * @param query The query parameters for the search - the search string, whether it's case-sensitive, or a regex, or matches whole words.
		 * @param callback A callback, called for each result
		 * @param token A token that can be used to signal cancellation to the underlying search engine.
		 * @return A thenable that resolves when the search is complete.
		 */
		export function findTextInFiles(query: TextSearchQuery, callback: (result: TextSearchResult) => void, token?: CancellationToken): Thenable<void>;

		/**
		 * Search text in files across all [workspace folders](#workspace.workspaceFolders) in the workspace.
		 * @param query The query parameters for the search - the search string, whether it's case-sensitive, or a regex, or matches whole words.
		 * @param options An optional set of query options. Include and exclude patterns, maxResults, etc.
		 * @param callback A callback, called for each result
		 * @param token A token that can be used to signal cancellation to the underlying search engine.
		 * @return A thenable that resolves when the search is complete.
		 */
		export function findTextInFiles(query: TextSearchQuery, options: FindTextInFilesOptions, callback: (result: TextSearchResult) => void, token?: CancellationToken): Thenable<void>;
	}

	//#endregion

	//#region Joao: diff command

	/**
	 * The contiguous set of modified lines in a diff.
	 */
	export interface LineChange {
		readonly originalStartLineNumber: number;
		readonly originalEndLineNumber: number;
		readonly modifiedStartLineNumber: number;
		readonly modifiedEndLineNumber: number;
	}

	export namespace commands {

		/**
		 * Registers a diff information command that can be invoked via a keyboard shortcut,
		 * a menu item, an action, or directly.
		 *
		 * Diff information commands are different from ordinary [commands](#commands.registerCommand) as
		 * they only execute when there is an active diff editor when the command is called, and the diff
		 * information has been computed. Also, the command handler of an editor command has access to
		 * the diff information.
		 *
		 * @param command A unique identifier for the command.
		 * @param callback A command handler function with access to the [diff information](#LineChange).
		 * @param thisArg The `this` context used when invoking the handler function.
		 * @return Disposable which unregisters this command on disposal.
		 */
		export function registerDiffInformationCommand(command: string, callback: (diff: LineChange[], ...args: any[]) => any, thisArg?: any): Disposable;
	}

	//#endregion

	//#region Joh: decorations

	//todo@joh -> make class
	export interface DecorationData {
		priority?: number;
		title?: string;
		bubble?: boolean;
		abbreviation?: string;
		color?: ThemeColor;
		source?: string;
	}

	export interface SourceControlResourceDecorations {
		source?: string;
		letter?: string;
		color?: ThemeColor;
	}

	export interface DecorationProvider {
		onDidChangeDecorations: Event<undefined | Uri | Uri[]>;
		provideDecoration(uri: Uri, token: CancellationToken): ProviderResult<DecorationData>;
	}

	export namespace window {
		export function registerDecorationProvider(provider: DecorationProvider): Disposable;
	}

	//#endregion

	//#region André: debug

	/**
	 * Represents a debug adapter executable and optional arguments passed to it.
	 */
	export class DebugAdapterExecutable {
		/**
		 * The command path of the debug adapter executable.
		 * A command must be either an absolute path or the name of an executable looked up via the PATH environment variable.
		 * The special value 'node' will be mapped to VS Code's built-in node runtime.
		 */
		readonly command: string;

		/**
		 * Optional arguments passed to the debug adapter executable.
		 */
		readonly args: string[];

		/**
		 * Create a new debug adapter specification.
		 */
		constructor(command: string, args?: string[]);
	}

	export interface DebugConfigurationProvider {
		/**
		 * This optional method is called just before a debug adapter is started to determine its executable path and arguments.
		 * Registering more than one debugAdapterExecutable for a type results in an error.
		 * @param folder The workspace folder from which the configuration originates from or undefined for a folderless setup.
		 * @param token A cancellation token.
		 * @return a [debug adapter's executable and optional arguments](#DebugAdapterExecutable) or undefined.
		 */
		debugAdapterExecutable?(folder: WorkspaceFolder | undefined, token?: CancellationToken): ProviderResult<DebugAdapterExecutable>;
	}

	//#endregion

	//#region Rob, Matt: logging

	/**
	 * The severity level of a log message
	 */
	export enum LogLevel {
		Trace = 1,
		Debug = 2,
		Info = 3,
		Warning = 4,
		Error = 5,
		Critical = 6,
		Off = 7
	}

	/**
	 * A logger for writing to an extension's log file, and accessing its dedicated log directory.
	 */
	export interface Logger {
		trace(message: string, ...args: any[]): void;
		debug(message: string, ...args: any[]): void;
		info(message: string, ...args: any[]): void;
		warn(message: string, ...args: any[]): void;
		error(message: string | Error, ...args: any[]): void;
		critical(message: string | Error, ...args: any[]): void;
	}

	export interface ExtensionContext {
		/**
		 * This extension's logger
		 */
		logger: Logger;

		/**
		 * Path where an extension can write log files.
		 *
		 * Extensions must create this directory before writing to it. The parent directory will always exist.
		 */
		readonly logDirectory: string;
	}

	export namespace env {
		/**
		 * Current logging level.
		 *
		 * @readonly
		 */
		export const logLevel: LogLevel;
	}

	//#endregion

	//#region Joao: SCM validation

	/**
	 * Represents the validation type of the Source Control input.
	 */
	export enum SourceControlInputBoxValidationType {

		/**
		 * Something not allowed by the rules of a language or other means.
		 */
		Error = 0,

		/**
		 * Something suspicious but allowed.
		 */
		Warning = 1,

		/**
		 * Something to inform about but not a problem.
		 */
		Information = 2
	}

	export interface SourceControlInputBoxValidation {

		/**
		 * The validation message to display.
		 */
		readonly message: string;

		/**
		 * The validation type.
		 */
		readonly type: SourceControlInputBoxValidationType;
	}

	/**
	 * Represents the input box in the Source Control viewlet.
	 */
	export interface SourceControlInputBox {

		/**
		 * A validation function for the input box. It's possible to change
		 * the validation provider simply by setting this property to a different function.
		 */
		validateInput?(value: string, cursorPosition: number): ProviderResult<SourceControlInputBoxValidation | undefined | null>;
	}

	//#endregion

	//#region Comments
	/**
	 * Comments provider related APIs are still in early stages, they may be changed significantly during our API experiments.
	 */

	interface CommentInfo {
		threads: CommentThread[];
		commentingRanges?: Range[];
	}

	export enum CommentThreadCollapsibleState {
		/**
		 * Determines an item is collapsed
		 */
		Collapsed = 0,
		/**
		 * Determines an item is expanded
		 */
		Expanded = 1
	}

	interface CommentThread {
		threadId: string;
		resource: Uri;
		range: Range;
		comments: Comment[];
		collapsibleState?: CommentThreadCollapsibleState;
	}

	interface Comment {
		commentId: string;
		body: MarkdownString;
		userName: string;
		gravatar: string;
		command?: Command;
	}

	export interface CommentThreadChangedEvent {
		/**
		 * Added comment threads.
		 */
		readonly added: CommentThread[];

		/**
		 * Removed comment threads.
		 */
		readonly removed: CommentThread[];

		/**
		 * Changed comment threads.
		 */
		readonly changed: CommentThread[];
	}

	interface DocumentCommentProvider {
		provideDocumentComments(document: TextDocument, token: CancellationToken): Promise<CommentInfo>;
		createNewCommentThread?(document: TextDocument, range: Range, text: string, token: CancellationToken): Promise<CommentThread>;
		replyToCommentThread?(document: TextDocument, range: Range, commentThread: CommentThread, text: string, token: CancellationToken): Promise<CommentThread>;
		onDidChangeCommentThreads?: Event<CommentThreadChangedEvent>;
	}

	interface WorkspaceCommentProvider {
		provideWorkspaceComments(token: CancellationToken): Promise<CommentThread[]>;
		createNewCommentThread?(document: TextDocument, range: Range, text: string, token: CancellationToken): Promise<CommentThread>;
		replyToCommentThread?(document: TextDocument, range: Range, commentThread: CommentThread, text: string, token: CancellationToken): Promise<CommentThread>;

		onDidChangeCommentThreads?: Event<CommentThreadChangedEvent>;
	}

	namespace workspace {
		export function registerDocumentCommentProvider(provider: DocumentCommentProvider): Disposable;
		export function registerWorkspaceCommentProvider(provider: WorkspaceCommentProvider): Disposable;
	}
	//#endregion

	//#region Terminal

	export interface Terminal {
		/**
		 * Fires when the terminal's pty slave pseudo-device is written to. In other words, this
		 * provides access to the raw data stream from the process running within the terminal,
		 * including VT sequences.
		 */
		onDidWriteData: Event<string>;
	}

	/**
	 * Represents the dimensions of a terminal.
	 */
	export interface TerminalDimensions {
		/**
		 * The number of columns in the terminal.
		 */
		readonly columns: number;

		/**
		 * The number of rows in the terminal.
		 */
		readonly rows: number;
	}

	/**
	 * Represents a terminal without a process where all interaction and output in the terminal is
	 * controlled by an extension. This is similar to an output window but has the same VT sequence
	 * compatility as the regular terminal.
	 *
	 * Note that an instance of [Terminal](#Terminal) will be created when a TerminalRenderer is
	 * created with all its APIs available for use by extensions. When using the Terminal object
	 * of a TerminalRenderer it acts just like normal only the extension that created the
	 * TerminalRenderer essentially acts as a process. For example when an
	 * [Terminal.onDidWriteData](#Terminal.onDidWriteData) listener is registered, that will fire
	 * when [TerminalRenderer.write](#TerminalRenderer.write) is called. Similarly when
	 * [Terminal.sendText](#Terminal.sendText) is triggered that will fire the
	 * [TerminalRenderer.onDidAcceptInput](#TerminalRenderer.onDidAcceptInput) event.
	 *
	 * **Example:** Create a terminal renderer, show it and write hello world in red
	 * ```typescript
	 * const renderer = window.createTerminalRenderer('foo');
	 * renderer.terminal.then(t => t.show());
	 * renderer.write('\x1b[31mHello world\x1b[0m');
	 * ```
	 */
	export interface TerminalRenderer {
		/**
		 * The name of the terminal, this will appear in the terminal selector.
		 */
		name: string;

		/**
		 * The dimensions of the terminal, the rows and columns of the terminal can only be set to
		 * a value smaller than the maximum value, if this is undefined the terminal will auto fit
		 * to the maximum value [maximumDimensions](TerminalRenderer.maximumDimensions).
		 *
		 * **Example:** Override the dimensions of a TerminalRenderer to 20 columns and 10 rows
		 * ```typescript
		 * terminalRenderer.dimensions = {
		 *   cols: 20,
		 *   rows: 10
		 * };
		 * ```
		 */
		dimensions: TerminalDimensions | undefined;

		/**
		 * The maximum dimensions of the terminal, this will be undefined immediately after a
		 * terminal renderer is created and also until the terminal becomes visible in the UI.
		 * Listen to [onDidChangeMaximumDimensions](TerminalRenderer.onDidChangeMaximumDimensions)
		 * to get notified when this value changes.
		 */
		readonly maximumDimensions: TerminalDimensions | undefined;

		/**
		 * The corressponding [Terminal](#Terminal) for this TerminalRenderer.
		 */
		readonly terminal: Terminal;

		/**
		 * Write text to the terminal. Unlike [Terminal.sendText](#Terminal.sendText) which sends
		 * text to the underlying _process_, this will write the text to the terminal itself.
		 *
		 * **Example:** Write red text to the terminal
		 * ```typescript
		 * terminalRenderer.write('\x1b[31mHello world\x1b[0m');
		 * ```
		 *
		 * **Example:** Move the cursor to the 10th row and 20th column and write an asterisk
		 * ```typescript
		 * terminalRenderer.write('\x1b[10;20H*');
		 * ```
		 *
		 * @param text The text to write.
		 */
		write(text: string): void;

		/**
		 * An event which fires on keystrokes in the terminal or when an extension calls
		 * [Terminal.sendText](#Terminal.sendText). Keystrokes are converted into their
		 * corresponding VT sequence representation.
		 *
		 * **Example:** Simulate interaction with the terminal from an outside extension or a
		 * workbench command such as `workbench.action.terminal.runSelectedText`
		 * ```typescript
		 * const terminalRenderer = window.createTerminalRenderer('test');
		 * terminalRenderer.onDidAcceptInput(data => {
		 *   cosole.log(data); // 'Hello world'
		 * });
		 * terminalRenderer.terminal.then(t => t.sendText('Hello world'));
		 * ```
		 */
		readonly onDidAcceptInput: Event<string>;

		/**
		 * An event which fires when the [maximum dimensions](#TerminalRenderer.maimumDimensions) of
		 * the terminal renderer change.
		 */
		readonly onDidChangeMaximumDimensions: Event<TerminalDimensions>;
	}

	export namespace window {
		/**
		 * The currently active terminal or `undefined`. The active terminal is the one that
		 * currently has focus or most recently had focus.
		 */
		export const activeTerminal: Terminal | undefined;

		/**
		 * An [event](#Event) which fires when the [active terminal](#window.activeTerminal)
		 * has changed. *Note* that the event also fires when the active terminal changes
		 * to `undefined`.
		 */
		export const onDidChangeActiveTerminal: Event<Terminal | undefined>;

		/**
		 * Create a [TerminalRenderer](#TerminalRenderer).
		 *
		 * @param name The name of the terminal renderer, this shows up in the terminal selector.
		 */
		export function createTerminalRenderer(name: string): TerminalRenderer;
	}

	//#endregion

	//#region Joh -> exclusive document filters

	export interface DocumentFilter {
		exclusive?: boolean;
	}

	//#endregion

	//#region joh: https://github.com/Microsoft/vscode/issues/10659

	/**
	 * A workspace edit is a collection of textual and files changes for
	 * multiple resources and documents.
	 *
	 * Use the [applyEdit](#workspace.applyEdit)-function to apply a workspace edit.
	 */
	export interface WorkspaceEdit {

		/**
		 * The number of affected resources of textual or resource changes.
		 */
		readonly size: number;

		/**
		 * Create a regular file.
		 *
		 * @param uri Uri of the new file..
		 * @param options Defines if an existing file should be overwritten or be ignored.
		 */
		createFile(uri: Uri, options?: { overwrite?: boolean, ignoreIfExists?: boolean }): void;

		/**
		 * Delete a file or folder.
		 *
		 * @param uri The uri of the file that is to be deleted.
		 */
		deleteFile(uri: Uri, options?: { recursive?: boolean, ignoreIfNotExists?: boolean }): void;

		/**
		 * Rename a file or folder.
		 *
		 * @param oldUri The existing file.
		 * @param newUri The new location.
		 * @param options Defines if existing files should be overwritten.
		 */
		renameFile(oldUri: Uri, newUri: Uri, options?: { overwrite?: boolean, ignoreIfExists?: boolean }): void;
	}

	export namespace workspace {

		/**
		 * Make changes to one or many resources or create, delete, and rename resources.
		 *
		 * All changes of a workspace edit are applied in the same order in which they have been added. If
		 * multiple textual inserts are made at the same position, these strings appear in the resulting text
		 * in the order the 'inserts' were made. Invalid sequences like 'delete file a' -> 'insert text in file a'
		 * cause failure of the operation.
		 *
		 * When applying a workspace edit that consists only of text edits an 'all-or-nothing'-strategy is used.
		 * A workspace edit with resource creations or deletions aborts the operation, e.g. consective edits will
		 * not be attempted, when a single edit fails.
		 *
		 * @param edit A workspace edit.
		 * @return A thenable that resolves when the edit could be applied.
		 */
		export function applyEdit(edit: WorkspaceEdit): Thenable<boolean>;
	}

	//#endregion

	//#region mjbvz,joh: https://github.com/Microsoft/vscode/issues/43768
	export interface FileRenameEvent {
		readonly oldUri: Uri;
		readonly newUri: Uri;
	}

	export interface FileWillRenameEvent {
		readonly oldUri: Uri;
		readonly newUri: Uri;
		waitUntil(thenable: Thenable<WorkspaceEdit>): void;
	}

	export namespace workspace {
		export const onWillRenameFile: Event<FileWillRenameEvent>;
		export const onDidRenameFile: Event<FileRenameEvent>;
	}
	//#endregion
}
