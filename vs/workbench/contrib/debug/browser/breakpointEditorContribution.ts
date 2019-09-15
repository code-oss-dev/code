/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as env from 'vs/base/common/platform';
import { URI as uri } from 'vs/base/common/uri';
import severity from 'vs/base/common/severity';
import { IAction, Action } from 'vs/base/common/actions';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IModelDecorationOptions, IModelDeltaDecoration, TrackedRangeStickiness } from 'vs/editor/common/model';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { RemoveBreakpointAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { IDebugService, IBreakpoint, CONTEXT_BREAKPOINT_WIDGET_VISIBLE, BreakpointWidgetContext, BREAKPOINT_EDITOR_CONTRIBUTION_ID, IBreakpointEditorContribution } from 'vs/workbench/contrib/debug/common/debug';
import { IMarginData } from 'vs/editor/browser/controller/mouseTarget';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ContextSubMenu } from 'vs/base/browser/contextmenu';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { BreakpointWidget } from 'vs/workbench/contrib/debug/browser/breakpointWidget';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';

class BreakpointEditorContribution implements IBreakpointEditorContribution {

	private breakpointHintDecoration: string[] = [];
	private breakpointWidget: BreakpointWidget | undefined;
	private breakpointWidgetVisible: IContextKey<boolean>;
	private toDispose: IDisposable[] = [];

	constructor(
		private readonly editor: ICodeEditor,
		@IDebugService private readonly debugService: IDebugService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		this.breakpointWidgetVisible = CONTEXT_BREAKPOINT_WIDGET_VISIBLE.bindTo(contextKeyService);
		this.registerListeners();
	}

	getId(): string {
		return BREAKPOINT_EDITOR_CONTRIBUTION_ID;
	}

	private registerListeners(): void {
		this.toDispose.push(this.editor.onMouseDown(async (e: IEditorMouseEvent) => {
			const data = e.target.detail as IMarginData;
			const model = this.editor.getModel();
			if (!e.target.position || !model || e.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN || data.isAfterLines || !this.marginFreeFromNonDebugDecorations(e.target.position.lineNumber)) {
				return;
			}
			const canSetBreakpoints = this.debugService.getConfigurationManager().canSetBreakpointsIn(model);
			const lineNumber = e.target.position.lineNumber;
			const uri = model.uri;

			if (e.event.rightButton || (env.isMacintosh && e.event.leftButton && e.event.ctrlKey)) {
				if (!canSetBreakpoints) {
					return;
				}

				const anchor = { x: e.event.posx, y: e.event.posy };
				const breakpoints = this.debugService.getModel().getBreakpoints({ lineNumber, uri });

				this.contextMenuService.showContextMenu({
					getAnchor: () => anchor,
					getActions: () => this.getContextMenuActions(breakpoints, uri, lineNumber),
					getActionsContext: () => breakpoints.length ? breakpoints[0] : undefined
				});
			} else {
				const breakpoints = this.debugService.getModel().getBreakpoints({ uri, lineNumber });

				if (breakpoints.length) {
					// Show the dialog if there is a potential condition to be accidently lost.
					// Do not show dialog on linux due to electron issue freezing the mouse #50026
					if (!env.isLinux && breakpoints.some(bp => !!bp.condition || !!bp.logMessage || !!bp.hitCondition)) {
						const logPoint = breakpoints.every(bp => !!bp.logMessage);
						const breakpointType = logPoint ? nls.localize('logPoint', "Logpoint") : nls.localize('breakpoint', "Breakpoint");
						const disable = breakpoints.some(bp => bp.enabled);

						const enabling = nls.localize('breakpointHasConditionDisabled',
							"This {0} has a {1} that will get lost on remove. Consider enabling the {0} instead.",
							breakpointType.toLowerCase(),
							logPoint ? nls.localize('message', "message") : nls.localize('condition', "condition")
						);
						const disabling = nls.localize('breakpointHasConditionEnabled',
							"This {0} has a {1} that will get lost on remove. Consider disabling the {0} instead.",
							breakpointType.toLowerCase(),
							logPoint ? nls.localize('message', "message") : nls.localize('condition', "condition")
						);

						const { choice } = await this.dialogService.show(severity.Info, disable ? disabling : enabling, [
							nls.localize('removeLogPoint', "Remove {0}", breakpointType),
							nls.localize('disableLogPoint', "{0} {1}", disable ? nls.localize('disable', "Disable") : nls.localize('enable', "Enable"), breakpointType),
							nls.localize('cancel', "Cancel")
						], { cancelId: 2 });

						if (choice === 0) {
							breakpoints.forEach(bp => this.debugService.removeBreakpoints(bp.getId()));
						}
						if (choice === 1) {
							breakpoints.forEach(bp => this.debugService.enableOrDisableBreakpoints(!disable, bp));
						}
					} else {
						breakpoints.forEach(bp => this.debugService.removeBreakpoints(bp.getId()));
					}
				} else if (canSetBreakpoints) {
					this.debugService.addBreakpoints(uri, [{ lineNumber }], `debugEditorGutter`);
				}
			}
		}));

		this.toDispose.push(this.editor.onMouseMove((e: IEditorMouseEvent) => {
			let showBreakpointHintAtLineNumber = -1;
			const model = this.editor.getModel();
			if (model && e.target.position && e.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN && this.debugService.getConfigurationManager().canSetBreakpointsIn(model) &&
				this.marginFreeFromNonDebugDecorations(e.target.position.lineNumber)) {
				const data = e.target.detail as IMarginData;
				if (!data.isAfterLines) {
					showBreakpointHintAtLineNumber = e.target.position.lineNumber;
				}
			}
			this.ensureBreakpointHintDecoration(showBreakpointHintAtLineNumber);
		}));
		this.toDispose.push(this.editor.onMouseLeave((e: IEditorMouseEvent) => {
			this.ensureBreakpointHintDecoration(-1);
		}));

		this.toDispose.push(this.editor.onDidChangeModel(() => {
			this.closeBreakpointWidget();
		}));
	}

