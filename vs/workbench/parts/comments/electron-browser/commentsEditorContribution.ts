/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import 'vs/css!./media/review';
import * as nls from 'vs/nls';
import * as arrays from 'vs/base/common/arrays';
import * as modes from 'vs/editor/common/modes';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType, IViewZone } from 'vs/editor/browser/editorBrowser';
import { $ } from 'vs/base/browser/builder';
import * as dom from 'vs/base/browser/dom';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { TrackedRangeStickiness, IModelDeltaDecoration, IModelDecoration, OverviewRulerLane } from 'vs/editor/common/model';
import { renderMarkdown } from 'vs/base/browser/htmlContentRenderer';
import { RawContextKey, IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EmbeddedCodeEditorWidget } from 'vs/editor/browser/widget/embeddedCodeEditorWidget';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { Action } from 'vs/base/common/actions';
import { registerThemingParticipant, ITheme, IThemeService } from 'vs/platform/theme/common/themeService';
import { peekViewEditorBackground, peekViewBorder, } from 'vs/editor/contrib/referenceSearch/referencesWidget';
import { Color } from 'vs/base/common/color';
import { IMarginData } from 'vs/editor/browser/controller/mouseTarget';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { Emitter, Event } from 'vs/base/common/event';
import { editorBackground, editorForeground } from 'vs/platform/theme/common/colorRegistry';
import { ZoneWidget, IOptions } from 'vs/editor/contrib/zoneWidget/zoneWidget';
import { ReviewModel } from 'vs/workbench/parts/comments/common/reviewModel';
import { ICommentService } from '../../../services/comments/electron-browser/commentService';
import { CommentThreadCollapsibleState } from '../../../api/node/extHostTypes';
import { Button } from 'vs/base/browser/ui/button/button';
import { attachButtonStyler } from 'vs/platform/theme/common/styler';

export const ctxReviewPanelVisible = new RawContextKey<boolean>('reviewPanelVisible', false);
export const ID = 'editor.contrib.review';

declare var ResizeObserver: any;

const REVIEW_DECORATION = ModelDecorationOptions.register({
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	glyphMarginClassName: 'review',
	overviewRuler: {
		color: 'rgba(255, 100, 100, 0.5)',
		darkColor: 'rgba(255, 100, 100, 0.5)',
		position: OverviewRulerLane.Full
	}
});

const COMMENTING_RANGE_DECORATION = ModelDecorationOptions.register({
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	glyphMarginClassName: 'commenting-range',
});

const NEW_COMMENT_DECORATION = ModelDecorationOptions.register({
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	glyphMarginClassName: 'new-comment-hint',
});

export class ReviewViewZone implements IViewZone {
	public readonly afterLineNumber: number;
	public readonly domNode: HTMLElement;
	private callback: (top: number) => void;

	constructor(afterLineNumber: number, onDomNodeTop: (top: number) => void) {
		this.afterLineNumber = afterLineNumber;
		this.callback = onDomNodeTop;

		this.domNode = $('.review-viewzone').getHTMLElement();
	}

	onDomNodeTop(top: number): void {
		this.callback(top);
	}
}

export class CommentNode {
	private _domNode: HTMLElement;
	private _body: HTMLElement;
	private _md: HTMLElement;
	public get domNode(): HTMLElement {
		return this._domNode;
	}
	constructor(public comment: modes.Comment, ) {
		this._domNode = $('div.review-comment').getHTMLElement();
		let avatar = $('div.avatar-container').appendTo(this._domNode).getHTMLElement();
		let img = <HTMLImageElement>$('img.avatar').appendTo(avatar).getHTMLElement();
		img.src = comment.gravatar;
		let commentDetailsContainer = $('.review-comment-contents').appendTo(this._domNode).getHTMLElement();

		let header = $('div').appendTo(commentDetailsContainer).getHTMLElement();
		let author = $('strong.author').appendTo(header).getHTMLElement();
		author.innerText = comment.userName;
		this._body = $('comment-body').appendTo(commentDetailsContainer).getHTMLElement();
		this._md = renderMarkdown(comment.body);
		this._body.appendChild(this._md);
	}

	update(newComment: modes.Comment) {
		if (newComment.body !== this.comment.body) {
			this._body.removeChild(this._md);
			this._md = renderMarkdown(newComment.body);
			this._body.appendChild(this._md);
		}

		this.comment = newComment;
	}
}

