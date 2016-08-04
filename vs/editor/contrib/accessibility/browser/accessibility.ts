/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./accessibility';
import * as nls from 'vs/nls';
import {KeyCode, KeyMod} from 'vs/base/common/keyCodes';
import {Disposable} from 'vs/base/common/lifecycle';
import * as strings from 'vs/base/common/strings';
import {clearNode} from 'vs/base/browser/dom';
import {renderHtml} from 'vs/base/browser/htmlContentRenderer';
import {StyleMutator} from 'vs/base/browser/styleMutator';
import {Widget} from 'vs/base/browser/ui/widget';
import {ServicesAccessor} from 'vs/platform/instantiation/common/instantiation';
import {KbExpr, KbCtxKey, IKeybindingContextKey, IKeybindingService} from 'vs/platform/keybinding/common/keybinding';
import {KeybindingsRegistry} from 'vs/platform/keybinding/common/keybindingsRegistry';
import {GlobalScreenReaderNVDA} from 'vs/editor/common/config/commonEditorConfig';
import {ICommonCodeEditor, IEditorContribution, EditorKbExpr} from 'vs/editor/common/editorCommon';
import {CommonEditorRegistry, EditorAction, EditorCommand, Command} from 'vs/editor/common/editorCommonExtensions';
import {ICodeEditor, IOverlayWidget, IOverlayWidgetPosition} from 'vs/editor/browser/editorBrowser';
import {EditorBrowserRegistry} from 'vs/editor/browser/editorBrowserExtensions';
import {ToggleTabFocusModeAction} from 'vs/editor/contrib/toggleTabFocusMode/common/toggleTabFocusMode';

const CONTEXT_ACCESSIBILITY_WIDGET_VISIBLE = new KbCtxKey('accessibilityHelpWidgetVisible');
const TOGGLE_EXPERIMENTAL_SCREEN_READER_SUPPORT_COMMAND_ID = 'toggleExperimentalScreenReaderSupport';

class AccessibilityHelpController extends Disposable implements IEditorContribution {

	static ID = 'editor.contrib.accessibilityHelpController';

	static get(editor:ICommonCodeEditor): AccessibilityHelpController {
		return <AccessibilityHelpController>editor.getContribution(AccessibilityHelpController.ID);
	}

	private _editor: ICodeEditor;
	private _widget: AccessibilityHelpWidget;

	constructor(editor:ICodeEditor, @IKeybindingService keybindingService: IKeybindingService) {
		super();

		this._editor = editor;
		this._widget = this._register(new AccessibilityHelpWidget(this._editor, keybindingService));
	}

	public getId(): string {
		return AccessibilityHelpController.ID;
	}

	public show(): void {
		this._widget.show();
	}

	public hide(): void {
		this._widget.hide();
	}
}

class AccessibilityHelpWidget extends Widget implements IOverlayWidget {

	private static ID = 'editor.contrib.accessibilityHelpWidget';
	private static WIDTH = 500;
	private static HEIGHT = 300;

	private _editor: ICodeEditor;
	private _keybindingService: IKeybindingService;
	private _domNode: HTMLElement;
	private _isVisible: boolean;
	private _isVisibleKey: IKeybindingContextKey<boolean>;

	constructor(editor:ICodeEditor, keybindingService: IKeybindingService) {
		super();

		this._editor = editor;
		this._keybindingService = keybindingService;
		this._isVisibleKey = CONTEXT_ACCESSIBILITY_WIDGET_VISIBLE.bindTo(keybindingService, false);

		this._domNode = document.createElement('div');
		this._domNode.className = 'accessibilityHelpWidget';
		StyleMutator.setWidth(this._domNode, AccessibilityHelpWidget.WIDTH);
		StyleMutator.setHeight(this._domNode, AccessibilityHelpWidget.HEIGHT);

		this._domNode.style.display = 'none';
		this._domNode.setAttribute('role', 'tooltip');
		this._domNode.setAttribute('aria-hidden', 'true');
		this._isVisible = false;

		this._register(this._editor.onDidLayoutChange(() => {
			if (this._isVisible) {
				this._layout();
			}
		}));
		this.onblur(this._domNode, () => {
			this.hide();
		});

		this._editor.addOverlayWidget(this);
	}

	public dispose(): void {
		this._editor.removeOverlayWidget(this);
		super.dispose();
	}