	private getContextMenuActions(breakpoints: ReadonlyArray<IBreakpoint>, uri: uri, lineNumber: number): Array<IAction | ContextSubMenu> {
		const actions: Array<IAction | ContextSubMenu> = [];
		if (breakpoints.length === 1) {
			const breakpointType = breakpoints[0].logMessage ? nls.localize('logPoint', "Logpoint") : nls.localize('breakpoint', "Breakpoint");
			actions.push(new RemoveBreakpointAction(RemoveBreakpointAction.ID, nls.localize('removeBreakpoint', "Remove {0}", breakpointType), this.debugService, this.keybindingService));
			actions.push(new Action(
				'workbench.debug.action.editBreakpointAction',
				nls.localize('editBreakpoint', "Edit {0}...", breakpointType),
				undefined,
				true,
				() => Promise.resolve(this.showBreakpointWidget(breakpoints[0].lineNumber))
			));

			actions.push(new Action(
				`workbench.debug.viewlet.action.toggleBreakpoint`,
				breakpoints[0].enabled ? nls.localize('disableBreakpoint', "Disable {0}", breakpointType) : nls.localize('enableBreakpoint', "Enable {0}", breakpointType),
				undefined,
				true,
				() => this.debugService.enableOrDisableBreakpoints(!breakpoints[0].enabled, breakpoints[0])
			));
		} else if (breakpoints.length > 1) {
			const sorted = breakpoints.slice().sort((first, second) => (first.column && second.column) ? first.column - second.column : 1);
			actions.push(new ContextSubMenu(nls.localize('removeBreakpoints', "Remove Breakpoints"), sorted.map(bp => new Action(
				'removeInlineBreakpoint',
				bp.column ? nls.localize('removeInlineBreakpointOnColumn', "Remove Inline Breakpoint on Column {0}", bp.column) : nls.localize('removeLineBreakpoint', "Remove Line Breakpoint"),
				undefined,
				true,
				() => this.debugService.removeBreakpoints(bp.getId())
			))));

			actions.push(new ContextSubMenu(nls.localize('editBreakpoints', "Edit Breakpoints"), sorted.map(bp =>
				new Action('editBreakpoint',
					bp.column ? nls.localize('editInlineBreakpointOnColumn', "Edit Inline Breakpoint on Column {0}", bp.column) : nls.localize('editLineBrekapoint', "Edit Line Breakpoint"),
					undefined,
					true,
					() => Promise.resolve(this.showBreakpointWidget(bp.lineNumber))
				)
			)));

			actions.push(new ContextSubMenu(nls.localize('enableDisableBreakpoints', "Enable/Disable Breakpoints"), sorted.map(bp => new Action(
				bp.enabled ? 'disableColumnBreakpoint' : 'enableColumnBreakpoint',
				bp.enabled ? (bp.column ? nls.localize('disableInlineColumnBreakpoint', "Disable Inline Breakpoint on Column {0}", bp.column) : nls.localize('disableBreakpointOnLine', "Disable Line Breakpoint"))
					: (bp.column ? nls.localize('enableBreakpoints', "Enable Inline Breakpoint on Column {0}", bp.column) : nls.localize('enableBreakpointOnLine', "Enable Line Breakpoint")),
				undefined,
				true,
				() => this.debugService.enableOrDisableBreakpoints(!bp.enabled, bp)
			))));
		} else {
			actions.push(new Action(
				'addBreakpoint',
				nls.localize('addBreakpoint', "Add Breakpoint"),
				undefined,
				true,
				() => this.debugService.addBreakpoints(uri, [{ lineNumber }], `debugEditorContextMenu`)
			));
			actions.push(new Action(
				'addConditionalBreakpoint',
				nls.localize('addConditionalBreakpoint', "Add Conditional Breakpoint..."),
				undefined,
				true,
				() => Promise.resolve(this.showBreakpointWidget(lineNumber))
			));
			actions.push(new Action(
				'addLogPoint',
				nls.localize('addLogPoint', "Add Logpoint..."),
				undefined,
				true,
				() => Promise.resolve(this.showBreakpointWidget(lineNumber, BreakpointWidgetContext.LOG_MESSAGE))
			));
		}

		return actions;
	}

