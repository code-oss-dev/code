/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import uri from 'vs/base/common/uri';
import { TPromise } from 'vs/base/common/winjs.base';
import Event from 'vs/base/common/event';
import { IJSONSchemaSnippet } from 'vs/base/common/jsonSchema';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IModel as EditorIModel, IEditorContribution, IRange } from 'vs/editor/common/editorCommon';
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
export const CONTEXT_BREAKPOINT_WIDGET_VISIBLE = new RawContextKey<boolean>('breakpointWidgetVisible', false);

export const EDITOR_CONTRIBUTION_ID = 'editor.contrib.debug';
export const DEBUG_SCHEME = 'debug';
export const NO_CONFIGURATIONS_LABEL = nls.localize('noConfigurations', "No Configurations");

// raw

export interface IRawModelUpdate {
	threadId: number;
	sessionId: string;
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
	stackFrame: IStackFrame;
	hasChildren: boolean;
	getChildren(debugService: IDebugService): TPromise<IExpression[]>;
}

export interface IExpression extends ITreeElement, IExpressionContainer {
	name: string;
	value: string;
	valueChanged: boolean;
	type?: string;
}

export enum SessionRequestType {
	LAUNCH,
	ATTACH,
	LAUNCH_NO_DEBUG
}

export interface ISession {
	requestType: SessionRequestType;
	stackTrace(args: DebugProtocol.StackTraceArguments): TPromise<DebugProtocol.StackTraceResponse>;
	scopes(args: DebugProtocol.ScopesArguments): TPromise<DebugProtocol.ScopesResponse>;
	variables(args: DebugProtocol.VariablesArguments): TPromise<DebugProtocol.VariablesResponse>;
	evaluate(args: DebugProtocol.EvaluateArguments): TPromise<DebugProtocol.EvaluateResponse>;

	configuration: { type: string, capabilities: DebugProtocol.Capabilities };
	disconnect(restart?: boolean, force?: boolean): TPromise<DebugProtocol.DisconnectResponse>;
	custom(request: string, args: any): TPromise<DebugProtocol.Response>;
	onDidEvent: Event<DebugProtocol.Event>;
	restartFrame(args: DebugProtocol.RestartFrameArguments): TPromise<DebugProtocol.RestartFrameResponse>;

	next(args: DebugProtocol.NextArguments): TPromise<DebugProtocol.NextResponse>;
	stepIn(args: DebugProtocol.StepInArguments): TPromise<DebugProtocol.StepInResponse>;
	stepOut(args: DebugProtocol.StepOutArguments): TPromise<DebugProtocol.StepOutResponse>;
	continue(args: DebugProtocol.ContinueArguments): TPromise<DebugProtocol.ContinueResponse>;
	pause(args: DebugProtocol.PauseArguments): TPromise<DebugProtocol.PauseResponse>;
	stepBack(args: DebugProtocol.StepBackArguments): TPromise<DebugProtocol.StepBackResponse>;
	reverseContinue(args: DebugProtocol.ReverseContinueArguments): TPromise<DebugProtocol.ReverseContinueResponse>;

	completions(args: DebugProtocol.CompletionsArguments): TPromise<DebugProtocol.CompletionsResponse>;
	setVariable(args: DebugProtocol.SetVariableArguments): TPromise<DebugProtocol.SetVariableResponse>;
	source(args: DebugProtocol.SourceArguments): TPromise<DebugProtocol.SourceResponse>;
}

export interface IProcess extends ITreeElement {
	name: string;
	session: ISession;
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
	 * Gets the callstack if it has already been received from the debug
	 * adapter, otherwise it returns null.
	 */
	getCallStack(): IStackFrame[];

	/**
	 * Invalidates the callstack cache
	 */
	clearCallStack(): void;

	/**
	 * Indicates whether this thread is stopped. The callstack for stopped
	 * threads can be retrieved from the debug adapter.
	 */
	stopped: boolean;

	next(): TPromise<any>;
	stepIn(): TPromise<any>;
	stepOut(): TPromise<any>;
	stepBack(): TPromise<any>;
	continue(): TPromise<any>;
	pause(): TPromise<any>;
	reverseContinue(): TPromise<any>;
}

export interface IScope extends IExpressionContainer {
	name: string;
	expensive: boolean;
	range?: IRange;
}

