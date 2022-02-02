/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { UriComponents, URI } from 'vs/base/common/uri';
import { IRequestHandler } from 'vs/base/common/worker/simpleWorker';
import { ILocalFileSearchSimpleWorker, ILocalFileSearchSimpleWorkerHost, ISearchWorkerFileSystemDirectoryHandle, ISearchWorkerFileSystemFileHandle, IWorkerFileSearchComplete, IWorkerTextSearchComplete, SearchWorkerFileSystemHandle } from 'vs/workbench/services/search/common/localFileSearchWorkerTypes';
import { ICommonQueryProps, IFileMatch, IFileQueryProps, IFolderQuery, IPatternInfo, ITextQueryProps, } from 'vs/workbench/services/search/common/search';
import * as extpath from 'vs/base/common/extpath';
import * as paths from 'vs/base/common/path';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { getFileResults } from 'vs/workbench/services/search/common/getFileResults';
import { IgnoreFile } from 'vs/workbench/services/search/common/ignoreFile';
import { createRegExp } from 'vs/base/common/strings';
import { Promises } from 'vs/base/common/async';

const PERF = false;

type FileNode = {
	type: 'file';
	name: string;
	path: string;
	resolve: () => Promise<ArrayBuffer>;
};

type DirNode = {
	type: 'dir';
	name: string;
	entries: Promise<(DirNode | FileNode)[]>;
};

const globalStart = +new Date();
const itrcount: Record<string, number> = {};
const time = async <T>(name: string, task: () => Promise<T> | T) => {
	if (!PERF) { return task(); }

	const start = Date.now();
	const itr = (itrcount[name] ?? 0) + 1;
	console.info(name, itr, 'starting', Math.round((start - globalStart) * 10) / 10000);

	itrcount[name] = itr;
	const r = await task();
	const end = Date.now();
	console.info(name, itr, 'took', end - start);
	return r;
};

/**
 * Called on the worker side
 * @internal
 */
export function create(host: ILocalFileSearchSimpleWorkerHost): IRequestHandler {
	return new LocalFileSearchSimpleWorker(host);
}

export class LocalFileSearchSimpleWorker implements ILocalFileSearchSimpleWorker, IRequestHandler {
	_requestHandlerBrand: any;

	cancellationTokens: Map<number, CancellationTokenSource> = new Map();

	constructor(private host: ILocalFileSearchSimpleWorkerHost) { }

	cancelQuery(queryId: number): void {
		this.cancellationTokens.get(queryId)?.cancel();
	}

	private registerCancellationToken(queryId: number): CancellationTokenSource {
		const source = new CancellationTokenSource();
		this.cancellationTokens.set(queryId, source);
		return source;
	}

	async listDirectory(handle: ISearchWorkerFileSystemDirectoryHandle, query: IFileQueryProps<UriComponents>, folderQuery: IFolderQuery<UriComponents>, queryId: number): Promise<IWorkerFileSearchComplete> {
		const token = this.registerCancellationToken(queryId);
		const entries: string[] = [];
		let limitHit = false;
		let count = 0;

		const max = query.maxResults || 512;

		const filePatternMatcher = query.filePattern
			? (name: string) => query.filePattern!.split('').every(c => name.includes(c))
			: (name: string) => true;

		await time('listDirectory', () => this.walkFolderQuery(handle, query, folderQuery, file => {
			if (!filePatternMatcher(file.name)) {
				return;
			}

			count++;

			if (max && count > max) {
				limitHit = true;
				token.cancel();
			}
			return entries.push(file.path);
		}, token.token));

		return {
			results: entries,
			limitHit
		};
	}

	async searchDirectory(handle: ISearchWorkerFileSystemDirectoryHandle, query: ITextQueryProps<UriComponents>, folderQuery: IFolderQuery<UriComponents>, queryId: number): Promise<IWorkerTextSearchComplete> {
		return time('searchInFiles', async () => {
			const token = this.registerCancellationToken(queryId);

			const results: IFileMatch[] = [];

			const pattern = createSearchRegExp(query.contentPattern);

			const onGoingProcesses: Promise<void>[] = [];

			let fileCount = 0;
			let resultCount = 0;
			let limitHit = false;

			const processFile = async (file: FileNode) => {
				if (token.token.isCancellationRequested) {
					return;
				}

				fileCount++;

				const contents = await file.resolve();
				if (token.token.isCancellationRequested) {
					return;
				}

				const bytes = new Uint8Array(contents);
				const fileResults = getFileResults(bytes, pattern, {
					afterContext: query.afterContext ?? 0,
					beforeContext: query.beforeContext ?? 0,
					previewOptions: query.previewOptions,
					remainingResultQuota: query.maxResults ? (query.maxResults - resultCount) : 10000,
				});

				if (fileResults.length) {
					resultCount += fileResults.length;
					if (query.maxResults && resultCount > query.maxResults) {
						token.cancel();
					}
					const match = {
						resource: URI.joinPath(URI.revive(folderQuery.folder), file.path),
						results: fileResults,
					};
					this.host.sendTextSearchMatch(match, queryId);
					results.push(match);
				}
			};

			await time('walkFolderToResolve', () =>
				this.walkFolderQuery(handle, query, folderQuery, async file => onGoingProcesses.push(processFile(file)), token.token)
			);

			await time('resolveOngoingProcesses', () => Promise.all(onGoingProcesses));

			if (PERF) { console.log('Searched in', fileCount, 'files'); }

			return {
				results,
				limitHit,
			};
		});

	}

