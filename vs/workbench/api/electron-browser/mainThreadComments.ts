/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import * as modes from 'vs/editor/common/modes';
import { extHostNamedCustomer } from 'vs/workbench/api/electron-browser/extHostCustomers';
import { IEditorGroupService } from 'vs/workbench/services/group/common/groupService';
import { keys } from '../../../base/common/map';
import { IWorkbenchEditorService } from '../../services/editor/common/editorService';
import { ExtHostCommentsShape, ExtHostContext, IExtHostContext, MainContext, MainThreadCommentsShape } from '../node/extHost.protocol';

import { ICommentService } from 'vs/workbench/services/comments/electron-browser/commentService';
import { COMMENTS_PANEL_ID } from 'vs/workbench/parts/comments/electron-browser/commentsPanel';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import URI from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ReviewController } from 'vs/workbench/parts/comments/electron-browser/commentsEditorContribution';

@extHostNamedCustomer(MainContext.MainThreadComments)
export class MainThreadComments extends Disposable implements MainThreadCommentsShape {

	private _proxy: ExtHostCommentsShape;
	private _providers = new Map<number, IDisposable>();

	constructor(
		extHostContext: IExtHostContext,
		@IEditorGroupService editorGroupService: IEditorGroupService,
		@IWorkbenchEditorService private _workbenchEditorService: IWorkbenchEditorService,
		@ICommentService private _commentService: ICommentService,
		@IPanelService private _panelService: IPanelService,
		@ICodeEditorService private _codeEditorService: ICodeEditorService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostComments);
		editorGroupService.onEditorsChanged(e => {
			const outerEditor = this.getFocusedEditor();
			if (!outerEditor) {
				return;
			}

			const controller = ReviewController.get(outerEditor);
			if (!controller) {
				return;
			}

			const outerEditorURI = outerEditor.getModel().uri;
			this.provideComments(outerEditorURI).then(commentThreads => {
				this._commentService.setComments(outerEditorURI, commentThreads);
			});
			this.provideNewCommentRange(outerEditor.getModel()).then(newActions => {
				controller.setNewCommentActions(newActions);
			});
		});
	}

	$registerCommentProvider(handle: number): void {
		this._providers.set(handle, undefined);
		// Fetch all comments
		this._proxy.$provideAllComments(handle).then(commentThreads => {
			if (commentThreads) {
				this._commentService.setAllComments(commentThreads);
				this._panelService.setPanelEnablement(COMMENTS_PANEL_ID, true);
			}
		});


	}

	$unregisterCommentProvider(handle: number): void {
		this._providers.delete(handle);
		this._panelService.setPanelEnablement(COMMENTS_PANEL_ID, false);
	}

	dispose(): void {
		throw new Error('Method not implemented.');
	}

	getFocusedEditor(): ICodeEditor {
		let editor = this._codeEditorService.getFocusedCodeEditor();
		if (!editor) {
			editor = this._workbenchEditorService.getActiveEditor().getControl() as ICodeEditor;
		}

		return editor;
	}

	async provideComments(resource: URI): Promise<any> {
		const result: modes.CommentThread[] = [];
		for (const handle of keys(this._providers)) {
			result.push(...await this._proxy.$provideComments(handle, resource));
		}
		return result;
	}

	async provideNewCommentRange(model: ITextModel): Promise<modes.NewCommentAction[]> {
		const result: modes.NewCommentAction[] = [];
		for (const handle of keys(this._providers)) {
			let newCommentRange = await this._proxy.$provideNewCommentRange(handle, model.uri);
			if (newCommentRange) {
				result.push(newCommentRange);
			}
		}
		return result;
	}
}
