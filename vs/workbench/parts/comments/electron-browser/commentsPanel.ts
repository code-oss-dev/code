/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { debounceEvent } from 'vs/base/common/event';
import { Promise, TPromise } from 'vs/base/common/winjs.base';
import { IDataSource, IFilter, IRenderer, ITree } from 'vs/base/parts/tree/browser/tree';
import { DefaultAccessibilityProvider, DefaultController, DefaultDragAndDrop } from 'vs/base/parts/tree/browser/treeDefaults';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorService } from 'vs/platform/editor/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TreeResourceNavigator, WorkbenchTree } from 'vs/platform/list/browser/listService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ResourceLabel } from 'vs/workbench/browser/labels';
import { Panel } from 'vs/workbench/browser/panel';
import { ReviewController } from 'vs/workbench/parts/comments/electron-browser/commentsEditorContribution';
import { ICommentService } from 'vs/workbench/services/comments/electron-browser/commentService';
import { ResourceCommentThreads, CommentsModel, CommentNode } from 'vs/workbench/parts/comments/common/commentModel';
import { CommentThread } from 'vs/editor/common/modes';

export const COMMENTS_PANEL_ID = 'workbench.panel.comments';
export const COMMENTS_PANEL_TITLE = 'Comments';

export class CommentsDataSource implements IDataSource {
	public getId(tree: ITree, element: any): string {
		if (element instanceof CommentsModel) {
			return 'root';
		}
		if (element instanceof ResourceCommentThreads) {
			return element.id;
		}
		if (element instanceof CommentNode) {
			// Fix
			return 'commentNode' + element.comment.body.value.substr(0, 10);
		}
		return '';
	}

	public hasChildren(tree: ITree, element: any): boolean {
		return element instanceof CommentsModel || element instanceof ResourceCommentThreads || (element instanceof CommentNode && element.hasReply());
	}

	public getChildren(tree: ITree, element: any): Promise {
		if (element instanceof CommentsModel) {
			return Promise.as(element.commentThreads);
		}
		if (element instanceof ResourceCommentThreads) {
			return Promise.as([element.comments[0]]);
		}
		if (element instanceof CommentNode && element.hasReply()) {
			return Promise.as([element.reply]);
		}
		return null;
	}

	public getParent(tree: ITree, element: any): Promise {
		return TPromise.as(null);
	}

	public shouldAutoexpand(tree: ITree, element: any): boolean {
		return true;
	}
}

export class CommentsModelRenderer implements IRenderer {
	private static COMMENTS_THREAD_ID = 'comments-thread';
	private static COMMENT_ID = 'comment';


	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
	) {
	}

	public getHeight(tree: ITree, element: any): number {
		return 22;
	}

	public getTemplateId(tree: ITree, element: any): string {
		if (element instanceof ResourceCommentThreads) {
			return CommentsModelRenderer.COMMENTS_THREAD_ID;
		}
		if (element instanceof CommentNode) {
			return CommentsModelRenderer.COMMENT_ID;
		}

		return '';
	}

	public renderTemplate(ITree: ITree, templateId: string, container: HTMLElement): any {
		switch (templateId) {
			case CommentsModelRenderer.COMMENTS_THREAD_ID:
				return this.renderCommentsThreadTemplate(container);
			case CommentsModelRenderer.COMMENT_ID:
				return this.renderCommentTemplate(container);
		}
	}

	public disposeTemplate(tree: ITree, templateId: string): void {
		// TODO
	}

	public renderElement(tree: ITree, element: any, templateId: string, templateData: any): void {
		switch (templateId) {
			case CommentsModelRenderer.COMMENTS_THREAD_ID:
				return this.renderCommentsThreadElement(tree, element, templateData);
			case CommentsModelRenderer.COMMENT_ID:
				return this.renderCommentElement(tree, element, templateData);
		}
	}

	private renderCommentsThreadTemplate(container: HTMLElement): IResourceMarkersTemplateData {
		const data = <IResourceMarkersTemplateData>Object.create(null);
		const labelContainer = dom.append(container, dom.$('.comment-thread-container'));
		data.resourceLabel = this.instantiationService.createInstance(ResourceLabel, labelContainer, {});

		return data;
	}

	private renderCommentTemplate(container: HTMLElement): IResourceMarkersTemplateData {
		const data = <IResourceMarkersTemplateData>Object.create(null);
		const labelContainer = dom.append(container, dom.$('.comment-container'));
		data.resourceLabel = this.instantiationService.createInstance(ResourceLabel, labelContainer, {});

		return data;
	}

	private renderCommentsThreadElement(tree: ITree, element: ResourceCommentThreads, templateData: IResourceMarkersTemplateData) {
		templateData.resourceLabel.setLabel({ name: element.resource.toString() });
	}

	private renderCommentElement(tree: ITree, element: CommentNode, templateData: IResourceMarkersTemplateData) {
		templateData.resourceLabel.setLabel({ name: element.comment.body.value });
	}
}

