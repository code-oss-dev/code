/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as uuid from 'vs/base/common/uuid';
import * as strings from 'vs/base/common/strings';
import * as platform from 'vs/base/common/platform';
import * as flow from 'vs/base/node/flow';

import * as fs from 'fs';
import * as paths from 'path';
import { TPromise } from 'vs/base/common/winjs.base';
import { nfcall } from 'vs/base/common/async';

const loop = flow.loop;

export function readdirSync(path: string): string[] {
	// Mac: uses NFD unicode form on disk, but we want NFC
	// See also https://github.com/nodejs/node/issues/2165
	if (platform.isMacintosh) {
		return fs.readdirSync(path).map(c => strings.normalizeNFC(c));
	}

	return fs.readdirSync(path);
}

export function readdir(path: string, callback: (error: Error, files: string[]) => void): void {
	// Mac: uses NFD unicode form on disk, but we want NFC
	// See also https://github.com/nodejs/node/issues/2165
	if (platform.isMacintosh) {
		return fs.readdir(path, (error, children) => {
			if (error) {
				return callback(error, null);
			}

			return callback(null, children.map(c => strings.normalizeNFC(c)));
		});
	}

	return fs.readdir(path, callback);
}

export function copy(source: string, target: string, callback: (error: Error) => void, copiedSources?: { [path: string]: boolean }): void {
	if (!copiedSources) {
		copiedSources = Object.create(null);
	}

	fs.stat(source, (error, stat) => {
		if (error) {
			return callback(error);
		}

		if (!stat.isDirectory()) {
			return doCopyFile(source, target, stat.mode & 511, callback);
		}

		if (copiedSources[source]) {
			return callback(null); // escape when there are cycles (can happen with symlinks)
		}

		copiedSources[source] = true; // remember as copied

		const proceed = function () {
			readdir(source, (err, files) => {
				loop(files, (file: string, clb: (error: Error, result: string[]) => void) => {
					copy(paths.join(source, file), paths.join(target, file), (error: Error) => clb(error, void 0), copiedSources);
				}, callback);
			});
		};

		mkdirp(target, stat.mode & 511).done(proceed, proceed);
	});
}

function doCopyFile(source: string, target: string, mode: number, callback: (error: Error) => void): void {
	const reader = fs.createReadStream(source);
	const writer = fs.createWriteStream(target, { mode });

	let finished = false;
	const finish = (error?: Error) => {
		if (!finished) {
			finished = true;

			// in error cases, pass to callback
			if (error) {
				callback(error);
			}

			// we need to explicitly chmod because of https://github.com/nodejs/node/issues/1104
			else {
				fs.chmod(target, mode, callback);
			}
		}
	};

	// handle errors properly
	reader.once('error', error => finish(error));
	writer.once('error', error => finish(error));

	// we are done (underlying fd has been closed)
	writer.once('close', () => finish());

	// start piping
	reader.pipe(writer);
}

export function mkdirp(path: string, mode?: number): TPromise<boolean> {
	const mkdir = () => nfcall(fs.mkdir, path, mode)
		.then(null, (err: NodeJS.ErrnoException) => {
			if (err.code === 'EEXIST') {
				return nfcall(fs.stat, path)
					.then((stat: fs.Stats) => stat.isDirectory
						? null
						: TPromise.wrapError(new Error(`'${path}' exists and is not a directory.`)));
			}

			return TPromise.wrapError<boolean>(err);
		});

	// stop at root
	if (path === paths.dirname(path)) {
		return TPromise.as(true);
	}

	// recursively mkdir
	return mkdir().then(null, (err: NodeJS.ErrnoException) => {
		if (err.code === 'ENOENT') {
			return mkdirp(paths.dirname(path), mode).then(mkdir);
		}

		return TPromise.wrapError<boolean>(err);
	});
}

