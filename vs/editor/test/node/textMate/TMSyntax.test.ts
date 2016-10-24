/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { decodeTextMateToken, DecodeMap, TMScopeRegistry } from 'vs/editor/node/textMate/TMSyntax';

suite('TextMate.TMScopeRegistry', () => {

	test('getFilePath', () => {
		let manager = new TMScopeRegistry();

		manager.register('a', 'source.a', './grammar/a.tmLanguage');
		assert.equal(manager.getFilePath('source.a'), './grammar/a.tmLanguage');
		assert.equal(manager.getFilePath('a'), null);
		assert.equal(manager.getFilePath('source.b'), null);
		assert.equal(manager.getFilePath('b'), null);

		manager.register('b', 'source.b', './grammar/b.tmLanguage');
		assert.equal(manager.getFilePath('source.a'), './grammar/a.tmLanguage');
		assert.equal(manager.getFilePath('a'), null);
		assert.equal(manager.getFilePath('source.b'), './grammar/b.tmLanguage');
		assert.equal(manager.getFilePath('b'), null);

		manager.register('a', 'source.a', './grammar/ax.tmLanguage');
		assert.equal(manager.getFilePath('source.a'), './grammar/ax.tmLanguage');
		assert.equal(manager.getFilePath('a'), null);
		assert.equal(manager.getFilePath('source.b'), './grammar/b.tmLanguage');
		assert.equal(manager.getFilePath('b'), null);
	});

	test('scopeToLanguage', () => {
		let manager = new TMScopeRegistry();

		assert.equal(manager.scopeToLanguage('source.html'), null);

		manager.register('html', 'source.html', null);
		manager.register('css', 'source.css', null);
		manager.register('javascript', 'source.js', null);
		manager.register('python', 'source.python', null);
		manager.register('smarty', 'source.smarty', null);
		manager.register(null, 'source.baz', null);

		// exact matches
		assert.equal(manager.scopeToLanguage('source.html'), 'html');
		assert.equal(manager.scopeToLanguage('source.css'), 'css');
		assert.equal(manager.scopeToLanguage('source.js'), 'javascript');
		assert.equal(manager.scopeToLanguage('source.python'), 'python');
		assert.equal(manager.scopeToLanguage('source.smarty'), 'smarty');

		// prefix matches
		assert.equal(manager.scopeToLanguage('source.css.embedded.html'), 'css');
		assert.equal(manager.scopeToLanguage('source.js.embedded.html'), 'javascript');
		assert.equal(manager.scopeToLanguage('source.python.embedded.html'), 'python');
		assert.equal(manager.scopeToLanguage('source.smarty.embedded.html'), 'smarty');

		// misses
		assert.equal(manager.scopeToLanguage('source.ts'), null);
		assert.equal(manager.scopeToLanguage('source.baz'), null);
		assert.equal(manager.scopeToLanguage('asource.css'), null);
		assert.equal(manager.scopeToLanguage('a.source.css'), null);
		assert.equal(manager.scopeToLanguage('source_css'), null);
	});

});

