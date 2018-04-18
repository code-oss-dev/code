/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is the place for API experiments and proposal.

declare module 'vscode' {

	export namespace window {
		export function sampleFunction(): Thenable<any>;
	}

	//#region Aeschli: folding

	export class FoldingRangeList {

		/**
		 * The folding ranges.
		 */
		ranges: FoldingRange[];

		/**
		 * Creates new folding range list.
		 *
		 * @param ranges The folding ranges
		 */
		constructor(ranges: FoldingRange[]);
	}


	export class FoldingRange {

		/**
		 * The start line number (zero-based) of the range to fold. The hidden area starts after the last character of that line.
		 */
		startLine: number;

		/**
		 * The end line number (0-based) of the range to fold. The hidden area ends at the last character of that line.
		 */
		endLine: number;

		/**
		 * The actual color value for this color range.
		 */
		type?: FoldingRangeType | string;

		/**
		 * Creates a new folding range.
		 *
		 * @param startLineNumber The first line of the fold
		 * @param type The last line of the fold
		 */
		constructor(startLineNumber: number, endLineNumber: number, type?: FoldingRangeType | string);
	}

	export enum FoldingRangeType {
		/**
		 * Folding range for a comment
		 */
		Comment = 'comment',
		/**
		 * Folding range for a imports or includes
		 */
		Imports = 'imports',
		/**
		 * Folding range for a region (e.g. `#region`)
		 */
		Region = 'region'
	}

	export namespace languages {

		/**
		 * Register a folding provider.
		 *
		 * Multiple folding can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and the best-matching provider is used. Failure
		 * of the selected provider will cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A folding provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerFoldingProvider(selector: DocumentSelector, provider: FoldingProvider): Disposable;
	}

	export interface FoldingContext {
		maxRanges?: number;
	}

	export interface FoldingProvider {
		/**
		 * Returns a list of folding ranges or null if the provider does not want to participate or was cancelled.
		 */
		provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRangeList>;
	}

	//#endregion

	//#region Joh: file system provider

	export enum FileChangeType {
		Updated = 0,
		Added = 1,
		Deleted = 2
	}

	export interface FileChange {
		type: FileChangeType;
		resource: Uri;
	}

	export enum FileType {
		File = 0,
		Dir = 1,
		Symlink = 2
	}

	export interface FileStat {
		id: number | string;
		mtime: number;
		// atime: number;
		size: number;
		type: FileType;
	}

	// todo@joh discover files etc
	// todo@joh CancellationToken everywhere
	// todo@joh add open/close calls?
	export interface FileSystemProvider {

		readonly onDidChange?: Event<FileChange[]>;

		// more...
		// @deprecated - will go away
		utimes(resource: Uri, mtime: number, atime: number): Thenable<FileStat>;

		stat(resource: Uri): Thenable<FileStat>;

		read(resource: Uri, offset: number, length: number, progress: Progress<Uint8Array>): Thenable<number>;

		// todo@joh - have an option to create iff not exist
		// todo@remote
		// offset - byte offset to start
		// count - number of bytes to write
		// Thenable<number> - number of bytes actually written
		write(resource: Uri, content: Uint8Array): Thenable<void>;

		// todo@remote
		// Thenable<FileStat>
		move(resource: Uri, target: Uri): Thenable<FileStat>;

		// todo@remote
		// helps with performance bigly
		// copy?(from: Uri, to: Uri): Thenable<void>;

		// todo@remote
		// Thenable<FileStat>
		mkdir(resource: Uri): Thenable<FileStat>;

		readdir(resource: Uri): Thenable<[Uri, FileStat][]>;

		// todo@remote
		// ? merge both
		// ? recursive del
		rmdir(resource: Uri): Thenable<void>;
		unlink(resource: Uri): Thenable<void>;

		// todo@remote
		// create(resource: Uri): Thenable<FileStat>;
	}

	// export class FileError extends Error {

	// 	/**
	// 	 * Entry already exists, e.g. when creating a file or folder.
	// 	 */
	// 	static readonly EntryExists: FileError;

	// 	/**
	// 	 * Entry does not exist.
	// 	 */
	// 	static readonly EntryNotFound: FileError;

	// 	/**
	// 	 * Entry is not a directory.
	// 	 */
	// 	static readonly EntryNotADirectory: FileError;

	// 	/**
	// 	 * Entry is a directory.
	// 	 */
	// 	static readonly EntryIsADirectory: FileError;

