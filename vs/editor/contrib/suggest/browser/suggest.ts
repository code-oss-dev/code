/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import {onUnexpectedError} from 'vs/base/common/errors';
import {KeyCode, KeyMod} from 'vs/base/common/keyCodes';
import {IDisposable, dispose} from 'vs/base/common/lifecycle';
import {TPromise} from 'vs/base/common/winjs.base';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IKeybindingContextKey, IKeybindingService, KbExpr} from 'vs/platform/keybinding/common/keybindingService';
import {EditorAction} from 'vs/editor/common/editorAction';
import {ICommonCodeEditor, IEditorActionDescriptorData, IEditorContribution} from 'vs/editor/common/editorCommon';
import {CommonEditorRegistry, ContextKey, EditorActionDescriptor} from 'vs/editor/common/editorCommonExtensions';
import {ISuggestSupport, SuggestRegistry} from 'vs/editor/common/modes';
import {ICodeEditor} from 'vs/editor/browser/editorBrowser';
import {EditorBrowserRegistry} from 'vs/editor/browser/editorBrowserExtensions';
import {getSnippetController} from 'vs/editor/contrib/snippet/common/snippet';
import {ACCEPT_SELECTED_SUGGESTION_CMD, CONTEXT_SUGGEST_WIDGET_VISIBLE} from 'vs/editor/contrib/suggest/common/suggest';
import {KeybindingsRegistry} from 'vs/platform/keybinding/common/keybindingsRegistry';
import {withCodeEditorFromCommandHandler} from 'vs/editor/common/config/config';
import {SuggestModel} from './suggestModel';
import {SuggestWidget} from './suggestWidget';

export class SuggestController implements IEditorContribution {
	static ID: string = 'editor.contrib.suggestController';

	static getSuggestController(editor: ICommonCodeEditor): SuggestController {
		return <SuggestController>editor.getContribution(SuggestController.ID);
	}

	private model: SuggestModel;
	private widget: SuggestWidget;
	private triggerCharacterListeners: IDisposable[];
	private suggestWidgetVisible: IKeybindingContextKey<boolean>;
	private toDispose: IDisposable[];

	constructor(
		private editor: ICodeEditor,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		this.suggestWidgetVisible = keybindingService.createKey(CONTEXT_SUGGEST_WIDGET_VISIBLE, false);
		this.model = new SuggestModel(this.editor);
		this.widget = instantiationService.createInstance(SuggestWidget, this.editor, this.model);

		this.triggerCharacterListeners = [];

		this.toDispose = [];
		this.toDispose.push(this.widget.onDidVisibilityChange(visible => visible ? this.suggestWidgetVisible.set(true) : this.suggestWidgetVisible.reset()));
		this.toDispose.push(editor.onDidChangeConfiguration(() => this.update()));
		this.toDispose.push(editor.onDidChangeModel(() => this.update()));
		this.toDispose.push(editor.onDidChangeModelMode(() => this.update()));
		this.toDispose.push(SuggestRegistry.onDidChange(this.update, this));

		this.toDispose.push(this.model.onDidAccept(e => getSnippetController(this.editor).run(e.snippet, e.overwriteBefore, e.overwriteAfter)));

		this.update();
	}

	getId(): string {
		return SuggestController.ID;
	}

	dispose(): void {
		this.toDispose = dispose(this.toDispose);
		this.triggerCharacterListeners = dispose(this.triggerCharacterListeners);

		if (this.widget) {
			this.widget.dispose();
			this.widget = null;
		}
		if (this.model) {
			this.model.dispose();
			this.model = null;
		}
	}

	private update(): void {

		this.triggerCharacterListeners = dispose(this.triggerCharacterListeners);

		if (this.editor.getConfiguration().readOnly
			|| !this.editor.getModel()
			|| !this.editor.getConfiguration().contribInfo.suggestOnTriggerCharacters) {

			return;
		}

		let groups = SuggestRegistry.orderedGroups(this.editor.getModel());
		if (groups.length === 0) {
			return;
		}

		let triggerCharacters: { [ch: string]: ISuggestSupport[][] } = Object.create(null);

		groups.forEach(group => {

			let groupTriggerCharacters: { [ch: string]: ISuggestSupport[] } = Object.create(null);

			group.forEach(support => {
				let localTriggerCharacters = support.triggerCharacters;
				if (localTriggerCharacters) {
					for (let ch of localTriggerCharacters) {
						let array = groupTriggerCharacters[ch];
						if (array) {
							array.push(support);
						} else {
							array = [support];
							groupTriggerCharacters[ch] = array;
							if (triggerCharacters[ch]) {
								triggerCharacters[ch].push(array);
							} else {
								triggerCharacters[ch] = [array];
							}
						}
					}
				}
			});
		});

		Object.keys(triggerCharacters).forEach(ch => {
			this.triggerCharacterListeners.push(this.editor.addTypingListener(ch, () => {
				this.triggerCharacterHandler(ch, triggerCharacters[ch]);
			}));
		});
	}

	private triggerCharacterHandler(character: string, groups: ISuggestSupport[][]): void {
		groups = groups.map(supports => {
			return supports.filter(support => support.shouldAutotriggerSuggest);
		});

		if (groups.length > 0) {
			this.triggerSuggest(character, groups).done(null, onUnexpectedError);
		}
	}

