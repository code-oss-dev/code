/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import uri from 'vs/base/common/uri';
import { TPromise } from 'vs/base/common/winjs.base';
import Event from 'vs/base/common/event';
import severity from 'vs/base/common/severity';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import editor = require('vs/editor/common/editorCommon');
import { Position } from 'vs/editor/common/core/position';
import { ISuggestion } from 'vs/editor/common/modes';
import { Source } from 'vs/workbench/parts/debug/common/debugSource';
import { Range } from 'vs/editor/common/core/range';
import { RawContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';

export const VIEWLET_ID = 'workbench.view.debug';
export const REPL_ID = 'workbench.panel.repl';
export const DEBUG_SERVICE_ID = 'debugService';
export const CONTEXT_IN_DEBUG_MODE = new RawContextKey<boolean>('inDebugMode', false);
export const CONTEXT_NOT_IN_DEBUG_MODE: ContextKeyExpr = CONTEXT_IN_DEBUG_MODE.toNegated();
export const CONTEXT_IN_DEBUG_REPL = new RawContextKey<boolean>('inDebugRepl', false);
export const CONTEXT_NOT_IN_DEBUG_REPL: ContextKeyExpr = CONTEXT_IN_DEBUG_REPL.toNegated();
export const CONTEXT_ON_FIRST_DEBUG_REPL_LINE = new RawContextKey<boolean>('onFirsteDebugReplLine', false);
export const CONTEXT_ON_LAST_DEBUG_REPL_LINE = new RawContextKey<boolean>('onLastDebugReplLine', false);
export const EDITOR_CONTRIBUTION_ID = 'editor.contrib.debug';
export const DEBUG_SCHEME = 'debug';

// raw

export interface IRawModelUpdate {
	threadId: number;
	rawSession: ISession;
	thread?: DebugProtocol.Thread;
	callStack?: DebugProtocol.StackFrame[];
	stoppedDetails?: IRawStoppedDetails;
	allThreadsStopped?: boolean;
}

export interface IRawStoppedDetails {
	reason: string;
	threadId?: number;
	text?: string;
	totalFrames?: number;
	framesErrorMessage?: string;
}

// model

export interface ITreeElement {
	getId(): string;
}

export interface IExpressionContainer extends ITreeElement {
	reference: number;
	stackFrame: IStackFrame;
	getChildren(debugService: IDebugService): TPromise<IExpression[]>;
}

export interface IExpression extends ITreeElement, IExpressionContainer {
	name: string;
	value: string;
	valueChanged: boolean;
	type?: string;
}

export interface IBaseSession {
	stackTrace(args: DebugProtocol.StackTraceArguments): TPromise<DebugProtocol.StackTraceResponse>;
	scopes(args: DebugProtocol.ScopesArguments): TPromise<DebugProtocol.ScopesResponse>;
	variables(args: DebugProtocol.VariablesArguments): TPromise<DebugProtocol.VariablesResponse>;
	evaluate(args: DebugProtocol.EvaluateArguments): TPromise<DebugProtocol.EvaluateResponse>;

	configuration: { type: string, capabilities: DebugProtocol.Capabilities };
	disconnect(restart?: boolean, force?: boolean): TPromise<DebugProtocol.DisconnectResponse>;
	custom(request: string, args: any): TPromise<DebugProtocol.Response>;
	onDidEvent: Event<DebugProtocol.Event>;
}

export interface ISession extends IBaseSession, ITreeElement {
	readyForBreakpoints: boolean;
	emittedStopped: boolean;
	getLengthInSeconds(): number;
	attach(args: DebugProtocol.AttachRequestArguments): TPromise<DebugProtocol.AttachResponse>;
	setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): TPromise<DebugProtocol.SetBreakpointsResponse>;
	setFunctionBreakpoints(args: DebugProtocol.SetFunctionBreakpointsArguments): TPromise<DebugProtocol.SetFunctionBreakpointsResponse>;
	setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments): TPromise<DebugProtocol.SetExceptionBreakpointsResponse>;
	onDidStop: Event<DebugProtocol.StoppedEvent>;
	threads(): TPromise<DebugProtocol.ThreadsResponse>;
	stepIn(args: DebugProtocol.StepInArguments): TPromise<DebugProtocol.StepInResponse>;
	stepOut(args: DebugProtocol.StepOutArguments): TPromise<DebugProtocol.StepOutResponse>;
	stepBack(args: DebugProtocol.StepBackArguments): TPromise<DebugProtocol.StepBackResponse>;
	continue(args: DebugProtocol.ContinueArguments): TPromise<DebugProtocol.ContinueResponse>;
	pause(args: DebugProtocol.PauseArguments): TPromise<DebugProtocol.PauseResponse>;
	setVariable(args: DebugProtocol.SetVariableArguments): TPromise<DebugProtocol.SetVariableResponse>;
	restartFrame(args: DebugProtocol.RestartFrameArguments): TPromise<DebugProtocol.RestartFrameResponse>;
	completions(args: DebugProtocol.CompletionsArguments): TPromise<DebugProtocol.CompletionsResponse>;
	next(args: DebugProtocol.NextArguments): TPromise<DebugProtocol.NextResponse>;
	source(args: DebugProtocol.SourceArguments): TPromise<DebugProtocol.SourceResponse>;
}

