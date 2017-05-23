/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { MergeConflictParser } from './mergeConflictParser';
import * as interfaces from './interfaces';
import { Delayer } from './delayer';

class ScanTask {
	public origins: Set<string> = new Set<string>();
	public delayTask: Delayer<interfaces.IDocumentMergeConflict[]>;

	constructor(delayTime: number, initialOrigin: string) {
		this.origins.add(initialOrigin);
		this.delayTask = new Delayer<interfaces.IDocumentMergeConflict[]>(delayTime);
	}

	public addOrigin(name: string): boolean {
		if (this.origins.has(name)) {
			return false;
		}

		return false;
	}

	public hasOrigin(name: string): boolean {
		return this.origins.has(name);
	}
}

class OriginDocumentMergeConflictTracker implements interfaces.IDocumentMergeConflictTracker {
	constructor(private parent: DocumentMergeConflictTracker, private origin: string) {
	}

	getConflicts(document: vscode.TextDocument): PromiseLike<interfaces.IDocumentMergeConflict[]> {
		return this.parent.getConflicts(document, this.origin);
	}

	isPending(document: vscode.TextDocument): boolean {
		return this.parent.isPending(document, this.origin);
	}

	forget(document: vscode.TextDocument) {
		this.parent.forget(document);
	}
}

export default class DocumentMergeConflictTracker implements vscode.Disposable, interfaces.IDocumentMergeConflictTrackerService {
	private cache: Map<string, ScanTask> = new Map();
	private delayExpireTime: number = 300;

	getConflicts(document: vscode.TextDocument, origin: string): PromiseLike<interfaces.IDocumentMergeConflict[]> {
		// Attempt from cache

		let key = this.getCacheKey(document);

		if (!key) {
			// Document doesnt have a uri, can't cache it, so return
			return Promise.resolve(this.getConflictsOrEmpty(document, [origin]));
		}

		let cacheItem = this.cache.get(key);
		if (!cacheItem) {
			cacheItem = new ScanTask(this.delayExpireTime, origin);
			this.cache.set(key, cacheItem);
		}
		else {
			cacheItem.addOrigin(origin);
		}

		return cacheItem.delayTask.trigger(() => {
			let conflicts = this.getConflictsOrEmpty(document, Array.from(cacheItem!.origins));

			if (this.cache) {
				this.cache.delete(key!);
			}

			return conflicts;
		});
	}

	isPending(document: vscode.TextDocument, origin: string): boolean {
		if (!document) {
			return false;
		}

		let key = this.getCacheKey(document);
		if (!key) {
			return false;
		}

		var task = this.cache.get(key);

		if (!task) {
			return false;
		}

		return task.hasOrigin(origin);
	}

	createTracker(origin: string): interfaces.IDocumentMergeConflictTracker {
		return new OriginDocumentMergeConflictTracker(this, origin);
	}

	forget(document: vscode.TextDocument) {
		let key = this.getCacheKey(document);

		if (key) {
			this.cache.delete(key);
		}
	}

	dispose() {
		this.cache.clear();
	}

	private getConflictsOrEmpty(document: vscode.TextDocument, origins: string[]): interfaces.IDocumentMergeConflict[] {
		let stepStart = process.hrtime();
		const containsConflict = MergeConflictParser.containsConflict(document);
		let stepEnd = process.hrtime(stepStart);

		console.info('[%s] %s -> Check document execution time: %dms', origins.join(', '), document.uri.toString(), stepEnd[1] / 1000000);

		if (!containsConflict) {
			return [];
		}

		stepStart = process.hrtime();
		const conflicts = MergeConflictParser.scanDocument(document);
		stepEnd = process.hrtime(stepStart);

		console.info('[%s] %s -> Find conflict regions execution time: %dms', origins.join(', '), document.uri.toString(), stepEnd[1] / 1000000);

		return conflicts;
	}

	private getCacheKey(document: vscode.TextDocument): string | null {
		if (document.uri && document.uri) {
			return document.uri.toString();
		}

		return null;
	}
}

