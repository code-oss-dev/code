/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import {TPromise} from 'vs/base/common/winjs.base';
import {EditorAction} from 'vs/editor/common/editorAction';
import {ICommonCodeEditor, IEditorActionDescriptorData} from 'vs/editor/common/editorCommon';
import {CommonEditorRegistry, EditorActionDescriptor} from 'vs/editor/common/editorCommonExtensions';
import {IndentationToSpacesCommand, IndentationToTabsCommand} from 'vs/editor/contrib/indentation/common/indentationCommands';
import {IQuickOpenService} from 'vs/workbench/services/quickopen/common/quickOpenService';

export class IndentationToSpacesAction extends EditorAction {
	static ID = 'editor.action.indentationToSpaces';

	constructor(descriptor: IEditorActionDescriptorData, editor: ICommonCodeEditor) {
		super(descriptor, editor);
	}

	public run(): TPromise<boolean> {
		let model = this.editor.getModel();
		if (!model) {
			return;
		}
		let modelOpts = model.getOptions();
		const command = new IndentationToSpacesCommand(this.editor.getSelection(), modelOpts.tabSize);
		this.editor.executeCommands(this.id, [command]);
		// TODO@Alex TODO@indent
		// model.updateOptions({
		// 	insertSpaces: true
		// });

		return TPromise.as(true);
	}
}

export class IndentationToTabsAction extends EditorAction {
	static ID = 'editor.action.indentationToTabs';

	constructor(descriptor: IEditorActionDescriptorData, editor: ICommonCodeEditor) {
		super(descriptor, editor);
	}

	public run(): TPromise<boolean> {
		let model = this.editor.getModel();
		if (!model) {
			return;
		}
		let modelOpts = model.getOptions();
		const command = new IndentationToTabsCommand(this.editor.getSelection(), modelOpts.tabSize);
		this.editor.executeCommands(this.id, [command]);
		// TODO@Alex TODO@indent
		// model.updateOptions({
		// 	insertSpaces: false
		// });

		return TPromise.as(true);
	}
}

export class ChangeIndentationSizeAction extends EditorAction {

	constructor(descriptor: IEditorActionDescriptorData, editor: ICommonCodeEditor,
		private insertSpaces: boolean,
		private quickOpenService: IQuickOpenService
	) {
		super(descriptor, editor);
	}

	public run(): TPromise<boolean> {
		let model = this.editor.getModel();
		if (!model) {
			return;
		}
		let modelOpts = model.getOptions();
		const picks = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
			id: n.toString(),
			label: n.toString(),
			description: n === modelOpts.tabSize ? nls.localize('configuredTabSize', "Configured Tab Size") : null
		}));
		const autoFocusIndex = Math.min(modelOpts.tabSize - 1, 7);

		return TPromise.timeout(50 /* quick open is sensitive to being opened so soon after another */).then(() =>
			this.quickOpenService.pick(picks, { placeHolder: nls.localize('selectTabWidth', "Select Tab Size for Current File"), autoFocus: { autoFocusIndex } }).then(pick => {
				if (pick) {
					// TODO@Alex TODO@indent
					// model.updateOptions({
					// 	tabSize: parseInt(pick.label)
					//  insertSpaces: this.insertSpaces
					// });
				}

				return true;
			})
		);
	}
}

export class IndentUsingTabs extends ChangeIndentationSizeAction {

	static ID = 'editor.action.indentUsingTabs';

	constructor(descriptor: IEditorActionDescriptorData, editor: ICommonCodeEditor,
		@IQuickOpenService quickOpenService: IQuickOpenService
	) {
		super(descriptor, editor, false, quickOpenService);
	}
}

export class IndentUsingSpaces extends ChangeIndentationSizeAction {

	static ID = 'editor.action.indentUsingSpaces';

	constructor(descriptor: IEditorActionDescriptorData, editor: ICommonCodeEditor,
		@IQuickOpenService quickOpenService: IQuickOpenService
	) {
		super(descriptor, editor, true, quickOpenService);
	}
}

export class ToggleRenderWhitespaceAction extends EditorAction {
	static ID = 'editor.action.toggleRenderWhitespace';

	constructor(descriptor: IEditorActionDescriptorData, editor: ICommonCodeEditor) {
		super(descriptor, editor);
	}

	public run(): TPromise<boolean> {
		this.editor.updateOptions({
			renderWhitespace: !this.editor.getConfiguration().renderWhitespace
		});

		return TPromise.as(true);
	}
}

// register actions
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(IndentationToSpacesAction, IndentationToSpacesAction.ID, nls.localize('indentationToSpaces', "Convert Indentation to Spaces")));
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(IndentationToTabsAction, IndentationToTabsAction.ID, nls.localize('indentationToTabs', "Convert Indentation to Tabs")));
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(IndentUsingSpaces, IndentUsingSpaces.ID, nls.localize('indentUsingSpaces', "Indent Using Spaces")));
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(IndentUsingTabs, IndentUsingTabs.ID, nls.localize('indentUsingTabs', "Indent Using Tabs")));
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(ToggleRenderWhitespaceAction, ToggleRenderWhitespaceAction.ID, nls.localize('toggleRenderWhitespace', "Toggle Render Whitespace")));
