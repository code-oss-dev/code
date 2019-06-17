/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer as ipc } from 'electron';
import { IOpenFileRequest } from 'vs/platform/windows/common/windows';
import { ITerminalNativeService, LinuxDistro, IShellDefinition } from 'vs/workbench/contrib/terminal/common/terminal';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { getWindowsBuildNumber, linuxDistro, detectWindowsShells } from 'vs/workbench/contrib/terminal/node/terminal';
import { escapeNonWindowsPath } from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { execFile } from 'child_process';
import { Emitter, Event } from 'vs/base/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export class TerminalNativeService implements ITerminalNativeService {
	public _serviceBrand: any;

	public get linuxDistro(): LinuxDistro { return linuxDistro; }

	private readonly _onOpenFileRequest = new Emitter<IOpenFileRequest>();
	public get onOpenFileRequest(): Event<IOpenFileRequest> { return this._onOpenFileRequest.event; }
	private readonly _onOsResume = new Emitter<void>();
	public get onOsResume(): Event<void> { return this._onOsResume.event; }

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService readonly instantiationService: IInstantiationService,
	) {
		ipc.on('vscode:openFiles', (_event: any, request: IOpenFileRequest) => this._onOpenFileRequest.fire(request));
		ipc.on('vscode:osResume', () => this._onOsResume.fire());
	}

	public whenFileDeleted(path: URI): Promise<void> {
		// Complete when wait marker file is deleted
		return new Promise<void>(resolve => {
			let running = false;
			const interval = setInterval(() => {
				if (!running) {
					running = true;
					this._fileService.exists(path).then(exists => {
						running = false;

						if (!exists) {
							clearInterval(interval);
							resolve(undefined);
						}
					});
				}
			}, 1000);
		});
	}

	public detectWindowsShells(): Promise<IShellDefinition[]> {
		return detectWindowsShells();
	}

	/**
	 * Converts a path to a path on WSL using the wslpath utility.
	 * @param path The original path.
	 */
	public getWslPath(path: string): Promise<string> {
		if (getWindowsBuildNumber() < 17063) {
			throw new Error('wslpath does not exist on Windows build < 17063');
		}
		return new Promise<string>(c => {
			execFile('bash.exe', ['-c', 'echo $(wslpath ' + escapeNonWindowsPath(path) + ')'], {}, (error, stdout, stderr) => {
				c(escapeNonWindowsPath(stdout.trim()));
			});
		});
	}

	public getWindowsBuildNumber(): number {
		return getWindowsBuildNumber();
	}
}