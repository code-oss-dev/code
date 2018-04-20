/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Promise, TPromise } from 'vs/base/common/winjs.base';
import { IDataSource, IFilter, IRenderer as ITreeRenderer, ITree } from 'vs/base/parts/tree/browser/tree';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { FileLabel, ResourceLabel } from 'vs/workbench/browser/labels';
import { CommentsModel, ResourceWithCommentThreads, CommentNode } from 'vs/workbench/parts/comments/common/commentModel';

export class CommentsDataSource implements IDataSource {
	public getId(tree: ITree, element: any): string {
		if (element instanceof CommentsModel) {
			return 'root';
		}
		if (element instanceof ResourceWithCommentThreads) {
			return element.id;
		}
		if (element instanceof CommentNode) {
			return element.comment.commentId;
		}
		return '';
	}

	public hasChildren(tree: ITree, element: any): boolean {
		return element instanceof CommentsModel || element instanceof ResourceWithCommentThreads || (element instanceof CommentNode && !!element.replies.length);
	}

	public getChildren(tree: ITree, element: any): Promise {
		if (element instanceof CommentsModel) {
			return Promise.as(element.resourceCommentThreads);
		}
		if (element instanceof ResourceWithCommentThreads) {
			return Promise.as(element.commentThreads);
		}
		if (element instanceof CommentNode) {
			return Promise.as(element.replies);
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

interface IResourceTemplateData {
	resourceLabel: FileLabel;
	count: CountBadge;
	styler: IDisposable;
}

interface ICommentThreadTemplateData {
	icon: HTMLImageElement;
	resourceLabel: ResourceLabel;
	userName: HTMLSpanElement;
}

export class CommentsModelRenderer implements ITreeRenderer {
	private static RESOURCE_ID = 'resource-with-comments';
	private static COMMENT_ID = 'comment-node';


	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
		@IThemeService private themeService: IThemeService
	) {
	}

	public getHeight(tree: ITree, element: any): number {
		return 22;
	}

	public getTemplateId(tree: ITree, element: any): string {
		if (element instanceof ResourceWithCommentThreads) {
			return CommentsModelRenderer.RESOURCE_ID;
		}
		if (element instanceof CommentNode) {
			return CommentsModelRenderer.COMMENT_ID;
		}

		return '';
	}

	public renderTemplate(ITree: ITree, templateId: string, container: HTMLElement): any {
		switch (templateId) {
			case CommentsModelRenderer.RESOURCE_ID:
				return this.renderResourceTemplate(container);
			case CommentsModelRenderer.COMMENT_ID:
				return this.renderCommentTemplate(container);
		}
	}

	public disposeTemplate(tree: ITree, templateId: string, templateData: any): void {
		switch (templateId) {
			case CommentsModelRenderer.RESOURCE_ID:
				(<IResourceTemplateData>templateData).resourceLabel.dispose();
				(<IResourceTemplateData>templateData).styler.dispose();
			case CommentsModelRenderer.COMMENT_ID:
				(<ICommentThreadTemplateData>templateData).resourceLabel.dispose();
		}
	}

	public renderElement(tree: ITree, element: any, templateId: string, templateData: any): void {
		switch (templateId) {
			case CommentsModelRenderer.RESOURCE_ID:
				return this.renderResourceElement(tree, element, templateData);
			case CommentsModelRenderer.COMMENT_ID:
				return this.renderCommentElement(tree, element, templateData);
		}
	}

	private renderResourceTemplate(container: HTMLElement): IResourceTemplateData {
		const data = <IResourceTemplateData>Object.create(null);
		const labelContainer = dom.append(container, dom.$('.resource-container'));
		data.resourceLabel = this.instantiationService.createInstance(FileLabel, labelContainer, {});

		const badgeWrapper = dom.append(labelContainer, dom.$('.count-badge-wrapper'));
		data.count = new CountBadge(badgeWrapper);
		data.styler = attachBadgeStyler(data.count, this.themeService);

		return data;
	}

	private renderCommentTemplate(container: HTMLElement): ICommentThreadTemplateData {
		const data = <ICommentThreadTemplateData>Object.create(null);
		const labelContainer = dom.append(container, dom.$('.comment-container'));
		data.userName = dom.append(labelContainer, dom.$('.user'));
		data.resourceLabel = this.instantiationService.createInstance(ResourceLabel, labelContainer, {});

		return data;
	}

	private renderResourceElement(tree: ITree, element: ResourceWithCommentThreads, templateData: IResourceTemplateData) {
		templateData.resourceLabel.setFile(element.resource);
		let numComments = element.commentThreads.length;
		element.commentThreads.forEach(thread => numComments += thread.replies.length);
		templateData.count.setCount(numComments);
	}

	private renderCommentElement(tree: ITree, element: CommentNode, templateData: ICommentThreadTemplateData) {
		templateData.resourceLabel.setLabel({ name: element.comment.body.value });
		templateData.userName.textContent = element.comment.userName;
	}
}

export class CommentsDataFilter implements IFilter {
	public isVisible(tree: ITree, element: any): boolean {
		if (element instanceof CommentsModel) {
			return element.resourceCommentThreads.length > 0;
		}
		if (element instanceof ResourceWithCommentThreads) {
			return element.commentThreads.length > 0;
		}
		return true;
	}
}
