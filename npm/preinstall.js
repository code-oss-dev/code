/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

let err = false;

const majorNodeVersion = parseInt(/^(\d+)\./.exec(process.versions.node)[1]);

if (majorNodeVersion < 14 || majorNodeVersion >= 17) {
	console.error('\033[1;31m*** Please use node.js versions >=14 and <17.\033[0;0m');
	err = true;
}

const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const yarnVersion = cp.execSync('yarn -v', { encoding: 'utf8' }).trim();
const parsedYarnVersion = /^(\d+)\.(\d+)\./.exec(yarnVersion);
const majorYarnVersion = parseInt(parsedYarnVersion[1]);
const minorYarnVersion = parseInt(parsedYarnVersion[2]);

if (majorYarnVersion < 1 || minorYarnVersion < 10) {
	console.error('\033[1;31m*** Please use yarn >=1.10.1.\033[0;0m');
	err = true;
}

if (!/yarn[\w-.]*\.c?js$|yarnpkg$/.test(process.env['npm_execpath'])) {
	console.error('\033[1;31m*** Please use yarn to install dependencies.\033[0;0m');
	err = true;
}

if (process.platform === 'win32') {
	if (!hasSupportedVisualStudioVersion()) {
		console.error('\033[1;31m*** Invalid C/C++ Compiler Toolchain. Please check https://github.com/microsoft/vscode/wiki/How-to-Contribute#prerequisites.\033[0;0m');
		err = true;
	}
	if (!err) {
		installHeaders();
	}
}

if (err) {
	console.error('');
	process.exit(1);
}

function hasSupportedVisualStudioVersion() {
	const fs = require('fs');
	const path = require('path');
	// Translated over from
	// https://source.chromium.org/chromium/chromium/src/+/master:build/vs_toolchain.py;l=140-175
	const supportedVersions = ['2019', '2017'];

	const availableVersions = [];
	for (const version of supportedVersions) {
		let vsPath = process.env[`vs${version}_install`];
		if (vsPath && fs.existsSync(vsPath)) {
			availableVersions.push(version);
			break;
		}
		const programFiles86Path = process.env['ProgramFiles(x86)'];
		if (programFiles86Path) {
			vsPath = `${programFiles86Path}/Microsoft Visual Studio/${version}`;
			const vsTypes = ['Enterprise', 'Professional', 'Community', 'Preview', 'BuildTools'];
			if (vsTypes.some(vsType => fs.existsSync(path.join(vsPath, vsType)))) {
				availableVersions.push(version);
				break;
			}
		}
	}
	return availableVersions.length;
}

function installHeaders() {
	const yarn = 'yarn.cmd';
	const opts = {
		env: process.env,
		cwd: path.join(__dirname, 'gyp'),
		stdio: 'inherit'
	};
	const yarnResult = cp.spawnSync(yarn, ['install'], opts);
	if (yarnResult.error || yarnResult.status !== 0) {
		console.error(`Installing node-gyp failed`);
		err = true;
		return;
	}

	const node_gyp = path.join(__dirname, 'gyp', 'node_modules', '.bin', 'node-gyp.cmd');
	const result = cp.execSync(`${node_gyp} list`, { encoding: 'utf8' });
	const versions = new Set(result.split(/\n/g).filter(line => !line.startsWith('gyp info')).map(value => `"${value}"`));

	const local = getHeaderInfo(path.join(__dirname, '..', '..', '.yarnrc'));
	const remote = getHeaderInfo(path.join(__dirname, '..', '..', 'remote', '.yarnrc'));

	if (local !== undefined && !versions.has(local.target)) {
		cp.execSync(`${node_gyp} install --dist-url ${local.disturl} ${local.target}`);
	}

	if (remote !== undefined && !versions.has(remote.target)) {
		cp.execSync(`${node_gyp} install --dist-url ${remote.disturl} ${remote.target}`);
	}
}

/**
 * @param {string} rcFile
 * @returns {{ disturl: string; target: string } | undefined}
 */
function getHeaderInfo(rcFile) {
	const lines = fs.readFileSync(rcFile, 'utf8').split(/\r\n?/g);
	let disturl, target;
	for (const line of lines) {
		let match = line.match(/\s*disturl\s*(.*)$/);
		if (match !== null && match.length >= 1) {
			disturl = match[1];
		}
		match = line.match(/\s*target\s*(.*)$/);
		if (match !== null && match.length >= 1) {
			target = match[1];
		}
	}
	return disturl !== undefined && target !== undefined
		? { disturl, target }
		: undefined;
}
