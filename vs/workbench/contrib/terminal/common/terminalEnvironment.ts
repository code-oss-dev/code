/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import * as platform from 'vs/base/common/platform';
import { URI as Uri } from 'vs/base/common/uri';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IShellLaunchConfig, ITerminalEnvironment } from 'vs/workbench/contrib/terminal/common/terminal';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { sanitizeProcessEnvironment } from 'vs/base/common/processes';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * This module contains utility functions related to the environment, cwd and paths.
 */

export function mergeEnvironments(parent: platform.IProcessEnvironment, other: ITerminalEnvironment | undefined): void {
	if (!other) {
		return;
	}

	// On Windows apply the new values ignoring case, while still retaining
	// the case of the original key.
	if (platform.isWindows) {
		for (const configKey in other) {
			let actualKey = configKey;
			for (const envKey in parent) {
				if (configKey.toLowerCase() === envKey.toLowerCase()) {
					actualKey = envKey;
					break;
				}
			}
			const value = other[configKey];
			_mergeEnvironmentValue(parent, actualKey, value);
		}
	} else {
		Object.keys(other).forEach((key) => {
			const value = other[key];
			_mergeEnvironmentValue(parent, key, value);
		});
	}
}

function _mergeEnvironmentValue(env: ITerminalEnvironment, key: string, value: string | null): void {
	if (typeof value === 'string') {
		env[key] = value;
	} else {
		delete env[key];
	}
}

export function addTerminalEnvironmentKeys(env: platform.IProcessEnvironment, version: string | undefined, locale: string | undefined, detectLocale: 'auto' | 'off' | 'on'): void {
	env['TERM_PROGRAM'] = 'vscode';
	if (version) {
		env['TERM_PROGRAM_VERSION'] = version;
	}
	if (shouldSetLangEnvVariable(env, detectLocale)) {
		env['LANG'] = getLangEnvVariable(locale);
	}
	env['COLORTERM'] = 'truecolor';
}

function mergeNonNullKeys(env: platform.IProcessEnvironment, other: ITerminalEnvironment | undefined) {
	if (!other) {
		return;
	}
	for (const key of Object.keys(other)) {
		const value = other[key];
		if (value) {
			env[key] = value;
		}
	}
}

function resolveConfigurationVariables(variableResolver: VariableResolver, env: ITerminalEnvironment): ITerminalEnvironment {
	Object.keys(env).forEach((key) => {
		const value = env[key];
		if (typeof value === 'string') {
			try {
				env[key] = variableResolver(value);
			} catch (e) {
				env[key] = value;
			}
		}
	});
	return env;
}

export function shouldSetLangEnvVariable(env: platform.IProcessEnvironment, detectLocale: 'auto' | 'off' | 'on'): boolean {
	if (detectLocale === 'on') {
		return true;
	}
	if (detectLocale === 'auto') {
		return !env['LANG'] || (env['LANG'].search(/\.UTF\-8$/) === -1 && env['LANG'].search(/\.utf8$/) === -1);
	}
	return false; // 'off'
}

export function getLangEnvVariable(locale?: string): string {
	const parts = locale ? locale.split('-') : [];
	const n = parts.length;
	if (n === 0) {
		// Fallback to en_US if the locale is unknown
		return 'en_US.UTF-8';
	}
	if (n === 1) {
		// The local may only contain the language, not the variant, if this is the case guess the
		// variant such that it can be used as a valid $LANG variable. The language variant chosen
		// is the original and/or most prominent with help from
		// https://stackoverflow.com/a/2502675/1156119
		// The list of locales was generated by running `locale -a` on macOS
		const languageVariants: { [key: string]: string } = {
			af: 'ZA',
			am: 'ET',
			be: 'BY',
			bg: 'BG',
			ca: 'ES',
			cs: 'CZ',
			da: 'DK',
			// de: 'AT',
			// de: 'CH',
			de: 'DE',
			el: 'GR',
			// en: 'AU',
			// en: 'CA',
			// en: 'GB',
			// en: 'IE',
			// en: 'NZ',
			en: 'US',
			es: 'ES',
			et: 'EE',
			eu: 'ES',
			fi: 'FI',
			// fr: 'BE',
			// fr: 'CA',
			// fr: 'CH',
			fr: 'FR',
			he: 'IL',
			hr: 'HR',
			hu: 'HU',
			hy: 'AM',
			is: 'IS',
			// it: 'CH',
			it: 'IT',
			ja: 'JP',
			kk: 'KZ',
			ko: 'KR',
			lt: 'LT',
			// nl: 'BE',
			nl: 'NL',
			no: 'NO',
			pl: 'PL',
			pt: 'BR',
			// pt: 'PT',
			ro: 'RO',
			ru: 'RU',
			sk: 'SK',
			sl: 'SI',
			sr: 'YU',
			sv: 'SE',
			tr: 'TR',
			uk: 'UA',
			zh: 'CN',
		};
		if (parts[0] in languageVariants) {
			parts.push(languageVariants[parts[0]]);
		}
	} else {
		// Ensure the variant is uppercase to be a valid $LANG
		parts[1] = parts[1].toUpperCase();
	}
	return parts.join('_') + '.UTF-8';
}