const EXPAND_ACTION_CLASS = 'expand-review-action octicon octicon-chevron-down';
const COLLAPSE_ACTION_CLASS = 'expand-review-action octicon octicon-chevron-up';

export class ReviewZoneWidget extends ZoneWidget {
	private _headElement: HTMLElement;
	protected _primaryHeading: HTMLElement;
	protected _secondaryHeading: HTMLElement;
	protected _metaHeading: HTMLElement;
	protected _actionbarWidget: ActionBar;
	private _bodyElement: HTMLElement;
	private _commentsElement: HTMLElement;
	private _commentElements: CommentNode[];
	private _resizeObserver: any;
	private _onDidClose = new Emitter<ReviewZoneWidget>();
	private _isCollapsed;
	private _toggleAction: Action;
	private _commentThread: modes.CommentThread;
	public get commentThread(): modes.CommentThread {
		return this._commentThread;
	}
	private _replyCommand: modes.Command;
	private _owner: number;
	public get owner(): number {
		return this._owner;
	}

	private _decorationIDs: string[];
	private _localToDispose: IDisposable[];

	constructor(
		editor: ICodeEditor,
		owner: number,
		commentThread: modes.CommentThread,
		replyCommand: modes.Command,
		options: IOptions = {},
		private readonly themeService: IThemeService,
		private readonly commandService: ICommandService
	) {
		super(editor, options);
		this._resizeObserver = null;
		this._owner = owner;
		this._commentThread = commentThread;
		this._replyCommand = replyCommand;
		this._isCollapsed = commentThread.collapsibleState !== modes.CommentThreadCollapsibleState.Expanded;
		this._decorationIDs = [];
		this._localToDispose = [];
		this.create();
		this.themeService.onThemeChange(this._applyTheme, this);
	}

	public get onDidClose(): Event<ReviewZoneWidget> {
		return this._onDidClose.event;
	}

	public reveal() {
		if (this._isCollapsed) {
			this._isCollapsed = false;

			if (this._decorationIDs && this._decorationIDs.length) {
				let range = this.editor.getModel().getDecorationRange(this._decorationIDs[0]);
				this.show(range, 2);
			} else {
				this.show({ lineNumber: this._commentThread.range.startLineNumber, column: 1 }, 2);
			}
		}
	}

	protected _fillContainer(container: HTMLElement): void {
		this.setCssClass('review-widget');
		this._headElement = <HTMLDivElement>$('.head').getHTMLElement();
		container.appendChild(this._headElement);
		this._fillHead(this._headElement);

		this._bodyElement = <HTMLDivElement>$('.body').getHTMLElement();
		container.appendChild(this._bodyElement);
	}

	protected _fillHead(container: HTMLElement): void {
		var titleElement = $('.review-title').
			appendTo(this._headElement).
			getHTMLElement();

		this._primaryHeading = $('span.filename').appendTo(titleElement).getHTMLElement();
		this._secondaryHeading = $('span.dirname').appendTo(titleElement).getHTMLElement();
		this._metaHeading = $('span.meta').appendTo(titleElement).getHTMLElement();

		let primaryHeading = 'Reviewers:';
		$(this._primaryHeading).safeInnerHtml(primaryHeading);
		this._primaryHeading.setAttribute('aria-label', primaryHeading);

		let secondaryHeading = this._commentThread.comments.filter(arrays.uniqueFilter(comment => comment.userName)).map(comment => `@${comment.userName}`).join(', ');
		$(this._secondaryHeading).safeInnerHtml(secondaryHeading);

		const actionsContainer = $('.review-actions').appendTo(this._headElement);
		this._actionbarWidget = new ActionBar(actionsContainer.getHTMLElement(), {});
		this._disposables.push(this._actionbarWidget);

		this._toggleAction = new Action('review.expand', nls.localize('label.expand', "Expand"), this._isCollapsed ? EXPAND_ACTION_CLASS : COLLAPSE_ACTION_CLASS, true, () => {
			if (this._isCollapsed) {
			}
			else {
				this._isCollapsed = true;
				this.hide();
			}
			return null;
		});

		this._actionbarWidget.push(this._toggleAction, { label: false, icon: true });
	}

	toggleExpand() {
		this._toggleAction.run();
	}

