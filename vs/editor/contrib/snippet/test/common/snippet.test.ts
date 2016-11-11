/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { Range } from 'vs/editor/common/core/range';
import { CodeSnippet, ICodeSnippet, IPlaceHolder } from 'vs/editor/contrib/snippet/common/snippet';
import { Marker, Placeholder, Text, SnippetParser } from 'vs/editor/contrib/snippet/common/snippetParser';

suite('Editor Contrib - Snippets', () => {

	class CodeSnippetGlue implements ICodeSnippet {

		static fromValue(s: string): ICodeSnippet {
			const marker = new SnippetParser().parse(s);
			return new CodeSnippetGlue(marker);
		}

		static fromInternal(s: string): ICodeSnippet {
			const marker = new SnippetParser(false, true).parse(s);
			return new CodeSnippetGlue(marker);
		}

		static fromTextMate(s: string): ICodeSnippet {
			const marker = new SnippetParser(true, false).parse(s);
			return new CodeSnippetGlue(marker);
		}

		lines: string[] = [];
		placeHolders: IPlaceHolder[] = [];
		finishPlaceHolderIndex: number = -1;

		private constructor(marker: Marker[]) {

			let placeHolders: { [id: string]: IPlaceHolder } = Object.create(null);

			const stack = [...marker];
			this.lines = [''];
			while (stack.length > 0) {
				const marker = stack.shift();
				if (marker instanceof Text) {
					// simple text
					let lines = marker.string.split(/\r\n|\n|\r/);
					this.lines[this.lines.length - 1] += lines.shift();
					this.lines.push(...lines);

				} else if (marker instanceof Placeholder) {

					let placeHolder = placeHolders[marker.name];
					if (!placeHolder) {
						placeHolders[marker.name] = placeHolder = {
							id: marker.name,
							value: Marker.toString(marker.value),
							occurences: []
						};
						this.placeHolders.push(placeHolder);
					}

					const line = this.lines.length;
					const column = this.lines[line - 1].length + 1;

					placeHolder.occurences.push({
						startLineNumber: line,
						startColumn: column,
						endLineNumber: line,
						endColumn: column + Marker.toString(marker.value).length
					});

					stack.unshift(...marker.value);
				}
			}

			// Named variables (e.g. {greeting} and {greeting:Hello}) are sorted first, followed by
			// tab-stops and numeric variables (e.g. $1, $2, ${3:foo}) which are sorted in ascending order
			this.placeHolders.sort((a, b) => {
				let nonIntegerId = (v: IPlaceHolder) => !(/^\d+$/).test(v.id);
				let isFinishPlaceHolder = (v: IPlaceHolder) => (v.id === '' && v.value === '') || v.id === '0';

				// Sort finish placeholder last
				if (isFinishPlaceHolder(a)) {
					return 1;
				} else if (isFinishPlaceHolder(b)) {
					return -1;
				}

				// Sort named placeholders first
				if (nonIntegerId(a) && nonIntegerId(b)) {
					return 0;
				} else if (nonIntegerId(a)) {
					return -1;
				} else if (nonIntegerId(b)) {
					return 1;
				}

				if (a.id === b.id) {
					return 0;
				}

				return Number(a.id) < Number(b.id) ? -1 : 1;
			});

			if (this.placeHolders.length > 0 && this.placeHolders[this.placeHolders.length - 1].value === '') {
				this.finishPlaceHolderIndex = this.placeHolders.length - 1;

				if (this.placeHolders[this.placeHolders.length - 1].id === '0') {
					this.placeHolders[this.placeHolders.length - 1].id = '';
				}
			}
		}
	}

	function assertInternalAndTextmate(internal: string, textmate: string, callback: (snippet: ICodeSnippet) => any, ignoreTextMate = false) {

		// new world
		callback(CodeSnippetGlue.fromInternal(internal));
		if (!ignoreTextMate) {
			callback(CodeSnippetGlue.fromTextMate(textmate));
		}

		// old world
		callback(CodeSnippet.fromInternal(internal));
		callback(CodeSnippet.fromTextmate(textmate));
	}

	test('Support tab stop order', () => {

		assertInternalAndTextmate(
			'finished:{{}}, second:{{2:name}}, first:{{1:}}, third:{{3:}}',
			'finished:$0, second:${2:name}, first:$1, third:$3',
			snippet => {
				assert.deepEqual(snippet.lines, ['finished:, second:name, first:, third:']);
				assert.equal(snippet.placeHolders.length, 4);
				assert.equal(snippet.placeHolders[0].id, '1');
				assert.equal(snippet.placeHolders[0].value, '');
				assert.equal(snippet.placeHolders[1].id, '2');
				assert.equal(snippet.placeHolders[1].value, 'name');
				assert.equal(snippet.placeHolders[2].id, '3');
				assert.equal(snippet.placeHolders[2].value, '');
				assert.equal(snippet.placeHolders[3].id, '');
				assert.equal(snippet.placeHolders[3].value, '');
				assert.equal(snippet.finishPlaceHolderIndex, 3);
			});
	});

	test('Support tab stop order with implicit finish', () => {

		assertInternalAndTextmate(
			't2:{{2:}}, t1:{{1:}}',
			't2:$2, t1:$1',
			snippet => {
				assert.deepEqual(snippet.lines, ['t2:, t1:']);
				assert.equal(snippet.placeHolders.length, 2);
				assert.equal(snippet.placeHolders[0].id, '1');
				assert.equal(snippet.placeHolders[0].value, '');
				assert.equal(snippet.placeHolders[1].id, '2');
				assert.equal(snippet.placeHolders[1].value, '');
				assert.equal(snippet.finishPlaceHolderIndex, 1);
			});
	});

	test('Support tab stop order with no finish', () => {

		assertInternalAndTextmate(
			't2:{{2:second}}, t3:{{3:last}}, t1:{{1:first}}',
			't2:${2:second}, t3:${3:last}, t1:${1:first}',
			snippet => {
				assert.deepEqual(snippet.lines, ['t2:second, t3:last, t1:first']);
				assert.equal(snippet.placeHolders.length, 3);
				assert.equal(snippet.placeHolders[0].id, '1');
				assert.equal(snippet.placeHolders[0].value, 'first');
				assert.equal(snippet.placeHolders[1].id, '2');
				assert.equal(snippet.placeHolders[1].value, 'second');
				assert.equal(snippet.placeHolders[2].id, '3');
				assert.equal(snippet.placeHolders[2].value, 'last');
				assert.equal(snippet.finishPlaceHolderIndex, -1);
			});
	});

	test('Support tab stop order wich does not affect named variable id\'s', () => {

		assertInternalAndTextmate(
			'{{first}}-{{2:}}-{{second}}-{{1:}}',
			'${first}-${2}-${second}-${1}',
			snippet => {
				assert.deepEqual(snippet.lines, ['first--second-']);
				assert.equal(snippet.placeHolders.length, 4);
				assert.equal(snippet.placeHolders[0].id, 'first');
				assert.equal(snippet.placeHolders[1].id, 'second');
				assert.equal(snippet.placeHolders[2].id, '1');
				assert.equal(snippet.placeHolders[3].id, '2');
			},
			true // ignore new parser, the above is invalid TM syntax
		);
	});

	test('nested placeholder', () => {
		let snippet = CodeSnippet.fromTextmate([
			'<div${1: id="${2:some_id}"}>',
			'\t$0',
			'</div>'
		].join('\n'));

		assert.equal(snippet.placeHolders.length, 3);
		assert.equal(snippet.finishPlaceHolderIndex, 2);
		let [first, second, third] = snippet.placeHolders;

		assert.equal(third.id, 0);
		assert.equal(third.occurences.length, 1);
		assert.deepEqual(third.occurences[0], new Range(2, 2, 2, 2));

		assert.equal(second.id, 2);
		assert.equal(second.occurences.length, 1);
		assert.deepEqual(second.occurences[0], new Range(1, 10, 1, 17));

		assert.equal(first.id, '1');
		assert.equal(first.occurences.length, 1);
		assert.deepEqual(first.occurences[0], new Range(1, 5, 1, 18));
	});

	test('bug #17541:[snippets] Support default text in mirrors', () => {

		var external = [
			'begin{${1:enumerate}}',
			'\t$0',
			'end{$1}'
		].join('\n');

		var internal = [
			'begin\\{{{1:enumerate}}\\}',
			'\t{{}}',
			'end\\{{{1:}}\\}'
		].join('\n');

		assertInternalAndTextmate(internal, external, snippet => {
			assert.deepEqual(snippet.lines, [
				'begin{enumerate}',
				'\t',
				'end{enumerate}'
			]);
			assert.equal(snippet.placeHolders.length, 2);
			assert.equal(snippet.placeHolders[0].id, '1');
			assert.equal(snippet.placeHolders[0].occurences.length, 2);
			assert.deepEqual(snippet.placeHolders[0].occurences[0], new Range(1, 7, 1, 16));
			assert.deepEqual(snippet.placeHolders[0].occurences[1], new Range(3, 5, 3, 14));
			assert.equal(snippet.placeHolders[1].id, '');
			assert.equal(snippet.placeHolders[1].occurences.length, 1);
			assert.deepEqual(snippet.placeHolders[1].occurences[0], new Range(2, 2, 2, 2));
		});
	});

	test('bug #7093: Snippet default value is only populated for first variable reference', () => {
		var internal = 'logger.error({ logContext: lc, errorContext: `{{1:err}}`, error: {{1:}} });';
		var external = 'logger.error({ logContext: lc, errorContext: `${1:err}`, error: $1 });';

		assertInternalAndTextmate(internal, external, snippet => {
			assert.equal(snippet.lines.length, 1);
			assert.equal(snippet.lines[0], 'logger.error({ logContext: lc, errorContext: `err`, error: err });');
		});
	});

	test('bug #17487:[snippets] four backslashes are required to get one backslash in the inserted text', () => {

		var external = [
			'\\begin{${1:enumerate}}',
			'\t$0',
			'\\end{$1}'
		].join('\n');

		var internal = [
			'\\begin\\{{{1:enumerate}}\\}',
			'\t{{}}',
			'\\end\\{{{1:}}\\}'
		].join('\n');

		assertInternalAndTextmate(internal, external, snippet => {
			assert.deepEqual(snippet.lines, [
				'\\begin{enumerate}',
				'\t',
				'\\end{enumerate}'
			]);
			assert.equal(snippet.placeHolders.length, 2);
			assert.equal(snippet.placeHolders[0].id, '1');
			assert.equal(snippet.placeHolders[0].occurences.length, 2);
			assert.deepEqual(snippet.placeHolders[0].occurences[0], new Range(1, 8, 1, 17));
			assert.deepEqual(snippet.placeHolders[0].occurences[1], new Range(3, 6, 3, 15));
			assert.equal(snippet.placeHolders[1].id, '');
			assert.equal(snippet.placeHolders[1].occurences.length, 1);
			assert.deepEqual(snippet.placeHolders[1].occurences[0], new Range(2, 2, 2, 2));
		});
	});

	test('issue #3552: Snippet Converted Not Working for literal Dollar Sign', () => {

		let external = '\n\\$scope.\\$broadcast(\'scroll.infiniteScrollComplete\');\n';
		let snippet = CodeSnippet.fromTextmate(external);
		assert.equal(snippet.placeHolders.length, 0);
		assert.deepEqual(snippet.lines, ['', '$scope.$broadcast(\'scroll.infiniteScrollComplete\');', '']);
	});

	test('bind, adjust indentation', () => {

		// don't move placeholder at the beginning of the line
		let snippet = CodeSnippet.fromTextmate([
			'afterEach((done) => {',
			'\t${1}test${2}',
			'})'
		].join('\n'));

		// replace tab-stop with two spaces
		let boundSnippet = snippet.bind('', 0, 0, {
			normalizeIndentation(str: string): string {
				return str.replace(/\t/g, '  ');
			}
		});
		let [first, second] = boundSnippet.placeHolders;
		assert.equal(first.occurences.length, 1);
		assert.equal(first.occurences[0].startColumn, 3);
		assert.equal(second.occurences.length, 1);
		assert.equal(second.occurences[0].startColumn, 7);

		// keep tab-stop, identity
		boundSnippet = snippet.bind('', 0, 0, {
			normalizeIndentation(str: string): string {
				return str;
			}
		});
		[first, second] = boundSnippet.placeHolders;
		assert.equal(first.occurences.length, 1);
		assert.equal(first.occurences[0].startColumn, 2);
		assert.equal(second.occurences.length, 1);
		assert.equal(second.occurences[0].startColumn, 6);
	});


	test('issue #11890: Bad cursor position', () => {

		let snippet = CodeSnippet.fromTextmate([
			'afterEach((done) => {',
			'${1}\ttest${2}',
			'})'
		].join('\n'));

		let boundSnippet = snippet.bind('', 0, 0, {
			normalizeIndentation(str: string): string {
				return str.replace(/\t/g, '  ');
			}
		});

		assert.equal(boundSnippet.lines[1], '  test');
		assert.equal(boundSnippet.placeHolders.length, 2);
		let [first, second] = boundSnippet.placeHolders;
		assert.equal(first.occurences.length, 1);
		assert.equal(first.occurences[0].startColumn, 1);
		assert.equal(second.occurences.length, 1);
		assert.equal(second.occurences[0].startColumn, 7);
	});
});

