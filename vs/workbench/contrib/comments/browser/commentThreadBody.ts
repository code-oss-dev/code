/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import * as languages from 'vs/editor/common/languages';
import { Emitter } from 'vs/base/common/event';
import { ICommentService } from 'vs/workbench/contrib/comments/browser/commentService';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { CommentNode } from 'vs/workbench/contrib/comments/browser/commentNode';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { ICommentThreadWidget } from 'vs/workbench/contrib/comments/common/commentThreadWidget';
import { MarkdownRenderer } from 'vs/editor/contrib/markdownRenderer/browser/markdownRenderer';

export class CommentThreadBody extends Disposable {
	private _commentsElement!: HTMLElement;
	private _commentElements: CommentNode[] = [];
	private _resizeObserver: any;
	private _focusedComment: number | undefined = undefined;
	private _onDidResize = new Emitter<dom.Dimension>();
	onDidResize = this._onDidResize.event;

	get length() {
		return this._commentThread.comments ? this._commentThread.comments.length : 0;
	}

	get activeComment() {
		return this._commentElements.filter(node => node.isEditing)[0];
	}


	constructor(
		readonly owner: string,
		readonly parentResourceUri: URI,
		readonly container: HTMLElement,
		private _commentThread: languages.CommentThread,
		private _parentCommentThreadWidget: ICommentThreadWidget,
		private _markdownRenderer: MarkdownRenderer,
		private _commentService: ICommentService,
		private _scopedInstatiationService: IInstantiationService
	) {
		super();

		this._register(dom.addDisposableListener(container, dom.EventType.FOCUS_IN, e => {
			this._commentService.setActiveCommentThread(this._commentThread);
		}));
	}

	display() {
		this._commentsElement = dom.append(this.container, dom.$('div.comments-container'));
		this._commentsElement.setAttribute('role', 'presentation');
		this._commentsElement.tabIndex = 0;

		this._register(dom.addDisposableListener(this._commentsElement, dom.EventType.KEY_DOWN, (e) => {
			let event = new StandardKeyboardEvent(e as KeyboardEvent);
			if (event.equals(KeyCode.UpArrow) || event.equals(KeyCode.DownArrow)) {
				const moveFocusWithinBounds = (change: number): number => {
					if (this._focusedComment === undefined && change >= 0) { return 0; }
					if (this._focusedComment === undefined && change < 0) { return this._commentElements.length - 1; }
					let newIndex = this._focusedComment! + change;
					return Math.min(Math.max(0, newIndex), this._commentElements.length - 1);
				};

				this._setFocusedComment(event.equals(KeyCode.UpArrow) ? moveFocusWithinBounds(-1) : moveFocusWithinBounds(1));
			}
		}));

		this._commentElements = [];
		if (this._commentThread.comments) {
			for (const comment of this._commentThread.comments) {
				const newCommentNode = this.createNewCommentNode(comment);

				this._commentElements.push(newCommentNode);
				this._commentsElement.appendChild(newCommentNode.domNode);
				if (comment.mode === languages.CommentMode.Editing) {
					newCommentNode.switchToEditMode();
				}
			}
		}

		this._resizeObserver = new MutationObserver(this._refresh.bind(this));

		this._resizeObserver.observe(this.container, {
			attributes: true,
			childList: true,
			characterData: true,
			subtree: true
		});
	}

	private _refresh() {
		let dimensions = dom.getClientArea(this.container);
		this._onDidResize.fire(dimensions);
	}

	getDimensions() {
		return dom.getClientArea(this.container);
	}

	layout() {
		this._commentElements.forEach(element => {
			element.layout();
		});
	}

	getCommentCoords(commentUniqueId: number): { thread: dom.IDomNodePagePosition; comment: dom.IDomNodePagePosition } | undefined {
		let matchedNode = this._commentElements.filter(commentNode => commentNode.comment.uniqueIdInThread === commentUniqueId);
		if (matchedNode && matchedNode.length) {
			const commentThreadCoords = dom.getDomNodePagePosition(this._commentElements[0].domNode);
			const commentCoords = dom.getDomNodePagePosition(matchedNode[0].domNode);
			return {
				thread: commentThreadCoords,
				comment: commentCoords
			};
		}

		return;
	}

