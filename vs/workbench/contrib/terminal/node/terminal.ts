/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as platform from 'vs/base/common/platform';
import { SymlinkSupport } from 'vs/base/node/pfs';
import { coalesce } from 'vs/base/common/arrays';
import { normalize, basename } from 'vs/base/common/path';
import { enumeratePowerShellInstallations } from 'vs/base/node/powershell';
import { getWindowsBuildNumber } from 'vs/platform/terminal/node/terminalEnvironment';
import { IShellDefinition, LinuxDistro } from 'vs/platform/terminal/common/terminal';

let detectedDistro = LinuxDistro.Unknown;
if (platform.isLinux) {
	const file = '/etc/os-release';
	SymlinkSupport.existsFile(file).then(async exists => {
		if (!exists) {
			return;
		}
		const buffer = await fs.promises.readFile(file);
		const contents = buffer.toString();
		if (/NAME="?Fedora"?/.test(contents)) {
			detectedDistro = LinuxDistro.Fedora;
		} else if (/NAME="?Ubuntu"?/.test(contents)) {
			detectedDistro = LinuxDistro.Ubuntu;
		}
	});
}

export const linuxDistro = detectedDistro;

export function detectAvailableShells(): Promise<IShellDefinition[]> {
	return platform.isWindows ? detectAvailableWindowsShells() : detectAvailableUnixShells();
}

async function detectAvailableWindowsShells(): Promise<IShellDefinition[]> {
	// Determine the correct System32 path. We want to point to Sysnative
	// when the 32-bit version of VS Code is running on a 64-bit machine.
	// The reason for this is because PowerShell's important PSReadline
	// module doesn't work if this is not the case. See #27915.
	const is32ProcessOn64Windows = process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
	const system32Path = `${process.env['windir']}\\${is32ProcessOn64Windows ? 'Sysnative' : 'System32'}`;

	let useWSLexe = false;

	if (getWindowsBuildNumber() >= 16299) {
		useWSLexe = true;
	}

	const expectedLocations: { [key: string]: string[] } = {
		'Command Prompt': [`${system32Path}\\cmd.exe`],
		'WSL Bash': [`${system32Path}\\${useWSLexe ? 'wsl.exe' : 'bash.exe'}`],
		'Git Bash': [
			`${process.env['ProgramW6432']}\\Git\\bin\\bash.exe`,
			`${process.env['ProgramW6432']}\\Git\\usr\\bin\\bash.exe`,
			`${process.env['ProgramFiles']}\\Git\\bin\\bash.exe`,
			`${process.env['ProgramFiles']}\\Git\\usr\\bin\\bash.exe`,
			`${process.env['LocalAppData']}\\Programs\\Git\\bin\\bash.exe`,
		],
		// See #75945
		// Cygwin: [
		// 	`${process.env['HOMEDRIVE']}\\cygwin64\\bin\\bash.exe`,
		// 	`${process.env['HOMEDRIVE']}\\cygwin\\bin\\bash.exe`
		// ]
	};

	// Add all of the different kinds of PowerShells
	for await (const pwshExe of enumeratePowerShellInstallations()) {
		expectedLocations[pwshExe.displayName] = [pwshExe.exePath];
	}

	const promises: Promise<IShellDefinition | undefined>[] = [];
	Object.keys(expectedLocations).forEach(key => promises.push(validateShellPaths(key, expectedLocations[key])));
	const shells = await Promise.all(promises);
	return coalesce(shells);
}

async function detectAvailableUnixShells(): Promise<IShellDefinition[]> {
	const contents = await fs.promises.readFile('/etc/shells', 'utf8');
	const shells = contents.split('\n').filter(e => e.trim().indexOf('#') !== 0 && e.trim().length > 0);
	return shells.map(e => {
		return {
			label: basename(e),
			path: e
		};
	});
}

async function validateShellPaths(label: string, potentialPaths: string[]): Promise<IShellDefinition | undefined> {
	if (potentialPaths.length === 0) {
		return Promise.resolve(undefined);
	}
	const current = potentialPaths.shift()!;
	if (current! === '') {
		return validateShellPaths(label, potentialPaths);
	}
	try {
		const result = await fs.promises.stat(normalize(current));
		if (result.isFile() || result.isSymbolicLink()) {
			return {
				label,
				path: current
			};
		}
	} catch (e) {
		// Also try using lstat as some symbolic links on Windows
		// throw 'permission denied' using 'stat' but don't throw
		// using 'lstat'
		try {
			const result = await fs.promises.lstat(normalize(current));
			if (result.isFile() || result.isSymbolicLink()) {
				return {
					label,
					path: current
				};
			}
		}
		catch (e) {
			// noop
		}
	}
	return validateShellPaths(label, potentialPaths);
}
