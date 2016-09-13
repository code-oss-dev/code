/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import nls = require('vs/nls');
import platform = require('vs/base/common/platform');
import {TPromise} from 'vs/base/common/winjs.base';
import {ITerminalService, ITerminalInstance} from 'vs/workbench/parts/terminal/electron-browser/terminal';
import {ITerminalService as IExternalTerminalService} from 'vs/workbench/parts/execution/common/execution';


export class TerminalSupport {

	private static integratedTerminalInstance: ITerminalInstance;

	public static runInTerminal(terminalService: ITerminalService, nativeTerminalService: IExternalTerminalService, args: DebugProtocol.RunInTerminalRequestArguments, response: DebugProtocol.RunInTerminalResponse): TPromise<void> {

		if (args.kind === 'external') {
			return nativeTerminalService.runInTerminal(args.title, args.cwd, args.args, args.env);
		}
		return this.runInIntegratedTerminal(terminalService, args);
	}

	private static runInIntegratedTerminal(terminalService: ITerminalService, args: DebugProtocol.RunInTerminalRequestArguments): TPromise<void> {

		if (!TerminalSupport.integratedTerminalInstance) {
			TerminalSupport.integratedTerminalInstance = terminalService.createInstance(args.title || nls.localize('debuggee', "debuggee"));
		}
		terminalService.setActiveInstance(TerminalSupport.integratedTerminalInstance);
		terminalService.showPanel(true);
		const command = this.prepareCommand(args);
		TerminalSupport.integratedTerminalInstance.sendText(command, true);
		return TPromise.as(void 0);
	}

	private static prepareCommand(args: DebugProtocol.RunInTerminalRequestArguments): string {
		let command = '';

		if (platform.isWindows) {

			const quote = (s: string) => {
				s = s.replace(/\"/g, '""');
				return (s.indexOf(' ') >= 0 || s.indexOf('"') >= 0) ? `"${s}"` : s;
			};

			if (args.cwd) {
				command += `cd ${quote(args.cwd)} && `;
			}
			if (args.env) {
				command += 'cmd /C "';
				for (let key in args.env) {
					command += `set "${key}=${args.env[key]}" && `;
				}
			}
			for (let a of args.args) {
				command += `${quote(a)} `;
			}
			if (args.env) {
				command += '"';
			}
		} else {
			const quote = (s: string) => {
				s = s.replace(/\"/g, '\\"');
				return s.indexOf(' ') >= 0 ? `"${s}"` : s;
			};

			if (args.cwd) {
				command += `cd ${quote(args.cwd)} ; `;
			}
			if (args.env) {
				command += 'env';
				for (let key in args.env) {
					command += ` ${quote(key + '=' + args.env[key])}`;
				}
				command += ' ';
			}
			for (let a of args.args) {
				command += `${quote(a)} `;
			}
		}

		return command;
	}
}