	triggerSuggest(triggerCharacter?: string, groups?: ISuggestSupport[][]): TPromise<boolean> {
		this.model.trigger(false, triggerCharacter, false, groups);
		this.editor.focus();

		return TPromise.as(false);
	}

	acceptSelectedSuggestion(): void {
		if (this.widget) {
			this.widget.acceptSelectedSuggestion();
		}
	}

	cancelSuggestWidget(): void {
		if (this.widget) {
			this.widget.cancel();
		}
	}

	selectNextSuggestion(): void {
		if (this.widget) {
			this.widget.selectNext();
		}
	}

	selectNextPageSuggestion(): void {
		if (this.widget) {
			this.widget.selectNextPage();
		}
	}

	selectPrevSuggestion(): void {
		if (this.widget) {
			this.widget.selectPrevious();
		}
	}

	selectPrevPageSuggestion(): void {
		if (this.widget) {
			this.widget.selectPreviousPage();
		}
	}

	toggleSuggestionDetails(): void {
		if (this.widget) {
			this.widget.toggleDetails();
		}
	}
}

export class TriggerSuggestAction extends EditorAction {

	static ID: string = 'editor.action.triggerSuggest';

	constructor(descriptor: IEditorActionDescriptorData, editor: ICommonCodeEditor) {
		super(descriptor, editor);
	}

	isSupported(): boolean {
		return SuggestRegistry.has(this.editor.getModel()) && !this.editor.getConfiguration().readOnly;
	}

	run(): TPromise<boolean> {
		return SuggestController.getSuggestController(this.editor).triggerSuggest();
	}
}

const weight = CommonEditorRegistry.commandWeight(90);

// register action
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(TriggerSuggestAction, TriggerSuggestAction.ID, nls.localize('suggest.trigger.label', "Trigger Suggest"), {
	context: ContextKey.EditorTextFocus,
	primary: KeyMod.CtrlCmd | KeyCode.Space,
	mac: { primary: KeyMod.WinCtrl | KeyCode.Space }
}, 'Trigger Suggest'));
CommonEditorRegistry.registerEditorCommand(ACCEPT_SELECTED_SUGGESTION_CMD, weight, { primary: KeyCode.Tab }, true, CONTEXT_SUGGEST_WIDGET_VISIBLE, (ctx, editor, args) => {
	const controller = SuggestController.getSuggestController(editor);
	controller.acceptSelectedSuggestion();
});
KeybindingsRegistry.registerCommandDesc({
	id: 'acceptSelectedSuggestionOnEnter',
	handler(accessor) {
		withCodeEditorFromCommandHandler('acceptSelectedSuggestionOnEnter', accessor, (editor) => {
			const controller = SuggestController.getSuggestController(editor);
			controller.acceptSelectedSuggestion();
		});
	},
	weight,
	when: KbExpr.and(KbExpr.has(CONTEXT_SUGGEST_WIDGET_VISIBLE), KbExpr.has('config.editor.acceptSuggestionOnEnter')),
	primary: KeyCode.Enter,
});
CommonEditorRegistry.registerEditorCommand('hideSuggestWidget', weight, { primary: KeyCode.Escape, secondary: [KeyMod.Shift | KeyCode.Escape] }, true, CONTEXT_SUGGEST_WIDGET_VISIBLE, (ctx, editor, args) => {
	const controller = SuggestController.getSuggestController(editor);
	controller.cancelSuggestWidget();
});
CommonEditorRegistry.registerEditorCommand('selectNextSuggestion', weight, { primary: KeyCode.DownArrow, secondary: [ KeyMod.Alt | KeyCode.DownArrow ] }, true, CONTEXT_SUGGEST_WIDGET_VISIBLE, (ctx, editor, args) => {
	const controller = SuggestController.getSuggestController(editor);
	controller.selectNextSuggestion();
});
CommonEditorRegistry.registerEditorCommand('selectNextPageSuggestion', weight, { primary: KeyCode.PageDown, secondary: [ KeyMod.Alt | KeyCode.PageDown ] }, true, CONTEXT_SUGGEST_WIDGET_VISIBLE, (ctx, editor, args) => {
	const controller = SuggestController.getSuggestController(editor);
	controller.selectNextPageSuggestion();
});
CommonEditorRegistry.registerEditorCommand('selectPrevSuggestion', weight, { primary: KeyCode.UpArrow, secondary: [ KeyMod.Alt | KeyCode.UpArrow ] }, true, CONTEXT_SUGGEST_WIDGET_VISIBLE, (ctx, editor, args) => {
	const controller = SuggestController.getSuggestController(editor);
	controller.selectPrevSuggestion();
});
CommonEditorRegistry.registerEditorCommand('selectPrevPageSuggestion', weight, { primary: KeyCode.PageUp, secondary: [ KeyMod.Alt | KeyCode.PageUp ] }, true, CONTEXT_SUGGEST_WIDGET_VISIBLE, (ctx, editor, args) => {
	const controller = SuggestController.getSuggestController(editor);
	controller.selectPrevPageSuggestion();
});
CommonEditorRegistry.registerEditorCommand('toggleSuggestionDetails', weight, { primary: KeyMod.CtrlCmd | KeyCode.Space, mac: { primary: KeyMod.WinCtrl | KeyCode.Space } }, true, CONTEXT_SUGGEST_WIDGET_VISIBLE, (ctx, editor, args) => {
	const controller = SuggestController.getSuggestController(editor);
	controller.toggleSuggestionDetails();
});
EditorBrowserRegistry.registerEditorContribution(SuggestController);
