/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { RunOnceScheduler } from 'vs/base/common/async';
import * as dom from 'vs/base/browser/dom';
import { CollapseAction2 } from 'vs/workbench/browser/viewlet';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IDebugService, IExpression, IScope } from 'vs/workbench/parts/debug/common/debug';
import { Variable, Scope } from 'vs/workbench/parts/debug/common/debugModel';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { renderViewTree, renderVariable, IInputBoxOptions, AbstractExpressionsRenderer, IExpressionTemplateData } from 'vs/workbench/parts/debug/browser/baseDebugView';
import { IAction } from 'vs/base/common/actions';
import { SetValueAction, AddToWatchExpressionsAction } from 'vs/workbench/parts/debug/browser/debugActions';
import { CopyValueAction, CopyEvaluatePathAction } from 'vs/workbench/parts/debug/electron-browser/electronDebugActions';
import { Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewletPanelOptions, ViewletPanel } from 'vs/workbench/browser/parts/views/panelViewlet';
import { DataTree, IDataSource } from 'vs/base/browser/ui/tree/dataTree';
import { IAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { ITreeContextMenuEvent, ITreeMouseEvent } from 'vs/base/browser/ui/tree/abstractTree';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeRenderer, ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

const $ = dom.$;

export class VariablesView extends ViewletPanel {

	private onFocusStackFrameScheduler: RunOnceScheduler;
	// private expandedElements: any[];
	private needsRefresh: boolean;
	private tree: DataTree<IExpression | IScope>;

	constructor(
		options: IViewletViewOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IDebugService private debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super({ ...(options as IViewletPanelOptions), ariaHeaderLabel: nls.localize('variablesSection', "Variables Section") }, keybindingService, contextMenuService, configurationService);

		// this.expandedElements = [];
		// Use scheduler to prevent unnecessary flashing
		this.onFocusStackFrameScheduler = new RunOnceScheduler(() => {
			// Remember expanded elements when there are some (otherwise don't override/erase the previous ones)
			// TODO@Isidor
			// const expanded = this.tree.getExpandedElements();
			// if (expanded.length > 0) {
			// 	this.expandedElements = expanded;
			// }

			this.needsRefresh = false;
			this.tree.refresh(null).then(() => {
				// const stackFrame = this.debugService.getViewModel().focusedStackFrame;
				// return sequence(this.expandedElements.map(e => () => this.tree.expand(e))).then(() => {
				// 	// If there is no preserved expansion state simply expand the first scope
				// 	if (stackFrame && this.tree.getExpandedElements().length === 0) {
				// 		return stackFrame.getScopes().then(scopes => {
				// 			if (scopes.length > 0 && !scopes[0].expensive) {
				// 				return this.tree.expand(scopes[0]);
				// 			}
				// 			return undefined;
				// 		});
				// 	}
				// 	return undefined;
				// });
			});
		}, 400);
	}

	renderBody(container: HTMLElement): void {
		dom.addClass(container, 'debug-variables');
		const treeContainer = renderViewTree(container);

		this.tree = new DataTree(treeContainer, new VariablesDelegate(), [this.instantiationService.createInstance(VariablesRenderer), new ScopesRenderer()],
			new VariablesDataSource(this.debugService), {
				ariaLabel: nls.localize('variablesAriaTreeLabel', "Debug Variables"),
				accessibilityProvider: new VariablesAccessibilityProvider()
			});

		// TODO@Isidor
		// CONTEXT_VARIABLES_FOCUSED.bindTo(this.tree.contextKeyService);

		const collapseAction = new CollapseAction2(this.tree, false, 'explorer-action collapse-explorer');
		this.toolbar.setActions([collapseAction])();
		this.tree.refresh(null);

		this.disposables.push(this.debugService.getViewModel().onDidFocusStackFrame(sf => {
			if (!this.isVisible() || !this.isExpanded()) {
				this.needsRefresh = true;
				return;
			}

			// Refresh the tree immediately if the user explictly changed stack frames.
			// Otherwise postpone the refresh until user stops stepping.
			const timeout = sf.explicit ? 0 : undefined;
			this.onFocusStackFrameScheduler.schedule(timeout);
		}));

		this.disposables.push(this.tree.onMouseDblClick(e => this.onMouseDblClick(e)));
		this.disposables.push(this.tree.onContextMenu(e => this.onContextMenu(e)));
	}

	layoutBody(size: number): void {
		this.tree.layout(size);
	}

	setExpanded(expanded: boolean): void {
		super.setExpanded(expanded);
		if (expanded && this.needsRefresh) {
			this.onFocusStackFrameScheduler.schedule();
		}
	}

	setVisible(visible: boolean): void {
		super.setVisible(visible);
		if (visible && this.needsRefresh) {
			this.onFocusStackFrameScheduler.schedule();
		}
	}

	private onMouseDblClick(e: ITreeMouseEvent<IExpression | IScope>): void {
		const element = e.element;
		const session = this.debugService.getViewModel().focusedSession;
		if (element instanceof Variable && session.capabilities.supportsSetVariable) {
			this.debugService.getViewModel().setSelectedExpression(element);
		}
	}

	private onContextMenu(e: ITreeContextMenuEvent<IExpression | IScope>): void {
		const element = e.element;
		if (element instanceof Variable && !!element.value) {
			const actions: IAction[] = [];
			const variable = <Variable>element;
			actions.push(new SetValueAction(SetValueAction.ID, SetValueAction.LABEL, variable, this.debugService, this.keybindingService));
			actions.push(new CopyValueAction(CopyValueAction.ID, CopyValueAction.LABEL, variable, this.debugService));
			actions.push(new CopyEvaluatePathAction(CopyEvaluatePathAction.ID, CopyEvaluatePathAction.LABEL, variable));
			actions.push(new Separator());
			actions.push(new AddToWatchExpressionsAction(AddToWatchExpressionsAction.ID, AddToWatchExpressionsAction.LABEL, variable, this.debugService, this.keybindingService));

			this.contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => actions,
				getActionsContext: () => element
			});
		}
	}
}