export function getCwd(
	shell: IShellLaunchConfig,
	userHome: string | undefined,
	variableResolver: VariableResolver | undefined,
	root: Uri | undefined,
	customCwd: string | undefined,
	logService?: ILogService
): string {
	if (shell.cwd) {
		const unresolved = (typeof shell.cwd === 'object') ? shell.cwd.fsPath : shell.cwd;
		const resolved = _resolveCwd(unresolved, variableResolver);
		return _sanitizeCwd(resolved || unresolved);
	}

	let cwd: string | undefined;

	if (!shell.ignoreConfigurationCwd && customCwd) {
		if (variableResolver) {
			customCwd = _resolveCwd(customCwd, variableResolver, logService);
		}
		if (customCwd) {
			if (path.isAbsolute(customCwd)) {
				cwd = customCwd;
			} else if (root) {
				cwd = path.join(root.fsPath, customCwd);
			}
		}
	}

	// If there was no custom cwd or it was relative with no workspace
	if (!cwd) {
		cwd = root ? root.fsPath : userHome || '';
	}

	return _sanitizeCwd(cwd);
}

function _resolveCwd(cwd: string, variableResolver: VariableResolver | undefined, logService?: ILogService): string | undefined {
	if (variableResolver) {
		try {
			return variableResolver(cwd);
		} catch (e) {
			logService?.error('Could not resolve terminal cwd', e);
			return undefined;
		}
	}
	return cwd;
}

function _sanitizeCwd(cwd: string): string {
	// Make the drive letter uppercase on Windows (see #9448)
	if (platform.platform === platform.Platform.Windows && cwd && cwd[1] === ':') {
		return cwd[0].toUpperCase() + cwd.substr(1);
	}
	return cwd;
}

export function escapeNonWindowsPath(path: string): string {
	let newPath = path;
	if (newPath.indexOf('\\') !== 0) {
		newPath = newPath.replace(/\\/g, '\\\\');
	}
	if (!newPath && (newPath.indexOf('"') !== -1)) {
		newPath = '\'' + newPath + '\'';
	} else if (newPath.indexOf(' ') !== -1) {
		newPath = newPath.replace(/ /g, '\\ ');
	}
	return newPath;
}

export type TerminalShellSetting = (
	`terminal.integrated.automationShell.windows`
	| `terminal.integrated.automationShell.osx`
	| `terminal.integrated.automationShell.linux`
	| `terminal.integrated.shell.windows`
	| `terminal.integrated.shell.osx`
	| `terminal.integrated.shell.linux`
);

export type TerminalShellArgsSetting = (
	`terminal.integrated.shellArgs.windows`
	| `terminal.integrated.shellArgs.osx`
	| `terminal.integrated.shellArgs.linux`
);

export type VariableResolver = (str: string) => string;

export function createVariableResolver(lastActiveWorkspace: IWorkspaceFolder | undefined, configurationResolverService: IConfigurationResolverService | undefined): VariableResolver | undefined {
	if (!configurationResolverService) {
		return undefined;
	}
	return (str) => configurationResolverService.resolve(lastActiveWorkspace, str);
}