	public getId(): string {
		return AccessibilityHelpWidget.ID;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getPosition(): IOverlayWidgetPosition {
		return {
			preference: null
		};
	}

	public show(): void {
		if (this._isVisible) {
			return;
		}
		this._isVisible = true;
		this._isVisibleKey.set(true);
		this._layout();
		this._domNode.style.display = 'block';
		this._domNode.setAttribute('aria-hidden', 'false');
		this._domNode.tabIndex = 0;
		this._buildContent();
		this._domNode.focus();
	}

	private _descriptionForCommand(commandId:string, msg:string, noKbMsg:string): string {
		let keybindings = this._keybindingService.lookupKeybindings(commandId);
		if (keybindings.length > 0) {
			return strings.format(msg, this._keybindingService.getAriaLabelFor(keybindings[0]));
		}
		return strings.format(noKbMsg, commandId);
	}

	private _buildContent() {
		let opts = this._editor.getConfiguration();
		let text = nls.localize('introMsg', "Thank you for trying out VS Code's experimental accessibility options.");

		text += '\n\n' + nls.localize('status', "Status:");

		const NLS_TAB_FOCUS_MODE_ON = nls.localize('tabFocusModeOnMsg', "Pressing Tab in this editor will move focus to the next focusable element. Toggle this behaviour by pressing {0}.");
		const NLS_TAB_FOCUS_MODE_ON_NO_KB = nls.localize('tabFocusModeOnMsgNoKb', "Pressing Tab in this editor will move focus to the next focusable element. The command {0} is currently not triggerable by a keybinding.");
		const NLS_TAB_FOCUS_MODE_OFF = nls.localize('tabFocusModeOffMsg', "Pressing Tab in this editor will insert the tab character. Toggle this behaviour by pressing {0}.");
		const NLS_TAB_FOCUS_MODE_OFF_NO_KB = nls.localize('tabFocusModeOffMsgNoKb', "Pressing Tab in this editor will move focus to the next focusable element. The command {0} is currently not triggerable by a keybinding.");

		if (opts.tabFocusMode) {
			text += '\n\n - ' + this._descriptionForCommand(ToggleTabFocusModeAction.ID, NLS_TAB_FOCUS_MODE_ON, NLS_TAB_FOCUS_MODE_ON_NO_KB);
		} else {
			text += '\n\n - ' + this._descriptionForCommand(ToggleTabFocusModeAction.ID, NLS_TAB_FOCUS_MODE_OFF, NLS_TAB_FOCUS_MODE_OFF_NO_KB);
		}

		text += '\n\n' + nls.localize('outroMsg', "You can dismiss this tooltip and return to the editor by pressing Escape.");

		this._domNode.appendChild(renderHtml({
			formattedText: text
		}));
	}

	public hide(): void {
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._isVisibleKey.reset();
		this._domNode.style.display = 'none';
		this._domNode.setAttribute('aria-hidden', 'true');
		this._domNode.tabIndex = -1;
		clearNode(this._domNode);

		this._editor.focus();
	}

	private _layout(): void {
		let editorLayout = this._editor.getLayoutInfo();

		let top = Math.round((editorLayout.height - AccessibilityHelpWidget.HEIGHT) / 2);
		StyleMutator.setTop(this._domNode, top);

		let left = Math.round((editorLayout.width - AccessibilityHelpWidget.WIDTH) / 2);
		StyleMutator.setLeft(this._domNode, left);
	}
}

class ShowAccessibilityHelpAction extends EditorAction {

	constructor() {
		super(
			'editor.action.showAccessibilityHelp',
			nls.localize('ShowAccessibilityHelpAction',"Show Accessibility Help"),
			'Show Accessibility Help',
			false
		);

		this.kbOpts = {
			kbExpr: EditorKbExpr.Focus,
			primary: KeyMod.Alt | KeyCode.F1
		};
	}

	public run(accessor:ServicesAccessor, editor:ICommonCodeEditor): void {
		let controller = AccessibilityHelpController.get(editor);
		controller.show();
	}
}

EditorBrowserRegistry.registerEditorContribution(AccessibilityHelpController);
CommonEditorRegistry.registerEditorAction(new ShowAccessibilityHelpAction());

const AccessibilityHelpCommand = EditorCommand.bindToContribution<AccessibilityHelpController>(
	AccessibilityHelpController.get,
	{
		weight: CommonEditorRegistry.commandWeight(100),
		kbExpr: KbExpr.and(EditorKbExpr.Focus, CONTEXT_ACCESSIBILITY_WIDGET_VISIBLE)
	}
);

CommonEditorRegistry.registerEditorCommand2(new AccessibilityHelpCommand(
	'closeAccessibilityHelp',
	x => x.hide(),
	{
		primary: KeyCode.Escape, secondary: [KeyMod.Shift | KeyCode.Escape]
	}
));

class ToggleExperimentalScreenReaderSupportCommand extends Command {
	constructor() {
		super(TOGGLE_EXPERIMENTAL_SCREEN_READER_SUPPORT_COMMAND_ID);

		this.kbOpts = {
			weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
			kbExpr: null,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_R
		};
	}

	public runCommand(accessor:ServicesAccessor, args: any): void {
		let currentValue = GlobalScreenReaderNVDA.getValue();
		GlobalScreenReaderNVDA.setValue(!currentValue);
	}
}

CommonEditorRegistry.registerEditorCommand2(new ToggleExperimentalScreenReaderSupportCommand());
