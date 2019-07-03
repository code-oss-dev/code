/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const util = require('./lib/util');
const task = require('./lib/task');
const compilation = require('./lib/compilation');

// Full compile, including nls and inline sources in sourcemaps, for build
const compileBuildTask = task.define('compile-build', task.series(util.rimraf('out-build'), compilation.compileTask('src', 'out-build', true)));
exports.compileBuildTask = compileBuildTask;