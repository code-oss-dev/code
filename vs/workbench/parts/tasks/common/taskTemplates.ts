/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';

import { IPickOpenEntry } from 'vs/workbench/services/quickopen/common/quickOpenService';

export interface TaskEntry extends IPickOpenEntry {
	sort?: string;
	autoDetect: boolean;
	content: string;
}

const gulp: TaskEntry = {
	id: 'gulp',
	label: 'Gulp',
	autoDetect: true,
	content: [
		'{',
			'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
			'\t// for the documentation about the tasks.json format',
			'\t"version": "0.1.0",',
			'\t"command": "gulp",',
			'\t"isShellCommand": true,',
			'\t"args": ["--no-color"],',
			'\t"showOutput": "always"',
		'}'
	].join('\n')
};

const grunt: TaskEntry = {
	id: 'grunt',
	label: 'Grunt',
	autoDetect: true,
	content: [
		'{',
			'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
			'\t// for the documentation about the tasks.json format',
			'\t"version": "0.1.0",',
			'\t"command": "grunt",',
			'\t"isShellCommand": true,',
			'\t"args": ["--no-color"],',
			'\t"showOutput": "always"',
		'}'
	].join('\n')
};

const npm: TaskEntry = {
	id: 'npm',
	label: 'npm',
	sort: 'NPM',
	autoDetect: false,
	content: [
		'{',
			'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
			'\t// for the documentation about the tasks.json format',
			'\t"version": "0.1.0",',
			'\t"command": "npm",',
			'\t"isShellCommand": true,',
			'\t"showOutput": "always",',
			'\t"suppressTaskName": true,',
			'\t"tasks": [',
				'\t\t{',
					'\t\t\t"taskName": "install",',
					'\t\t\t"args": ["install"]',
				'\t\t},',
				'\t\t{',
					'\t\t\t"taskName": "update",',
					'\t\t\t"args": ["update"]',
				'\t\t},',
				'\t\t{',
					'\t\t\t"taskName": "test",',
					'\t\t\t"args": ["run", "test"]',
				'\t\t}',
			'\t]',
		'}'
	].join('\n')
};

const tscConfig: TaskEntry = {
	id: 'tsc.config',
	label: 'TypeScript - tsconfig.json',
	autoDetect: false,
	description: nls.localize('tsc.config', 'Compiles a TypeScript project'),
	content: [
		'{',
			'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
			'\t// for the documentation about the tasks.json format',
			'\t"version": "0.1.0",',
			'\t"command": "tsc",',
			'\t"isShellCommand": true,',
			'\t"args": ["-p", "."],',
			'\t"showOutput": "silent",',
			'\t"problemMatcher": "$tsc"',
		'}'
	].join('\n')
};

const tscWatch: TaskEntry = {
	id: 'tsc.watch',
	label: 'TypeScript - Watch Mode',
	autoDetect: false,
	description: nls.localize('tsc.watch', 'Compiles a TypeScript project in watch mode'),
	content: [
		'{',
			'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
			'\t// for the documentation about the tasks.json format',
			'\t"version": "0.1.0",',
			'\t"command": "tsc",',
			'\t"isShellCommand": true,',
			'\t"args": ["-w", "-p", "."],',
			'\t"showOutput": "silent",',
			'\t"isWatching": true,',
			'\t"problemMatcher": "$tsc-watch"',
		'}'
	].join('\n')
};

const dotnetBuild: TaskEntry = {
	id: 'dotnetCore',
	label: '.NET Core',
	sort: 'NET Core',
	autoDetect: false,
	description: nls.localize('dotnetCore', 'Executes .NET Core build command'),
	content: [
		'{',
			'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
			'\t// for the documentation about the tasks.json format',
			'\t"version": "0.1.0",',
			'\t"command": "dotnet",',
			'\t"isShellCommand": true,',
			'\t"args": [],',
			'\t"tasks": [',
				'\t\t{',
					'\t\t\t"taskName": "build",',
					'\t\t\t"args": [ ],',
					'\t\t\t"isBuildCommand": true,',
					'\t\t\t"showOutput": "silent",',
					'\t\t\t"problemMatcher": "$msCompile"',
				'\t\t}',
			'\t]',
		'}'
	].join('\n')
};

const msbuild: TaskEntry = {
	id: 'msbuild',
	label: 'MSBuild',
	autoDetect: false,
	description: nls.localize('msbuild', 'Executes the build target'),
	content: [
		'{',
			'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
			'\t// for the documentation about the tasks.json format',
			'\t"version": "0.1.0",',
			'\t"command": "msbuild",',
			'\t"args": [',
				'\t\t// Ask msbuild to generate full paths for file names.',
				'\t\t"/property:GenerateFullPaths=true"',
			'\t],',
			'\t"taskSelector": "/t:",',
			'\t"showOutput": "silent",',
			'\t"tasks": [',
				'\t\t{',
					'\t\t\t"taskName": "build",',
					'\t\t\t// Show the output window only if unrecognized errors occur.',
					'\t\t\t"showOutput": "silent",',
					'\t\t\t// Use the standard MS compiler pattern to detect errors, warnings and infos',
					'\t\t\t"problemMatcher": "$msCompile"',
				'\t\t}',
			'\t]',
		'}'
	].join('\n')
};

const command: TaskEntry = {
	id: 'externalCommand',
	label: 'Others',
	autoDetect: false,
	description: nls.localize('externalCommand', 'Example to run an arbitrary external command'),
	content: [
		'{',
			'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
			'\t// for the documentation about the tasks.json format',
			'\t"version": "0.1.0",',
			'\t"command": "echo",',
			'\t"isShellCommand": true,',
			'\t"args": ["Hello World"],',
			'\t"showOutput": "always"',
		'}'
	].join('\n')
};


export let templates: TaskEntry[] = [gulp, grunt, tscConfig, tscWatch, dotnetBuild, msbuild, npm].sort((a, b) => {
	return (a.sort || a.label).localeCompare(b.sort || b.label);
});
templates.push(command);