// Deletes the given path by first moving it out of the workspace. This has two benefits. For one, the operation can return fast because
// after the rename, the contents are out of the workspace although not yet deleted. The greater benefit however is that this operation
// will fail in case any file is used by another process. fs.unlink() in node will not bail if a file unlinked is used by another process.
// However, the consequences are bad as outlined in all the related bugs from https://github.com/joyent/node/issues/7164
export function del(path: string, tmpFolder: string, callback: (error: Error) => void, done?: (error: Error) => void): void {
	fs.exists(path, exists => {
		if (!exists) {
			return callback(null);
		}

		fs.stat(path, (err, stat) => {
			if (err || !stat) {
				return callback(err);
			}

			// Special windows workaround: A file or folder that ends with a "." cannot be moved to another place
			// because it is not a valid file name. In this case, we really have to do the deletion without prior move.
			if (path[path.length - 1] === '.' || strings.endsWith(path, './') || strings.endsWith(path, '.\\')) {
				return rmRecursive(path, callback);
			}

			const pathInTemp = paths.join(tmpFolder, uuid.generateUuid());
			fs.rename(path, pathInTemp, (error: Error) => {
				if (error) {
					return rmRecursive(path, callback); // if rename fails, delete without tmp dir
				}

				// Return early since the move succeeded
				callback(null);

				// do the heavy deletion outside the callers callback
				rmRecursive(pathInTemp, error => {
					if (error) {
						console.error(error);
					}

					if (done) {
						done(error);
					}
				});
			});
		});
	});
}

function rmRecursive(path: string, callback: (error: Error) => void): void {
	if (path === '\\' || path === '/') {
		return callback(new Error('Will not delete root!'));
	}

	fs.exists(path, exists => {
		if (!exists) {
			callback(null);
		} else {
			fs.lstat(path, (err, stat) => {
				if (err || !stat) {
					callback(err);
				} else if (!stat.isDirectory() || stat.isSymbolicLink() /* !!! never recurse into links when deleting !!! */) {
					const mode = stat.mode;
					if (!(mode & 128)) { // 128 === 0200
						fs.chmod(path, mode | 128, (err: Error) => { // 128 === 0200
							if (err) {
								callback(err);
							} else {
								fs.unlink(path, callback);
							}
						});
					} else {
						fs.unlink(path, callback);
					}
				} else {
					readdir(path, (err, children) => {
						if (err || !children) {
							callback(err);
						} else if (children.length === 0) {
							fs.rmdir(path, callback);
						} else {
							let firstError: Error = null;
							let childrenLeft = children.length;
							children.forEach(child => {
								rmRecursive(paths.join(path, child), (err: Error) => {
									childrenLeft--;
									if (err) {
										firstError = firstError || err;
									}

									if (childrenLeft === 0) {
										if (firstError) {
											callback(firstError);
										} else {
											fs.rmdir(path, callback);
										}
									}
								});
							});
						}
					});
				}
			});
		}
	});
}

export function delSync(path: string): void {
	try {
		const stat = fs.lstatSync(path);
		if (stat.isDirectory() && !stat.isSymbolicLink()) {
			readdirSync(path).forEach(child => delSync(paths.join(path, child)));
			fs.rmdirSync(path);
		} else {
			fs.unlinkSync(path);
		}
	} catch (err) {
		if (err.code === 'ENOENT') {
			return; // not found
		}

		throw err;
	}
}

export function mv(source: string, target: string, callback: (error: Error) => void): void {
	if (source === target) {
		return callback(null);
	}

	function updateMtime(err: Error): void {
		if (err) {
			return callback(err);
		}

		fs.stat(target, (error, stat) => {
			if (error) {
				return callback(error);
			}

			if (stat.isDirectory()) {
				return callback(null);
			}

			fs.open(target, 'a', null, (err: Error, fd: number) => {
				if (err) {
					return callback(err);
				}

				fs.futimes(fd, stat.atime, new Date(), (err: Error) => {
					if (err) {
						return callback(err);
					}

					fs.close(fd, callback);
				});
			});
		});
	}

	// Try native rename()
	fs.rename(source, target, (err: Error) => {
		if (!err) {
			return updateMtime(null);
		}

		// In two cases we fallback to classic copy and delete:
		//
		// 1.) The EXDEV error indicates that source and target are on different devices
		// In this case, fallback to using a copy() operation as there is no way to
		// rename() between different devices.
		//
		// 2.) The user tries to rename a file/folder that ends with a dot. This is not
		// really possible to move then, at least on UNC devices.
		if (err && source.toLowerCase() !== target.toLowerCase() && ((<any>err).code === 'EXDEV') || strings.endsWith(source, '.')) {
			return copy(source, target, (err: Error) => {
				if (err) {
					return callback(err);
				}

				rmRecursive(source, updateMtime);
			});
		}

		return callback(err);
	});
}

