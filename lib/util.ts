/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as es from 'event-stream';
import debounce = require('debounce');
import * as _filter from 'gulp-filter';
import * as rename from 'gulp-rename';
import * as _ from 'underscore';
import * as path from 'path';
import * as fs from 'fs';
import * as _rimraf from 'rimraf';
import * as git from './git';
import * as VinylFile from 'vinyl';
import { ThroughStream } from 'through';
import * as sm from 'source-map';
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';

export interface ICancellationToken {
	isCancellationRequested(): boolean;
}

const NoCancellationToken: ICancellationToken = { isCancellationRequested: () => false };

export interface IStreamProvider {
	(cancellationToken?: ICancellationToken): NodeJS.ReadWriteStream;
}

export function incremental(streamProvider: IStreamProvider, initial: NodeJS.ReadWriteStream, supportsCancellation?: boolean): NodeJS.ReadWriteStream {
	const input = es.through();
	const output = es.through();
	let state = 'idle';
	let buffer = Object.create(null);

	const token: ICancellationToken | undefined = !supportsCancellation ? undefined : { isCancellationRequested: () => Object.keys(buffer).length > 0 };

	const run = (input: NodeJS.ReadWriteStream, isCancellable: boolean) => {
		state = 'running';

		const stream = !supportsCancellation ? streamProvider() : streamProvider(isCancellable ? token : NoCancellationToken);

		input
			.pipe(stream)
			.pipe(es.through(undefined, () => {
				state = 'idle';
				eventuallyRun();
			}))
			.pipe(output);
	};

	if (initial) {
		run(initial, false);
	}

	const eventuallyRun = debounce(() => {
		const paths = Object.keys(buffer);

		if (paths.length === 0) {
			return;
		}

		const data = paths.map(path => buffer[path]);
		buffer = Object.create(null);
		run(es.readArray(data), true);
	}, 500);

	input.on('data', (f: any) => {
		buffer[f.path] = f;

		if (state === 'idle') {
			eventuallyRun();
		}
	});

	return es.duplex(input, output);
}

export function fixWin32DirectoryPermissions(): NodeJS.ReadWriteStream {
	if (!/win32/.test(process.platform)) {
		return es.through();
	}

	return es.mapSync<VinylFile, VinylFile>(f => {
		if (f.stat && f.stat.isDirectory && f.stat.isDirectory()) {
			f.stat.mode = 16877;
		}

		return f;
	});
}

export function setExecutableBit(pattern?: string | string[]): NodeJS.ReadWriteStream {
	const setBit = es.mapSync<VinylFile, VinylFile>(f => {
		f.stat.mode = /* 100755 */ 33261;
		return f;
	});

	if (!pattern) {
		return setBit;
	}

	const input = es.through();
	const filter = _filter(pattern, { restore: true });
	const output = input
		.pipe(filter)
		.pipe(setBit)
		.pipe(filter.restore);

	return es.duplex(input, output);
}

export function toFileUri(filePath: string): string {
	const match = filePath.match(/^([a-z])\:(.*)$/i);

	if (match) {
		filePath = '/' + match[1].toUpperCase() + ':' + match[2];
	}

	return 'file://' + filePath.replace(/\\/g, '/');
}

export function skipDirectories(): NodeJS.ReadWriteStream {
	return es.mapSync<VinylFile, VinylFile | undefined>(f => {
		if (!f.isDirectory()) {
			return f;
		}
	});
}

export function cleanNodeModule(name: string, excludes: string[], includes?: string[]): NodeJS.ReadWriteStream {
	const toGlob = (path: string) => '**/node_modules/' + name + (path ? '/' + path : '');
	const negate = (str: string) => '!' + str;

	const allFilter = _filter(toGlob('**'), { restore: true });
	const globs = [toGlob('**')].concat(excludes.map(_.compose(negate, toGlob) as (x: string) => string));

	const input = es.through();
	const nodeModuleInput = input.pipe(allFilter);
	let output: NodeJS.ReadWriteStream = nodeModuleInput.pipe(_filter(globs));

	if (includes) {
		const includeGlobs = includes.map(toGlob);
		output = es.merge(output, nodeModuleInput.pipe(_filter(includeGlobs)));
	}

	output = output.pipe(allFilter.restore);
	return es.duplex(input, output);
}

declare class FileSourceMap extends VinylFile {
	public sourceMap: sm.RawSourceMap;
}