	update(commentThread: modes.CommentThread) {
		const oldCommentsLen = this._commentElements.length;
		const newCommentsLen = commentThread.comments.length;

		let commentElementsToDel: CommentNode[] = [];
		let commentElementsToDelIndex: number[] = [];
		for (let i = 0; i < oldCommentsLen; i++) {
			let comment = this._commentElements[i].comment;
			let newComment = commentThread.comments.filter(c => c.commentId === comment.commentId);

			if (newComment.length) {
				this._commentElements[i].update(newComment[0]);
			} else {
				commentElementsToDelIndex.push(i);
				commentElementsToDel.push(this._commentElements[i]);
			}
		}

		// del removed elements
		for (let i = commentElementsToDel.length - 1; i >= 0; i--) {
			this._commentElements.splice(commentElementsToDelIndex[i]);
			this._commentsElement.removeChild(commentElementsToDel[i].domNode);
		}

		if (this._commentElements.length === 0) {
			this._commentThread = commentThread;
			commentThread.comments.forEach(comment => {
				let newElement = new CommentNode(comment);
				this._commentElements.push(newElement);
				this._commentsElement.appendChild(newElement.domNode);
			});
			return;
		}

		let lastCommentElement: HTMLElement = null;
		let newCommentNodeList: CommentNode[] = [];
		for (let i = newCommentsLen - 1; i >= 0; i--) {
			let currentComment = commentThread.comments[i];
			let oldCommentNode = this._commentElements.filter(commentNode => commentNode.comment.commentId === currentComment.commentId);
			if (oldCommentNode.length) {
				lastCommentElement = oldCommentNode[0].domNode;
				newCommentNodeList.unshift(oldCommentNode[0]);
			} else {
				let newElement = new CommentNode(currentComment);
				newCommentNodeList.unshift(newElement);
				if (lastCommentElement) {
					this._commentsElement.insertBefore(newElement.domNode, lastCommentElement);
					lastCommentElement = newElement.domNode;
				} else {
					this._commentsElement.appendChild(newElement.domNode);
					lastCommentElement = newElement.domNode;
				}
			}
		}

		this._commentThread = commentThread;
		this._commentElements = newCommentNodeList;
	}

	display(lineNumber: number) {
		this.editor.changeDecorations(accessor => {
			this._decorationIDs = accessor.deltaDecorations(this._decorationIDs, [{
				range: this._commentThread.range,
				options: REVIEW_DECORATION
			}]);
		});

		this._localToDispose.push(this.editor.onMouseDown(e => this.onEditorMouseDown(e)));
		this._localToDispose.push(this.editor.onMouseUp(e => this.onEditorMouseUp(e)));

		var headHeight = Math.ceil(this.editor.getConfiguration().lineHeight * 1.2);
		this._headElement.style.height = `${headHeight}px`;
		this._headElement.style.lineHeight = this._headElement.style.height;

		this._commentsElement = $('div.comments-container').appendTo(this._bodyElement).getHTMLElement();
		this._commentElements = [];
		for (let i = 0; i < this._commentThread.comments.length; i++) {
			let newCommentNode = new CommentNode(this._commentThread.comments[i]);
			this._commentElements.push(newCommentNode);
			this._commentsElement.appendChild(newCommentNode.domNode);
		}

		if (this._commentThread.reply) {
			const commentForm = $('.comment-form').appendTo(this._bodyElement).getHTMLElement();
			const reviewThreadReplyButton = <HTMLButtonElement>$('button.review-thread-reply-button').appendTo(commentForm).getHTMLElement();
			reviewThreadReplyButton.title = 'Reply...';
			reviewThreadReplyButton.textContent = 'Reply...';
			const textArea = <HTMLTextAreaElement>$('textarea').appendTo(commentForm).getHTMLElement();
			textArea.placeholder = 'Reply...';

			// bind click/escape actions for reviewThreadReplyButton and textArea
			reviewThreadReplyButton.onclick = () => {
				if (!dom.hasClass(commentForm, 'expand')) {
					dom.addClass(commentForm, 'expand');
					textArea.focus();
				}
			};

			dom.addDisposableListener(textArea, 'keydown', (ev: KeyboardEvent) => {
				if (textArea.value === '' && ev.keyCode === 27) {
					if (dom.hasClass(commentForm, 'expand')) {
						dom.removeClass(commentForm, 'expand');
					}
				}
			});

			const formActions = $('.form-actions').appendTo(commentForm).getHTMLElement();

			const button = new Button(formActions);
			attachButtonStyler(button, this.themeService);
			button.label = this.commentThread.reply.title;
			button.onDidClick(async () => {
				let newComment = await this.commandService.executeCommand(this._replyCommand.id, this.editor.getModel().uri, {
					start: { line: lineNumber, column: 1 },
					end: { line: lineNumber, column: 1 }
				}, this._commentThread, textArea.value);
				if (newComment) {
					textArea.value = '';
					this._commentThread.comments.push(newComment);
					let newCommentNode = new CommentNode(newComment);
					this._commentElements.push(newCommentNode);
					this._commentsElement.appendChild(newCommentNode.domNode);
					let secondaryHeading = this._commentThread.comments.filter(arrays.uniqueFilter(comment => comment.userName)).map(comment => `@${comment.userName}`).join(', ');
					$(this._secondaryHeading).safeInnerHtml(secondaryHeading);
				}
			});
		}

		this._resizeObserver = new ResizeObserver(entries => {
			if (entries[0].target === this._bodyElement && !this._isCollapsed) {
				const lineHeight = this.editor.getConfiguration().lineHeight;
				const arrowHeight = Math.round(lineHeight / 3);
				const computedLinesNumber = Math.ceil((headHeight + entries[0].contentRect.height + arrowHeight) / lineHeight);
				this._relayout(computedLinesNumber);
			}
		});

		this._resizeObserver.observe(this._bodyElement);

		if (this._commentThread.collapsibleState === modes.CommentThreadCollapsibleState.Expanded) {
			this.show({ lineNumber: lineNumber, column: 1 }, 2);
		}
	}

