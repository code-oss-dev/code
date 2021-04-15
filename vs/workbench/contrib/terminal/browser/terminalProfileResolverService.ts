/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import { env } from 'vs/base/common/process';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IRemoteTerminalService, ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IProcessEnvironment, Platform } from 'vs/base/common/platform';
import { IShellLaunchConfig } from 'vs/platform/terminal/common/terminal';
import { IShellLaunchConfigResolveOptions, ITerminalProfile, ITerminalProfileResolverService } from 'vs/workbench/contrib/terminal/common/terminal';
import * as path from 'vs/base/common/path';
import { Codicon } from 'vs/base/common/codicons';

export interface IProfileContextProvider {
	getDefaultSystemShell: (platform: Platform) => Promise<string>;
	getShellEnvironment: () => Promise<IProcessEnvironment>;
}

const generatedProfileName = 'Generated';

export abstract class BaseTerminalProfileResolverService implements ITerminalProfileResolverService {
	declare _serviceBrand: undefined;

	constructor(
		private readonly _context: IProfileContextProvider,
		private readonly _configurationService: IConfigurationService,
		private readonly _configurationResolverService: IConfigurationResolverService,
		private readonly _historyService: IHistoryService,
		private readonly _logService: ILogService,
		private readonly _terminalService: ITerminalService,
		private readonly _workspaceContextService: IWorkspaceContextService,
	) {
	}

	async resolveShellLaunchConfig(shellLaunchConfig: IShellLaunchConfig, options: IShellLaunchConfigResolveOptions): Promise<void> {
		// TODO: Consider workspace trust

		// Resolve the shell and shell args
		let resolvedProfile: ITerminalProfile;
		if (shellLaunchConfig.executable) {
			resolvedProfile = await this._resolveProfile({
				path: shellLaunchConfig.executable,
				args: shellLaunchConfig.args,
				profileName: generatedProfileName
			}, options);
		} else {
			resolvedProfile = await this.getDefaultProfile(options);
		}
		shellLaunchConfig.executable = resolvedProfile.path;
		shellLaunchConfig.args = resolvedProfile.args;

		// TODO: Also resolve environment
	}

	async getDefaultShell(options: IShellLaunchConfigResolveOptions): Promise<string> {
		return (await this.getDefaultProfile(options)).path;
	}

	async getDefaultShellArgs(options: IShellLaunchConfigResolveOptions): Promise<string | string[]> {
		return (await this.getDefaultProfile(options)).args || [];
	}