export interface IProcess extends IBaseSession, ITreeElement {
	getThread(threadId: number): IThread;
	getAllThreads(): IThread[];
}

export interface IThread extends ITreeElement {

	/**
	 * Process the thread belongs to
	 */
	process: IProcess;

	/**
	 * Id of the thread generated by the debug adapter backend.
	 */
	threadId: number;

	/**
	 * Name of the thread.
	 */
	name: string;

	/**
	 * Information about the current thread stop event. Null if thread is not stopped.
	 */
	stoppedDetails: IRawStoppedDetails;

	/**
	 * Queries the debug adapter for the callstack and returns a promise with
	 * the stack frames of the callstack.
	 * If the thread is not stopped, it returns a promise to an empty array.
	 * Only gets the first 20 stack frames. Calling this method consecutive times
	 * with getAdditionalStackFrames = true gets the remainder of the call stack.
	 */
	getCallStack(getAdditionalStackFrames?: boolean): TPromise<IStackFrame[]>;

	/**
	 * Gets the callstack if it has already been received from the debug
	 * adapter, otherwise it returns undefined.
	 */
	getCachedCallStack(): IStackFrame[];

	/**
	 * Invalidates the callstack cache
	 */
	clearCallStack(): void;

	/**
	 * Indicates whether this thread is stopped. The callstack for stopped
	 * threads can be retrieved from the debug adapter.
	 */
	stopped: boolean;
}

export interface IScope extends IExpressionContainer {
	name: string;
	expensive: boolean;
}

export interface IStackFrame extends ITreeElement {
	thread: IThread;
	name: string;
	lineNumber: number;
	column: number;
	frameId: number;
	source: Source;
	getScopes(): TPromise<IScope[]>;
}

export interface IEnablement extends ITreeElement {
	enabled: boolean;
}

export interface IRawBreakpoint {
	uri: uri;
	lineNumber: number;
	enabled?: boolean;
	condition?: string;
	hitCondition?: string;
}

export interface IBreakpoint extends IEnablement {
	source: Source;
	lineNumber: number;
	desiredLineNumber: number;
	condition: string;
	hitCondition: string;
	verified: boolean;
	idFromAdapter: number;
	message: string;
}

export interface IFunctionBreakpoint extends IEnablement {
	name: string;
	verified: boolean;
	idFromAdapter: number;
	hitCondition: string;
}

export interface IExceptionBreakpoint extends IEnablement {
	filter: string;
	label: string;
}

// model interfaces

export interface IViewModel extends ITreeElement {
	/**
	 * Returns the active debug process or null if debug is inactive.
	 */
	focusedProcess: IProcess;
	focusedThread: IThread;
	focusedStackFrame: IStackFrame;
	getSelectedExpression(): IExpression;
	getSelectedFunctionBreakpoint(): IFunctionBreakpoint;
	setSelectedExpression(expression: IExpression);
	setSelectedFunctionBreakpoint(functionBreakpoint: IFunctionBreakpoint): void;

