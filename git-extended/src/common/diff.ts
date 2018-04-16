/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { getFileContent, writeTmpFile } from './file';
import { GitChangeType, RichFileChange } from './models/file';
import { Repository } from './models/repository';
import { Comment } from './models/comment';

export const MODIFY_DIFF_INFO = /diff --git a\/(\S+) b\/(\S+).*\n*index.*\n*-{3}.*\n*\+{3}.*\n*((.*\n*)+)/;
export const NEW_FILE_INFO = /diff --git a\/(\S+) b\/(\S+).*\n*new file mode .*\nindex.*\n*-{3}.*\n*\+{3}.*\n*((.*\n*)+)/;
export const DELETE_FILE_INFO = /diff --git a\/(\S+) b\/(\S+).*\n*deleted file mode .*\nindex.*\n*-{3}.*\n*\+{3}.*\n*((.*\n*)+)/;
export const DIFF_HUNK_INFO = /@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@/;


async function parseModifiedHunkComplete(originalContent, patch, a, b) {
	let left = originalContent.split(/\r|\n|\r\n/);
	let diffHunks = patch.split('\n');
	diffHunks.pop(); // there is one additional line break at the end of the diff ??

	let right = [];
	let lastCommonLine = 0;
	for (let i = 0; i < diffHunks.length; i++) {
		let line = diffHunks[i];
		if (DIFF_HUNK_INFO.test(line)) {
			let changeInfo = DIFF_HUNK_INFO.exec(line);
			let oriStartLine = Number(changeInfo[1]);
			let oriEndLine = Number(changeInfo[3]) | 0;

			for (let j = lastCommonLine + 1; j < oriStartLine; j++) {
				right.push(left[j - 1]);
			}
			lastCommonLine = oriStartLine + oriEndLine - 1;
		} else if (/^\-/.test(line)) {
			// do nothing
		} else if (/^\+/.test(line)) {
			right.push(line.substr(1));
		} else {
			let codeInFirstLine = line.substr(1);
			right.push(codeInFirstLine);
		}
	}

	if (lastCommonLine < left.length) {
		for (let j = lastCommonLine + 1; j <= left.length; j++) {
			right.push(left[j - 1]);
		}
	}

	let contentPath = await writeTmpFile(right.join('\n'), path.extname(b));
	let originalContentPath = await writeTmpFile(left.join('\n'), path.extname(a));

	return new RichFileChange(contentPath, originalContentPath, GitChangeType.MODIFY, b, patch);
}

async function parseModifiedHunkFast(modifyDiffInfo, a, b) {
	let left = [];
	let right = [];

	let diffHunks = modifyDiffInfo.split('\n');
	diffHunks.pop(); // there is one additional line break at the end of the diff ??

	for (let i = 0; i < diffHunks.length; i++) {
		let line = diffHunks[i];
		if (/@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@/.test(line)) {
			// let changeInfo = /@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@/.exec(line);
			left.push(line);
			right.push(line);
		} else if (/^\-/.test(line)) {
			left.push(line.substr(1));
		} else if (/^\+/.test(line)) {
			right.push(line.substr(1));
		} else {
			let codeInFirstLine = line.substr(1);
			left.push(codeInFirstLine);
			right.push(codeInFirstLine);
		}
	}

	let contentPath = await writeTmpFile(right.join('\n'), path.extname(b));
	let originalContentPath = await writeTmpFile(left.join('\n'), path.extname(a));

	return new RichFileChange(contentPath, originalContentPath, GitChangeType.MODIFY, b, modifyDiffInfo);
}

export async function parseDiff(reviews: any[], repository: Repository, parentCommit: string): Promise<RichFileChange[]> {
	let richFileChanges: RichFileChange[] = [];
	for (let i = 0; i < reviews.length; i++) {
		let review = reviews[i];
		if (review.status === 'modified') {
			let fileName = review.filename;

			try {
				let originalContent = await getFileContent(repository.path, parentCommit, fileName);
				let richFileChange = await parseModifiedHunkComplete(originalContent, review.patch, fileName, fileName);
				richFileChanges.push(richFileChange);
			} catch (e) {
				let richFileChange = await parseModifiedHunkFast(review.patch, fileName, fileName);
				richFileChanges.push(richFileChange);
			}
		} else if (review.status === 'removed') {
			let fileName = review.filename;
			let diffHunks = review.patch.split('\n');
			let contentArray = [];
			for (let i = 0; i < diffHunks.length; i++) {
				if (/@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@$/.test(diffHunks[i])) {
					continue;
				} else if (/@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@ /.test(diffHunks[i])) {
					contentArray.push(diffHunks[i].replace(/@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@ /, ''));
				} else if (/^\-/.test(diffHunks[i])) {
					contentArray.push(diffHunks[i].substr(1));
				}
			}
			let originalFilePath = await writeTmpFile(contentArray.join('\n'), path.extname(fileName));
			let filePath = await writeTmpFile('', path.extname(fileName));
			let richFileChange = new RichFileChange(filePath, originalFilePath, GitChangeType.DELETE, fileName, review.patch);
			richFileChanges.push(richFileChange);
		} else {
			// added
			let fileName = review.filename;
			let diffHunks = review.patch.split('\n');
			let contentArray = [];
			for (let i = 0; i < diffHunks.length; i++) {
				if (/@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@$/.test(diffHunks[i])) {
					continue;
				} else if (/@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@ /.test(diffHunks[i])) {
					contentArray.push(diffHunks[i].replace(/@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@ /, ''));
				} else if (/^\+/.test(diffHunks[i])) {
					contentArray.push(diffHunks[i].substr(1));
				}
			}
			let oriFilePath = await writeTmpFile('', path.extname(fileName));
			let filePath = await writeTmpFile(contentArray.join('\n'), path.extname(fileName));
			let richFileChange = new RichFileChange(filePath, oriFilePath, GitChangeType.ADD, fileName, review.patch);
			richFileChanges.push(richFileChange);
		}
	}
	return richFileChanges;
}

export function mapCommentsToHead(patches: string, comments: Comment[]) {
	let regex = new RegExp(DIFF_HUNK_INFO, 'g');
	let matches = regex.exec(patches);

	let rangeMapping = [];
	const diffHunkContext = 3;
	while (matches) {
		let oriStartLine = Number(matches[1]);
		let oriLen = Number(matches[3]) | 0;
		let newStartLine = Number(matches[5]);
		let newLen = Number(matches[7]) | 0;

		rangeMapping.push({
			oriStart: oriStartLine + diffHunkContext,
			oriLen: oriLen - diffHunkContext * 2,
			newStart: newStartLine + diffHunkContext,
			newLen: newLen - diffHunkContext * 2
		});
		matches = regex.exec(patches);
	}

	for (let i = 0; i < comments.length; i++) {
		let comment = comments[i];
		let commentPosition = comment.diff_hunk_range.start + comment.position - 1;
		let delta = 0;
		for (let j = 0; j < rangeMapping.length; j++) {
			let map = rangeMapping[j];
			if (map.oriStart + map.oriLen - 1 < commentPosition) {
				delta += map.newLen - map.oriLen;
			} else if (map.oriStart > commentPosition) {
				continue;
			} else {
				break;
			}
		}

		comment.currentPosition = commentPosition + delta;
	}

	return comments;
}