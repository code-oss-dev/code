/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import os = require('os');
import {app} from 'electron';

import arrays = require('vs/base/common/arrays');
import strings = require('vs/base/common/strings');
import paths = require('vs/base/common/paths');
import platform = require('vs/base/common/platform');
import uri from 'vs/base/common/uri';
import types = require('vs/base/common/types');
import {ServiceIdentifier, createDecorator} from 'vs/platform/instantiation/common/instantiation';

export interface IEnv {
	cliArgs: ICommandLineArguments;
}

export const IEnvService = createDecorator<IEnvService>('environmentService');

export interface IEnvService {
	serviceId: ServiceIdentifier<any>;

	cliArgs: ICommandLineArguments;
	userExtensionsHome: string;
	isTestingFromCli: boolean;
}

export class EnvService implements IEnvService {

	serviceId = IEnvService;

	private _cliArgs: ICommandLineArguments;
	private _userExtensionsHome: string;
	private _isTestingFromCli: boolean;

	constructor() {
		// Remove the Electron executable
		let [, ...args] = process.argv;

		// Id dev, remove the first argument: it's the app location
		if (!isBuilt) {
			[, ...args] = args;
		}

		// Finally, prepend any extra arguments from the 'argv' file
		if (fs.existsSync(path.join(appRoot, 'argv'))) {
			const extraargs: string[] = JSON.parse(fs.readFileSync(path.join(appRoot, 'argv'), 'utf8'));
			args = [...extraargs, ...args];
		}

		const opts = parseOpts(args);

		const gotoLineMode = !!opts['g'] || !!opts['goto'];

		const debugBrkExtensionHostPort = parseNumber(args, '--debugBrkPluginHost', 5870);
		let debugExtensionHostPort: number;
		let debugBrkExtensionHost: boolean;

		if (debugBrkExtensionHostPort) {
			debugExtensionHostPort = debugBrkExtensionHostPort;
			debugBrkExtensionHost = true;
		} else {
			debugExtensionHostPort = parseNumber(args, '--debugPluginHost', 5870, isBuilt ? void 0 : 5870);
		}

		const pathArguments = parsePathArguments(args, gotoLineMode);

		this._cliArgs = Object.freeze({
			pathArguments: pathArguments,
			programStart: parseNumber(args, '--timestamp', 0, 0),
			enablePerformance: !!opts['p'],
			verboseLogging: !!opts['verbose'],
			debugExtensionHostPort: debugExtensionHostPort,
			debugBrkExtensionHost: debugBrkExtensionHost,
			logExtensionHostCommunication: !!opts['logExtensionHostCommunication'],
			firstrun: !!opts['squirrel-firstrun'],
			openNewWindow: !!opts['n'] || !!opts['new-window'],
			openInSameWindow: !!opts['r'] || !!opts['reuse-window'],
			gotoLineMode: gotoLineMode,
			diffMode: (!!opts['d'] || !!opts['diff']) && pathArguments.length === 2,
			extensionsHomePath: normalizePath(parseString(args, '--extensionHomePath')),
			extensionDevelopmentPath: normalizePath(parseString(args, '--extensionDevelopmentPath')),
			extensionTestsPath: normalizePath(parseString(args, '--extensionTestsPath')),
			disableExtensions: !!opts['disableExtensions'] || !!opts['disable-extensions'],
			locale: parseString(args, '--locale'),
			waitForWindowClose: !!opts['w'] || !!opts['wait']
		});

		this._userExtensionsHome = this.cliArgs.extensionsHomePath || path.join(userHome, 'extensions');

		// TODO move out of here!
		if (!fs.existsSync(this.userExtensionsHome)) {
			fs.mkdirSync(this.userExtensionsHome);
		}

		this._isTestingFromCli = this.cliArgs.extensionTestsPath && !this.cliArgs.debugBrkExtensionHost;
	}

	get cliArgs(): ICommandLineArguments {
		return this._cliArgs;
	}

	get userExtensionsHome(): string {
		return this._userExtensionsHome;
	}

	get isTestingFromCli(): boolean {
		return this._isTestingFromCli;
	}
}