	onDidFocusStackFrame: Event<IStackFrame>;
	onDidSelectExpression: Event<IExpression>;
	onDidSelectFunctionBreakpoint: Event<IFunctionBreakpoint>;
}

export interface IModel extends ITreeElement {
	getProcesses(): IProcess[];
	getBreakpoints(): IBreakpoint[];
	areBreakpointsActivated(): boolean;
	getFunctionBreakpoints(): IFunctionBreakpoint[];
	getExceptionBreakpoints(): IExceptionBreakpoint[];
	getWatchExpressions(): IExpression[];
	getReplElements(): ITreeElement[];

	onDidChangeBreakpoints: Event<void>;
	onDidChangeCallStack: Event<void>;
	onDidChangeWatchExpressions: Event<IExpression>;
	onDidChangeReplElements: Event<void>;
};

// service enums

export enum State {
	Disabled,
	Inactive,
	Initializing,
	Stopped,
	Running,
	RunningNoDebug
}

// Service config

export interface IDebugConfiguration {
	allowBreakpointsEverywhere: boolean;
	openExplorerOnEnd: boolean;
}

// service interfaces

export interface IGlobalConfig {
	version: string;
	debugServer?: number;
	configurations: IConfig[];
}

export interface IEnvConfig {
	name?: string;
	type: string;
	request: string;
	internalConsoleOptions?: string;
	preLaunchTask?: string;
	debugServer?: number;
	noDebug?: boolean;
	silentlyAbort?: boolean;
}

export interface IExtHostConfig extends IEnvConfig {
	port?: number;
	sourceMaps?: boolean;
	outDir?: string;
}

export interface IConfig extends IEnvConfig {
	windows?: IEnvConfig;
	osx?: IEnvConfig;
	linux?: IEnvConfig;
}

export interface IRawEnvAdapter {
	type?: string;
	label?: string;
	program?: string;
	args?: string[];
	runtime?: string;
	runtimeArgs?: string[];
}

export interface IRawAdapter extends IRawEnvAdapter {
	enableBreakpointsFor?: { languageIds: string[] };
	configurationAttributes?: any;
	initialConfigurations?: any[] | string;
	variables: { [key: string]: string };
	aiKey?: string;
	win?: IRawEnvAdapter;
	winx86?: IRawEnvAdapter;
	windows?: IRawEnvAdapter;
	osx?: IRawEnvAdapter;
	linux?: IRawEnvAdapter;
}

export interface IRawBreakpointContribution {
	language: string;
}

export interface IConfigurationManager {
	configuration: IConfig;
	setConfiguration(name: string): TPromise<void>;
	openConfigFile(sideBySide: boolean): TPromise<boolean>;
	loadLaunchConfig(): TPromise<IGlobalConfig>;
	canSetBreakpointsIn(model: editor.IModel): boolean;

	/**
	 * Allows to register on change of debug configuration.
	 */
	onDidConfigurationChange: Event<IConfig>;
}

export const IDebugService = createDecorator<IDebugService>(DEBUG_SERVICE_ID);

export interface IDebugService {
	_serviceBrand: any;

	/**
	 * Gets the current debug state.
	 */
	state: State;

	/**
	 * Allows to register on debug state changes.
	 */
	onDidChangeState: Event<State>;

	/**
	 * Gets the current configuration manager.
	 */
	getConfigurationManager(): IConfigurationManager;

	/**
	 * Sets the focused stack frame and evaluates all expresions against the newly focused stack frame,
	 */
	setFocusedStackFrameAndEvaluate(focusedStackFrame: IStackFrame): TPromise<void>;

	/**
	 * Adds new breakpoints to the model. Notifies debug adapter of breakpoint changes.
	 */
	addBreakpoints(rawBreakpoints: IRawBreakpoint[]): TPromise<void>;