	private mouseDownInfo: { lineNumber: number, iconClicked: boolean };

	private onEditorMouseDown(e: IEditorMouseEvent): void {
		if (!e.event.leftButton) {
			return;
		}

		let range = e.target.range;
		if (!range) {
			return;
		}

		let iconClicked = false;
		switch (e.target.type) {
			case MouseTargetType.GUTTER_GLYPH_MARGIN:
				iconClicked = true;
				break;
			default:
				return;
		}

		this.mouseDownInfo = { lineNumber: range.startLineNumber, iconClicked };
	}

	private onEditorMouseUp(e: IEditorMouseEvent): void {
		if (!this.mouseDownInfo) {
			return;
		}
		let lineNumber = this.mouseDownInfo.lineNumber;
		let iconClicked = this.mouseDownInfo.iconClicked;

		let range = e.target.range;
		if (!range || range.startLineNumber !== lineNumber) {
			return;
		}

		if (this.position && this.position.lineNumber !== lineNumber) {
			return;
		}

		if (!this.position && lineNumber !== this._commentThread.range.startLineNumber) {
			return;
		}

		if (iconClicked) {
			if (e.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN) {
				return;
			}
		}

		if (this._isCollapsed) {
			this._isCollapsed = !this._isCollapsed;
			this.show({ lineNumber: lineNumber, column: 1 }, 2);
		} else {
			this._isCollapsed = !this._isCollapsed;
			this.hide();
		}
	}

	private _applyTheme(theme: ITheme) {
		let borderColor = theme.getColor(peekViewBorder) || Color.transparent;
		this.style({
			arrowColor: borderColor,
			frameColor: borderColor
		});
	}

	dispose() {
		super.dispose();
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
		this.editor.changeDecorations(accessor => {
			accessor.deltaDecorations(this._decorationIDs, []);
		});
		this._localToDispose.forEach(local => local.dispose());
		this._onDidClose.fire();
	}
}

export class ReviewController implements IEditorContribution {
	private globalToDispose: IDisposable[];
	private localToDispose: IDisposable[];
	private editor: ICodeEditor;
	private decorationIDs: string[];
	private newCommentHintDecoration: string[];
	private commentingRangeDecorationMap: Map<number, string[]>;
	private commentingRangeDecorations: string[];
	private _zoneWidget: ReviewZoneWidget;
	private _zoneWidgets: ReviewZoneWidget[];
	private _reviewPanelVisible: IContextKey<boolean>;
	private _commentInfos: modes.CommentInfo[];
	private _reviewModel: ReviewModel;