export interface IProductConfiguration {
	nameShort: string;
	nameLong: string;
	applicationName: string;
	win32AppUserModelId: string;
	win32MutexName: string;
	darwinBundleIdentifier: string;
	dataFolderName: string;
	downloadUrl: string;
	updateUrl?: string;
	quality?: string;
	commit: string;
	date: string;
	extensionsGallery: {
		serviceUrl: string;
		itemUrl: string;
	};
	extensionTips: { [id: string]: string; };
	crashReporter: Electron.CrashReporterStartOptions;
	welcomePage: string;
	enableTelemetry: boolean;
	aiConfig: {
		key: string;
		asimovKey: string;
	};
	sendASmile: {
		reportIssueUrl: string,
		requestFeatureUrl: string
	};
	documentationUrl: string;
	releaseNotesUrl: string;
	twitterUrl: string;
	requestFeatureUrl: string;
	reportIssueUrl: string;
	licenseUrl: string;
	privacyStatementUrl: string;
}

export const isBuilt = !process.env.VSCODE_DEV;

export const appRoot = path.dirname(uri.parse(require.toUrl('')).fsPath);

export const currentWorkingDirectory = process.env.VSCODE_CWD || process.cwd();

let productContents: IProductConfiguration;
try {
	productContents = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
} catch (error) {
	productContents = Object.create(null);
}

export const product: IProductConfiguration = productContents;
product.nameShort = product.nameShort + (isBuilt ? '' : ' Dev');
product.nameLong = product.nameLong + (isBuilt ? '' : ' Dev');
product.dataFolderName = product.dataFolderName + (isBuilt ? '' : '-dev');

export const updateUrl = product.updateUrl;
export const quality = product.quality;

export const mainIPCHandle = getMainIPCHandle();
export const sharedIPCHandle = getSharedIPCHandle();
export const version = app.getVersion();

export const appHome = app.getPath('userData');

export const appSettingsHome = path.join(appHome, 'User');
if (!fs.existsSync(appSettingsHome)) {
	fs.mkdirSync(appSettingsHome);
}
export const appSettingsPath = path.join(appSettingsHome, 'settings.json');
export const appKeybindingsPath = path.join(appSettingsHome, 'keybindings.json');

export const userHome = path.join(app.getPath('home'), product.dataFolderName);
if (!fs.existsSync(userHome)) {
	fs.mkdirSync(userHome);
}

export interface IProcessEnvironment {
	[key: string]: string;
}

export interface ICommandLineArguments {
	verboseLogging: boolean;
	debugExtensionHostPort: number;
	debugBrkExtensionHost: boolean;
	logExtensionHostCommunication: boolean;
	disableExtensions: boolean;
	extensionsHomePath: string;
	extensionDevelopmentPath: string;
	extensionTestsPath: string;
	programStart: number;
	pathArguments?: string[];
	enablePerformance?: boolean;
	firstrun?: boolean;
	openNewWindow?: boolean;
	openInSameWindow?: boolean;
	gotoLineMode?: boolean;
	diffMode?: boolean;
	locale?: string;
	waitForWindowClose?: boolean;
}

function getIPCHandleName(): string {
	let handleName = app.getName();

	if (!isBuilt) {
		handleName += '-dev';
	}

	// Support to run VS Code multiple times as different user
	// by making the socket unique over the logged in user
	let userId = uniqueUserId();
	if (userId) {
		handleName += ('-' + userId);
	}

	if (process.platform === 'win32') {
		return '\\\\.\\pipe\\' + handleName;
	}

	return path.join(os.tmpdir(), handleName);
}

function getMainIPCHandle(): string {
	return getIPCHandleName() + (process.platform === 'win32' ? '-sock' : '.sock');
}

function getSharedIPCHandle(): string {
	return getIPCHandleName() + '-shared' + (process.platform === 'win32' ? '-sock' : '.sock');
}

function uniqueUserId(): string {
	let username: string;
	if (platform.isWindows) {
		username = process.env.USERNAME;
	} else {
		username = process.env.USER;
	}

	if (!username) {
		return ''; // fail gracefully if there is no user name
	}

	// use sha256 to ensure the userid value can be used in filenames and are unique
	return crypto.createHash('sha256').update(username).digest('hex').substr(0, 6);
}

type OptionBag = { [opt: string]: boolean; };

function parseOpts(argv: string[]): OptionBag {
	return argv
		.filter(a => /^-/.test(a))
		.map(a => a.replace(/^-*/, ''))
		.reduce((r, a) => { r[a] = true; return r; }, <OptionBag>{});
}

