/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import {ILanguage, IRichLanguageConfiguration} from './types';

export var conf:IRichLanguageConfiguration = {
	comments: {
		lineComment: '--',
		blockComment: ['--[[', ']]'],
	},
	brackets: [['{','}'], ['[',']'], ['(',')']],
	autoClosingPairs: [
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
		{ open: '\'', close: '\'', notIn: ['string', 'comment'] },
		{ open: '{', close: '}', notIn: ['string', 'comment'] },
		{ open: '[', close: ']', notIn: ['string', 'comment'] },
		{ open: '(', close: ')', notIn: ['string', 'comment'] },
	],
	__electricCharacterSupport: {
		caseInsensitive: false,
		embeddedElectricCharacters: []
	}
};

export var language = <ILanguage> {
	displayName: 'Lua',
	name:        'lua',
	defaultToken: '',

	lineComment:      '--',
	blockCommentStart: '--[[',
	blockCommentEnd:   ']]',

	keywords: [
		'and', 'break', 'do', 'else', 'elseif',
	'end', 'false', 'for', 'function', 'goto', 'if',
	'in', 'local', 'nil', 'not', 'or',
	'repeat', 'return', 'then', 'true', 'until',
	'while'
	],

	brackets: [
			{ token: 'delimiter.bracket', open: '{', close: '}'},
			{ token: 'delimiter.array', open: '[', close: ']'},
			{ token: 'delimiter.parenthesis', open: '(', close: ')'}
	],

	operators: [
		'+', '-', '*', '/', '%', '^', '#', '==', '~=', '<=', '>=', '<', '>', '=',
	';', ':', ',', '.', '..', '...'
	],

	// we include these common regular expressions
	symbols:  /[=><!~?:&|+\-*\/\^%]+/,
	escapes:  /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

	// The main tokenizer for our languages
	tokenizer: {
		root: [
			// identifiers and keywords
			[/[a-zA-Z_]\w*/, { cases: { '@keywords': {token:'keyword.$0'},
																	'@default': 'identifier' } }],
			// whitespace
			{ include: '@whitespace' },

		// keys
		[/(,)(\s*)([a-zA-Z_]\w*)(\s*)(:)(?!:)/, ['delimiter', '', 'key', '', 'delimiter']],
		[/({)(\s*)([a-zA-Z_]\w*)(\s*)(:)(?!:)/, ['@brackets', '', 'key', '', 'delimiter']],

			// delimiters and operators
			[/[{}()\[\]]/, '@brackets'],
			[/@symbols/, { cases: { '@operators': 'delimiter',
															'@default'  : '' } } ],

			// numbers
			[/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
			[/0[xX][0-9a-fA-F_]*[0-9a-fA-F]/, 'number.hex'],
			[/\d+?/, 'number'],

			// delimiter: after number because of .\d floats
			[/[;,.]/, 'delimiter'],

			// strings: recover on non-terminated strings
			[/"([^"\\]|\\.)*$/, 'string.invalid' ],  // non-teminated string
			[/'([^'\\]|\\.)*$/, 'string.invalid' ],  // non-teminated string
			[/"/,  'string', '@string."' ],
			[/'/, 'string', '@string.\''],
		],

		whitespace: [
			[/[ \t\r\n]+/, ''],
			[/--\[([=]*)\[/,  'comment', '@comment.$1' ],
			[/--.*$/,        'comment'],
		],

		comment: [
			[/[^\]]+/, 'comment'],
			[/\]([=]*)\]/, { cases: { '$1==$S2': { token: 'comment', next: '@pop' }, '@default' : 'comment' } } ],
			[/./,   'comment' ]
		],

		string: [
			[/[^\\"']+/, 'string'],
			[/@escapes/, 'string.escape'],
			[/\\./,      'string.escape.invalid'],
			[/["']/,     { cases: { '$#==$S2' : { token: 'string', next: '@pop' },
															'@default': 'string' }} ]
		],

	},
};