	updateCommentThread(commentThread: languages.CommentThread) {
		const oldCommentsLen = this._commentElements.length;
		const newCommentsLen = commentThread.comments ? commentThread.comments.length : 0;

		let commentElementsToDel: CommentNode[] = [];
		let commentElementsToDelIndex: number[] = [];
		for (let i = 0; i < oldCommentsLen; i++) {
			let comment = this._commentElements[i].comment;
			let newComment = commentThread.comments ? commentThread.comments.filter(c => c.uniqueIdInThread === comment.uniqueIdInThread) : [];

			if (newComment.length) {
				this._commentElements[i].update(newComment[0]);
			} else {
				commentElementsToDelIndex.push(i);
				commentElementsToDel.push(this._commentElements[i]);
			}
		}

		// del removed elements
		// TODO@rebornix remove listener for deleted comments
		for (let i = commentElementsToDel.length - 1; i >= 0; i--) {
			this._commentElements.splice(commentElementsToDelIndex[i], 1);
			this._commentsElement.removeChild(commentElementsToDel[i].domNode);
		}


		let lastCommentElement: HTMLElement | null = null;
		let newCommentNodeList: CommentNode[] = [];
		let newCommentsInEditMode: CommentNode[] = [];
		for (let i = newCommentsLen - 1; i >= 0; i--) {
			let currentComment = commentThread.comments![i];
			let oldCommentNode = this._commentElements.filter(commentNode => commentNode.comment.uniqueIdInThread === currentComment.uniqueIdInThread);
			if (oldCommentNode.length) {
				lastCommentElement = oldCommentNode[0].domNode;
				newCommentNodeList.unshift(oldCommentNode[0]);
			} else {
				const newElement = this.createNewCommentNode(currentComment);

				newCommentNodeList.unshift(newElement);
				if (lastCommentElement) {
					this._commentsElement.insertBefore(newElement.domNode, lastCommentElement);
					lastCommentElement = newElement.domNode;
				} else {
					this._commentsElement.appendChild(newElement.domNode);
					lastCommentElement = newElement.domNode;
				}

				if (currentComment.mode === languages.CommentMode.Editing) {
					newElement.switchToEditMode();
					newCommentsInEditMode.push(newElement);
				}
			}
		}

		this._commentThread = commentThread;
		this._commentElements = newCommentNodeList;

		if (newCommentsInEditMode.length) {
			const lastIndex = this._commentElements.indexOf(newCommentsInEditMode[newCommentsInEditMode.length - 1]);
			this._focusedComment = lastIndex;
		}

		this._setFocusedComment(this._focusedComment);
	}

	private _setFocusedComment(value: number | undefined) {
		if (this._focusedComment !== undefined) {
			this._commentElements[this._focusedComment]?.setFocus(false);
		}

		if (this._commentElements.length === 0 || value === undefined) {
			this._focusedComment = undefined;
		} else {
			this._focusedComment = Math.min(value, this._commentElements.length - 1);
			this._commentElements[this._focusedComment].setFocus(true);
		}
	}

	private createNewCommentNode(comment: languages.Comment): CommentNode {
		let newCommentNode = this._scopedInstatiationService.createInstance(CommentNode,
			this._commentThread,
			comment,
			this.owner,
			this.parentResourceUri,
			this._parentCommentThreadWidget,
			this._markdownRenderer);

		this._register(newCommentNode);
		this._register(newCommentNode.onDidClick(clickedNode =>
			this._setFocusedComment(this._commentElements.findIndex(commentNode => commentNode.comment.uniqueIdInThread === clickedNode.comment.uniqueIdInThread))
		));

		return newCommentNode;
	}

	public override dispose(): void {
		super.dispose();

		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
	}
}
