/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as moment from 'moment';
import md from './mdRenderer';


export enum DiffChangeType {
	Context,
	Add,
	Delete,
	Control
}

export class DiffLine {
	public get raw(): string {
		return this._raw;
	}

	public get text(): string {
		return this._raw.substr(1);
	}

	public endwithLineBreak: boolean = true;

	constructor(
		public type: DiffChangeType,
		public oldLineNumber: number, /* 1 based */
		public newLineNumber: number, /* 1 based */
		public positionInHunk: number,
		private _raw: string
	) { }
}

export function getDiffChangeType(text: string) {
	let c = text[0];
	switch (c) {
		case ' ': return DiffChangeType.Context;
		case '+': return DiffChangeType.Add;
		case '-': return DiffChangeType.Delete;
		default: return DiffChangeType.Control;
	}
}

export class DiffHunk {
	public diffLines: DiffLine[] = [];

	constructor(
		public oldLineNumber: number,
		public oldLength: number,
		public newLineNumber: number,
		public newLength: number,
		public positionInHunk: number
	) { }
}
export interface Comment {
	url: string;
	id: string;
	path: string;
	pull_request_review_id: string;
	diff_hunk: string;
	diff_hunks: DiffHunk[];
	position: number;
	original_position: number;
	commit_id: string;
	original_commit_id: string;
	user: User;
	body: string;
	created_at: string;
	updated_at: string;
	html_url: string;
	absolutePosition?: number;
}


export enum EventType {
	Committed,
	Mentioned,
	Subscribed,
	Commented,
	Reviewed,
	Other
}

export interface Author {
	name: string;
	email: string;
	date: Date;
}

export interface Committer {
	name: string;
	email: string;
	date: Date;
}

export interface Tree {
	sha: string;
	url: string;
}

export interface Parent {
	sha: string;
	url: string;
	html_url: string;
}

export interface Verification {
	verified: boolean;
	reason: string;
	signature?: any;
	payload?: any;
}

export interface User {
	login: string;
	id: number;
	avatar_url: string;
	gravatar_id: string;
	url: string;
	html_url: string;
	followers_url: string;
	following_url: string;
	gists_url: string;
	starred_url: string;
	subscriptions_url: string;
	organizations_url: string;
	repos_url: string;
	events_url: string;
	received_events_url: string;
	type: string;
	site_admin: boolean;
}

export interface Html {
	href: string;
}

export interface PullRequest {
	href: string;
}

export interface Links {
	html: Html;
	pull_request: PullRequest;
}

export interface MentionEvent {
	id: number;
	url: string;
	actor: User;
	event: EventType;
	commit_id: string;
	commit_url: string;
	created_at: Date;
}

export interface SubscribeEvent {
	id: number;
	url: string;
	actor: User;
	event: EventType;
	commit_id: string;
	commit_url: string;
	created_at: Date;
}

export interface CommentEvent {
	url: string;
	html_url: string;
	author: Author;
	user: User;
	created_at: Date;
	updated_at: Date;
	id: number;
	event: EventType;
	actor: User;
	author_association: string;
	body: string;
}

export interface ReviewEvent {
	id: number;
	user: User;
	body: string;
	commit_id: string;
	submitted_at: Date;
	state: string;
	html_url: string;
	pull_request_url: string;
	author_association: string;
	_links: Links;
	event: EventType;
	comments: Comment[];
}

export interface CommitEvent {
	sha: string;
	url: string;
	html_url: string;
	author: Author;
	committer: Committer;
	tree: Tree;
	message: string;
	parents: Parent[];
	verification: Verification;
	event: EventType;
}

export enum PullRequestStateEnum {
	Open,
	Merged,
	Closed,
}

export type TimelineEvent = CommitEvent | ReviewEvent | SubscribeEvent | CommentEvent | MentionEvent;

export function renderCommentBody(comment: Comment): string {
	return `
			<div class="comment-body">
				${md.render(comment.body)}
			</div>`;
}


