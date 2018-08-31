/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as es from 'event-stream';
import * as util from 'gulp-util';
import { Stream } from 'stream';
import * as File from 'vinyl';

class Entry {
	constructor(readonly name: string, public totalCount: number, public totalSize: number) { }

	toString(): string {
		return `${this.name}: ${this.totalCount} files with ${this.totalSize} bytes`;
	}
}

const _entries = new Map<string, Entry>();

export function createStatsStream(group: string, stream: Stream, log?: boolean): Stream {

	const entry = new Entry(group, 0, 0);
	_entries.set(entry.name, entry);

	return stream.pipe(es.through(function (data) {
		let file = data as File;
		if (typeof file.path === 'string') {
			entry.totalCount += 1;
			if (typeof file.stat === 'object' && typeof file.stat.size === 'number') {
				entry.totalSize += file.stat.size;
				// } else {
				// 	console.warn(`${file.path} looks like a file but has no stat`);
			}
		}
		this.emit('data', data);
	}, () => {
		if (log) {
			let count = entry.totalCount < 100
				? util.colors.green(entry.totalCount.toString())
				: util.colors.red(entry.totalCount.toString());

			util.log(`Stats for ${group}: ${count} files with approx. ${Math.round(entry.totalSize / 1204)}KB`);
		}
	}));
}
