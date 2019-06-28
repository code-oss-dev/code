/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment, isLinux, isMacintosh, isWindows } from 'vs/base/common/platform';
import { readFile } from 'vs/base/node/pfs';
import { basename } from 'vs/base/common/path';

let mainProcessParentEnv: IProcessEnvironment | undefined;

export async function getMainProcessParentEnv(): Promise<IProcessEnvironment> {
	if (mainProcessParentEnv) {
		return mainProcessParentEnv;
	}

	// For Linux use /proc/<pid>/status to get the parent of the main process and then fetch its
	// env using /proc/<pid>/environ.
	if (isLinux) {
		const mainProcessId = process.ppid;
		const codeProcessName = basename(process.argv[0]);
		let pid: number = 0;
		let ppid: number = mainProcessId;
		let name: string = codeProcessName;
		do {
			pid = ppid;
			const status = await readFile(`/proc/${pid}/status`, 'utf8');
			const splitByLine = status.split('\n');
			splitByLine.forEach(line => {
				if (line.indexOf('Name:') === 0) {
					name = line.replace(/^Name:\s+/, '');
				}
				if (line.indexOf('PPid:') === 0) {
					ppid = parseInt(line.replace(/^PPid:\s+/, ''));
				}
			});
		} while (name === codeProcessName);
		const rawEnv = await readFile(`/proc/${pid}/environ`, 'utf8');
		const env = {};
		rawEnv.split('\0').forEach(e => {
			const i = e.indexOf('=');
			env[e.substr(0, i)] = e.substr(i + 1);
		});
		mainProcessParentEnv = env;
	}

	// For macOS we want the "root" environment as shells by default run as login shells. It
	// doesn't appear to be possible to get the "root" environment as `ps eww -o command` for
	// PID 1 (the parent of the main process when launched from the dock/finder) returns no
	// environment, because of this we will fill in the root environment using a whitelist of
	// environment variables that we have.
	if (isMacintosh) {
		mainProcessParentEnv = {};
		// This list was generated by diffing launching a terminal with {} and the system
		// terminal launched from finder.
		const rootEnvVars = [
			'SHELL',
			'SSH_AUTH_SOCK',
			'Apple_PubSub_Socket_Render',
			'XPC_FLAGS',
			'XPC_SERVICE_NAME',
			'HOME',
			'LOGNAME',
			'TMPDIR'
		];
		rootEnvVars.forEach(k => {
			if (process.env[k]) {
				mainProcessParentEnv![k] = process.env[k]!;
			}
		});
	}

	// TODO: Windows should return a fresh environment block, might need native code?
	if (isWindows) {
		mainProcessParentEnv = process.env as IProcessEnvironment;
	}

	return mainProcessParentEnv!;
}