export function renderComment(comment: CommentEvent): string {
	return `<div class="comment-container">

	<div class="review-comment" role="treeitem">
		<div class="review-comment-contents">
			<div class="review-comment-header">
				<div class="avatar-container">
					<img class="avatar" src="${comment.user.avatar_url}">
				</div>
				<strong class="author"><a href="${comment.user.html_url}">${comment.user.login}</a></strong>
				<div class="timestamp">${moment(comment.created_at).fromNow()}</div>
			</div>
			<div class="comment-body">
				${md.render(comment.body)}
			</div>
		</div>
	</div>
</div>`;
}

export function renderCommit(timelineEvent: CommitEvent): string {
	return `<div class="comment-container">

	<div class="review-comment" role="treeitem">
		<div class="review-comment-contents">
			<div class="commit">
				<strong>${timelineEvent.author.name} commit: <a href="${timelineEvent.html_url}">${timelineEvent.message} (${timelineEvent.sha})</a></strong>
			</div>
		</div>
	</div>
</div>`;
}

function getDiffChangeClass(type: DiffChangeType) {
	switch (type) {
		case DiffChangeType.Add:
			return 'add';
		case DiffChangeType.Delete:
			return 'delete';
		case DiffChangeType.Context:
			return 'context';
		case DiffChangeType.Context:
			return 'context';
		default:
			return 'control';
	}
}

export function renderReview(timelineEvent: ReviewEvent): string {
	let comments = timelineEvent.comments;
	let avatar = '';
	let diffView = '';
	let diffLines = [];
	if (comments && comments.length) {
		avatar = `<div class="avatar-container">
			<img class="avatar" src="${timelineEvent.comments[0].user.avatar_url}">
		</div>`;
		for (let i = 0; i < comments[0].diff_hunks.length; i++) {
			diffLines.push(comments[0].diff_hunks[i].diffLines.slice(-4).map(diffLine => `<div class="diffLine ${getDiffChangeClass(diffLine.type)}">
				<span class="lineNumber old">${diffLine.oldLineNumber > 0 ? diffLine.oldLineNumber : ' '}</span>
				<span class="lineNumber new">${diffLine.newLineNumber > 0 ? diffLine.newLineNumber : ' '}</span>
				<span class="lineContent">${(diffLine as any)._raw}</span>
				</div>`).join(''));
		}

		diffView = `<div class="diff">
			<div class="diffHeader">${comments[0].path}</div>
			${diffLines.join('')}
		</div>`;
	}
	return `<div class="comment-container">

	<div class="review-comment" role="treeitem">
		<div class="review-comment-contents">
			<div class="review-comment-header">
				${avatar}
				<strong class="author">${timelineEvent.user.login} left a <a href="${timelineEvent.html_url}">review </a></strong><span></span>
				<div class="timestamp">${moment(timelineEvent.submitted_at).fromNow()}</div>
			</div>
			${diffView}
			<div>${ timelineEvent.comments && timelineEvent.comments.length ? timelineEvent.comments.map(comment => renderCommentBody(comment)) : ''}</div>
		</div>
	</div>
</div>`;
}

export function renderTimelineEvent(timelineEvent: TimelineEvent): string {
	switch (timelineEvent.event) {
		case EventType.Committed:
			return renderCommit((<CommitEvent>timelineEvent));
		case EventType.Commented:
			return renderComment((<CommentEvent>timelineEvent));
		case EventType.Reviewed:
			return renderReview((<ReviewEvent>timelineEvent));
	}
	return '';
}

export function getStatusBGCoor(state: PullRequestStateEnum) {
	if (state === PullRequestStateEnum.Merged) {
		return '#6f42c1';
	} else if (state === PullRequestStateEnum.Open) {
		return '#2cbe4e';
	} else {
		return '#cb2431';
	}
}

export function getStatus(state: PullRequestStateEnum) {
	if (state === PullRequestStateEnum.Merged) {
		return 'Merged';
	} else if (state === PullRequestStateEnum.Open) {
		return 'Open';
	} else {
		return 'Closed';
	}
}