	// 	readonly code: string;

	// 	constructor(code: string, message?: string);
	// }

	export enum FileChangeType2 {
		Changed = 1,
		Created = 2,
		Deleted = 3,
	}

	export interface FileChange2 {
		type: FileChangeType2;
		uri: Uri;
	}

	export enum FileType2 {
		File = 0b001,
		Directory = 0b010,
		SymbolicLink = 0b100,
	}

	export interface FileStat2 {
		type: FileType2;
		mtime: number;
		size: number;
	}

	export enum FileOpenFlags {
		Read = 0b0001,
		Write = 0b0010,
		Create = 0b0100,
		Exclusive = 0b1000
	}

	/**
	 *
	 */
	export interface FileSystemProvider2 {

		_version: 7;

		/**
		 * An event to signal that a resource has been created, changed, or deleted. This
		 * event should fire for resources that are being [watched](#FileSystemProvider2.watch)
		 * by clients of this provider.
		 */
		readonly onDidChangeFile: Event<FileChange2[]>;

		/**
		 * Subscribe to events in the file or folder denoted by `uri`.
		 * @param uri
		 * @param options
		 */
		watch(uri: Uri, options: { recursive?: boolean; excludes?: string[] }): Disposable;

		/**
		 * Retrieve metadata about a file.
		 *
		 * @param uri The uri of the file to retrieve meta data about.
		 * @param token A cancellation token.
		 * @return The file metadata about the file.
		 */
		stat(uri: Uri, token: CancellationToken): FileStat2 | Thenable<FileStat2>;

		/**
		 * Retrieve the meta data of all entries of a [directory](#FileType2.Directory)
		 *
		 * @param uri The uri of the folder.
		 * @param token A cancellation token.
		 * @return A thenable that resolves to an array of tuples of file names and files stats.
		 */
		readDirectory(uri: Uri, token: CancellationToken): [string, FileStat2][] | Thenable<[string, FileStat2][]>;

		/**
		 * Create a new directory. *Note* that new files are created via `write`-calls.
		 *
		 * @param uri The uri of the *new* folder.
		 * @param token A cancellation token.
		 */
		createDirectory(uri: Uri, token: CancellationToken): FileStat2 | Thenable<FileStat2>;

		/**
		 * Read the entire contents of a file.
		 *
		 * @param uri The uri of the file.
		 * @param token A cancellation token.
		 * @return A thenable that resolves to an array of bytes.
		 */
		readFile(uri: Uri, options: { flags: FileOpenFlags }, token: CancellationToken): Uint8Array | Thenable<Uint8Array>;

		/**
		 * Write data to a file, replacing its entire contents.
		 *
		 * @param uri The uri of the file.
		 * @param content The new content of the file.
		 * @param token A cancellation token.
		 */
		writeFile(uri: Uri, content: Uint8Array, options: { flags: FileOpenFlags }, token: CancellationToken): void | Thenable<void>;

		/**
		 * Rename a file or folder.
		 *
		 * @param oldUri The existing file or folder.
		 * @param newUri The target location.
		 * @param token A cancellation token.
		 */
		rename(oldUri: Uri, newUri: Uri, options: { flags: FileOpenFlags }, token: CancellationToken): FileStat2 | Thenable<FileStat2>;

		/**
		 * Copy files or folders. Implementing this function is optional but it will speedup
		 * the copy operation.
		 *
		 * @param uri The existing file or folder.
		 * @param target The target location.
		 * @param token A cancellation token.
		 */
		copy?(uri: Uri, target: Uri, options: { flags: FileOpenFlags }, token: CancellationToken): FileStat2 | Thenable<FileStat2>;

		// todo@remote
		// ? useTrash, expose trash
		delete(uri: Uri, token: CancellationToken): void | Thenable<void>;
	}

	export namespace workspace {
		export function registerFileSystemProvider(scheme: string, provider: FileSystemProvider, newProvider?: FileSystemProvider2): Disposable;
		export function registerDeprecatedFileSystemProvider(scheme: string, provider: FileSystemProvider): Disposable;
	}

	//#endregion

	//#region Joh: remote, search provider

	export interface TextSearchQuery {
		pattern: string;
		isRegExp?: boolean;
		isCaseSensitive?: boolean;
		isWordMatch?: boolean;
	}

	export interface TextSearchOptions {
		includes: GlobPattern[];
		excludes: GlobPattern[];
	}

