/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../../shared.webpack.config');
const path = require('path');
const webpack = require('webpack');

const config = withDefaults({
	context: path.join(__dirname),
	entry: {
		extension: './src/node/jsonServerMain.ts',
	},
	output: {
		filename: 'jsonServerMain.js',
		path: path.join(__dirname, 'dist', 'node'),
	},
	resolve: {
		fallback: {
			vertx: false // indirectly required by request-light
		}
	}
});

module.exports = config;