let canFlush = true;
export function writeFileAndFlush(path: string, data: string | NodeBuffer | NodeJS.ReadableStream, options: { mode?: number; flag?: string; }, callback: (error?: Error) => void): void {
	options = ensureOptions(options);

	if (typeof data === 'string' || Buffer.isBuffer(data)) {
		doWriteFileAndFlush(path, data, options, callback);
	} else {
		doWriteFileStreamAndFlush(path, data, options, callback);
	}
}

function doWriteFileStreamAndFlush(path: string, reader: NodeJS.ReadableStream, options: { mode?: number; flag?: string; }, callback: (error?: Error) => void): void {

	// finish only once
	let finished = false;
	const finish = (error?: Error) => {
		if (!finished) {
			finished = true;

			// in error cases we need to manually close streams
			// if the write stream was successfully opened
			if (error) {
				if (isOpen) {
					writer.once('close', () => callback(error));
					writer.close();
				} else {
					callback(error);
				}
			}

			// otherwise just return without error
			else {
				callback();
			}
		}
	};

	// create writer to target. we set autoClose: false because we want to use the streams
	// file descriptor to call fs.fdatasync to ensure the data is flushed to disk
	const writer = fs.createWriteStream(path, { mode: options.mode, flags: options.flag, autoClose: false });

	// Event: 'open'
	// Purpose: save the fd for later use
	// Notes: will not be called when there is an error opening the file descriptor!
	let fd: number;
	let isOpen: boolean;
	writer.once('open', descriptor => {
		fd = descriptor;
		isOpen = true;
	});

	// Event: 'error'
	// Purpose: to return the error to the outside and to close the write stream (does not happen automatically)
	reader.once('error', error => finish(error));
	writer.once('error', error => finish(error));

	// Event: 'finish'
	// Purpose: use fs.fdatasync to flush the contents to disk
	// Notes: event is called when the writer has finished writing to the underlying resource. we must call writer.close()
	// because we have created the WriteStream with autoClose: false
	writer.once('finish', () => {

		// flush to disk
		if (canFlush && isOpen) {
			fs.fdatasync(fd, (syncError: Error) => {

				// In some exotic setups it is well possible that node fails to sync
				// In that case we disable flushing and warn to the console
				if (syncError) {
					console.warn('[node.js fs] fdatasync is now disabled for this session because it failed: ', syncError);
					canFlush = false;
				}

				writer.close();
			});
		} else {
			writer.close();
		}
	});

	// Event: 'close'
	// Purpose: signal we are done to the outside
	// Notes: event is called when the writer's filedescriptor is closed
	writer.once('close', () => finish());

	// start data piping
	reader.pipe(writer);
}

// Calls fs.writeFile() followed by a fs.sync() call to flush the changes to disk
// We do this in cases where we want to make sure the data is really on disk and
// not in some cache.
//
// See https://github.com/nodejs/node/blob/v5.10.0/lib/fs.js#L1194
function doWriteFileAndFlush(path: string, data: string | NodeBuffer, options: { mode?: number; flag?: string; }, callback: (error?: Error) => void): void {
	if (!canFlush) {
		return fs.writeFile(path, data, options, callback);
	}

	// Open the file with same flags and mode as fs.writeFile()
	fs.open(path, options.flag, options.mode, (openError, fd) => {
		if (openError) {
			return callback(openError);
		}

		// It is valid to pass a fd handle to fs.writeFile() and this will keep the handle open!
		fs.writeFile(fd, data, writeError => {
			if (writeError) {
				return fs.close(fd, () => callback(writeError)); // still need to close the handle on error!
			}

			// Flush contents (not metadata) of the file to disk
			fs.fdatasync(fd, (syncError: Error) => {

				// In some exotic setups it is well possible that node fails to sync
				// In that case we disable flushing and warn to the console
				if (syncError) {
					console.warn('[node.js fs] fdatasync is now disabled for this session because it failed: ', syncError);
					canFlush = false;
				}

				return fs.close(fd, closeError => callback(closeError));
			});
		});
	});
}

export function writeFileAndFlushSync(path: string, data: string | NodeBuffer, options?: { mode?: number; flag?: string; }): void {
	options = ensureOptions(options);

	if (!canFlush) {
		return fs.writeFileSync(path, data, options);
	}

	// Open the file with same flags and mode as fs.writeFile()
	const fd = fs.openSync(path, options.flag, options.mode);

	try {

		// It is valid to pass a fd handle to fs.writeFile() and this will keep the handle open!
		fs.writeFileSync(fd, data);

		// Flush contents (not metadata) of the file to disk
		try {
			fs.fdatasyncSync(fd);
		} catch (syncError) {
			console.warn('[node.js fs] fdatasyncSync is now disabled for this session because it failed: ', syncError);
			canFlush = false;
		}
	} finally {
		fs.closeSync(fd);
	}
}

