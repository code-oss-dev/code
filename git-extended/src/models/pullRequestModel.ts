/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Remote } from './remote';
import { parseComments } from '../common/comment';
import { Comment } from './comment';
import { GitHubRef } from './githubRef';
import { TimelineEvent, parseTimelineEvents } from './timelineEvent';

export enum PRType {
	RequestReview = 0,
	ReviewedByMe = 1,
	Mine = 2,
	Mention = 3,
	All = 4,
	LocalPullRequest = 5
}

export enum PullRequestStateEnum {
	Open,
	Merged,
	Closed,
}

export interface IAccount {
	login: string;
	isUser: boolean;
	isEnterprise: boolean;
	avatarUrl: string;
	htmlUrl: string;
	ownedPrivateRepositoryCount?: number;
	privateRepositoryInPlanCount?: number;
}

export interface Repo {
	label: string;
	ref: string;
	repo: any;
	sha: string;
}

// This interface is incomplete
export interface PullRequest {
	additions: number;
	assignee: any;
	assignees: any[];
	author_association: string;
	base: Repo;
	body: string;
	changed_files: number;
	closed_at: string;
	comments: number;
	commits: number;
	created_at: string;
	head: Repo;
	html_url: string;
	id: number;
	labels: any[];
	locked: boolean;
	maintainer_can_modify: boolean;
	merge_commit_sha; boolean;
	mergable: boolean;
	number: number;
	rebaseable: boolean;
	state: string;
	title: string;
	updated_at: string;
	user: any;
}

export class PullRequestModel {
	public prNumber: number;
	public title: string;
	public html_url: string;
	public state: PullRequestStateEnum = PullRequestStateEnum.Open;
	public commentCount: number;
	public commitCount: number;
	public author: IAccount;
	public assignee: IAccount;
	public createdAt: string;
	public updatedAt: string;

	public get isOpen(): boolean {
		return this.state === PullRequestStateEnum.Open;
	}
	public get isMerged(): boolean {
		return this.state === PullRequestStateEnum.Merged;
	}

	public head: GitHubRef;
	public base: GitHubRef;

	constructor(public readonly otcokit: any, public readonly remote: Remote, public prItem: PullRequest) {
		this.update(prItem);
	}

	update(prItem: PullRequest) {
		this.prNumber = prItem.number;
		this.title = prItem.title;
		this.html_url = prItem.html_url;
		this.author = {
			login: prItem.user.login,
			isUser: prItem.user.type === 'User',
			isEnterprise: prItem.user.type === 'Enterprise',
			avatarUrl: prItem.user.avatar_url,
			htmlUrl: prItem.user.html_url
		};
		switch (prItem.state) {
			case 'open':
				this.state = PullRequestStateEnum.Open;
				break;
			case 'merged':
				this.state = PullRequestStateEnum.Merged;
				break;
			case 'closed':
				this.state = PullRequestStateEnum.Closed;
				break;
		}
		if (prItem.assignee) {
			this.assignee = {
				login: prItem.assignee.login,
				isUser: prItem.assignee.type === 'User',
				isEnterprise: prItem.assignee.type === 'Enterprise',
				avatarUrl: prItem.assignee.avatar_url,
				htmlUrl: prItem.assignee.html_url
			};
		}

		this.createdAt = prItem.created_at;
		this.updatedAt = prItem.updated_at ? prItem.updated_at : this.createdAt;
		this.commentCount = prItem.comments;
		this.commitCount = prItem.commits;

		this.head = new GitHubRef(prItem.head.ref, prItem.head.label, prItem.head.sha, prItem.head.repo.clone_url);
		this.base = new GitHubRef(prItem.base.ref, prItem.base.label, prItem.base.sha, prItem.base.repo.clone_url);
	}

	async getFiles() {
		const { data } = await this.otcokit.pullRequests.getFiles({
			owner: this.remote.owner,
			repo: this.remote.repositoryName,
			number: this.prItem.number
		});

		return data;
	}

	async fetchBaseCommitSha() {
		if (!this.prItem.base) {
			// this one is from search results, which is not complete.
			const { data } = await this.otcokit.pullRequests.get({
				owner: this.remote.owner,
				repo: this.remote.repositoryName,
				number: this.prItem.number
			});
			this.update(data);
		}
	}

	async getReviewComments(reviewId: string): Promise<Comment[]> {
		const reviewData = await this.otcokit.pullRequests.getReviewComments({
			owner: this.remote.owner,
			repo: this.remote.repositoryName,
			number: this.prItem.number,
			id: reviewId
		});

		const rawComments = reviewData.data;
		return parseComments(rawComments);
	}

	async getComments(): Promise<Comment[]> {
		const reviewData = await this.otcokit.pullRequests.getComments({
			owner: this.remote.owner,
			repo: this.remote.repositoryName,
			number: this.prItem.number,
			per_page: 100
		});
		const rawComments = reviewData.data;
		return parseComments(rawComments);
	}

	async getTimelineEvents(): Promise<TimelineEvent[]> {
		let ret = await this.otcokit.issues.getEventsTimeline({
			owner: this.remote.owner,
			repo: this.remote.repositoryName,
			issue_number: this.prItem.number,
			number: this.prItem.number,
			per_page: 100
		});

		return await parseTimelineEvents(this, ret.data);
	}

	async getDiscussionComments(): Promise<Comment[]> {
		const promise = await this.otcokit.issues.getComments({
			owner: this.remote.owner,
			repo: this.remote.repositoryName,
			number: this.prItem.number,
			per_page: 100
		});

		return promise.data;
	}

	async createDiscussionComment(text: string): Promise<Comment> {
		const promise = await this.otcokit.issues.createComment({
			body: text,
			number: this.prNumber,
			owner: this.remote.owner,
			repo: this.remote.repositoryName
		});

		return promise.data;
	}

	async createCommentReply(body: string, reply_to: string) {
		let ret = await this.otcokit.pullRequests.createCommentReply({
			owner: this.remote.owner,
			repo: this.remote.repositoryName,
			number: this.prItem.number,
			body: body,
			in_reply_to: reply_to
		});

		return ret;
	}

	async createComment(body: string, path: string, position: number) {
		let ret = await this.otcokit.pullRequests.createComment({
			owner: this.remote.owner,
			repo: this.remote.repositoryName,
			number: this.prItem.number,
			body: body,
			commit_id: this.prItem.head.sha,
			path: path,
			position: position
		});

		return ret;
	}

	getUserGravatar(): string {
		return this.prItem.user.avatar_url;
	}

	async close() {
		let ret = await this.otcokit.pullRequests.update({
			owner: this.remote.owner,
			repo: this.remote.repositoryName,
			number: this.prItem.number,
			state: 'closed'
		});

		return ret.data;
	}

	equals(other: PullRequestModel): boolean {
		if (!other) {
			return false;
		}

		if (this.prNumber !== other.prNumber) {
			return false;
		}

		if (this.html_url !== other.html_url) {
			return false;
		}

		return true;
	}
}
