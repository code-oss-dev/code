/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Based on @sergeche's work on the emmet plugin for atom
// TODO: Move to https://github.com/emmetio/file-utils
'use strict';

import * as path from 'path';
import * as fs from 'fs';

const reAbsolute = /^\/+/;

/**
 * Locates given `filePath` on user’s file system and returns absolute path to it.
 * This method expects either URL, or relative/absolute path to resource
 * @param  {String} basePath Base path to use if filePath is not absoulte
 * @param  {String} filePath File to locate. 
 * @return {Promise}
 */
export function locateFile(base: string, filePath: string): Promise<string> {
	if (/^\w+:/.test(filePath)) {
		// path with protocol, already absolute
		return Promise.resolve(filePath);
	}

	filePath = path.normalize(filePath);

	return reAbsolute.test(filePath)
		? resolveAbsolute(base, filePath)
		: resolveRelative(base, filePath);
}

/**
 * Resolves relative file path
 * @param  {TextEditor|String} base
 * @param  {String}            filePath
 * @return {Promise}
 */
function resolveRelative(basePath, filePath): Promise<string> {
	return tryFile(path.resolve(basePath, filePath));
}

/**
 * Resolves absolute file path agaist given editor: tries to find file in every
 * parent of editor’s file
 * @param  {TextEditor|String} base
 * @param  {String}            filePath
 * @return {Promise}
 */
function resolveAbsolute(basePath, filePath): Promise<string> {
	return new Promise((resolve, reject) => {
		filePath = filePath.replace(reAbsolute, '');

		const next = ctx => {
			tryFile(path.resolve(ctx, filePath))
				.then(resolve, err => {
					const dir = path.dirname(ctx);
					if (!dir || dir === ctx) {
						return reject(`Unable to locate absolute file ${filePath}`);
					}

					next(dir);
				});
		};

		next(basePath);
	});
}

/**
 * Check if given file exists and it’s a file, not directory
 * @param  {String} file
 * @return {Promise}
 */
function tryFile(file): Promise<string> {
	return new Promise((resolve, reject) => {
		fs.stat(file, (err, stat) => {
			if (err) {
				return reject(err);
			}

			if (!stat.isFile()) {
				return reject(new Error(`${file} is not a file`));
			}

			resolve(file);
		});
	});
}
