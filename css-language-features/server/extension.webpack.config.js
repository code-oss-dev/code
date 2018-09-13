/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../../shared.webpack.config');
const path = require('path');
var webpack = require('webpack');

module.exports = withDefaults({
	context: path.join(__dirname),
	entry: {
		extension: './src/cssServerMain.ts',
	},
	output: {
		filename: 'cssServerMain.js',
		path: path.join(__dirname, 'dist'),
		libraryTarget: "commonjs",
	},
	externals: {
		"vscode-nls": 'commonjs vscode-nls',
	},
	plugins: [
		new webpack.NormalModuleReplacementPlugin(
			/[/\\]vscode-languageserver[/\\]lib[/\\]files\.js/,
			require.resolve('./build/filesFillIn')
		),
		new webpack.IgnorePlugin(/vertx/)
	],
});