	export interface TextSearchResult {
		uri: Uri;
		range: Range;
		preview: { leading: string, matching: string, trailing: string };
	}

	export interface SearchProvider {
		provideFileSearchResults?(query: string, progress: Progress<Uri>, token: CancellationToken): Thenable<void>;
		provideTextSearchResults?(query: TextSearchQuery, options: TextSearchOptions, progress: Progress<TextSearchResult>, token: CancellationToken): Thenable<void>;
	}

	export namespace workspace {
		export function registerSearchProvider(scheme: string, provider: SearchProvider): Disposable;
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
		 * This optional method is called just before a debug adapter is started to determine its excutable path and arguments.
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

	//#region Matt: WebView

	/**
	 * Content settings for a webview.
	 */
	export interface WebviewOptions {
		/**
		 * Should scripts be enabled in the webview content?
		 *
		 * Defaults to false (scripts-disabled).
		 */
		readonly enableScripts?: boolean;

		/**
		 * Should command uris be enabled in webview content?
		 *
		 * Defaults to false.
		 */
		readonly enableCommandUris?: boolean;

		/**
		 * Root paths from which the webview can load local (filesystem) resources using the `vscode-resource:` scheme.
		 *
		 * Default to the root folders of the current workspace plus the extension's install directory.
		 *
		 * Pass in an empty array to disallow access to any local resources.
		 */
		readonly localResourceRoots?: ReadonlyArray<Uri>;
	}

	/**
	 * A webview displays html content, like an iframe.
	 */
	export interface Webview {
		/**
		 * Content settings for the webview.
		 */
		readonly options: WebviewOptions;

		/**
		 * Title of the webview shown in UI.
		 */
		title: string;

		/**
		 * Contents of the webview.
		 *
		 * Should be a complete html document.
		 */
		html: string;

		/**
		 * Fired when the webview content posts a message.
		 */
		readonly onDidReceiveMessage: Event<any>;

		/**
		 * Post a message to the webview content.
		 *
		 * Messages are only develivered if the webview is visible.
		 *
		 * @param message Body of the message.
		 */
		postMessage(message: any): Thenable<boolean>;
	}

	/**
	 * Content settings for a webview panel.
	 */
	export interface WebviewPanelOptions {
		/**
		 * Should the find widget be enabled in the panel?
		 *
		 * Defaults to false.
		 */
		readonly enableFindWidget?: boolean;

		/**
		 * Should the webview panel's content (iframe) be kept around even when the panel
		 * is no longer visible?
		 *
		 * Normally the webview panel's html context is created when the panel becomes visible
		 * and destroyed when it is is hidden. Extensions that have complex state
		 * or UI can set the `retainContextWhenHidden` to make VS Code keep the webview
		 * context around, even when the webview moves to a background tab. When
		 * the panel becomes visible again, the context is automatically restored
		 * in the exact same state it was in originally.
		 *
		 * `retainContextWhenHidden` has a high memory overhead and should only be used if
		 * your panel's context cannot be quickly saved and restored.
		 */
		readonly retainContextWhenHidden?: boolean;
	}

	/**
	 * A panel that contains a webview.
	 */
	interface WebviewPanel {
		/**
		 * Type of the webview panel, such as `'markdown.preview'`.
		 */
		readonly viewType: string;

		/**
		 * Webview belonging to the panel.
		 */
		readonly webview: Webview;

		/**
		 * Content settings for the webview panel.
		 */
		readonly options: WebviewPanelOptions;

		/**
		 * Editor position of the panel.
		 */
		readonly position?: ViewColumn;

		/**
		 * Is the panel current visible?
		 */
		readonly visible: boolean;

		/**
		 * Fired when the panel's view state changes.
		 */
		readonly onDidChangeViewState: Event<WebviewPanelOnDidChangeViewStateEvent>;

		/**
		 * Fired when the panel is disposed.
		 *
		 * This may be because the user closed the panel or because `.dispose()` was
		 * called on it.
		 *
		 * Trying to use the panel after it has been disposed throws an exception.
		 */
		readonly onDidDispose: Event<void>;

		/**
		 * Show the webview panel in a given column.
		 *
		 * A webview panel may only show in a single column at a time. If it is already showing, this
		 * method moves it to a new column.
		 */
		reveal(viewColumn: ViewColumn): void;

		/**
		 * Dispose of the webview panel.
		 *
		 * This closes the panel if it showing and disposes of the resources owned by the webview.
		 * Webview panels are also disposed when the user closes the webview panel. Both cases
		 * fire the `onDispose` event.
		 */
		dispose(): any;
	}

