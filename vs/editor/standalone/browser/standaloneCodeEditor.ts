/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Disposable, IDisposable, combinedDisposable } from 'vs/base/common/lifecycle';
import { TPromise } from 'vs/base/common/winjs.base';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CommandsRegistry, ICommandService, ICommandHandler } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ContextKeyExpr, IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IModelChangedEvent } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { StandaloneKeybindingService, applyConfigurationValues } from 'vs/editor/standalone/browser/simpleServices';
import { ContextViewService } from 'vs/platform/contextview/browser/contextViewService';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { DiffEditorWidget } from 'vs/editor/browser/widget/diffEditorWidget';
import { ICodeEditor, IDiffEditor } from 'vs/editor/browser/editorBrowser';
import { IStandaloneThemeService } from 'vs/editor/standalone/common/standaloneThemeService';
import { InternalEditorAction } from 'vs/editor/common/editorAction';
import { MenuId, MenuRegistry, IMenuItem } from 'vs/platform/actions/common/actions';
import { IDiffEditorOptions, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import * as aria from 'vs/base/browser/ui/aria/aria';
import * as nls from 'vs/nls';
import * as browser from 'vs/base/browser/browser';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

/**
 * Description of an action contribution
 */
export interface IActionDescriptor {
	/**
	 * An unique identifier of the contributed action.
	 */
	id: string;
	/**
	 * A label of the action that will be presented to the user.
	 */
	label: string;
	/**
	 * Precondition rule.
	 */
	precondition?: string;
	/**
	 * An array of keybindings for the action.
	 */
	keybindings?: number[];
	/**
	 * The keybinding rule (condition on top of precondition).
	 */
	keybindingContext?: string;
	/**
	 * Control if the action should show up in the context menu and where.
	 * The context menu of the editor has these default:
	 *   navigation - The navigation group comes first in all cases.
	 *   1_modification - This group comes next and contains commands that modify your code.
	 *   9_cutcopypaste - The last default group with the basic editing commands.
	 * You can also create your own group.
	 * Defaults to null (don't show in context menu).
	 */
	contextMenuGroupId?: string;
	/**
	 * Control the order in the context menu group.
	 */
	contextMenuOrder?: number;
	/**
	 * Method that will be executed when the action is triggered.
	 * @param editor The editor instance is passed in as a convinience
	 */
	run(editor: ICodeEditor): void | TPromise<void>;
}

/**
 * The options to create an editor.
 */
export interface IEditorConstructionOptions extends IEditorOptions {
	/**
	 * The initial model associated with this code editor.
	 */
	model?: ITextModel;
	/**
	 * The initial value of the auto created model in the editor.
	 * To not create automatically a model, use `model: null`.
	 */
	value?: string;
	/**
	 * The initial language of the auto created model in the editor.
	 * To not create automatically a model, use `model: null`.
	 */
	language?: string;
	/**
	 * Initial theme to be used for rendering.
	 * The current out-of-the-box available themes are: 'vs' (default), 'vs-dark', 'hc-black'.
	 * You can create custom themes via `monaco.editor.defineTheme`.
	 * To switch a theme, use `monaco.editor.setTheme`
	 */
	theme?: string;
	/**
	 * An URL to open when Ctrl+H (Windows and Linux) or Cmd+H (OSX) is pressed in
	 * the accessibility help dialog in the editor.
	 *
	 * Defaults to "https://go.microsoft.com/fwlink/?linkid=852450"
	 */
	accessibilityHelpUrl?: string;
}

/**
 * The options to create a diff editor.
 */
export interface IDiffEditorConstructionOptions extends IDiffEditorOptions {
	/**
	 * Initial theme to be used for rendering.
	 * The current out-of-the-box available themes are: 'vs' (default), 'vs-dark', 'hc-black'.
	 * You can create custom themes via `monaco.editor.defineTheme`.
	 * To switch a theme, use `monaco.editor.setTheme`
	 */
	theme?: string;
}

export interface IStandaloneCodeEditor extends ICodeEditor {
	addCommand(keybinding: number, handler: ICommandHandler, context: string): string;
	createContextKey<T>(key: string, defaultValue: T): IContextKey<T>;
	addAction(descriptor: IActionDescriptor): IDisposable;
}

export interface IStandaloneDiffEditor extends IDiffEditor {
	addCommand(keybinding: number, handler: ICommandHandler, context: string): string;
	createContextKey<T>(key: string, defaultValue: T): IContextKey<T>;
	addAction(descriptor: IActionDescriptor): IDisposable;

	getOriginalEditor(): IStandaloneCodeEditor;
	getModifiedEditor(): IStandaloneCodeEditor;
}

let LAST_GENERATED_COMMAND_ID = 0;

let ariaDomNodeCreated = false;
function createAriaDomNode() {
	if (ariaDomNodeCreated) {
		return;
	}
	ariaDomNodeCreated = true;
	aria.setARIAContainer(document.body);
}

/**
 * A code editor to be used both by the standalone editor and the standalone diff editor.
 */
export class StandaloneCodeEditor extends CodeEditorWidget implements IStandaloneCodeEditor {

	private _standaloneKeybindingService: StandaloneKeybindingService;

	constructor(
		domElement: HTMLElement,
		options: IEditorConstructionOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IThemeService themeService: IThemeService,
		@INotificationService notificationService: INotificationService
	) {
		options = options || {};
		options.ariaLabel = options.ariaLabel || nls.localize('editorViewAccessibleLabel', "Editor content");
		options.ariaLabel = options.ariaLabel + ';' + (
			browser.isIE
				? nls.localize('accessibilityHelpMessageIE', "Press Ctrl+F1 for Accessibility Options.")
				: nls.localize('accessibilityHelpMessage', "Press Alt+F1 for Accessibility Options.")
		);
		super(domElement, options, {}, instantiationService, codeEditorService, commandService, contextKeyService, themeService, notificationService);

		if (keybindingService instanceof StandaloneKeybindingService) {
			this._standaloneKeybindingService = keybindingService;
		}

		// Create the ARIA dom node as soon as the first editor is instantiated
		createAriaDomNode();
	}

	public addCommand(keybinding: number, handler: ICommandHandler, context: string): string {
		if (!this._standaloneKeybindingService) {
			console.warn('Cannot add command because the editor is configured with an unrecognized KeybindingService');
			return null;
		}
		let commandId = 'DYNAMIC_' + (++LAST_GENERATED_COMMAND_ID);
		let whenExpression = ContextKeyExpr.deserialize(context);
		this._standaloneKeybindingService.addDynamicKeybinding(commandId, keybinding, handler, whenExpression);
		return commandId;
	}

	public createContextKey<T>(key: string, defaultValue: T): IContextKey<T> {
		return this._contextKeyService.createKey(key, defaultValue);
	}

	public addAction(_descriptor: IActionDescriptor): IDisposable {
		if ((typeof _descriptor.id !== 'string') || (typeof _descriptor.label !== 'string') || (typeof _descriptor.run !== 'function')) {
			throw new Error('Invalid action descriptor, `id`, `label` and `run` are required properties!');
		}
		if (!this._standaloneKeybindingService) {
			console.warn('Cannot add keybinding because the editor is configured with an unrecognized KeybindingService');
			return Disposable.None;
		}

		// Read descriptor options
		const id = _descriptor.id;
		const label = _descriptor.label;
		const precondition = ContextKeyExpr.and(
			ContextKeyExpr.equals('editorId', this.getId()),
			ContextKeyExpr.deserialize(_descriptor.precondition)
		);
		const keybindings = _descriptor.keybindings;
		const keybindingsWhen = ContextKeyExpr.and(
			precondition,
			ContextKeyExpr.deserialize(_descriptor.keybindingContext)
		);
		const contextMenuGroupId = _descriptor.contextMenuGroupId || null;
		const contextMenuOrder = _descriptor.contextMenuOrder || 0;
		const run = (): TPromise<void> => {
			const r = _descriptor.run(this);
			return r ? r : TPromise.as(void 0);
		};


		let toDispose: IDisposable[] = [];

		// Generate a unique id to allow the same descriptor.id across multiple editor instances
		const uniqueId = this.getId() + ':' + id;

		// Register the command
		toDispose.push(CommandsRegistry.registerCommand(uniqueId, run));

		// Register the context menu item
		if (contextMenuGroupId) {
			let menuItem: IMenuItem = {
				command: {
					id: uniqueId,
					title: label
				},
				when: precondition,
				group: contextMenuGroupId,
				order: contextMenuOrder
			};
			toDispose.push(MenuRegistry.appendMenuItem(MenuId.EditorContext, menuItem));
		}

		// Register the keybindings
		if (Array.isArray(keybindings)) {
			toDispose = toDispose.concat(
				keybindings.map((kb) => {
					return this._standaloneKeybindingService.addDynamicKeybinding(uniqueId, kb, run, keybindingsWhen);
				})
			);
		}

		// Finally, register an internal editor action
		let internalAction = new InternalEditorAction(
			uniqueId,
			label,
			label,
			precondition,
			run,
			this._contextKeyService
		);

		// Store it under the original id, such that trigger with the original id will work
		this._actions[id] = internalAction;
		toDispose.push({
			dispose: () => {
				delete this._actions[id];
			}
		});

		return combinedDisposable(toDispose);
	}
}

export class StandaloneEditor extends StandaloneCodeEditor implements IStandaloneCodeEditor {

	private _contextViewService: ContextViewService;
	private readonly _configurationService: IConfigurationService;
	private _ownsModel: boolean;

	constructor(
		domElement: HTMLElement,
		options: IEditorConstructionOptions,
		toDispose: IDisposable,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextViewService contextViewService: IContextViewService,
		@IStandaloneThemeService themeService: IStandaloneThemeService,
		@INotificationService notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		applyConfigurationValues(configurationService, options, false);
		options = options || {};
		if (typeof options.theme === 'string') {
			themeService.setTheme(options.theme);
		}
		let model: ITextModel = options.model;
		delete options.model;
		super(domElement, options, instantiationService, codeEditorService, commandService, contextKeyService, keybindingService, themeService, notificationService);

		this._contextViewService = <ContextViewService>contextViewService;
		this._configurationService = configurationService;
		this._register(toDispose);

		if (typeof model === 'undefined') {
			model = (<any>self).monaco.editor.createModel(options.value || '', options.language || 'text/plain');
			this._ownsModel = true;
		} else {
			this._ownsModel = false;
		}

		this._attachModel(model);
		if (model) {
			let e: IModelChangedEvent = {
				oldModelUrl: null,
				newModelUrl: model.uri
			};
			this._onDidChangeModel.fire(e);
		}
	}

	public dispose(): void {
		super.dispose();
	}

	public updateOptions(newOptions: IEditorOptions): void {
		applyConfigurationValues(this._configurationService, newOptions, false);
		super.updateOptions(newOptions);
	}

	_attachModel(model: ITextModel): void {
		super._attachModel(model);
		if (this._view) {
			this._contextViewService.setContainer(this._view.domNode.domNode);
		}
	}

	_postDetachModelCleanup(detachedModel: ITextModel): void {
		super._postDetachModelCleanup(detachedModel);
		if (detachedModel && this._ownsModel) {
			detachedModel.dispose();
			this._ownsModel = false;
		}
	}
}

export class StandaloneDiffEditor extends DiffEditorWidget implements IStandaloneDiffEditor {

	private _contextViewService: ContextViewService;
	private readonly _configurationService: IConfigurationService;

	constructor(
		domElement: HTMLElement,
		options: IDiffEditorConstructionOptions,
		toDispose: IDisposable,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextViewService contextViewService: IContextViewService,
		@IEditorWorkerService editorWorkerService: IEditorWorkerService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IStandaloneThemeService themeService: IStandaloneThemeService,
		@INotificationService notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		applyConfigurationValues(configurationService, options, true);
		options = options || {};
		if (typeof options.theme === 'string') {
			options.theme = themeService.setTheme(options.theme);
		}

		super(domElement, options, editorWorkerService, contextKeyService, instantiationService, codeEditorService, themeService, notificationService);

		this._contextViewService = <ContextViewService>contextViewService;
		this._configurationService = configurationService;

		this._register(toDispose);

		this._contextViewService.setContainer(this._containerDomElement);
	}

	public dispose(): void {
		super.dispose();
	}

	public updateOptions(newOptions: IDiffEditorOptions): void {
		applyConfigurationValues(this._configurationService, newOptions, true);
		super.updateOptions(newOptions);
	}

	protected _createInnerEditor(instantiationService: IInstantiationService, container: HTMLElement, options: IEditorOptions): CodeEditorWidget {
		return instantiationService.createInstance(StandaloneCodeEditor, container, options);
	}

	public getOriginalEditor(): IStandaloneCodeEditor {
		return <StandaloneCodeEditor>super.getOriginalEditor();
	}

	public getModifiedEditor(): IStandaloneCodeEditor {
		return <StandaloneCodeEditor>super.getModifiedEditor();
	}

	public addCommand(keybinding: number, handler: ICommandHandler, context: string): string {
		return this.getModifiedEditor().addCommand(keybinding, handler, context);
	}

	public createContextKey<T>(key: string, defaultValue: T): IContextKey<T> {
		return this.getModifiedEditor().createContextKey(key, defaultValue);
	}

	public addAction(descriptor: IActionDescriptor): IDisposable {
		return this.getModifiedEditor().addAction(descriptor);
	}
}