function ensureOptions(options?: { mode?: number; flag?: string; }): { mode: number, flag: string } {
	if (!options) {
		return { mode: 0o666, flag: 'w' };
	}

	const ensuredOptions = { mode: options.mode, flag: options.flag };

	if (typeof ensuredOptions.mode !== 'number') {
		ensuredOptions.mode = 0o666;
	}

	if (typeof ensuredOptions.flag !== 'string') {
		ensuredOptions.flag = 'w';
	}

	return ensuredOptions;
}

/**
 * Copied from: https://github.com/Microsoft/vscode-node-debug/blob/master/src/node/pathUtilities.ts#L83
 *
 * Given an absolute, normalized, and existing file path 'realcase' returns the exact path that the file has on disk.
 * On a case insensitive file system, the returned path might differ from the original path by character casing.
 * On a case sensitive file system, the returned path will always be identical to the original path.
 * In case of errors, null is returned. But you cannot use this function to verify that a path exists.
 * realcaseSync does not handle '..' or '.' path segments and it does not take the locale into account.
 */
export function realcaseSync(path: string): string {
	const dir = paths.dirname(path);
	if (path === dir) {	// end recursion
		return path;
	}

	const name = (paths.basename(path) /* can be '' for windows drive letters */ || path).toLowerCase();
	try {
		const entries = readdirSync(dir);
		const found = entries.filter(e => e.toLowerCase() === name);	// use a case insensitive search
		if (found.length === 1) {
			// on a case sensitive filesystem we cannot determine here, whether the file exists or not, hence we need the 'file exists' precondition
			const prefix = realcaseSync(dir);   // recurse
			if (prefix) {
				return paths.join(prefix, found[0]);
			}
		} else if (found.length > 1) {
			// must be a case sensitive $filesystem
			const ix = found.indexOf(name);
			if (ix >= 0) {	// case sensitive
				const prefix = realcaseSync(dir);   // recurse
				if (prefix) {
					return paths.join(prefix, found[ix]);
				}
			}
		}
	} catch (error) {
		// silently ignore error
	}

	return null;
}

export function realpathSync(path: string): string {
	try {
		return fs.realpathSync(path);
	} catch (error) {

		// We hit an error calling fs.realpathSync(). Since fs.realpathSync() is doing some path normalization
		// we now do a similar normalization and then try again if we can access the path with read
		// permissions at least. If that succeeds, we return that path.
		// fs.realpath() is resolving symlinks and that can fail in certain cases. The workaround is
		// to not resolve links but to simply see if the path is read accessible or not.
		const normalizedPath = normalizePath(path);
		fs.accessSync(normalizedPath, fs.constants.R_OK); // throws in case of an error

		return normalizedPath;
	}
}

export function realpath(path: string, callback: (error: Error, realpath: string) => void): void {
	return fs.realpath(path, (error, realpath) => {
		if (!error) {
			return callback(null, realpath);
		}

		// We hit an error calling fs.realpath(). Since fs.realpath() is doing some path normalization
		// we now do a similar normalization and then try again if we can access the path with read
		// permissions at least. If that succeeds, we return that path.
		// fs.realpath() is resolving symlinks and that can fail in certain cases. The workaround is
		// to not resolve links but to simply see if the path is read accessible or not.
		const normalizedPath = normalizePath(path);

		return fs.access(normalizedPath, fs.constants.R_OK, error => {
			return callback(error, normalizedPath);
		});
	});
}

function normalizePath(path: string): string {
	return strings.rtrim(paths.normalize(path), paths.sep);
}

export function watch(path: string, onChange: (type: string, path: string) => void): fs.FSWatcher {
	const watcher = fs.watch(path);
	watcher.on('change', (type, raw) => {
		let file: string = null;
		if (raw) { // https://github.com/Microsoft/vscode/issues/38191
			file = raw.toString();
			if (platform.isMacintosh) {
				// Mac: uses NFD unicode form on disk, but we want NFC
				// See also https://github.com/nodejs/node/issues/2165
				file = strings.normalizeNFC(file);
			}
		}

		onChange(type, file);
	});

	return watcher;
}