	/**
	 * Event fired when a webview panel's view state changes.
	 */
	export interface WebviewPanelOnDidChangeViewStateEvent {
		/**
		 * Webview panel whose view state changed.
		 */
		readonly webviewPanel: WebviewPanel;
	}

	/**
	 * Save and restore webview panels that have been persisted when vscode shuts down.
	 */
	interface WebviewPanelSerializer {
		/**
		 * Save a webview panel's `state`.
		 *
		 * Called before shutdown. Extensions have a 250ms timeframe to return a state. If serialization
		 * takes longer than 250ms, the panel will not be serialized.
		 *
		 * @param webviewPanel webview Panel to serialize. May or may not be visible.
		 *
		 * @returns JSON serializable state blob.
		 */
		serializeWebviewPanel(webviewPanel: WebviewPanel): Thenable<any>;

		/**
		 * Restore a webview panel from its seriailzed `state`.
		 *
		 * Called when a serialized webview first becomes visible.
		 *
		 * @param webviewPanel Webview panel to restore. The serializer should take ownership of this panel.
		 * @param state Persisted state.
		 *
		 * @return Thanble indicating that the webview has been fully restored.
		 */
		deserializeWebviewPanel(webviewPanel: WebviewPanel, state: any): Thenable<void>;
	}

	namespace window {
		/**
		 * Create and show a new webview panel.
		 *
		 * @param viewType Identifies the type of the webview panel.
		 * @param title Title of the panel.
		 * @param position Editor column to show the new panel in.
		 * @param options Settings for the new webview panel.
		 *
		 * @return New webview panel.
		 */
		export function createWebviewPanel(viewType: string, title: string, position: ViewColumn, options: WebviewPanelOptions & WebviewOptions): WebviewPanel;

		/**
		 * Registers a webview panel serializer.
		 *
		 * Extensions that support reviving should have an `"onView:viewType"` activation method and
		 * make sure that [registerWebviewPanelSerializer](#registerWebviewPanelSerializer) is called during activation.
		 *
		 * Only a single serializer may be registered at a time for a given `viewType`.
		 *
		 * @param viewType Type of the webview panel that can be serialized.
		 * @param reviver Webview serializer.
		 */
		export function registerWebviewPanelSerializer(viewType: string, reviver: WebviewPanelSerializer): Disposable;
	}

	//#endregion

	//#region Tasks

	/**
	 * An object representing an executed Task. It can be used
	 * to terminate a task.
	 *
	 * This interface is not intended to be implemented.
	 */
	export interface TaskExecution {
		/**
		 * The task that got started.
		 */
		task: Task;

		/**
		 * Terminates the task execution.
		 */
		terminate(): void;
	}

	/**
	 * An event signaling the start of a task execution.
	 *
	 * This interface is not intended to be implemented.
	 */
	interface TaskStartEvent {
		/**
		 * The task item representing the task that got started.
		 */
		execution: TaskExecution;
	}

	/**
	 * An event signaling the end of an executed task.
	 *
	 * This interface is not intended to be implemented.
	 */
	interface TaskEndEvent {
		/**
		 * The task item representing the task that finished.
		 */
		execution: TaskExecution;
	}

	export namespace workspace {

		/**
		 * Fetches all task available in the systems. Thisweweb includes tasks
		 * from `tasks.json` files as well as tasks from task providers
		 * contributed through extensions.
		 */
		export function fetchTasks(): Thenable<Task[]>;

		/**
		 * Executes a task that is managed by VS Code. The returned
		 * task execution can be used to terminate the task.
		 *
		 * @param task the task to execute
		 */
		export function executeTask(task: Task): Thenable<TaskExecution>;

		/**
		 * Fires when a task starts.
		 */
		export const onDidStartTask: Event<TaskStartEvent>;

		/**
		 * Fires when a task ends.
		 */
		export const onDidEndTask: Event<TaskEndEvent>;
	}

	//#endregion

	//#region Terminal

	export namespace window {
		/**
		 * The currently active terminals or an empty array.
		 *
		 * @readonly
		 */
		export let terminals: Terminal[];

		/**
		 * An [event](#Event) which fires when a terminal has been created, either through the
		 * [createTerminal](#window.createTerminal) API or commands.
		 */
		export const onDidOpenTerminal: Event<Terminal>;
	}

	//#endregion
}