export interface IStackFrame extends ITreeElement {
	thread: IThread;
	name: string;
	lineNumber: number;
	column: number;
	frameId: number;
	source: Source;
	getScopes(): TPromise<IScope[]>;
	restart(): TPromise<any>;
	completions(text: string, position: Position, overwriteBefore: number): TPromise<ISuggestion[]>;
}

export interface IEnablement extends ITreeElement {
	enabled: boolean;
}

export interface IRawBreakpoint {
	lineNumber: number;
	enabled?: boolean;
	condition?: string;
	hitCondition?: string;
}

export interface IBreakpoint extends IEnablement {
	uri: uri;
	lineNumber: number;
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
	 * Returns the focused debug process or null if no process is stopped.
	 */
	focusedProcess: IProcess;

	/**
	 * Returns the focused thread or null if no thread is stopped.
	 */
	focusedThread: IThread;

	/**
	 * Returns the focused stack frame or null if there are no stack frames.
	 */
	focusedStackFrame: IStackFrame;
	getSelectedExpression(): IExpression;
	getSelectedFunctionBreakpoint(): IFunctionBreakpoint;
	setSelectedExpression(expression: IExpression);
	setSelectedFunctionBreakpoint(functionBreakpoint: IFunctionBreakpoint): void;

	selectedConfigurationName: string;
	setSelectedConfigurationName(name: string): void;

	isMultiProcessView(): boolean;

	onDidFocusStackFrame: Event<IStackFrame>;
	onDidFocusProcess: Event<IProcess>;
	onDidSelectExpression: Event<IExpression>;
	onDidSelectFunctionBreakpoint: Event<IFunctionBreakpoint>;
	/**
	 * Allows to register on change of selected debug configuration.
	 */
	onDidSelectConfigurationName: Event<string>;
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
	configurationSnippets?: IJSONSchemaSnippet[];
	initialConfigurations?: any[] | string;
	variables?: { [key: string]: string };
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

	/**
	 * Returns a resolved debug configuration.
	 * If nameOrConfig is null resolves the first configuration and returns it.
	 */
	getConfiguration(nameOrConfig: string | IConfig): TPromise<IConfig>;

	/**
	 * Opens the launch.json file
	 */
	openConfigFile(sideBySide: boolean): TPromise<boolean>;

	/**
	 * Returns true if breakpoints can be set for a given editor model. Depends on mode.
	 */
	canSetBreakpointsIn(model: EditorIModel): boolean;
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
	onDidChangeState: Event<void>;

	/**
	 * Gets the current configuration manager.
	 */
	getConfigurationManager(): IConfigurationManager;

	/**
	 * Sets the focused stack frame and evaluates all expresions against the newly focused stack frame,
	 */
	focusStackFrameAndEvaluate(focusedStackFrame: IStackFrame, process?: IProcess): TPromise<void>;

	/**
	 * Adds new breakpoints to the model for the file specified with the uri. Notifies debug adapter of breakpoint changes.
	 */
	addBreakpoints(uri: uri, rawBreakpoints: IRawBreakpoint[]): TPromise<void>;

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
	 * Adds a new watch expression and evaluates it against the debug adapter.
	 */
	addWatchExpression(name?: string): TPromise<void>;

	/**
	 * Renames a watch expression and evaluates it against the debug adapter.
	 */
	renameWatchExpression(id: string, newName: string): TPromise<void>;

	/**
	 * Moves a watch expression to a new possition. Used for reordering watch expressions.
	 */
	moveWatchExpression(id: string, position: number): void;

	/**
	 * Removes all watch expressions. If id is passed only removes the watch expression with the passed id.
	 */
	removeWatchExpressions(id?: string): void;

	/**
	 * Creates a new debug process. Depending on the configuration will either 'launch' or 'attach'.
	 */
	createProcess(configurationOrName: IConfig | string): TPromise<any>;

	/**
	 * Restarts a process or creates a new one if there is no active session.
	 */
	restartProcess(process: IProcess): TPromise<any>;

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
	openOrRevealSource(sourceOrUri: Source | uri, lineNumber: number, preserveFocus: boolean, sideBySide: boolean): TPromise<any>;
}

// Editor interfaces
export interface IDebugEditorContribution extends IEditorContribution {
	showHover(range: Range, hoveringOver: string, focus: boolean): TPromise<void>;
	showBreakpointWidget(lineNumber: number): void;
	closeBreakpointWidget(): void;
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
