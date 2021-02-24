/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IPtyService, IProcessDataEvent, IShellLaunchConfig, ITerminalDimensionsOverride, ITerminalLaunchError, ITerminalsLayoutInfo, TerminalIpcChannels, IHeartbeatService, HeartbeatConstants } from 'vs/platform/terminal/common/terminal';
import { Client } from 'vs/base/parts/ipc/node/ipc.cp';
import { FileAccess } from 'vs/base/common/network';
import { ProxyChannel } from 'vs/base/parts/ipc/common/ipc';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { Emitter } from 'vs/base/common/event';
import { LogLevelChannelClient } from 'vs/platform/log/common/logIpc';
import { IGetTerminalLayoutInfoArgs, IPtyHostProcessReplayEvent, ISetTerminalLayoutInfoArgs } from 'vs/platform/terminal/common/terminalProcess';

enum Constants {
	MaxRestarts = 5
}

/**
 * Tracks the last terminal ID from the pty host so we can give it to the new pty host if it's
 * restarted and avoid ID conflicts.
 */
let lastPtyId = 0;

export class LocalPtyService extends Disposable implements IPtyService {
	declare readonly _serviceBrand: undefined;

	private _client: Client;
	// ProxyChannel is not used here because events get lost when forwarding across multiple proxies
	private _proxy: IPtyService;

	private _restartCount = 0;
	private _isDisposed = false;

	private _heartbeatFirstTimeout?: NodeJS.Timeout;
	private _heartbeatSecondTimeout?: NodeJS.Timeout;

	private readonly _onPtyHostExit = this._register(new Emitter<number>());
	readonly onPtyHostExit = this._onPtyHostExit.event;
	private readonly _onPtyHostStart = this._register(new Emitter<void>());
	readonly onPtyHostStart = this._onPtyHostStart.event;
	private readonly _onPtyHostUnresponsive = this._register(new Emitter<void>());
	readonly onPtyHostUnresponsive = this._onPtyHostUnresponsive.event;

	private readonly _onProcessData = this._register(new Emitter<{ id: number, event: IProcessDataEvent | string }>());
	readonly onProcessData = this._onProcessData.event;
	private readonly _onProcessExit = this._register(new Emitter<{ id: number, event: number | undefined }>());
	readonly onProcessExit = this._onProcessExit.event;
	private readonly _onProcessReady = this._register(new Emitter<{ id: number, event: { pid: number, cwd: string } }>());
	readonly onProcessReady = this._onProcessReady.event;
	private readonly _onProcessReplay = this._register(new Emitter<{ id: number, event: IPtyHostProcessReplayEvent }>());
	readonly onProcessReplay = this._onProcessReplay.event;
	private readonly _onProcessTitleChanged = this._register(new Emitter<{ id: number, event: string }>());
	readonly onProcessTitleChanged = this._onProcessTitleChanged.event;
	private readonly _onProcessOverrideDimensions = this._register(new Emitter<{ id: number, event: ITerminalDimensionsOverride | undefined }>());
	readonly onProcessOverrideDimensions = this._onProcessOverrideDimensions.event;
	private readonly _onProcessResolvedShellLaunchConfig = this._register(new Emitter<{ id: number, event: IShellLaunchConfig }>());
	readonly onProcessResolvedShellLaunchConfig = this._onProcessResolvedShellLaunchConfig.event;

	constructor(
		@ILogService private readonly _logService: ILogService
	) {
		super();

		this._register(toDisposable(() => this._disposePtyHost()));

		[this._client, this._proxy] = this._startPtyHost();
	}

	private _startPtyHost(): [Client, IPtyService] {
		const client = this._register(new Client(
			FileAccess.asFileUri('bootstrap-fork', require).fsPath,
			{
				serverName: 'Pty Host',
				args: ['--type=ptyHost'],
				env: {
					VSCODE_LAST_PTY_ID: lastPtyId,
					VSCODE_AMD_ENTRYPOINT: 'vs/platform/terminal/node/ptyHostMain',
					VSCODE_PIPE_LOGGING: 'true',
					VSCODE_VERBOSE_LOGGING: 'true' // transmit console logs from server to client
				}
			}
		));
		this._onPtyHostStart.fire();

		const heartbeatService = ProxyChannel.toService<IHeartbeatService>(client.getChannel(TerminalIpcChannels.Heartbeat));
		heartbeatService.onBeat(() => this._handleHeartbeat());

		// Handle exit
		this._register(client.onDidProcessExit(e => {
			this._onPtyHostExit.fire(e.code);
			if (!this._isDisposed) {
				if (this._restartCount <= Constants.MaxRestarts) {
					this._logService.error(`ptyHost terminated unexpectedly with code ${e.code}`);
					this._restartCount++;
					this.restartPtyHost();
				} else {
					this._logService.error(`ptyHost terminated unexpectedly with code ${e.code}, giving up`);
				}
			}
		}));

		// Setup logging
		const logChannel = client.getChannel(TerminalIpcChannels.Log);
		this._register(this._logService.onDidChangeLogLevel(() => {
			LogLevelChannelClient.setLevel(logChannel, this._logService.getLevel());
		}));

		// Create proxy and forward events
		const proxy = ProxyChannel.toService<IPtyService>(client.getChannel(TerminalIpcChannels.PtyHost));
		this._register(proxy.onProcessData(e => this._onProcessData.fire(e)));
		this._register(proxy.onProcessExit(e => this._onProcessExit.fire(e)));
		this._register(proxy.onProcessReady(e => this._onProcessReady.fire(e)));
		this._register(proxy.onProcessTitleChanged(e => this._onProcessTitleChanged.fire(e)));
		this._register(proxy.onProcessOverrideDimensions(e => this._onProcessOverrideDimensions.fire(e)));
		this._register(proxy.onProcessResolvedShellLaunchConfig(e => this._onProcessResolvedShellLaunchConfig.fire(e)));
		this._register(proxy.onProcessReplay(e => this._onProcessReplay.fire(e)));

		return [client, proxy];
	}