	/**
	 * Enables or disables all breakpoints. If breakpoint is passed only enables or disables the passed breakpoint.
	 * Notifies debug adapter of breakpoint changes.
	 */
	enableOrDisableBreakpoints(enable: boolean, breakpoint?: IEnablement): TPromise<void>;

	/**
	 * Sets the global activated property for all breakpoints.
	 * Notifies debug adapter of breakpoint changes.
	 */
	setBreakpointsActivated(activated: boolean): TPromise<void>;

	/**
	 * Removes all breakpoints. If id is passed only removes the breakpoint associated with that id.
	 * Notifies debug adapter of breakpoint changes.
	 */
	removeBreakpoints(id?: string): TPromise<any>;

	/**
	 * Adds a new no name function breakpoint. The function breakpoint should be renamed once user enters the name.
	 */
	addFunctionBreakpoint(): void;

	/**
	 * Renames an already existing function breakpoint.
	 * Notifies debug adapter of breakpoint changes.
	 */
	renameFunctionBreakpoint(id: string, newFunctionName: string): TPromise<void>;

	/**
	 * Removes all function breakpoints. If id is passed only removes the function breakpoint with the passed id.
	 * Notifies debug adapter of breakpoint changes.
	 */
	removeFunctionBreakpoints(id?: string): TPromise<void>;

	/**
	 * Adds a new expression to the repl.
	 */
	addReplExpression(name: string): TPromise<void>;

	/**
	 * Removes all repl expressions.
	 */
	removeReplExpressions(): void;

	/**
	 * Adds a new log to the repl. Either a string value or a dictionary (used to inspect complex objects printed to the repl).
	 */
	logToRepl(value: string | { [key: string]: any }, severity?: severity): void;

	/**
	 * Appends new output to the repl.
	 */
	appendReplOutput(value: string, severity?: severity): void;

	/**
	 * Sets the value for the variable against the debug adapter.
	 */
	setVariable(variable: IExpression, value: string): TPromise<void>;

	/**
	 * Adds a new watch expression and evaluates it against the debug adapter.
	 */
	addWatchExpression(name?: string): TPromise<void>;

	/**
	 * Renames a watch expression and evaluates it against the debug adapter.
	 */
	renameWatchExpression(id: string, newName: string): TPromise<void>;

	/**
	 * Removes all watch expressions. If id is passed only removes the watch expression with the passed id.
	 */
	removeWatchExpressions(id?: string): void;

	/**
	 * Creates a new debug session. Depending on the configuration will either 'launch' or 'attach'.
	 */
	createSession(noDebug: boolean, configuration?: IConfig): TPromise<any>;

	/**
	 * Restarts an active debug session or creates a new one if there is no active session.
	 */
	restartSession(): TPromise<any>;

	/**
	 * Gets the current debug model.
	 */
	getModel(): IModel;

	/**
	 * Gets the current view model.
	 */
	getViewModel(): IViewModel;

	/**
	 * Opens a new or reveals an already visible editor showing the source.
	 */
	openOrRevealSource(source: Source, lineNumber: number, preserveFocus: boolean, sideBySide: boolean): TPromise<any>;

	next(threadId: number): TPromise<void>;
	stepIn(threadId: number): TPromise<void>;
	stepOut(threadId: number): TPromise<void>;
	stepBack(threadId: number): TPromise<void>;
	continue(threadId: number): TPromise<void>;
	pause(threadId: number): TPromise<any>;
	restartFrame(frameId: number): TPromise<any>;
	completions(text: string, position: Position): TPromise<ISuggestion[]>;
}

// Editor interfaces
export interface IDebugEditorContribution extends editor.IEditorContribution {
	showHover(range: Range, hoveringOver: string, focus: boolean): TPromise<void>;
}

// utils

const _formatPIIRegexp = /{([^}]+)}/g;

export function formatPII(value: string, excludePII: boolean, args: { [key: string]: string }): string {
	return value.replace(_formatPIIRegexp, function (match, group) {
		if (excludePII && group.length > 0 && group[0] !== '_') {
			return match;
		}

		return args && args.hasOwnProperty(group) ?
			args[group] :
			match;
	});
}