suite('textMate', () => {

	function assertRelaxedEqual(a: string, b: string): void {
		let relaxString = (str: string) => {
			let pieces = str.split('.');
			pieces.sort();
			return pieces.join('.');
		};
		assert.equal(relaxString(a), relaxString(b));
	}

	function slowDecodeTextMateToken(scopes: string[]): string {
		let allTokensMap: { [token: string]: boolean; } = Object.create(null);
		for (let i = 1; i < scopes.length; i++) {
			let pieces = scopes[i].split('.');
			for (let j = 0; j < pieces.length; j++) {
				allTokensMap[pieces[j]] = true;
			}
		}
		return Object.keys(allTokensMap).join('.');
	}

	function testOneDecodeTextMateToken(decodeMap: DecodeMap, scopes: string[], expected: string): void {
		let actual = decodeTextMateToken(decodeMap, scopes);
		assert.equal(actual, expected);

		// Sanity-check
		let alternativeExpected = slowDecodeTextMateToken(scopes);
		assertRelaxedEqual(actual, alternativeExpected);
	}

	function testDecodeTextMateToken(input: string[][], expected: string[]): void {
		let decodeMap = new DecodeMap(new TMScopeRegistry());

		for (let i = 0; i < input.length; i++) {
			testOneDecodeTextMateToken(decodeMap, input[i], expected[i]);
		}
	}

	test('decodeTextMateToken JSON regression', () => {
		let input = [
			['source.json', 'meta.structure.dictionary.json'],
			['source.json', 'meta.structure.dictionary.json', 'support.type.property-name.json', 'punctuation.support.type.property-name.begin.json'],
			['source.json', 'meta.structure.dictionary.json', 'support.type.property-name.json'],
			['source.json', 'meta.structure.dictionary.json', 'support.type.property-name.json', 'punctuation.support.type.property-name.end.json'],
			['source.json', 'meta.structure.dictionary.json', 'meta.structure.dictionary.value.json', 'punctuation.separator.dictionary.key-value.json'],
			['source.json', 'meta.structure.dictionary.json', 'meta.structure.dictionary.value.json'],
			['source.json', 'meta.structure.dictionary.json', 'meta.structure.dictionary.value.json', 'string.quoted.double.json', 'punctuation.definition.string.begin.json'],
			['source.json', 'meta.structure.dictionary.json', 'meta.structure.dictionary.value.json', 'string.quoted.double.json', 'punctuation.definition.string.end.json'],
			['source.json', 'meta.structure.dictionary.json', 'meta.structure.dictionary.value.json', 'punctuation.separator.dictionary.pair.json']
		];

		let expected = [
			'meta.structure.dictionary.json',
			'meta.structure.dictionary.json.support.type.property-name.punctuation.begin',
			'meta.structure.dictionary.json.support.type.property-name',
			'meta.structure.dictionary.json.support.type.property-name.punctuation.end',
			'meta.structure.dictionary.json.punctuation.value.separator.key-value',
			'meta.structure.dictionary.json.value',
			'meta.structure.dictionary.json.punctuation.begin.value.string.quoted.double.definition',
			'meta.structure.dictionary.json.punctuation.end.value.string.quoted.double.definition',
			'meta.structure.dictionary.json.punctuation.value.separator.pair'
		];

		testDecodeTextMateToken(input, expected);
	});

	test('decodeTextMateToken', () => {
		let input = getTestScopes();

		let expected = [
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.entity.name',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.parameter.brace.round',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.parameter',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.name.parameter.variable',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.parameter',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.name.parameter.variable',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.parameter',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.name.parameter.variable',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.parameter.brace.round',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.entity.name.overload',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.parameter.brace.round',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.name.parameter.variable',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.parameter.brace.round',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.brace.curly',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.keyword.operator.comparison',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.string.double',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.string.double',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.string.double',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.keyword.operator.arithmetic',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.keyword.operator.arithmetic',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.string.double',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.string.double',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.string.double',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.brace.array.literal.square',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.array.literal',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.brace.array.literal.square',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.keyword.operator.comparison',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.brace.curly',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.brace.curly',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.name',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member.name',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member',
			'meta.function.js.decl.block.type.parameters.paren.cover.object.method.declaration.field.member'
		];

		testDecodeTextMateToken(input, expected);
	});
});

function getTestScopes(): string[][] {
	return [
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'entity.name.function.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js', 'meta.brace.round.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js', 'parameter.name.js', 'variable.parameter.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js', 'parameter.name.js', 'variable.parameter.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js', 'parameter.name.js', 'variable.parameter.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js', 'meta.brace.round.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.method.overload.declaration.js', 'entity.name.function.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js', 'meta.brace.round.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js', 'parameter.name.js', 'variable.parameter.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.function.type.parameter.js', 'meta.brace.round.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.brace.curly.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'keyword.operator.comparison.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'string.double.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'string.double.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'string.double.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'keyword.operator.arithmetic.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'keyword.operator.arithmetic.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'string.double.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'string.double.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'string.double.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.array.literal.js', 'meta.brace.square.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.array.literal.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.array.literal.js', 'meta.brace.square.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'keyword.operator.comparison.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.brace.curly.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.brace.curly.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.name.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.name.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js'],
		['source.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js', 'meta.object.type.js', 'meta.field.declaration.js', 'meta.block.js', 'meta.object.member.js', 'meta.function.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.object.type.js', 'meta.method.declaration.js', 'meta.decl.block.js', 'meta.type.parameters.js', 'meta.type.paren.cover.js']
	];
}
