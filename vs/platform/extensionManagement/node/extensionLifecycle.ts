/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ILogService } from 'vs/platform/log/common/log';
import { fork, ChildProcess } from 'child_process';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { posix } from 'path';
import { Limiter } from 'vs/base/common/async';
import { fromNodeEventEmitter, anyEvent, mapEvent, debounceEvent } from 'vs/base/common/event';
import * as objects from 'vs/base/common/objects';
import { Schemas } from 'vs/base/common/network';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

export class ExtensionsLifecycle extends Disposable {

	private processesLimiter: Limiter<void> = new Limiter(5); // Run max 5 processes in parallel

	constructor(
		private environmentService: IEnvironmentService,
		private logService: ILogService
	) {
		super();
	}

	postUninstall(extension: ILocalExtension): Thenable<void> {
		const script = this.parseScript(extension, 'uninstall');
		if (script) {
			this.logService.info(extension.identifier.id, `Running post uninstall script`);
			return this.processesLimiter.queue(() =>
				this.runLifecycleHook(script.script, 'uninstall', script.args, true, extension)
					.then(() => this.logService.info(extension.identifier.id, `Finished running post uninstall script`), err => this.logService.error(extension.identifier.id, `Failed to run post uninstall script: ${err}`)));
		}
		return Promise.resolve();
	}

	postInstall(extension: ILocalExtension): Thenable<void> {
		const script = this.parseScript(extension, 'install');
		if (script) {
			this.logService.info(extension.identifier.id, `Running post install script`);
			return this.processesLimiter.queue(() =>
				this.runLifecycleHook(script.script, 'install', script.args, false, extension)
					.then(() => this.logService.info(extension.identifier.id, `Finished running post install script`),
						err => {
							this.logService.error(extension.identifier.id, `Failed to run post install script: ${err}`);
							return Promise.reject(err);
						}));
		}
		return Promise.resolve();
	}

	private parseScript(extension: ILocalExtension, type: string): { script: string, args: string[] } | null {
		const scriptKey = `vscode:${type}`;
		if (extension.location.scheme === Schemas.file && extension.manifest && extension.manifest['scripts'] && typeof extension.manifest['scripts'][scriptKey] === 'string') {
			const script = (<string>extension.manifest['scripts'][scriptKey]).split(' ');
			if (script.length < 2 || script[0] !== 'node' || !script[1]) {
				this.logService.warn(extension.identifier.id, `${scriptKey} should be a node script`);
				return null;
			}
			return { script: posix.join(extension.location.fsPath, script[1]), args: script.slice(2) || [] };
		}
		return null;
	}

	private runLifecycleHook(lifecycleHook: string, lifecycleType: string, args: string[], timeout: boolean, extension: ILocalExtension): Thenable<void> {
		const extensionStoragePath = posix.join(this.environmentService.globalStorageHome, extension.identifier.id.toLocaleLowerCase());
		return new Promise<void>((c, e) => {

			const extensionLifecycleProcess = this.start(lifecycleHook, lifecycleType, args, extension, extensionStoragePath);
			let timeoutHandler;

			const onexit = (error?: string) => {
				if (timeoutHandler) {
					clearTimeout(timeoutHandler);
					timeoutHandler = null;
				}
				if (error) {
					e(error);
				} else {
					c(void 0);
				}
			};

			// on error
			extensionLifecycleProcess.on('error', (err) => {
				onexit(toErrorMessage(err) || 'Unknown');
			});

			// on exit
			extensionLifecycleProcess.on('exit', (code: number, signal: string) => {
				onexit(code ? `post-${lifecycleType} process exited with code ${code}` : void 0);
			});

			if (timeout) {
				// timeout: kill process after waiting for 5s
				timeoutHandler = setTimeout(() => {
					timeoutHandler = null;
					extensionLifecycleProcess.kill();
					e('timed out');
				}, 5000);
			}
		});
	}

	private start(uninstallHook: string, lifecycleType: string, args: string[], extension: ILocalExtension, extensionStoragePath: string): ChildProcess {
		const opts = {
			silent: true,
			execArgv: undefined,
			env: objects.mixin(objects.deepClone(process.env), {
				VSCODE_EXTENSION_STORAGE_LOCATION: extensionStoragePath
			})
		};
		const extensionUninstallProcess = fork(uninstallHook, [`--type=extension-post-${lifecycleType}`, ...args], opts);

		// Catch all output coming from the process
		type Output = { data: string, format: string[] };
		extensionUninstallProcess.stdout.setEncoding('utf8');
		extensionUninstallProcess.stderr.setEncoding('utf8');

		const onStdout = fromNodeEventEmitter<string>(extensionUninstallProcess.stdout, 'data');
		const onStderr = fromNodeEventEmitter<string>(extensionUninstallProcess.stderr, 'data');

		// Log output
		onStdout(data => this.logService.info(extension.identifier.id, `post-${lifecycleType}`, data));
		onStderr(data => this.logService.error(extension.identifier.id, `post-${lifecycleType}`, data));

		const onOutput = anyEvent(
			mapEvent(onStdout, o => ({ data: `%c${o}`, format: [''] })),
			mapEvent(onStderr, o => ({ data: `%c${o}`, format: ['color: red'] }))
		);
		// Debounce all output, so we can render it in the Chrome console as a group
		const onDebouncedOutput = debounceEvent<Output>(onOutput, (r, o) => {
			return r
				? { data: r.data + o.data, format: [...r.format, ...o.format] }
				: { data: o.data, format: o.format };
		}, 100);

		// Print out output
		onDebouncedOutput(data => {
			console.group(extension.identifier.id);
			console.log(data.data, ...data.format);
			console.groupEnd();
		});

		return extensionUninstallProcess;
	}
}