	async getDefaultProfile(options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> {
		return this._resolveProfile(await this._getUnresolvedDefaultProfile(options), options);
	}

	getShellEnvironment(): Promise<IProcessEnvironment> {
		return this._context.getShellEnvironment();
	}

	private async _getUnresolvedDefaultProfile(options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> {
		// If automation shell is allowed, prefer that
		if (options.allowAutomationShell) {
			const automationShellProfile = this._getAutomationShellProfile(options);
			if (automationShellProfile) {
				return automationShellProfile;
			}
		}

		// Return the real default profile if it exists and is valid
		const defaultProfileName = this._configurationService.getValue(`terminal.integrated.defaultProfile.${this._getPlatformKey(options.platform)}`);
		if (defaultProfileName && typeof defaultProfileName === 'string') {
			const profiles = this._terminalService.getAvailableProfiles();
			const defaultProfile = profiles.find(e => e.profileName === defaultProfileName);
			if (defaultProfile) {
				return defaultProfile;
			}
		}

		// If there is no real default profile, create a synthetic default profile based on the
		// shell and shellArgs settings in addition to the current environment.
		return this._getSyntheticDefaultProfile(options);
	}

	private async _getSyntheticDefaultProfile(options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> {
		let executable: string;
		let args: string | string[] | undefined;
		const shellSetting = this._configurationService.getValue(`terminal.integrated.shell.${this._getPlatformKey(options.platform)}`);
		if (this._isValidShell(shellSetting)) {
			executable = shellSetting;
			const shellArgsSetting = this._configurationService.getValue(`terminal.integrated.shellArgs.${this._getPlatformKey(options.platform)}`);
			if (this._isValidShellArgs(shellArgsSetting, options.platform)) {
				args = shellArgsSetting || [];
			}
		} else {
			executable = await this._context.getDefaultSystemShell(options.platform);
		}

		const icon = this._guessProfileIcon(executable);

		return {
			profileName: generatedProfileName,
			path: executable,
			args,
			icon
		};
	}

	private _getAutomationShellProfile(options: IShellLaunchConfigResolveOptions): ITerminalProfile | undefined {
		const automationShell = this._configurationService.getValue(`terminal.integrated.automationShell.${this._getPlatformKey(options.platform)}`);
		if (!automationShell || typeof automationShell !== 'string') {
			return undefined;
		}
		return {
			path: automationShell,
			profileName: generatedProfileName
		};
	}

	private async _resolveProfile(profile: ITerminalProfile, options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> {
		if (options.platform === Platform.Windows) {
			// Change Sysnative to System32 if the OS is Windows but NOT WoW64. It's
			// safe to assume that this was used by accident as Sysnative does not
			// exist and will break the terminal in non-WoW64 environments.
			const env = await this._context.getShellEnvironment();
			const isWoW64 = !!env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
			const windir = env.windir;
			if (!isWoW64 && windir) {
				const sysnativePath = path.join(windir, 'Sysnative').replace(/\//g, '\\').toLowerCase();
				if (profile.path && profile.path.toLowerCase().indexOf(sysnativePath) === 0) {
					profile.path = path.join(windir, 'System32', profile.path.substr(sysnativePath.length + 1));
				}
			}

			// Convert / to \ on Windows for convenience
			if (profile.path && options.platform === Platform.Windows) {
				profile.path = profile.path.replace(/\//g, '\\');
			}
		}

		// Resolve path variables
		const env = await this._context.getShellEnvironment();
		const activeWorkspaceRootUri = this._historyService.getLastActiveWorkspaceRoot(Schemas.file);
		const lastActiveWorkspace = activeWorkspaceRootUri ? withNullAsUndefined(this._workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri)) : undefined;
		profile.path = this._resolveVariables(profile.path, env, lastActiveWorkspace);

		// Resolve args variables
		if (profile.args) {
			if (typeof profile.args === 'string') {
				profile.args = this._resolveVariables(profile.args, env, lastActiveWorkspace);
			} else {
				for (let i = 0; i < profile.args.length; i++) {
					profile.args[i] = this._resolveVariables(profile.args[i], env, lastActiveWorkspace);
				}
			}
		}

		return profile;
	}

	private _resolveVariables(value: string, env: IProcessEnvironment, lastActiveWorkspace: IWorkspaceFolder | undefined) {
		try {
			value = this._configurationResolverService.resolveWithEnvironment(env, lastActiveWorkspace, value);
		} catch (e) {
			this._logService.error(`Could not resolve shell`, e);
		}
		return value;
	}

	private _getPlatformKey(platform: Platform): string {
		switch (platform) {
			case Platform.Linux: return 'linux';
			case Platform.Mac: return 'osx';
			case Platform.Windows: return 'windows';
			default: return '';
		}
	}

	private _guessProfileIcon(shell: string): string | undefined {
		const file = path.parse(shell).name;
		switch (file) {
			case 'pwsh':
			case 'powershell':
				return Codicon.terminalPowershell.id;
			case 'tmux':
				return Codicon.terminalTmux.id;
			case 'cmd':
				return Codicon.terminalCmd.id;
			default:
				return undefined;
		}
	}

	private _isValidShell(shell: unknown): shell is string {
		if (!shell) {
			return false;
		}
		return typeof shell === 'string';
	}

	private _isValidShellArgs(shellArgs: unknown, platform: Platform): shellArgs is string | string[] | undefined {
		if (shellArgs === undefined) {
			return true;
		}
		if (platform === Platform.Windows && typeof shellArgs === 'string') {
			return true;
		}
		if (Array.isArray(shellArgs) && shellArgs.every(e => typeof e === 'string')) {
			return true;
		}
		return false;
	}
}

export class BrowserTerminalProfileResolverService extends BaseTerminalProfileResolverService {

	constructor(
		@IConfigurationResolverService configurationResolverService: IConfigurationResolverService,
		@IConfigurationService configurationService: IConfigurationService,
		@IHistoryService historyService: IHistoryService,
		@ILogService logService: ILogService,
		@IRemoteTerminalService remoteTerminalService: IRemoteTerminalService,
		@ITerminalService terminalService: ITerminalService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
	) {
		super(
			{
				getDefaultSystemShell: async platform => remoteTerminalService.getDefaultSystemShell(platform),
				// TODO: Get the actual shell environment from the server
				getShellEnvironment: async () => env
			},
			configurationService,
			configurationResolverService,
			historyService,
			logService,
			terminalService,
			workspaceContextService
		);
	}
}