	constructor(
		editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService private themeService: IThemeService,
		@ICommandService private commandService: ICommandService,
		@ICommentService private commentService: ICommentService
	) {
		this.editor = editor;
		this.globalToDispose = [];
		this.localToDispose = [];
		this.decorationIDs = [];
		this.newCommentHintDecoration = [];
		this.commentingRangeDecorations = [];
		this.commentingRangeDecorationMap = new Map();
		this.mouseDownInfo = null;
		this._commentInfos = [];
		this._zoneWidgets = [];
		this._zoneWidget = null;

		this._reviewPanelVisible = ctxReviewPanelVisible.bindTo(contextKeyService);
		this._reviewModel = new ReviewModel();

		this._reviewModel.onDidChangeStyle(style => {
			this.editor.changeDecorations(accessor => {
				this.decorationIDs = accessor.deltaDecorations(this.decorationIDs, []);
			});

			if (this._zoneWidget) {
				this._zoneWidget.dispose();
				this._zoneWidget = null;
			}

			this._zoneWidgets.forEach(zone => {
				zone.dispose();
			});

			this._commentInfos.forEach(info => {
				info.threads.forEach(thread => {
					let zoneWidget = new ReviewZoneWidget(this.editor, info.owner, thread, info.reply, {}, this.themeService, this.commandService);
					zoneWidget.display(thread.range.startLineNumber);
					this._zoneWidgets.push(zoneWidget);
				});
			});
		});

		this.globalToDispose.push(this.commentService.onDidSetResourceCommentInfos(e => {
			const editorURI = this.editor && this.editor.getModel() && this.editor.getModel().uri;
			if (editorURI && editorURI.toString() === e.resource.toString()) {
				this.setComments(e.commentInfos);
			}
		}));

		this.globalToDispose.push(this.editor.onDidChangeModel(() => this.onModelChanged()));
	}

	public static get(editor: ICodeEditor): ReviewController {
		return editor.getContribution<ReviewController>(ID);
	}

	public revealCommentThread(threadId: string): void {
		const commentThreadWidget = this._zoneWidgets.filter(widget => widget.commentThread.threadId === threadId);
		if (commentThreadWidget.length === 1) {
			commentThreadWidget[0].reveal();
		}
	}

	getId(): string {
		return ID;
	}
	dispose(): void {
		this.globalToDispose = dispose(this.globalToDispose);
		this.localToDispose = dispose(this.localToDispose);

		if (this._zoneWidget) {
			this._zoneWidget.dispose();
			this._zoneWidget = null;
		}
		this.editor = null;
	}

	public onModelChanged(): void {
		this.localToDispose = dispose(this.localToDispose);
		if (this._zoneWidget) {
			// todo store view state.
			this._zoneWidget.dispose();
			this._zoneWidget = null;
		}

		this._zoneWidgets.forEach(zone => {
			zone.dispose();
		});
		this._zoneWidgets = [];

		this.localToDispose.push(this.editor.onMouseDown(e => this.onEditorMouseDown(e)));
		this.localToDispose.push(this.editor.onMouseUp(e => this.onEditorMouseUp(e)));
		this.localToDispose.push(this.editor.onMouseMove(e => this.onEditorMouseMove(e)));
		this.localToDispose.push(this.commentService.onDidUpdateCommentThreads(e => {
			const editorURI = this.editor && this.editor.getModel() && this.editor.getModel().uri;
			if (!editorURI) {
				return;
			}
			let added = e.added.filter(thread => thread.resource.toString() === editorURI.toString());
			let removed = e.removed.filter(thread => thread.resource.toString() === editorURI.toString());
			let changed = e.changed.filter(thread => thread.resource.toString() === editorURI.toString());

			removed.forEach(thread => {
				let matchedZones = this._zoneWidgets.filter(zoneWidget => zoneWidget.owner === e.owner && zoneWidget.commentThread.threadId === thread.threadId);
				if (matchedZones.length) {
					let matchedZone = matchedZones[0];
					let index = this._zoneWidgets.indexOf(matchedZone);
					this._zoneWidgets.splice(index, 1);
				}
			});

			changed.forEach(thread => {
				let matchedZones = this._zoneWidgets.filter(zoneWidget => zoneWidget.owner === e.owner && zoneWidget.commentThread.threadId === thread.threadId);
				if (matchedZones.length) {
					let matchedZone = matchedZones[0];
					matchedZone.update(thread);
				}
			});
			added.forEach(thread => {
				let zoneWidget = new ReviewZoneWidget(this.editor, e.owner, thread, thread.reply, {}, this.themeService, this.commandService);
				zoneWidget.display(thread.range.startLineNumber);
				this._zoneWidgets.push(zoneWidget);
				this._commentInfos.filter(info => info.owner === e.owner)[0].threads.push(thread);
			});
		}));
	}