export function getDefaultShell(
	fetchSetting: (key: TerminalShellSetting) => { userValue?: string | string[], value?: string | string[], defaultValue?: string | string[] },
	isWorkspaceShellAllowed: boolean,
	defaultShell: string,
	isWoW64: boolean,
	windir: string | undefined,
	variableResolver: VariableResolver | undefined,
	logService: ILogService,
	useAutomationShell: boolean,
	platformOverride: platform.Platform = platform.platform
): string {
	let maybeExecutable: string | null = null;
	if (useAutomationShell) {
		// If automationShell is specified, this should override the normal setting
		maybeExecutable = getShellSetting(fetchSetting, isWorkspaceShellAllowed, 'automationShell', platformOverride);
	}
	if (!maybeExecutable) {
		maybeExecutable = getShellSetting(fetchSetting, isWorkspaceShellAllowed, 'shell', platformOverride);
	}
	let executable: string = maybeExecutable || defaultShell;

	// Change Sysnative to System32 if the OS is Windows but NOT WoW64. It's
	// safe to assume that this was used by accident as Sysnative does not
	// exist and will break the terminal in non-WoW64 environments.
	if ((platformOverride === platform.Platform.Windows) && !isWoW64 && windir) {
		const sysnativePath = path.join(windir, 'Sysnative').replace(/\//g, '\\').toLowerCase();
		if (executable && executable.toLowerCase().indexOf(sysnativePath) === 0) {
			executable = path.join(windir, 'System32', executable.substr(sysnativePath.length + 1));
		}
	}

	// Convert / to \ on Windows for convenience
	if (executable && platformOverride === platform.Platform.Windows) {
		executable = executable.replace(/\//g, '\\');
	}

	if (variableResolver) {
		try {
			executable = variableResolver(executable);
		} catch (e) {
			logService.error(`Could not resolve shell`, e);
		}
	}

	return executable;
}

export function getDefaultShellArgs(
	fetchSetting: (key: TerminalShellSetting | TerminalShellArgsSetting) => { userValue?: string | string[], value?: string | string[], defaultValue?: string | string[] },
	isWorkspaceShellAllowed: boolean,
	useAutomationShell: boolean,
	variableResolver: VariableResolver | undefined,
	logService: ILogService,
	platformOverride: platform.Platform = platform.platform,
): string | string[] {
	if (useAutomationShell) {
		if (!!getShellSetting(fetchSetting, isWorkspaceShellAllowed, 'automationShell', platformOverride)) {
			return [];
		}
	}

	const platformKey = platformOverride === platform.Platform.Windows ? 'windows' : platformOverride === platform.Platform.Mac ? 'osx' : 'linux';
	const shellArgsConfigValue = fetchSetting(<TerminalShellArgsSetting>`terminal.integrated.shellArgs.${platformKey}`);
	let args = ((isWorkspaceShellAllowed ? shellArgsConfigValue.value : shellArgsConfigValue.userValue) || shellArgsConfigValue.defaultValue);
	if (!args) {
		return [];
	}
	if (typeof args === 'string' && platformOverride === platform.Platform.Windows) {
		return variableResolver ? variableResolver(args) : args;
	}
	if (variableResolver) {
		const resolvedArgs: string[] = [];
		for (const arg of args) {
			try {
				resolvedArgs.push(variableResolver(arg));
			} catch (e) {
				logService.error(`Could not resolve terminal.integrated.shellArgs.${platformKey}`, e);
				resolvedArgs.push(arg);
			}
		}
		args = resolvedArgs;
	}
	return args;
}

function getShellSetting(
	fetchSetting: (key: TerminalShellSetting) => { userValue?: string | string[], value?: string | string[], defaultValue?: string | string[] },
	isWorkspaceShellAllowed: boolean,
	type: 'automationShell' | 'shell',
	platformOverride: platform.Platform = platform.platform,
): string | null {
	const platformKey = platformOverride === platform.Platform.Windows ? 'windows' : platformOverride === platform.Platform.Mac ? 'osx' : 'linux';
	const shellConfigValue = fetchSetting(<TerminalShellSetting>`terminal.integrated.${type}.${platformKey}`);
	const executable = (isWorkspaceShellAllowed ? <string>shellConfigValue.value : <string>shellConfigValue.userValue) || (<string | null>shellConfigValue.defaultValue);
	return executable;
}

export function createTerminalEnvironment(
	shellLaunchConfig: IShellLaunchConfig,
	envFromConfig: { userValue?: ITerminalEnvironment, value?: ITerminalEnvironment, defaultValue?: ITerminalEnvironment },
	variableResolver: VariableResolver | undefined,
	isWorkspaceShellAllowed: boolean,
	version: string | undefined,
	detectLocale: 'auto' | 'off' | 'on',
	baseEnv: platform.IProcessEnvironment
): platform.IProcessEnvironment {
	// Create a terminal environment based on settings, launch config and permissions
	let env: platform.IProcessEnvironment = {};
	if (shellLaunchConfig.strictEnv) {
		// strictEnv is true, only use the requested env (ignoring null entries)
		mergeNonNullKeys(env, shellLaunchConfig.env);
	} else {
		// Merge process env with the env from config and from shellLaunchConfig
		mergeNonNullKeys(env, baseEnv);

		// const platformKey = platform.isWindows ? 'windows' : (platform.isMacintosh ? 'osx' : 'linux');
		// const envFromConfigValue = this._workspaceConfigurationService.inspect<ITerminalEnvironment | undefined>(`terminal.integrated.env.${platformKey}`);
		const allowedEnvFromConfig = { ...(isWorkspaceShellAllowed ? envFromConfig.value : envFromConfig.userValue) };

		// Resolve env vars from config and shell
		if (variableResolver) {
			if (allowedEnvFromConfig) {
				resolveConfigurationVariables(variableResolver, allowedEnvFromConfig);
			}
			if (shellLaunchConfig.env) {
				resolveConfigurationVariables(variableResolver, shellLaunchConfig.env);
			}
		}

		// Sanitize the environment, removing any undesirable VS Code and Electron environment
		// variables
		sanitizeProcessEnvironment(env, 'VSCODE_IPC_HOOK_CLI');

		// Merge config (settings) and ShellLaunchConfig environments
		mergeEnvironments(env, allowedEnvFromConfig);
		mergeEnvironments(env, shellLaunchConfig.env);

		// Adding other env keys necessary to create the process
		addTerminalEnvironmentKeys(env, version, platform.locale, detectLocale);
	}
	return env;
}
