/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import {KeyCode, KeyMod} from 'vs/base/common/keyCodes';
import {ICommand, ICommonCodeEditor, EditorContextKeys} from 'vs/editor/common/editorCommon';
import {IActionOptions, EditorAction, CommonEditorRegistry, ServicesAccessor} from 'vs/editor/common/editorCommonExtensions';
import {BlockCommentCommand} from './blockCommentCommand';
import {LineCommentCommand, Type} from './lineCommentCommand';

abstract class CommentLineAction extends EditorAction {

	private _type: Type;

	constructor(type:Type, opts:IActionOptions) {
		super(opts);
		this._type = type;
	}

	public run(accessor:ServicesAccessor, editor:ICommonCodeEditor): void {
		let model = editor.getModel();
		if (!model) {
			return;
		}

		var commands: ICommand[] = [];
		var selections = editor.getSelections();
		var opts = model.getOptions();

		for (var i = 0; i < selections.length; i++) {
			commands.push(new LineCommentCommand(selections[i], opts.tabSize, this._type));
		}

		editor.executeCommands(this.id, commands);
	}

}

class ToggleCommentLineAction extends CommentLineAction {
	constructor() {
		super(Type.Toggle, {
			id: 'editor.action.commentLine',
			label: nls.localize('comment.line', "Toggle Line Comment"),
			alias: 'Toggle Line Comment',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.US_SLASH
			}
		});
	}
}

class AddLineCommentAction extends CommentLineAction {
	constructor() {
		super(Type.ForceAdd, {
			id: 'editor.action.addCommentLine',
			label: nls.localize('comment.line.add', "Add Line Comment"),
			alias: 'Add Line Comment',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_C)
			}
		});
	}
}

class RemoveLineCommentAction extends CommentLineAction {
	constructor() {
		super(Type.ForceRemove, {
			id: 'editor.action.removeCommentLine',
			label: nls.localize('comment.line.remove', "Remove Line Comment"),
			alias: 'Remove Line Comment',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_U)
			}
		});
	}
}

class BlockCommentAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.blockComment',
			label: nls.localize('comment.block', "Toggle Block Comment"),
			alias: 'Toggle Block Comment',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_A,
				linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_A }
			}
		});
	}

	public run(accessor:ServicesAccessor, editor:ICommonCodeEditor): void {
		var commands: ICommand[] = [];
		var selections = editor.getSelections();

		for (var i = 0; i < selections.length; i++) {
			commands.push(new BlockCommentCommand(selections[i]));
		}

		editor.executeCommands(this.id, commands);
	}
}

// register actions
CommonEditorRegistry.registerEditorAction(new ToggleCommentLineAction());
CommonEditorRegistry.registerEditorAction(new AddLineCommentAction());
CommonEditorRegistry.registerEditorAction(new RemoveLineCommentAction());
CommonEditorRegistry.registerEditorAction(new BlockCommentAction());
