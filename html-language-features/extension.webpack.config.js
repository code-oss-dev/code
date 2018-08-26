/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../shared.webpack.config');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = withDefaults({
	context: path.join(__dirname, 'client'),
	entry: {
		extension: './src/htmlMain.ts',
	},
	resolve: {
		mainFields: ['module', 'main'],
		extensions: ['.ts', '.js'] // support ts-files and js-files
	},
	node: {
		__dirname: false // leave the __dirname-behaviour intact
	},
	output: {
		filename: 'htmlMain.js',
		path: path.join(__dirname, 'client', 'dist'),
		libraryTarget: "commonjs",
	},
	externals: {
		'./files': 'commonjs', // ignored because it doesn't exist
	},
	plugins: [
		new CopyWebpackPlugin([
			{ from: './out/*.sh', to: '[name].sh' },
			{ from: './out/nls.*.json', to: '[name].json' }
		])
	]
});
