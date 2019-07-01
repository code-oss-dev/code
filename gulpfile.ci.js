/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const task = require('./lib/task');

gulp.task(task.define('win32-ia32', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-win32-ia32-ci')
)));

gulp.task(task.define('win32-ia32-min', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-win32-ia32-min-ci')
)));

gulp.task(task.define('win32-x64', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-win32-x64-ci')
)));

gulp.task(task.define('win32-x64-min', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-win32-x64-min-ci')
)));

gulp.task(task.define('linux-ia32', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-linux-ia32-ci')
)));

gulp.task(task.define('linux-ia32-min', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-linux-ia32-min-ci')
)));

gulp.task(task.define('linux-x64', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-linux-x64-ci')
)));

gulp.task(task.define('linux-x64-min', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-linux-x64-min-ci')
)));

gulp.task(task.define('darwin', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-darwin-ci')
)));

gulp.task(task.define('darwin-min', task.series(
	gulp.task('compile-extensions-build'),
	gulp.task('vscode-darwin-min-ci')
)));
