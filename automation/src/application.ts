/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Workbench } from './workbench';
import { Code, launch, LaunchOptions } from './code';
import { Logger, measureAndLog } from './logger';
import { PlaywrightDriver } from './playwrightBrowserDriver';

export const enum Quality {
	Dev,
	Insiders,
	Stable
}

export interface ApplicationOptions extends LaunchOptions {
	quality: Quality;
	workspacePath: string;
	waitTime: number;
}

export class Application {

	constructor(private options: ApplicationOptions) {
		this._userDataPath = options.userDataDir;
		this._workspacePathOrFolder = options.workspacePath;
	}

	private _code: Code | undefined;
	get code(): Code { return this._code!; }

	private _workbench: Workbench | undefined;
	get workbench(): Workbench { return this._workbench!; }

	get quality(): Quality {
		return this.options.quality;
	}

	get logger(): Logger {
		return this.options.logger;
	}

	get remote(): boolean {
		return !!this.options.remote;
	}

	get web(): boolean {
		return !!this.options.web;
	}

	get legacy(): boolean {
		return !!this.options.legacy;
	}

	private _workspacePathOrFolder: string;
	get workspacePathOrFolder(): string {
		return this._workspacePathOrFolder;
	}

	get extensionsPath(): string {
		return this.options.extensionsPath;
	}

	private _userDataPath: string;
	get userDataPath(): string {
		return this._userDataPath;
	}

	async start(): Promise<void> {
		await this._start();
		await this.code.waitForElement('.explorer-folders-view');
	}

	async restart(options?: { workspaceOrFolder?: string; extraArgs?: string[] }): Promise<void> {
		await this.stop();
		await this._start(options?.workspaceOrFolder, options?.extraArgs);
	}

	private async _start(workspaceOrFolder = this.workspacePathOrFolder, extraArgs: string[] = []): Promise<void> {
		this._workspacePathOrFolder = workspaceOrFolder;

		// Launch Code...
		const code = await this.startApplication(extraArgs);

		// ...and make sure the window is ready to interact
		await measureAndLog(this.checkWindowReady(code), 'Application#checkWindowReady()', this.logger);
	}

	async stop(): Promise<void> {
		if (this._code) {
			try {
				await this._code.exit();
			} finally {
				this._code = undefined;
			}
		}
	}

	async startTracing(name: string): Promise<void> {
		await this._code?.startTracing(name);
	}

	async stopTracing(name: string, persist: boolean): Promise<void> {
		await this._code?.stopTracing(name, persist);
	}

	private async startApplication(extraArgs: string[] = []): Promise<Code> {
		const code = this._code = await launch({
			...this.options,
			extraArgs: [...(this.options.extraArgs || []), ...extraArgs],
		});

		this._workbench = new Workbench(this._code, this.userDataPath);

		return code;
	}

	private async checkWindowReady(code: Code): Promise<void> {

		// This is legacy and will be removed when our old driver removes
		await code.waitForWindowIds(ids => ids.length > 0);

		// We need a rendered workbench
		await this.checkWorkbenchReady(code);

		// Remote but not web: wait for a remote connection state change
		if (this.remote) {
			await measureAndLog(code.waitForTextContent('.monaco-workbench .statusbar-item[id="status.host"]', undefined, statusHostLabel => {
				this.logger.log(`checkWindowReady: remote indicator text is ${statusHostLabel}`);

				// The absence of "Opening Remote" is not a strict
				// indicator for a successful connection, but we
				// want to avoid hanging here until timeout because
				// this method is potentially called from a location
				// that has no tracing enabled making it hard to
				// diagnose this. As such, as soon as the connection
				// state changes away from the "Opening Remote..." one
				// we return.
				return !statusHostLabel.includes('Opening Remote');
			}, 300 /* = 30s of retry */), 'Application#checkWindowReady: wait for remote indicator', this.logger);
		}
	}

	private async checkWorkbenchReady(code: Code): Promise<void> {
		const driver = code.driver;

		// Web / Legacy: just poll for workbench element
		if (this.web || !(driver instanceof PlaywrightDriver)) {
			await measureAndLog(code.waitForElement('.monaco-workbench'), 'Application#checkWindowReady: wait for .monaco-workbench element', this.logger);
		}

		// Desktop (playwright): we see hangs, where IPC messages
		// are not delivered (https://github.com/microsoft/vscode/issues/146785)
		// Workaround is to try to reload the window when that happens
		else {
			try {
				await measureAndLog(code.waitForElement('.monaco-workbench', undefined, 100 /* 10s of retry */), 'Application#checkWindowReady: wait for .monaco-workbench element', this.logger);
			} catch (error) {
				this.logger.log(`checkWindowReady: giving up after 10s, reloading window and trying again...`);

				await driver.reload();

				return this.checkWorkbenchReady(code);
			}
		}
	}
}
