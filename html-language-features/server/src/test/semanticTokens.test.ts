/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { TextDocument, getLanguageModes, ClientCapabilities, Range } from '../modes/languageModes';
import { newSemanticTokenProvider } from '../modes/semanticTokens';

interface ExpectedToken {
	startLine: number;
	character: number;
	length: number;
	tokenClassifiction: string;
}

function assertTokens(lines: string[], expected: ExpectedToken[], range?: Range, message?: string): void {
	const document = TextDocument.create('test://foo/bar.html', 'html', 1, lines.join('\n'));
	const workspace = {
		settings: {},
		folders: [{ name: 'foo', uri: 'test://foo' }]
	};
	const languageModes = getLanguageModes({ css: true, javascript: true }, workspace, ClientCapabilities.LATEST);
	const semanticTokensProvider = newSemanticTokenProvider(languageModes);

	const legend = semanticTokensProvider.legend;
	const actual = semanticTokensProvider.getSemanticTokens(document, range && [range]);

	let actualRanges = [];
	let lastLine = 0;
	let lastCharacter = 0;
	for (let i = 0; i < actual.length; i += 5) {
		const lineDelta = actual[i], charDelta = actual[i + 1], len = actual[i + 2], typeIdx = actual[i + 3], modSet = actual[i + 4];
		const line = lastLine + lineDelta;
		const character = lineDelta === 0 ? lastCharacter + charDelta : charDelta;
		const tokenClassifiction = [legend.types[typeIdx], ...legend.modifiers.filter((_, i) => modSet & 1 << i)].join('.');
		actualRanges.push(t(line, character, len, tokenClassifiction));
		lastLine = line;
		lastCharacter = character;
	}
	assert.deepEqual(actualRanges, expected, message);
}

function t(startLine: number, character: number, length: number, tokenClassifiction: string): ExpectedToken {
	return { startLine, character, length, tokenClassifiction };
}

suite('JavaScript Semantic Tokens', () => {

	test('variables', () => {
		const input = [
			/*0*/'<html>',
			/*1*/'<head>',
			/*2*/'<script>',
			/*3*/'  var x = 9, y1 = [x];',
			/*4*/'  try {',
			/*5*/'    for (const s of y1) { }',
			/*6*/'  } catch (e) {',
			/*7*/'    throw y1;',
			/*8*/'  }',
			/*9*/'</script>',
			/*10*/'</head>',
			/*11*/'</html>',
		];
		assertTokens(input, [
			t(3, 6, 1, 'variable.declaration'), t(3, 13, 2, 'variable.declaration'), t(3, 19, 1, 'variable'),
			t(5, 15, 1, 'variable.declaration'), t(5, 20, 2, 'variable'),
			t(6, 11, 1, 'variable.declaration'),
			t(7, 10, 2, 'variable')
		]);
	});

	test('function', () => {
		const input = [
			/*0*/'<html>',
			/*1*/'<head>',
			/*2*/'<script>',
			/*3*/'  function foo(p1) {',
			/*4*/'    return foo(Math.abs(p1))',
			/*5*/'  }',
			/*6*/'  `/${window.location}`.split("/").forEach(s => foo(s));',
			/*7*/'</script>',
			/*8*/'</head>',
			/*9*/'</html>',
		];
		assertTokens(input, [
			t(3, 11, 3, 'function.declaration'), t(3, 15, 2, 'parameter.declaration'),
			t(4, 11, 3, 'function'), t(4, 15, 4, 'variable'), t(4, 20, 3, 'member'), t(4, 24, 2, 'parameter'),
			t(6, 6, 6, 'variable'), t(6, 13, 8, 'property'), t(6, 24, 5, 'member'), t(6, 35, 7, 'member'), t(6, 43, 1, 'parameter.declaration'), t(6, 48, 3, 'function'), t(6, 52, 1, 'parameter')
		]);
	});

	test('members', () => {
		const input = [
			/*0*/'<html>',
			/*1*/'<head>',
			/*2*/'<script>',
			/*3*/'  class A {',
			/*4*/'    static x = 9;',
			/*5*/'    f = 9;',
			/*6*/'    async m() { return A.x + await this.m(); };',
			/*7*/'    get s() { return this.f; ',
			/*8*/'    static t() { return new A().f; };',
			/*9*/'    constructor() {}',
			/*10*/'  }',
			/*11*/'</script>',
			/*12*/'</head>',
			/*13*/'</html>',
		];


		assertTokens(input, [
			t(3, 8, 1, 'class.declaration'),
			t(4, 11, 1, 'property.declaration.static'),
			t(5, 4, 1, 'property.declaration'),
			t(6, 10, 1, 'member.declaration.async'), t(6, 23, 1, 'class'), t(6, 25, 1, 'property.static'), t(6, 40, 1, 'member.async'),
			t(7, 8, 1, 'property.declaration'), t(7, 26, 1, 'property'),
			t(8, 11, 1, 'member.declaration.static'), t(8, 28, 1, 'class'), t(8, 32, 1, 'property'),
		]);
	});



});


suite('Type Semantic Tokens', () => {

	test('interface', () => {
		const input = [
			/*0*/'<html>',
			/*1*/'<head>',
			/*2*/'<script type="text/typescript">',
			/*3*/'  interface Position { x: number, y: number };',
			/*4*/'  const p = { x: 1, y: 2 } as Position;',
			/*5*/'  const foo = (o: Position) => o.x + o.y;',
			/*6*/'</script>',
			/*7*/'</head>',
			/*8*/'</html>',
		];
		assertTokens(input, [
			t(3, 12, 8, 'interface.declaration'), t(3, 23, 1, 'property.declaration'), t(3, 34, 1, 'property.declaration'),
			t(4, 8, 1, 'variable.declaration'), t(4, 30, 8, 'interface'),
			t(5, 8, 3, 'variable.declaration'), t(5, 15, 1, 'parameter.declaration'), t(5, 18, 8, 'interface'), t(5, 31, 1, 'parameter'), t(5, 33, 1, 'property'), t(5, 37, 1, 'parameter'), t(5, 39, 1, 'property')
		]);
	});


	test('type alias', () => {
		const input = [
			/*0*/'<html>',
			/*1*/'<head>',
			/*2*/'<script type="text/typescript">',
			/*3*/'  type MyMap = Map<string, number>;',
			/*4*/'  function f<T extends MyMap>(t: T | number) : T { ',
			/*5*/'    return <T> <unknown> new Map<string, MyMap>();',
			/*6*/'  }',
			/*7*/'</script>',
			/*8*/'</head>',
			/*9*/'</html>',
		];
		assertTokens(input, [
			t(3, 7, 5, 'type.declaration'), t(3, 15, 3, 'variable') /* to investiagte */,
			t(4, 11, 1, 'function.declaration'), t(4, 13, 1, 'typeParameter.declaration'), t(4, 23, 5, 'type'), t(4, 30, 1, 'parameter.declaration'), t(4, 33, 1, 'typeParameter'), t(4, 47, 1, 'typeParameter'),
			t(5, 12, 1, 'typeParameter'), t(5, 29, 3, 'variable'), t(5, 41, 5, 'type'),
		]);
	});


});
