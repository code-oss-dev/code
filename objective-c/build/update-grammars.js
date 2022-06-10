/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

var updateGrammar = require('vscode-grammar-updater');

async function updateGrammars() {
	await updateGrammar.update('jeff-hykin/better-objcpp-syntax', 'autogenerated/objcpp.tmLanguage.json', './syntaxes/objective-c++.tmLanguage.json', undefined, 'master');
	await updateGrammar.update('jeff-hykin/better-objc-syntax', 'autogenerated/objc.tmLanguage.json', './syntaxes/objective-c.tmLanguage.json', undefined, 'master');
}

updateGrammars();