	private mouseDownInfo: { lineNumber: number, iconClicked: boolean };

	private onEditorMouseDown(e: IEditorMouseEvent): void {
		if (!e.event.leftButton) {
			return;
		}

		let range = e.target.range;
		if (!range) {
			return;
		}

		let iconClicked = false;
		switch (e.target.type) {
			case MouseTargetType.GUTTER_GLYPH_MARGIN:
				iconClicked = true;
				break;
			default:
				return;
		}

		this.mouseDownInfo = { lineNumber: range.startLineNumber, iconClicked };
	}

	private onEditorMouseUp(e: IEditorMouseEvent): void {
		if (!this.mouseDownInfo) {
			return;
		}
		let lineNumber = this.mouseDownInfo.lineNumber;
		let iconClicked = this.mouseDownInfo.iconClicked;

		let range = e.target.range;
		if (!range || range.startLineNumber !== lineNumber) {
			return;
		}

		if (iconClicked) {
			if (e.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN) {
				return;
			}
		}

		if (this._zoneWidget && this._zoneWidget.position && this._zoneWidget.position.lineNumber === lineNumber) {
			return;
		}

		if (this.marginFreeFromCommentHintDecorations(lineNumber)) {
			let newCommentInfo = this.getNewCommentAction(lineNumber);
			if (!newCommentInfo) {
				return;
			}

			// add new comment
			this._reviewPanelVisible.set(true);
			this._zoneWidget = new ReviewZoneWidget(this.editor, newCommentInfo[1], {
				threadId: null,
				resource: null,
				comments: [],
				range: {
					startLineNumber: lineNumber,
					startColumn: 0,
					endLineNumber: lineNumber,
					endColumn: 0
				},
				reply: newCommentInfo[0],
				collapsibleState: CommentThreadCollapsibleState.Expanded,
			}, newCommentInfo[0], {}, this.themeService, this.commandService);

			this._zoneWidget.onDidClose(e => {
				this._zoneWidget = null;
			});
			this._zoneWidget.display(lineNumber);
		}
	}

	private onEditorMouseMove(e: IEditorMouseEvent): void {
		let showNewCommentHintAtLineNumber = -1;
		if (e.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN
			&& this.marginFreeFromCommentHintDecorations(e.target.position.lineNumber)) {
			const data = e.target.detail as IMarginData;
			if (!data.isAfterLines) {
				showNewCommentHintAtLineNumber = e.target.position.lineNumber;
			}
		}
		this.ensureNewCommentHintDecoration(showNewCommentHintAtLineNumber);
	}

	ensureNewCommentHintDecoration(showNewCommentHintAtLineNumber: number) {
		const newDecoration: IModelDeltaDecoration[] = [];
		if (showNewCommentHintAtLineNumber !== -1) {
			newDecoration.push({
				options: NEW_COMMENT_DECORATION,
				range: {
					startLineNumber: showNewCommentHintAtLineNumber,
					startColumn: 1,
					endLineNumber: showNewCommentHintAtLineNumber,
					endColumn: 1
				}
			});
		}

		this.newCommentHintDecoration = this.editor.deltaDecorations(this.newCommentHintDecoration, newDecoration);
	}

	getNewCommentAction(line: number): [modes.Command, number] {
		const decorations = this.editor.getLineDecorations(line);
		let activeDecoration: IModelDecoration;
		if (decorations) {
			for (const decoration of decorations) {
				if (decoration.options.glyphMarginClassName &&
					decoration.options.glyphMarginClassName.indexOf('commenting-range') > -1 &&
					decoration.options.glyphMarginClassName.indexOf('review') < 0
				) {
					activeDecoration = decoration;
				}
			}
		}

		if (!activeDecoration) {
			return null;
		}

		let cmd: modes.Command = null;
		let owner: number = -1;

		this.commentingRangeDecorationMap.forEach((value, key) => {
			if (!cmd && value.indexOf(activeDecoration.id) > -1) {
				// index
				let infos = this._commentInfos.filter(info => info.owner === Number(key));

				if (infos && infos.length) {
					cmd = infos[0].reply;
					owner = Number(key);
				}
			}
		});

		return [cmd, owner];
	}