	private marginFreeFromNonDebugDecorations(line: number): boolean {
		const decorations = this.editor.getLineDecorations(line);
		if (decorations) {
			for (const { options } of decorations) {
				if (options.glyphMarginClassName && options.glyphMarginClassName.indexOf('debug') === -1) {
					return false;
				}
			}
		}

		return true;
	}

	private ensureBreakpointHintDecoration(showBreakpointHintAtLineNumber: number): void {
		const newDecoration: IModelDeltaDecoration[] = [];
		if (showBreakpointHintAtLineNumber !== -1) {
			newDecoration.push({
				options: BreakpointEditorContribution.BREAKPOINT_HELPER_DECORATION,
				range: {
					startLineNumber: showBreakpointHintAtLineNumber,
					startColumn: 1,
					endLineNumber: showBreakpointHintAtLineNumber,
					endColumn: 1
				}
			});
		}

		this.breakpointHintDecoration = this.editor.deltaDecorations(this.breakpointHintDecoration, newDecoration);
	}

	// breakpoint widget
	showBreakpointWidget(lineNumber: number, context?: BreakpointWidgetContext): void {
		if (this.breakpointWidget) {
			this.breakpointWidget.dispose();
		}

		this.breakpointWidget = this.instantiationService.createInstance(BreakpointWidget, this.editor, lineNumber, context);
		this.breakpointWidget.show({ lineNumber, column: 1 }, 2);
		this.breakpointWidgetVisible.set(true);
	}

	closeBreakpointWidget(): void {
		if (this.breakpointWidget) {
			this.breakpointWidget.dispose();
			this.breakpointWidget = undefined;
			this.breakpointWidgetVisible.reset();
			this.editor.focus();
		}
	}

	dispose(): void {
		if (this.breakpointWidget) {
			this.breakpointWidget.dispose();
		}
		dispose(this.toDispose);
	}

	private static BREAKPOINT_HELPER_DECORATION: IModelDecorationOptions = {
		glyphMarginClassName: 'debug-breakpoint-hint',
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
	};
}

registerEditorContribution(BreakpointEditorContribution);