export function loadSourcemaps(): NodeJS.ReadWriteStream {
	const input = es.through();

	const output = input
		.pipe(es.map<FileSourceMap, FileSourceMap | undefined>((f, cb): FileSourceMap | undefined => {
			if (f.sourceMap) {
				cb(undefined, f);
				return;
			}

			if (!f.contents) {
				cb(new Error('empty file'));
				return;
			}

			const contents = (<Buffer>f.contents).toString('utf8');

			const reg = /\/\/# sourceMappingURL=(.*)$/g;
			let lastMatch: RegExpMatchArray | null = null;
			let match: RegExpMatchArray | null = null;

			while (match = reg.exec(contents)) {
				lastMatch = match;
			}

			if (!lastMatch) {
				f.sourceMap = {
					version: '3',
					names: [],
					mappings: '',
					sources: [f.relative.replace(/\//g, '/')],
					sourcesContent: [contents]
				};

				cb(undefined, f);
				return;
			}

			f.contents = Buffer.from(contents.replace(/\/\/# sourceMappingURL=(.*)$/g, ''), 'utf8');

			fs.readFile(path.join(path.dirname(f.path), lastMatch[1]), 'utf8', (err, contents) => {
				if (err) { return cb(err); }

				f.sourceMap = JSON.parse(contents);
				cb(undefined, f);
			});
		}));

	return es.duplex(input, output);
}

export function stripSourceMappingURL(): NodeJS.ReadWriteStream {
	const input = es.through();

	const output = input
		.pipe(es.mapSync<VinylFile, VinylFile>(f => {
			const contents = (<Buffer>f.contents).toString('utf8');
			f.contents = Buffer.from(contents.replace(/\n\/\/# sourceMappingURL=(.*)$/gm, ''), 'utf8');
			return f;
		}));

	return es.duplex(input, output);
}

export function rimraf(dir: string): (cb: any) => void {
	let retries = 0;

	const retry = (cb: (err?: any) => void) => {
		_rimraf(dir, { maxBusyTries: 1 }, (err: any) => {
			if (!err) {
				return cb();
			}

			if (err.code === 'ENOTEMPTY' && ++retries < 5) {
				return setTimeout(() => retry(cb), 10);
			}

			return cb(err);
		});
	};
	retry.displayName = `clean-${path.basename(dir)}`;
	return retry;
}

export type PromiseTask = () => Promise<void>;
export type StreamTask = () => NodeJS.ReadWriteStream;
export type CallbackTask = (cb?: (err?: any) => void) => void;
export type Task = PromiseTask | StreamTask | CallbackTask;

export namespace task {

	function _isPromise(p: Promise<void> | NodeJS.ReadWriteStream): p is Promise<void> {
		if (typeof (<any>p).then === 'function') {
			return true;
		}
		return false;
	}

	function _renderTime(time: number): string {
		if (time < 1000) {
			return `${time.toFixed(2)} ms`;
		}
		let seconds = time / 1000;
		if (seconds < 60) {
			return `${seconds.toFixed(1)} s`;
		}
		let minutes = Math.floor(seconds / 60);
		seconds -= minutes * 60;
		return `${minutes} m and ${seconds} s`;
	}

	async function _execute(task: Task): Promise<void> {
		const name = (<any>task).displayName || task.name || `<anonymous>`;
		fancyLog('Starting', ansiColors.cyan(name), '...');
		const startTime = process.hrtime();
		await _doExecute(task);
		const elapsedArr = process.hrtime(startTime);
		const elapsedNanoseconds = (elapsedArr[0] * 1e9 + elapsedArr[1]);
		fancyLog(`Finished`, ansiColors.cyan(name), 'after', ansiColors.green(_renderTime(elapsedNanoseconds / 1e6)));
	}

	async function _doExecute(task: Task): Promise<void> {
		// Always invoke as if it were a callback task
		return new Promise((resolve, reject) => {
			if (task.length === 1) {
				// this is a calback task
				task((err) => {
					if (err) {
						return reject(err);
					}
					resolve();
				});
				return;
			}

			const taskResult = task();

			if (typeof taskResult === 'undefined') {
				// this is a sync task
				resolve();
				return;
			}

			if (_isPromise(taskResult)) {
				// this is a promise returning task
				taskResult.then(resolve, reject);
				return;
			}

			// this is a stream returning task
			taskResult.on('end', _ => resolve());
			taskResult.on('error', err => reject(err));
		});
	}

	export function series(...tasks: Task[]): PromiseTask {
		return async () => {
			for (let i = 0; i < tasks.length; i++) {
				await _execute(tasks[i]);
			}
		};
	}

	export function parallel(...tasks: Task[]): PromiseTask {
		return async () => {
			await Promise.all(tasks.map(t => _execute(t)));
		};
	}
}

export function getVersion(root: string): string | undefined {
	let version = process.env['BUILD_SOURCEVERSION'];

	if (!version || !/^[0-9a-f]{40}$/i.test(version)) {
		version = git.getVersion(root);
	}

	return version;
}

export function rebase(count: number): NodeJS.ReadWriteStream {
	return rename(f => {
		const parts = f.dirname ? f.dirname.split(/[\/\\]/) : [];
		f.dirname = parts.slice(count).join(path.sep);
	});
}

export interface FilterStream extends NodeJS.ReadWriteStream {
	restore: ThroughStream;
}

export function filter(fn: (data: any) => boolean): FilterStream {
	const result = <FilterStream><any>es.through(function (data) {
		if (fn(data)) {
			this.emit('data', data);
		} else {
			result.restore.push(data);
		}
	});

	result.restore = es.through();
	return result;
}

export function versionStringToNumber(versionStr: string) {
	const semverRegex = /(\d+)\.(\d+)\.(\d+)/;
	const match = versionStr.match(semverRegex);
	if (!match) {
		throw new Error('Version string is not properly formatted: ' + versionStr);
	}

	return parseInt(match[1], 10) * 1e4 + parseInt(match[2], 10) * 1e2 + parseInt(match[3], 10);
}