export class DataFilter implements IFilter {
	public isVisible(tree: ITree, element: any): boolean {
		if (element instanceof CommentsModel) {
			return element.commentThreads.length > 0;
		}
		if (element instanceof ResourceCommentThreads) {
			return element.comments.length > 0;
		}
		return true;
	}
}

interface IResourceMarkersTemplateData {
	resourceLabel: ResourceLabel;
}
export class CommentsPanel extends Panel {
	private tree: WorkbenchTree;
	private treeContainer: HTMLElement;
	private commentsModel: CommentsModel;

	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
		@ICommentService private commentService: ICommentService,
		@IEditorService private editorService: IEditorService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(COMMENTS_PANEL_ID, telemetryService, themeService);
	}

	public create(parent: HTMLElement): TPromise<void> {
		super.create(parent);

		dom.addClass(parent, 'markers-panel');

		let container = dom.append(parent, dom.$('.markers-panel-container'));
		this.treeContainer = dom.append(container, dom.$('.tree-container'));
		this.commentsModel = new CommentsModel();

		this.createTree();

		this.commentService.onDidSetAllCommentThreads(this.onAllCommentsChanged, this);

		return this.render();
	}

	private onAllCommentsChanged(e: CommentThread[]) {
		this.commentsModel.setCommentThreads(e);
		this.tree.refresh().then(() => {
			console.log('tree refreshed');
		}, (e) => {
			console.log(e);
		});
	}

	private render(): TPromise<void> {
		dom.toggleClass(this.treeContainer, 'hidden', false);
		return this.tree.setInput(this.commentsModel);
	}

	public layout(dimensions: dom.Dimension): void {
		this.tree.layout(dimensions.height, dimensions.width);
	}

	public getTitle(): string {
		return COMMENTS_PANEL_TITLE;
	}

	private createTree(): void {
		this.tree = this.instantiationService.createInstance(WorkbenchTree, this.treeContainer, {
			dataSource: new CommentsDataSource(),
			renderer: new CommentsModelRenderer(this.instantiationService),
			accessibilityProvider: new DefaultAccessibilityProvider,
			controller: new DefaultController(),
			dnd: new DefaultDragAndDrop(),
			filter: new DataFilter()
		}, {
				twistiePixels: 20,
				ariaLabel: COMMENTS_PANEL_TITLE
			});

		const commentsNavigator = this._register(new TreeResourceNavigator(this.tree, { openOnFocus: true }));
		this._register(debounceEvent(commentsNavigator.openResource, (last, event) => event, 100, true)(options => {
			this.openFile(options.element, options.editorOptions.pinned, options.sideBySide);
		}));
	}

	private openFile(element: any, pinned: boolean, sideBySide: boolean): boolean {
		if (!(element instanceof ResourceCommentThreads || element instanceof CommentNode)) {
			return false;
		}

		const range = element instanceof ResourceCommentThreads ? element.comments[0].range : element.range;
		this.editorService.openEditor({ resource: element.resource, options: { pinned: pinned, selection: range } }, sideBySide)
			.done(editor => {
				// If clicking on the file name, open the first comment thread. If clicking on a comment, open its thread
				const threadToReveal = element instanceof ResourceCommentThreads ? element.comments[0].threadId : element.threadId;
				const control = editor.getControl();
				if (threadToReveal && isCodeEditor(control)) {
					const controller = ReviewController.get(control);
					// FIX there is a race between revealing the thread and the widget being created?
					controller.revealCommentThread(threadToReveal);
				}
			});

		return true;
	}
}
