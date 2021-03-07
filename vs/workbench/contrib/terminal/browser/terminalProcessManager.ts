/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/base/common/platform';
import * as terminalEnvironment from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { env as processEnv } from 'vs/base/common/process';
import { ProcessState, ITerminalProcessManager, ITerminalConfigHelper, IBeforeProcessDataEvent } from 'vs/workbench/contrib/terminal/common/terminal';
import { ILogService } from 'vs/platform/log/common/log';
import { Emitter, Event } from 'vs/base/common/event';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { TerminalProcessExtHostProxy } from 'vs/workbench/contrib/terminal/browser/terminalProcessExtHostProxy';
import { IInstantiationService, optional } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { Schemas } from 'vs/base/common/network';
import { getRemoteAuthority } from 'vs/platform/remote/common/remoteHosts';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IProductService } from 'vs/platform/product/common/productService';
import { IRemoteTerminalService, ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { withNullAsUndefined } from 'vs/base/common/types';
import { EnvironmentVariableInfoChangesActive, EnvironmentVariableInfoStale } from 'vs/workbench/contrib/terminal/browser/environmentVariableInfo';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { URI } from 'vs/base/common/uri';
import { IEnvironmentVariableInfo, IEnvironmentVariableService, IMergedEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { IProcessDataEvent, IShellLaunchConfig, ITerminalChildProcess, ITerminalDimensionsOverride, ITerminalEnvironment, ITerminalLaunchError, FlowControlConstants, TerminalShellType, ILocalTerminalService, IOffProcessTerminalService } from 'vs/platform/terminal/common/terminal';

/** The amount of time to consider terminal errors to be related to the launch */
const LAUNCHING_DURATION = 500;

/**
 * The minimum amount of time between latency requests.
 */
const LATENCY_MEASURING_INTERVAL = 1000;

enum ProcessType {
	Process,
	ExtensionTerminal
}

/**
 * Holds all state related to the creation and management of terminal processes.
 *
 * Internal definitions:
 * - Process: The process launched with the terminalProcess.ts file, or the pty as a whole
 * - Pty Process: The pseudoterminal parent process (or the conpty/winpty agent process)
 * - Shell Process: The pseudoterminal child process (ie. the shell)
 */
export class TerminalProcessManager extends Disposable implements ITerminalProcessManager {
	public processState: ProcessState = ProcessState.UNINITIALIZED;
	public ptyProcessReady: Promise<void>;
	public shellProcessId: number | undefined;
	public remoteAuthority: string | undefined;
	public os: platform.OperatingSystem | undefined;
	public userHome: string | undefined;
	public isDisconnected: boolean = false;

	private _isDisposed: boolean = false;
	private _process: ITerminalChildProcess | null = null;
	private _processType: ProcessType = ProcessType.Process;
	private _preLaunchInputQueue: string[] = [];
	private _latency: number = -1;
	private _latencyLastMeasured: number = 0;
	private _initialCwd: string | undefined;
	private _extEnvironmentVariableCollection: IMergedEnvironmentVariableCollection | undefined;
	private _environmentVariableInfo: IEnvironmentVariableInfo | undefined;
	private _ackDataBufferer: AckDataBufferer;
	private _hasWrittenData: boolean = false;
	private _ptyResponsiveListener: IDisposable | undefined;

	private readonly _onPtyDisconnect = this._register(new Emitter<void>());
	public get onPtyDisconnect(): Event<void> { return this._onPtyDisconnect.event; }
	private readonly _onPtyReconnect = this._register(new Emitter<void>());
	public get onPtyReconnect(): Event<void> { return this._onPtyReconnect.event; }

	private readonly _onProcessReady = this._register(new Emitter<void>());
	public get onProcessReady(): Event<void> { return this._onProcessReady.event; }
	private readonly _onBeforeProcessData = this._register(new Emitter<IBeforeProcessDataEvent>());
	public get onBeforeProcessData(): Event<IBeforeProcessDataEvent> { return this._onBeforeProcessData.event; }
	private readonly _onProcessData = this._register(new Emitter<IProcessDataEvent>());
	public get onProcessData(): Event<IProcessDataEvent> { return this._onProcessData.event; }
	private readonly _onProcessTitle = this._register(new Emitter<string>());
	public get onProcessTitle(): Event<string> { return this._onProcessTitle.event; }
	private readonly _onProcessShellTypeChanged = this._register(new Emitter<TerminalShellType>());
	public get onProcessShellTypeChanged(): Event<TerminalShellType> { return this._onProcessShellTypeChanged.event; }
	private readonly _onProcessExit = this._register(new Emitter<number | undefined>());
	public get onProcessExit(): Event<number | undefined> { return this._onProcessExit.event; }
	private readonly _onProcessOverrideDimensions = this._register(new Emitter<ITerminalDimensionsOverride | undefined>());
	public get onProcessOverrideDimensions(): Event<ITerminalDimensionsOverride | undefined> { return this._onProcessOverrideDimensions.event; }
	private readonly _onProcessOverrideShellLaunchConfig = this._register(new Emitter<IShellLaunchConfig>());
	public get onProcessResolvedShellLaunchConfig(): Event<IShellLaunchConfig> { return this._onProcessOverrideShellLaunchConfig.event; }
	private readonly _onEnvironmentVariableInfoChange = this._register(new Emitter<IEnvironmentVariableInfo>());
	public get onEnvironmentVariableInfoChanged(): Event<IEnvironmentVariableInfo> { return this._onEnvironmentVariableInfoChange.event; }

	public get environmentVariableInfo(): IEnvironmentVariableInfo | undefined { return this._environmentVariableInfo; }
	public get persistentProcessId(): number | undefined { return this._process?.id; }
	public get shouldPersist(): boolean { return this._process ? this._process.shouldPersist : false; }

	public get hasWrittenData(): boolean {
		return this._hasWrittenData;
	}

	private readonly _localTerminalService?: ILocalTerminalService;

	constructor(
		private readonly _instanceId: number,
		private readonly _configHelper: ITerminalConfigHelper,
		@IHistoryService private readonly _historyService: IHistoryService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IConfigurationResolverService private readonly _configurationResolverService: IConfigurationResolverService,
		@IConfigurationService private readonly _workspaceConfigurationService: IConfigurationService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IProductService private readonly _productService: IProductService,
		@ITerminalInstanceService private readonly _terminalInstanceService: ITerminalInstanceService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IPathService private readonly _pathService: IPathService,
		@IEnvironmentVariableService private readonly _environmentVariableService: IEnvironmentVariableService,
		@IRemoteTerminalService private readonly _remoteTerminalService: IRemoteTerminalService,
		@optional(ILocalTerminalService) localTerminalService: ILocalTerminalService,
	) {
		super();
		this._localTerminalService = localTerminalService;

		this.ptyProcessReady = new Promise<void>(c => {
			this.onProcessReady(() => {
				this._logService.debug(`Terminal process ready (shellProcessId: ${this.shellProcessId})`);
				c(undefined);
			});
		});
		this.ptyProcessReady.then(async () => await this.getLatency());
		this._ackDataBufferer = new AckDataBufferer(e => this._process?.acknowledgeDataEvent(e));
	}

	public dispose(immediate: boolean = false): void {
		this._isDisposed = true;
		if (this._process) {
			// If the process was still connected this dispose came from
			// within VS Code, not the process, so mark the process as
			// killed by the user.
			this.processState = ProcessState.KILLED_BY_USER;
			this._process.shutdown(immediate);
			this._process = null;
		}
		super.dispose();
	}

	public detachFromProcess(): void {
		if (this._process?.detach) {
			this._process.detach();
		}
	}

	public async createProcess(
		shellLaunchConfig: IShellLaunchConfig,
		cols: number,
		rows: number,
		isScreenReaderModeEnabled: boolean
	): Promise<ITerminalLaunchError | undefined> {
		if (shellLaunchConfig.isExtensionCustomPtyTerminal) {
			this._processType = ProcessType.ExtensionTerminal;
			this._process = this._instantiationService.createInstance(TerminalProcessExtHostProxy, this._instanceId, shellLaunchConfig, cols, rows);
		} else {
			const forceExtHostProcess = (this._configHelper.config as any).extHostProcess;
			if (shellLaunchConfig.cwd && typeof shellLaunchConfig.cwd === 'object') {
				this.remoteAuthority = getRemoteAuthority(shellLaunchConfig.cwd);
			} else {
				this.remoteAuthority = this._environmentService.remoteAuthority;
			}
			const hasRemoteAuthority = !!this.remoteAuthority;
			let launchRemotely = hasRemoteAuthority || forceExtHostProcess;

			// resolvedUserHome is needed here as remote resolvers can launch local terminals before
			// they're connected to the remote.
			this.userHome = this._pathService.resolvedUserHome?.fsPath;
			this.os = platform.OS;
			if (launchRemotely) {
				const userHomeUri = await this._pathService.userHome();
				this.userHome = userHomeUri.path;
				if (hasRemoteAuthority) {
					this._remoteAgentService.getEnvironment().then(remoteEnv => {
						if (remoteEnv) {
							this.userHome = remoteEnv.userHome.path;
							this.os = remoteEnv.os;
						}
					});
				}

				const activeWorkspaceRootUri = this._historyService.getLastActiveWorkspaceRoot();

				// this is a copy of what the merged environment collection is on the remote side
				await this._setupEnvVariableInfo(activeWorkspaceRootUri, shellLaunchConfig);

				const shouldPersist = !shellLaunchConfig.isFeatureTerminal && this._configHelper.config.enablePersistentSessions;
				if (shellLaunchConfig.attachPersistentProcess) {
					const result = await this._remoteTerminalService.attachToProcess(shellLaunchConfig.attachPersistentProcess.id);
					if (result) {
						this._process = result;
					} else {
						this._logService.trace(`Attach to process failed for terminal ${shellLaunchConfig.attachPersistentProcess}`);
						return undefined;
					}
				} else {
					this._process = await this._remoteTerminalService.createProcess(shellLaunchConfig, activeWorkspaceRootUri, cols, rows, shouldPersist, this._configHelper);
				}
				if (!this._isDisposed) {
					this._setupPtyHostListeners(this._remoteTerminalService);
				}
			} else {
				if (!this._localTerminalService) {
					this._logService.trace(`Tried to launch a local terminal which is not supported in this window`);
					return undefined;
				}
				if (shellLaunchConfig.attachPersistentProcess) {
					const result = await this._localTerminalService.attachToProcess(shellLaunchConfig.attachPersistentProcess.id);
					if (result) {
						this._process = result;
					} else {
						this._logService.trace(`Attach to process failed for terminal ${shellLaunchConfig.attachPersistentProcess}`);
						return undefined;
					}
				} else {
					this._process = await this._launchLocalProcess(this._localTerminalService, shellLaunchConfig, cols, rows, this.userHome, isScreenReaderModeEnabled);
				}
				if (!this._isDisposed) {
					this._setupPtyHostListeners(this._localTerminalService);
				}
			}
		}

		// If the process was disposed during its creation, shut it down and return failure
		if (this._isDisposed) {
			this._process.shutdown(false);
			return undefined;
		}

		this.processState = ProcessState.LAUNCHING;

		this._process.onProcessData(ev => {
			const data = (typeof ev === 'string' ? ev : ev.data);
			const sync = (typeof ev === 'string' ? false : ev.sync);
			const beforeProcessDataEvent: IBeforeProcessDataEvent = { data };
			this._onBeforeProcessData.fire(beforeProcessDataEvent);
			if (beforeProcessDataEvent.data && beforeProcessDataEvent.data.length > 0) {
				this._onProcessData.fire({ data: beforeProcessDataEvent.data, sync });
			}
		});

		this._process.onProcessReady((e: { pid: number, cwd: string }) => {
			this.shellProcessId = e.pid;
			this._initialCwd = e.cwd;
			this._onProcessReady.fire();

			if (this._preLaunchInputQueue.length > 0 && this._process) {
				// Send any queued data that's waiting
				this._process.input(this._preLaunchInputQueue.join(''));
				this._preLaunchInputQueue.length = 0;
			}
		});

		this._process.onProcessTitleChanged(title => this._onProcessTitle.fire(title));
		this._process.onProcessShellTypeChanged(type => this._onProcessShellTypeChanged.fire(type));
		this._process.onProcessExit(exitCode => this._onExit(exitCode));
		if (this._process.onProcessOverrideDimensions) {
			this._process.onProcessOverrideDimensions(e => this._onProcessOverrideDimensions.fire(e));
		}
		if (this._process.onProcessResolvedShellLaunchConfig) {
			this._process.onProcessResolvedShellLaunchConfig(e => this._onProcessOverrideShellLaunchConfig.fire(e));
		}

		setTimeout(() => {
			if (this.processState === ProcessState.LAUNCHING) {
				this.processState = ProcessState.RUNNING;
			}
		}, LAUNCHING_DURATION);

		const result = await this._process.start();
		if (result) {
			// Error
			return result;
		}

		return undefined;
	}

	// Fetch any extension environment additions and apply them
	private async _setupEnvVariableInfo(activeWorkspaceRootUri: URI | undefined, shellLaunchConfig: IShellLaunchConfig): Promise<platform.IProcessEnvironment> {
		const platformKey = platform.isWindows ? 'windows' : (platform.isMacintosh ? 'osx' : 'linux');
		const lastActiveWorkspace = activeWorkspaceRootUri ? withNullAsUndefined(this._workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri)) : undefined;
		const envFromConfigValue = this._workspaceConfigurationService.inspect<ITerminalEnvironment | undefined>(`terminal.integrated.env.${platformKey}`);
		const isWorkspaceShellAllowed = this._configHelper.checkWorkspaceShellPermissions();
		this._configHelper.showRecommendations(shellLaunchConfig);
		const baseEnv = this._configHelper.config.inheritEnv ? processEnv : await this._terminalInstanceService.getMainProcessParentEnv();
		const variableResolver = terminalEnvironment.createVariableResolver(lastActiveWorkspace, this._configurationResolverService);
		const env = terminalEnvironment.createTerminalEnvironment(shellLaunchConfig, envFromConfigValue, variableResolver, isWorkspaceShellAllowed, this._productService.version, this._configHelper.config.detectLocale, baseEnv);

		if (!shellLaunchConfig.strictEnv && !shellLaunchConfig.hideFromUser) {
			this._extEnvironmentVariableCollection = this._environmentVariableService.mergedCollection;
			this._register(this._environmentVariableService.onDidChangeCollections(newCollection => this._onEnvironmentVariableCollectionChange(newCollection)));
			// For remote terminals, this is a copy of the mergedEnvironmentCollection created on
			// the remote side. Since the environment collection is synced between the remote and
			// local sides immediately this is a fairly safe way of enabling the env var diffing and
			// info widget. While technically these could differ due to the slight change of a race
			// condition, the chance is minimal plus the impact on the user is also not that great
			// if it happens - it's not worth adding plumbing to sync back the resolved collection.
			this._extEnvironmentVariableCollection.applyToProcessEnvironment(env, variableResolver);
			if (this._extEnvironmentVariableCollection.map.size > 0) {
				this._environmentVariableInfo = new EnvironmentVariableInfoChangesActive(this._extEnvironmentVariableCollection);
				this._onEnvironmentVariableInfoChange.fire(this._environmentVariableInfo);
			}
		}
		return env;
	}

	private async _launchLocalProcess(
		localTerminalService: ILocalTerminalService,
		shellLaunchConfig: IShellLaunchConfig,
		cols: number,
		rows: number,
		userHome: string | undefined,
		isScreenReaderModeEnabled: boolean
	): Promise<ITerminalChildProcess> {
		const activeWorkspaceRootUri = this._historyService.getLastActiveWorkspaceRoot(Schemas.file);
		const lastActiveWorkspace = activeWorkspaceRootUri ? withNullAsUndefined(this._workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri)) : undefined;
		if (!shellLaunchConfig.executable) {
			const defaultConfig = await this._terminalInstanceService.getDefaultShellAndArgs(false);
			shellLaunchConfig.executable = defaultConfig.shell;
			shellLaunchConfig.args = defaultConfig.args;
		} else {
			shellLaunchConfig.executable = this._configurationResolverService.resolve(lastActiveWorkspace, shellLaunchConfig.executable);
			if (shellLaunchConfig.args) {
				if (Array.isArray(shellLaunchConfig.args)) {
					const resolvedArgs: string[] = [];
					for (const arg of shellLaunchConfig.args) {
						resolvedArgs.push(this._configurationResolverService.resolve(lastActiveWorkspace, arg));
					}
					shellLaunchConfig.args = resolvedArgs;
				} else {
					shellLaunchConfig.args = this._configurationResolverService.resolve(lastActiveWorkspace, shellLaunchConfig.args);
				}
			}
		}

		const initialCwd = terminalEnvironment.getCwd(
			shellLaunchConfig,
			userHome,
			terminalEnvironment.createVariableResolver(lastActiveWorkspace, this._configurationResolverService),
			activeWorkspaceRootUri,
			this._configHelper.config.cwd,
			this._logService
		);

		const env = await this._setupEnvVariableInfo(activeWorkspaceRootUri, shellLaunchConfig);

		const useConpty = this._configHelper.config.windowsEnableConpty && !isScreenReaderModeEnabled;
		const shouldPersist = this._configHelper.config.enablePersistentSessions && !shellLaunchConfig.isFeatureTerminal;

		return await localTerminalService.createProcess(shellLaunchConfig, initialCwd, cols, rows, env, useConpty, shouldPersist);
	}

	private _setupPtyHostListeners(offProcessTerminalService: IOffProcessTerminalService) {
		this._register(offProcessTerminalService.onPtyHostUnresponsive(() => {
			this.isDisconnected = true;
			this._onPtyDisconnect.fire();
		}));
		this._ptyResponsiveListener = offProcessTerminalService.onPtyHostResponsive(() => {
			this.isDisconnected = false;
			this._onPtyReconnect.fire();
		});
		this._register(toDisposable(() => this._ptyResponsiveListener?.dispose()));
		this._register(offProcessTerminalService.onPtyHostRestart(() => {
			// When the pty host restarts, reconnect is no longer possible
			if (!this.isDisconnected) {
				this.isDisconnected = true;
				this._onPtyDisconnect.fire();
			}
			this._ptyResponsiveListener?.dispose();
			this._ptyResponsiveListener = undefined;
		}));
	}

	public setDimensions(cols: number, rows: number): void {
		if (!this._process) {
			return;
		}

		// The child process could already be terminated
		try {
			this._process.resize(cols, rows);
		} catch (error) {
			// We tried to write to a closed pipe / channel.
			if (error.code !== 'EPIPE' && error.code !== 'ERR_IPC_CHANNEL_CLOSED') {
				throw (error);
			}
		}
	}

	public write(data: string): void {
		this._hasWrittenData = true;
		if (this.shellProcessId || this._processType === ProcessType.ExtensionTerminal) {
			if (this._process) {
				// Send data if the pty is ready
				this._process.input(data);
			}
		} else {
			// If the pty is not ready, queue the data received to send later
			this._preLaunchInputQueue.push(data);
		}
	}

	public getInitialCwd(): Promise<string> {
		return Promise.resolve(this._initialCwd ? this._initialCwd : '');
	}

	public getCwd(): Promise<string> {
		if (!this._process) {
			return Promise.resolve('');
		}
		return this._process.getCwd();
	}

	public async getLatency(): Promise<number> {
		await this.ptyProcessReady;
		if (!this._process) {
			return Promise.resolve(0);
		}
		if (this._latencyLastMeasured === 0 || this._latencyLastMeasured + LATENCY_MEASURING_INTERVAL < Date.now()) {
			const latencyRequest = this._process.getLatency();
			this._latency = await latencyRequest;
			this._latencyLastMeasured = Date.now();
		}
		return Promise.resolve(this._latency);
	}

	public acknowledgeDataEvent(charCount: number): void {
		this._ackDataBufferer.ack(charCount);
	}

	private _onExit(exitCode: number | undefined): void {
		this._process = null;

		// If the process is marked as launching then mark the process as killed
		// during launch. This typically means that there is a problem with the
		// shell and args.
		if (this.processState === ProcessState.LAUNCHING) {
			this.processState = ProcessState.KILLED_DURING_LAUNCH;
		}

		// If TerminalInstance did not know about the process exit then it was
		// triggered by the process, not on VS Code's side.
		if (this.processState === ProcessState.RUNNING) {
			this.processState = ProcessState.KILLED_BY_PROCESS;
		}

		this._onProcessExit.fire(exitCode);
	}

	private _onEnvironmentVariableCollectionChange(newCollection: IMergedEnvironmentVariableCollection): void {
		const diff = this._extEnvironmentVariableCollection!.diff(newCollection);
		if (diff === undefined) {
			return;
		}
		this._environmentVariableInfo = this._instantiationService.createInstance(EnvironmentVariableInfoStale, diff, this._instanceId);
		this._onEnvironmentVariableInfoChange.fire(this._environmentVariableInfo);
	}
}

class AckDataBufferer {
	private _unsentCharCount: number = 0;

	constructor(
		private readonly _callback: (charCount: number) => void
	) {
	}

	ack(charCount: number) {
		this._unsentCharCount += charCount;
		while (this._unsentCharCount > FlowControlConstants.CharCountAckSize) {
			this._unsentCharCount -= FlowControlConstants.CharCountAckSize;
			this._callback(FlowControlConstants.CharCountAckSize);
		}
	}
}