	private async walkFolderQuery(handle: ISearchWorkerFileSystemDirectoryHandle, queryProps: ICommonQueryProps<UriComponents>, folderQuery: IFolderQuery<UriComponents>, onFile: (file: FileNode) => any, token: CancellationToken): Promise<void> {

		const folderExcludes = glob.parse(folderQuery.excludePattern ?? {}, { trimForExclusions: true }) as glob.ParsedExpression;

		// For folders, only check if the folder is explicitly excluded so walking continues.
		const isFolderExcluded = (path: string, basename: string, hasSibling: (query: string) => boolean) => {
			path = path.slice(1);
			if (folderExcludes(path, basename, hasSibling)) { return true; }
			if (pathExcludedInQuery(queryProps, path)) { return true; }
			return false;
		};

		// For files ensure the full check takes place.
		const isFileIncluded = (path: string, basename: string, hasSibling: (query: string) => boolean) => {
			path = path.slice(1);
			if (folderExcludes(path, basename, hasSibling)) { return false; }
			if (!pathIncludedInQuery(queryProps, path)) { return false; }
			return true;
		};

		const processFile = (file: ISearchWorkerFileSystemFileHandle, prior: string): FileNode => {

			const resolved: FileNode = {
				type: 'file',
				name: file.name,
				path: prior,
				resolve: () => file.getFile().then(r => r.arrayBuffer())
			} as const;

			return resolved;
		};


		const processDirectory = async (directory: ISearchWorkerFileSystemDirectoryHandle, prior: string, ignoreFile?: IgnoreFile): Promise<DirNode> => {

			if (!folderQuery.disregardIgnoreFiles) {
				const ignoreFiles = await Promise.all([
					directory.getFileHandle('.gitignore').catch(e => undefined),
					directory.getFileHandle('.ignore').catch(e => undefined),
				]);

				await Promise.all(ignoreFiles.map(async file => {
					if (!file) { return; }

					const ignoreContents = new TextDecoder('utf8').decode(new Uint8Array(await (await file.getFile()).arrayBuffer()));
					ignoreFile = new IgnoreFile(ignoreContents, prior, ignoreFile);
				}));
			}

			const entries = Promises.withAsyncBody<(FileNode | DirNode)[]>(async c => {
				const files: FileNode[] = [];
				const dirs: Promise<DirNode>[] = [];

				const entries: [string, SearchWorkerFileSystemHandle][] = [];
				const sibilings = new Set<string>();

				for await (const entry of directory.entries()) {
					entries.push(entry);
					sibilings.add(entry[0]);
				}

				for (const [basename, handle] of entries) {
					if (token.isCancellationRequested) {
						break;
					}

					const path = prior + basename;

					if (ignoreFile && !ignoreFile.isPathIncludedInTraversal(path, handle.kind === 'directory')) {
						continue;
					}

					const hasSibling = (query: string) => sibilings.has(query);

					if (handle.kind === 'directory' && !isFolderExcluded(path, basename, hasSibling)) {
						dirs.push(processDirectory(handle, path + '/', ignoreFile));
					} else if (handle.kind === 'file' && isFileIncluded(path, basename, hasSibling)) {
						files.push(processFile(handle, path));
					}
				}
				c([...await Promise.all(dirs), ...files]);
			});

			return {
				type: 'dir',
				name: directory.name,
				entries
			};
		};

		const resolveDirectory = async (directory: DirNode, onFile: (f: FileNode) => any) => {
			if (token.isCancellationRequested) { return; }

			await Promise.all(
				(await directory.entries)
					.sort((a, b) => -(a.type === 'dir' ? 0 : 1) + (b.type === 'dir' ? 0 : 1))
					.map(async entry => {
						if (entry.type === 'dir') {
							return resolveDirectory(entry, onFile);
						}
						else {
							return onFile(entry);
						}
					}));
		};

		const processed = await time('process', () => processDirectory(handle, '/'));
		await time('resolve', () => resolveDirectory(processed, onFile));
	}
}

function createSearchRegExp(options: IPatternInfo): RegExp {
	return createRegExp(options.pattern, !!options.isRegExp, {
		wholeWord: options.isWordMatch,
		global: true,
		matchCase: options.isCaseSensitive,
		multiline: true,
		unicode: true,
	});
}


function pathExcludedInQuery(queryProps: ICommonQueryProps<UriComponents>, fsPath: string): boolean {
	if (queryProps.excludePattern && glob.match(queryProps.excludePattern, fsPath)) {
		return true;
	}

	return false;
}

function pathIncludedInQuery(queryProps: ICommonQueryProps<UriComponents>, fsPath: string): boolean {
	if (queryProps.excludePattern && glob.match(queryProps.excludePattern, fsPath)) {
		return false;
	}

	if (queryProps.includePattern || queryProps.usingSearchPaths) {
		if (queryProps.includePattern && glob.match(queryProps.includePattern, fsPath)) {
			return true;
		}

		// If searchPaths are being used, the extra file must be in a subfolder and match the pattern, if present
		if (queryProps.usingSearchPaths) {
			return !!queryProps.folderQueries && queryProps.folderQueries.some(fq => {
				const searchPath = fq.folder.path;
				if (extpath.isEqualOrParent(fsPath, searchPath)) {
					const relPath = paths.relative(searchPath, fsPath);
					return !fq.includePattern || !!glob.match(fq.includePattern, relPath);
				} else {
					return false;
				}
			});
		}

		return false;
	}

	return true;
}