	dispose() {
		this._isDisposed = true;
		super.dispose();
	}

	async createProcess(shellLaunchConfig: IShellLaunchConfig, cwd: string, cols: number, rows: number, env: IProcessEnvironment, executableEnv: IProcessEnvironment, windowsEnableConpty: boolean, workspaceId: string, workspaceName: string): Promise<number> {
		const timeout = setTimeout(() => this._handleUnresponsiveCreateProcess(), HeartbeatConstants.CreateProcessTimeout);
		const id = await this._proxy.createProcess(shellLaunchConfig, cwd, cols, rows, env, executableEnv, windowsEnableConpty, workspaceId, workspaceName);
		clearTimeout(timeout);
		lastPtyId = Math.max(lastPtyId, id);
		return id;
	}
	attachToProcess(id: number): Promise<void> {
		return this._proxy.attachToProcess(id);
	}
	detachFromProcess(id: number): Promise<void> {
		return this._proxy.detachFromProcess(id);
	}

	start(id: number): Promise<ITerminalLaunchError | undefined> {
		return this._proxy.start(id);
	}
	shutdown(id: number, immediate: boolean): Promise<void> {
		return this._proxy.shutdown(id, immediate);
	}
	input(id: number, data: string): Promise<void> {
		return this._proxy.input(id, data);
	}
	resize(id: number, cols: number, rows: number): Promise<void> {
		return this._proxy.resize(id, cols, rows);
	}
	acknowledgeDataEvent(id: number, charCount: number): Promise<void> {
		return this._proxy.acknowledgeDataEvent(id, charCount);
	}
	getInitialCwd(id: number): Promise<string> {
		return this._proxy.getInitialCwd(id);
	}
	getCwd(id: number): Promise<string> {
		return this._proxy.getCwd(id);
	}
	getLatency(id: number): Promise<number> {
		return this._proxy.getLatency(id);
	}
	setTerminalLayoutInfo(args: ISetTerminalLayoutInfoArgs): void {
		return this._proxy.setTerminalLayoutInfo(args);
	}
	async getTerminalLayoutInfo(args: IGetTerminalLayoutInfoArgs): Promise<ITerminalsLayoutInfo | undefined> {
		return await this._proxy.getTerminalLayoutInfo(args);
	}

	async restartPtyHost(): Promise<void> {
		this._disposePtyHost();
		[this._client, this._proxy] = this._startPtyHost();
	}

	private _disposePtyHost(): void {
		if (this._proxy.shutdownAll) {
			this._proxy.shutdownAll();
		}
		this._client.dispose();
	}

	private _handleHeartbeat() {
		this._clearHeartbeatTimeouts();
		this._heartbeatFirstTimeout = setTimeout(() => this._handleHeartbeatFirstTimeout(), HeartbeatConstants.BeatInterval * HeartbeatConstants.FirstWaitMultiplier);
	}

	private _handleHeartbeatFirstTimeout() {
		this._logService.warn(`No ptyHost heartbeat after ${HeartbeatConstants.BeatInterval * HeartbeatConstants.FirstWaitMultiplier / 1000} seconds`);
		this._heartbeatFirstTimeout = undefined;
		this._heartbeatSecondTimeout = setTimeout(() => this._handleHeartbeatSecondTimeout(), HeartbeatConstants.BeatInterval * HeartbeatConstants.SecondWaitMultiplier);
	}

	private _handleHeartbeatSecondTimeout() {
		this._logService.error(`No ptyHost heartbeat after ${(HeartbeatConstants.BeatInterval * HeartbeatConstants.FirstWaitMultiplier + HeartbeatConstants.BeatInterval * HeartbeatConstants.FirstWaitMultiplier) / 1000} seconds`);
		this._heartbeatSecondTimeout = undefined;
		this._onPtyHostUnresponsive.fire();
	}

	private _handleUnresponsiveCreateProcess() {
		this._clearHeartbeatTimeouts();
		this._logService.error(`No ptyHost response to createProcess after ${HeartbeatConstants.CreateProcessTimeout / 1000} seconds`);
		this._onPtyHostUnresponsive.fire();
	}

	private _clearHeartbeatTimeouts() {
		if (this._heartbeatFirstTimeout) {
			clearTimeout(this._heartbeatFirstTimeout);
			this._heartbeatFirstTimeout = undefined;
		}
		if (this._heartbeatSecondTimeout) {
			clearTimeout(this._heartbeatSecondTimeout);
			this._heartbeatSecondTimeout = undefined;
		}
	}
}
