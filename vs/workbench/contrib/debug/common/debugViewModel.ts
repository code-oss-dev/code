/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { CONTEXT_EXPRESSION_SELECTED, IViewModel, IStackFrame, IDebugSession, IThread, IExpression, IFunctionBreakpoint, CONTEXT_BREAKPOINT_SELECTED, CONTEXT_LOADED_SCRIPTS_SUPPORTED } from 'vs/workbench/contrib/debug/common/debug';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';

export class ViewModel implements IViewModel {

	firstSessionStart = true;

	private _focusedStackFrame: IStackFrame | undefined;
	private _focusedSession: IDebugSession | undefined;
	private _focusedThread: IThread | undefined;
	private selectedExpression: IExpression | undefined;
	private selectedFunctionBreakpoint: IFunctionBreakpoint | undefined;
	private readonly _onDidFocusSession: Emitter<IDebugSession | undefined>;
	private readonly _onDidFocusStackFrame: Emitter<{ stackFrame: IStackFrame | undefined, explicit: boolean }>;
	private readonly _onDidSelectExpression: Emitter<IExpression | undefined>;
	private multiSessionView: boolean;
	private expressionSelectedContextKey: IContextKey<boolean>;
	private breakpointSelectedContextKey: IContextKey<boolean>;
	private loadedScriptsSupportedContextKey: IContextKey<boolean>;

	constructor(contextKeyService: IContextKeyService) {
		this._onDidFocusSession = new Emitter<IDebugSession | undefined>();
		this._onDidFocusStackFrame = new Emitter<{ stackFrame: IStackFrame, explicit: boolean }>();
		this._onDidSelectExpression = new Emitter<IExpression>();
		this.multiSessionView = false;
		this.expressionSelectedContextKey = CONTEXT_EXPRESSION_SELECTED.bindTo(contextKeyService);
		this.breakpointSelectedContextKey = CONTEXT_BREAKPOINT_SELECTED.bindTo(contextKeyService);
		this.loadedScriptsSupportedContextKey = CONTEXT_LOADED_SCRIPTS_SUPPORTED.bindTo(contextKeyService);
	}

	getId(): string {
		return 'root';
	}

	get focusedSession(): IDebugSession | undefined {
		return this._focusedSession;
	}

	get focusedThread(): IThread | undefined {
		return this._focusedThread;
	}

	get focusedStackFrame(): IStackFrame | undefined {
		return this._focusedStackFrame;
	}

	setFocus(stackFrame: IStackFrame | undefined, thread: IThread | undefined, session: IDebugSession | undefined, explicit: boolean): void {
		const shouldEmitForStackFrame = this._focusedStackFrame !== stackFrame;
		const shouldEmitForSession = this._focusedSession !== session;

		this._focusedStackFrame = stackFrame;
		this._focusedThread = thread;
		this._focusedSession = session;

		this.loadedScriptsSupportedContextKey.set(session ? !!session.capabilities.supportsLoadedSourcesRequest : false);

		if (shouldEmitForSession) {
			this._onDidFocusSession.fire(session);
		}
		if (shouldEmitForStackFrame) {
			this._onDidFocusStackFrame.fire({ stackFrame, explicit });
		}
	}

	get onDidFocusSession(): Event<IDebugSession | undefined> {
		return this._onDidFocusSession.event;
	}

	get onDidFocusStackFrame(): Event<{ stackFrame: IStackFrame | undefined, explicit: boolean }> {
		return this._onDidFocusStackFrame.event;
	}

	getSelectedExpression(): IExpression | undefined {
		return this.selectedExpression;
	}

	setSelectedExpression(expression: IExpression | undefined) {
		this.selectedExpression = expression;
		this.expressionSelectedContextKey.set(!!expression);
		this._onDidSelectExpression.fire(expression);
	}

	get onDidSelectExpression(): Event<IExpression | undefined> {
		return this._onDidSelectExpression.event;
	}

	getSelectedFunctionBreakpoint(): IFunctionBreakpoint | undefined {
		return this.selectedFunctionBreakpoint;
	}

	setSelectedFunctionBreakpoint(functionBreakpoint: IFunctionBreakpoint | undefined): void {
		this.selectedFunctionBreakpoint = functionBreakpoint;
		this.breakpointSelectedContextKey.set(!!functionBreakpoint);
	}

	isMultiSessionView(): boolean {
		return this.multiSessionView;
	}

	setMultiSessionView(isMultiSessionView: boolean): void {
		this.multiSessionView = isMultiSessionView;
	}
}