	marginFreeFromCommentHintDecorations(line: number): boolean {
		const decorations = this.editor.getLineDecorations(line);
		let inCommentingRange = false;
		if (decorations) {
			for (const { options } of decorations) {
				if (options.glyphMarginClassName &&
					options.glyphMarginClassName.indexOf('commenting-range') > -1
				) {
					inCommentingRange = true;
				}
				if (options.glyphMarginClassName &&
					options.glyphMarginClassName.indexOf('review') > -1
				) {
					return false;
				}
			}
		}

		return inCommentingRange;
	}

	setComments(commentInfos: modes.CommentInfo[]): void {
		this._commentInfos = commentInfos;

		this.editor.changeDecorations(accessor => {
			this.commentingRangeDecorationMap.forEach((val, index) => {
				accessor.deltaDecorations(val, []);
				this.commentingRangeDecorationMap.delete(index);
			});

			if (this._commentInfos.length === 0) {
				return;
			}

			commentInfos.forEach(info => {
				let ranges = [];
				if (info.commentingRanges) {
					ranges.push(...info.commentingRanges);
				}

				const commentingRangeDecorations: IModelDeltaDecoration[] = [];

				ranges.forEach(range => {
					commentingRangeDecorations.push({
						options: COMMENTING_RANGE_DECORATION,
						range: range
					});
				});

				let commentingRangeDecorationIds = accessor.deltaDecorations(this.commentingRangeDecorations, commentingRangeDecorations);
				this.commentingRangeDecorationMap.set(info.owner, commentingRangeDecorationIds);
			});
		});

		// create viewzones
		this._zoneWidgets.forEach(zone => {
			zone.dispose();
		});

		this._commentInfos.forEach(info => {
			info.threads.forEach(thread => {
				let zoneWidget = new ReviewZoneWidget(this.editor, info.owner, thread, info.reply, {}, this.themeService, this.commandService);
				zoneWidget.display(thread.range.startLineNumber);
				this._zoneWidgets.push(zoneWidget);
			});
		});
	}


	public closeWidget(): void {
		this._reviewPanelVisible.reset();

		if (this._zoneWidget) {
			this._zoneWidget.dispose();
			this._zoneWidget = null;
		}

		this.editor.focus();
	}
}

registerEditorContribution(ReviewController);


KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'closeReviewPanel',
	weight: KeybindingsRegistry.WEIGHT.editorContrib(),
	primary: KeyCode.Escape,
	secondary: [KeyMod.Shift | KeyCode.Escape],
	when: ctxReviewPanelVisible,
	handler: closeReviewPanel
});

export function getOuterEditor(accessor: ServicesAccessor): ICodeEditor {
	let editor = accessor.get(ICodeEditorService).getFocusedCodeEditor();
	if (editor instanceof EmbeddedCodeEditorWidget) {
		return editor.getParentEditor();
	}
	return editor;
}

function closeReviewPanel(accessor: ServicesAccessor, args: any) {
	var outerEditor = getOuterEditor(accessor);
	if (!outerEditor) {
		return;
	}

	let controller = ReviewController.get(outerEditor);

	if (!controller) {
		return;
	}

	controller.closeWidget();
}


registerThemingParticipant((theme, collector) => {
	let peekViewBackground = theme.getColor(peekViewEditorBackground);
	if (peekViewBackground) {
		collector.addRule(
			`.monaco-editor .review-widget,` +
			`.monaco-editor .review-widget {` +
			`	background-color: ${peekViewBackground};` +
			`}`);
	}

	let monacoEditorBackground = theme.getColor(editorBackground);
	if (monacoEditorBackground) {
		collector.addRule(
			`.monaco-editor .review-widget .body textarea {` +
			`	background-color: ${monacoEditorBackground}` +
			`}` +
			`.monaco-editor .review-widget .body .comment-form .review-thread-reply-button {` +
			`	background-color: ${monacoEditorBackground}` +
			`}`
		);
	}

	let monacoEditorForeground = theme.getColor(editorForeground);
	if (monacoEditorForeground) {
		collector.addRule(
			`.monaco-editor .review-widget .body textarea {` +
			`	color: ${monacoEditorForeground}` +
			`}` +
			`.monaco-editor .review-widget .body .comment-form .review-thread-reply-button {` +
			`	color: ${monacoEditorForeground}` +
			`}`
		);
	}
});