export class VariablesDataSource implements IDataSource<IExpression | IScope> {

	constructor(private debugService: IDebugService) { }

	hasChildren(element: IExpression | IScope | null): boolean {
		if (element === null || element instanceof Scope) {
			return true;
		}

		return element.hasChildren;
	}

	getChildren(element: IExpression | IScope | null): Thenable<(IExpression | IScope)[]> {
		if (element === null) {
			const stackFrame = this.debugService.getViewModel().focusedStackFrame;
			return stackFrame ? stackFrame.getScopes() : Promise.resolve([]);
		}

		return element.getChildren();
	}
}

interface IScopeTemplateData {
	name: HTMLElement;
}

class VariablesDelegate implements IListVirtualDelegate<IExpression | IScope> {

	getHeight(element: IExpression | IScope): number {
		return 22;
	}

	getTemplateId(element: IExpression | IScope): string {
		if (element instanceof Scope) {
			return ScopesRenderer.ID;
		}
		if (element instanceof Variable) {
			return VariablesRenderer.ID;
		}

		return null;
	}
}

class ScopesRenderer implements ITreeRenderer<IScope, void, IScopeTemplateData> {

	static readonly ID = 'scope';

	get templateId(): string {
		return ScopesRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IScopeTemplateData {
		let data: IScopeTemplateData = Object.create(null);
		data.name = dom.append(container, $('.scope'));

		return data;
	}

	renderElement(element: ITreeNode<IScope, void>, index: number, templateData: IScopeTemplateData): void {
		templateData.name.textContent = element.element.name;
	}

	disposeElement(element: ITreeNode<IScope, void>, index: number, templateData: IScopeTemplateData): void {
		// noop
	}

	disposeTemplate(templateData: IScopeTemplateData): void {
		// noop
	}
}

export class VariablesRenderer extends AbstractExpressionsRenderer {

	static readonly ID = 'variable';

	get templateId(): string {
		return VariablesRenderer.ID;
	}

	protected renderExpression(expression: IExpression, data: IExpressionTemplateData): void {
		renderVariable(expression as Variable, data, true);
	}

	protected getInputBoxOptions(expression: IExpression): IInputBoxOptions {
		const variable = <Variable>expression;
		return {
			initialValue: expression.value,
			ariaLabel: nls.localize('variableValueAriaLabel', "Type new variable value"),
			validationOptions: {
				validation: () => variable.errorMessage ? ({ content: variable.errorMessage }) : null
			},
			onFinish: (value: string, success: boolean) => {
				variable.errorMessage = null;
				if (success && variable.value !== value) {
					variable.setVariable(value)
						// if everything went fine we need to refresh ui elements since the variable update can change watch and variables view
						.then(() => {
							// Need to force watch expressions to update since a variable change can have an effect on watches
							this.debugService.focusStackFrame(this.debugService.getViewModel().focusedStackFrame);
						});
				}

			}
		};
	}
}

class VariablesAccessibilityProvider implements IAccessibilityProvider<IExpression | IScope> {

	getAriaLabel(element: IExpression | IScope): string {
		if (element instanceof Scope) {
			return nls.localize('variableScopeAriaLabel', "Scope {0}, variables, debug", element.name);
		}
		if (element instanceof Variable) {
			return nls.localize('variableAriaLabel', "{0} value {1}, variables, debug", element.name, element.value);
		}

		return null;
	}
}