function parsePathArguments(argv: string[], gotoLineMode?: boolean): string[] {
	return arrays.coalesce(							// no invalid paths
		arrays.distinct(							// no duplicates
			argv.filter(a => !(/^-/.test(a))) 		// arguments without leading "-"
				.map((arg) => {
					let pathCandidate = arg;

					let parsedPath: IParsedPath;
					if (gotoLineMode) {
						parsedPath = parseLineAndColumnAware(arg);
						pathCandidate = parsedPath.path;
					}

					if (pathCandidate) {
						pathCandidate = preparePath(pathCandidate);
					}

					let realPath: string;
					try {
						realPath = fs.realpathSync(pathCandidate);
					} catch (error) {
						// in case of an error, assume the user wants to create this file
						// if the path is relative, we join it to the cwd
						realPath = path.normalize(path.isAbsolute(pathCandidate) ? pathCandidate : path.join(currentWorkingDirectory, pathCandidate));
					}

					if (!paths.isValidBasename(path.basename(realPath))) {
						return null; // do not allow invalid file names
					}

					if (gotoLineMode) {
						parsedPath.path = realPath;
						return toLineAndColumnPath(parsedPath);
					}

					return realPath;
				}),
			(element) => {
				return element && (platform.isWindows || platform.isMacintosh) ? element.toLowerCase() : element; // only linux is case sensitive on the fs
			}
		)
	);
}

function preparePath(p: string): string {

	// Trim trailing quotes
	if (platform.isWindows) {
		p = strings.rtrim(p, '"'); // https://github.com/Microsoft/vscode/issues/1498
	}

	// Trim whitespaces
	p = strings.trim(strings.trim(p, ' '), '\t');

	if (platform.isWindows) {

		// Resolve the path against cwd if it is relative
		p = path.resolve(currentWorkingDirectory, p);

		// Trim trailing '.' chars on Windows to prevent invalid file names
		p = strings.rtrim(p, '.');
	}

	return p;
}

function normalizePath(p?: string): string {
	return p ? path.normalize(p) : p;
}

function parseNumber(argv: string[], key: string, defaultValue?: number, fallbackValue?: number): number {
	let value: number;

	for (let i = 0; i < argv.length; i++) {
		let segments = argv[i].split('=');
		if (segments[0] === key) {
			value = Number(segments[1]) || defaultValue;
			break;
		}
	}

	return types.isNumber(value) ? value : fallbackValue;
}

function parseString(argv: string[], key: string, defaultValue?: string, fallbackValue?: string): string {
	let value: string;

	for (let i = 0; i < argv.length; i++) {
		let segments = argv[i].split('=');
		if (segments[0] === key) {
			value = String(segments[1]) || defaultValue;
			break;
		}
	}

	return types.isString(value) ? strings.trim(value, '"') : fallbackValue;
}

export function getPlatformIdentifier(): string {
	if (process.platform === 'linux') {
		return `linux-${process.arch}`;
	}

	return process.platform;
}

export interface IParsedPath {
	path: string;
	line?: number;
	column?: number;
}

export function parseLineAndColumnAware(rawPath: string): IParsedPath {
	let segments = rawPath.split(':'); // C:\file.txt:<line>:<column>

	let path: string;
	let line: number = null;
	let column: number = null;

	segments.forEach(segment => {
		let segmentAsNumber = Number(segment);
		if (!types.isNumber(segmentAsNumber)) {
			path = !!path ? [path, segment].join(':') : segment; // a colon can well be part of a path (e.g. C:\...)
		} else if (line === null) {
			line = segmentAsNumber;
		} else if (column === null) {
			column = segmentAsNumber;
		}
	});

	return {
		path: path,
		line: line !== null ? line : void 0,
		column: column !== null ? column : line !== null ? 1 : void 0 // if we have a line, make sure column is also set
	};
}

export function toLineAndColumnPath(parsedPath: IParsedPath): string {
	let segments = [parsedPath.path];

	if (types.isNumber(parsedPath.line)) {
		segments.push(String(parsedPath.line));
	}

	if (types.isNumber(parsedPath.column)) {
		segments.push(String(parsedPath.column));
	}

	return segments.join(':');
}