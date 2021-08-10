/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const { dirs } = require('./dirs');
const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

/**
 * @param {string} location
 * @param {*} [opts]
 */
function yarnInstall(location, opts) {
	opts = opts || { env: process.env };
	opts.cwd = location;
	opts.stdio = 'inherit';

	const raw = process.env['npm_config_argv'] || '{}';
	const argv = JSON.parse(raw);
	const original = argv.original || [];
	const args = original.filter(arg => arg === '--ignore-optional' || arg === '--frozen-lockfile');
	if (opts.ignoreEngines) {
		args.push('--ignore-engines');
		delete opts.ignoreEngines;
	}

	console.log(`Installing dependencies in ${location}...`);
	console.log(`$ yarn ${args.join(' ')}`);
	const result = cp.spawnSync(yarn, args, opts);

	if (result.error || result.status !== 0) {
		process.exit(1);
	}
}

for (let dir of dirs) {

	if (dir === '') {
		// `yarn` already executed in root
		continue;
	}

	if (/^remote/.test(dir) && process.platform === 'win32' && (process.arch === 'arm64' || process.env['npm_config_arch'] === 'arm64')) {
		// windows arm: do not execute `yarn` on remote folder
		continue;
	}

	if (dir === 'build/lib/watch') {
		// node modules for watching, specific to host node version, not electron
		yarnInstallBuildDependencies();
		continue;
	}

	let opts;

	if (dir === 'remote') {
		// node modules used by vscode server
		const env = { ...process.env };
		if (process.env['VSCODE_REMOTE_CC']) { env['CC'] = process.env['VSCODE_REMOTE_CC']; }
		if (process.env['VSCODE_REMOTE_CXX']) { env['CXX'] = process.env['VSCODE_REMOTE_CXX']; }
		if (process.env['CXXFLAGS']) { delete env['CXXFLAGS']; }
		if (process.env['LDFLAGS']) { delete env['LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_NODE_GYP']) { env['npm_config_node_gyp'] = process.env['VSCODE_REMOTE_NODE_GYP']; }
		opts = { env };
	} else if (/^extensions\//.test(dir)) {
		opts = { ignoreEngines: true };
	}

	yarnInstall(dir, opts);
}
buildWebNodePaths();

function yarnInstallBuildDependencies() {
	// make sure we install the deps of build/lib/watch for the system installed
	// node, since that is the driver of gulp
	const watchPath = path.join(path.dirname(__dirname), 'lib', 'watch');
	const yarnrcPath = path.join(watchPath, '.yarnrc');

	const disturl = 'https://nodejs.org/download/release';
	const target = process.versions.node;
	const runtime = 'node';

	const yarnrc = `disturl "${disturl}"
target "${target}"
runtime "${runtime}"`;

	fs.writeFileSync(yarnrcPath, yarnrc, 'utf8');
	yarnInstall(watchPath);
}

function buildWebNodePaths() {
	const root = path.join(__dirname, '..', '..');
	const webPackageJSON = path.join(root, '/remote/web', 'package.json');
	const webPackages = JSON.parse(fs.readFileSync(webPackageJSON, 'utf8')).dependencies;
	const nodePaths = new Object(null);
	for (const key of Object.keys(webPackages)) {
		const packageJSON = path.join(root, 'node_modules', key, 'package.json');
		const packageData = JSON.parse(fs.readFileSync(packageJSON, 'utf8'));
		let entryPoint = packageData.browser ?? packageData.main;
		// On rare cases a package doesn't have an entrypoint so we assume it has a dist folder with a min.js
		if (!entryPoint) {
			console.warn(`No entry point for ${key} assuming dist/${key}.min.js`);
			entryPoint = `dist/${key}.min.js`;
		}
		// Remove any starting path information so it's all relative info
		if (entryPoint.startsWith('./')) {
			entryPoint = entryPoint.substr(2);
		} else if (entryPoint.startsWith('/')) {
			entryPoint = entryPoint.substr(1);
		}
		nodePaths[key] = entryPoint;
	}

	// Now we write the node paths to out/vs
	const outDirectory = path.join(root, 'out', 'vs');
	const headerWithGeneratedFileWarning = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This file is generated by build/npm/postinstall.js. Do not edit.`;
	const fileContents = `${headerWithGeneratedFileWarning}\nself.webPackagePaths = ${JSON.stringify(nodePaths, null, 2)};`;
	fs.writeFileSync(path.join(outDirectory, 'webPackagePaths.js'), fileContents, 'utf8');
}

cp.execSync('git config pull.rebase merges');
cp.execSync('git config blame.ignoreRevsFile .git-blame-ignore');
