/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import * as glob from 'vs/base/common/glob';
import { URI } from 'vs/base/common/uri';
import { TPromise } from 'vs/base/common/winjs.base';
import { IFolderQuery, ITextQuery, QueryType } from 'vs/platform/search/common/search';
import { LegacyTextSearchService } from 'vs/workbench/services/search/node/legacy/rawLegacyTextSearchService';
import { ISerializedFileMatch } from 'vs/workbench/services/search/node/search';
import { TextSearchEngineAdapter } from 'vs/workbench/services/search/node/textSearchAdapter';

function countAll(matches: ISerializedFileMatch[]): number {
	return matches.reduce((acc, m) => acc + m.numMatches, 0);
}

const TEST_FIXTURES = path.normalize(getPathFromAmdModule(require, './fixtures'));
const EXAMPLES_FIXTURES = path.join(TEST_FIXTURES, 'examples');
const MORE_FIXTURES = path.join(TEST_FIXTURES, 'more');
const TEST_ROOT_FOLDER: IFolderQuery = { folder: URI.file(TEST_FIXTURES) };
const ROOT_FOLDER_QUERY: IFolderQuery[] = [
	TEST_ROOT_FOLDER
];

const MULTIROOT_QUERIES: IFolderQuery[] = [
	{ folder: URI.file(EXAMPLES_FIXTURES) },
	{ folder: URI.file(MORE_FIXTURES) }
];

function doLegacySearchTest(config: ITextQuery, expectedResultCount: number | Function): TPromise<void> {
	const engine = new LegacyTextSearchService();

	let c = 0;
	return engine.textSearch(config, (result) => {
		if (result && Array.isArray(result)) {
			c += countAll(result);
		}
	}, null).then(() => {
		if (typeof expectedResultCount === 'function') {
			assert(expectedResultCount(c));
		} else {
			assert.equal(c, expectedResultCount, 'legacy');
		}
	});
}

function doRipgrepSearchTest(query: ITextQuery, expectedResultCount: number | Function): TPromise<ISerializedFileMatch[]> {
	let engine = new TextSearchEngineAdapter(query);

	let c = 0;
	const results: ISerializedFileMatch[] = [];
	return engine.search(new CancellationTokenSource().token, _results => {
		if (_results) {
			c += _results.reduce((acc, cur) => acc + cur.numMatches, 0);
			results.push(..._results);
		}
	}, () => { }).then(() => {
		if (typeof expectedResultCount === 'function') {
			assert(expectedResultCount(c));
		} else {
			assert.equal(c, expectedResultCount, `rg ${c} !== ${expectedResultCount}`);
		}

		return results;
	});
}

function doSearchTest(query: ITextQuery, expectedResultCount: number) {
	return doLegacySearchTest(query, expectedResultCount)
		.then(() => doRipgrepSearchTest(query, expectedResultCount));
}

suite('Search-integration', function () {
	this.timeout(1000 * 60); // increase timeout for this suite

	test('Text: GameOfLife', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'GameOfLife' },
		};

		return doSearchTest(config, 4);
	});

	test('Text: GameOfLife (RegExp)', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'Game.?fL\\w?fe', isRegExp: true }
		};

		return doSearchTest(config, 4);
	});

	test('Text: GameOfLife (PCRE2 RegExp)', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			usePCRE2: true,
			contentPattern: { pattern: 'Life(?!P)', isRegExp: true }
		};

		return doSearchTest(config, 8);
	});

	test('Text: GameOfLife (RegExp to EOL)', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'GameOfLife.*', isRegExp: true }
		};

		return doSearchTest(config, 4);
	});

	test('Text: GameOfLife (Word Match, Case Sensitive)', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'GameOfLife', isWordMatch: true, isCaseSensitive: true }
		};

		return doSearchTest(config, 4);
	});

	test('Text: GameOfLife (Word Match, Spaces)', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: ' GameOfLife ', isWordMatch: true }
		};

		return doSearchTest(config, 1);
	});

	test('Text: GameOfLife (Word Match, Punctuation and Spaces)', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: ', as =', isWordMatch: true }
		};

		return doSearchTest(config, 1);
	});

	test('Text: Helvetica (UTF 16)', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'Helvetica' }
		};

		return doSearchTest(config, 3);
	});

	test('Text: e', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'e' }
		};

		return doSearchTest(config, 776);
	});

	test('Text: e (with excludes)', () => {
		const config: any = {
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'e' },
			excludePattern: { '**/examples': true }
		};

		return doSearchTest(config, 394);
	});

	test('Text: e (with includes)', () => {
		const config: any = {
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'e' },
			includePattern: { '**/examples/**': true }
		};

		return doSearchTest(config, 382);
	});

	// TODO
	// test('Text: e (with absolute path excludes)', () => {
	// 	const config: any = {
	// 		folderQueries: ROOT_FOLDER_QUERY,
	// 		contentPattern: { pattern: 'e' },
	// 		excludePattern: makeExpression(path.join(TEST_FIXTURES, '**/examples'))
	// 	};

	// 	return doSearchTest(config, 394);
	// });

	// test('Text: e (with mixed absolute/relative path excludes)', () => {
	// 	const config: any = {
	// 		folderQueries: ROOT_FOLDER_QUERY,
	// 		contentPattern: { pattern: 'e' },
	// 		excludePattern: makeExpression(path.join(TEST_FIXTURES, '**/examples'), '*.css')
	// 	};

	// 	return doSearchTest(config, 310);
	// });

	test('Text: sibling exclude', () => {
		const config: any = {
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'm' },
			includePattern: makeExpression('**/site*'),
			excludePattern: { '*.css': { when: '$(basename).less' } }
		};

		return doSearchTest(config, 1);
	});

	test('Text: e (with includes and exclude)', () => {
		const config: any = {
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'e' },
			includePattern: { '**/examples/**': true },
			excludePattern: { '**/examples/small.js': true }
		};

		return doSearchTest(config, 361);
	});

	test('Text: a (capped)', () => {
		const maxResults = 520;
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'a' },
			maxResults
		};

		// (Legacy) search can go over the maxResults because it doesn't trim the results from its worker processes to the exact max size.
		// But the worst-case scenario should be 2*max-1
		return doLegacySearchTest(config, count => count < maxResults * 2)
			.then(() => doRipgrepSearchTest(config, maxResults));
	});

	test('Text: a (no results)', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: 'ahsogehtdas' }
		};

		return doSearchTest(config, 0);
	});

	test('Text: -size', () => {
		const config = <ITextQuery>{
			type: QueryType.Text,
			folderQueries: ROOT_FOLDER_QUERY,
			contentPattern: { pattern: '-size' }
		};

		return doSearchTest(config, 9);
	});

	test('Multiroot: Conway', () => {
		const config: ITextQuery = {
			type: QueryType.Text,
			folderQueries: MULTIROOT_QUERIES,
			contentPattern: { pattern: 'conway' }
		};

		return doSearchTest(config, 8);
	});

	test('Multiroot: e with partial global exclude', () => {
		const config: ITextQuery = {
			type: QueryType.Text,
			folderQueries: MULTIROOT_QUERIES,
			contentPattern: { pattern: 'e' },
			excludePattern: makeExpression('**/*.txt')
		};

		return doSearchTest(config, 382);
	});

	test('Multiroot: e with global excludes', () => {
		const config: ITextQuery = {
			type: QueryType.Text,
			folderQueries: MULTIROOT_QUERIES,
			contentPattern: { pattern: 'e' },
			excludePattern: makeExpression('**/*.txt', '**/*.js')
		};

		return doSearchTest(config, 0);
	});

	test('Multiroot: e with folder exclude', () => {
		const config: ITextQuery = {
			type: QueryType.Text,
			folderQueries: [
				{ folder: URI.file(EXAMPLES_FIXTURES), excludePattern: makeExpression('**/e*.js') },
				{ folder: URI.file(MORE_FIXTURES) }
			],
			contentPattern: { pattern: 'e' }
		};

		return doSearchTest(config, 286);
	});

	suite('error messages', () => {
		test('invalid encoding', () => {
			const config = <ITextQuery>{
				type: QueryType.Text,
				folderQueries: [
					{
						...TEST_ROOT_FOLDER,
						fileEncoding: 'invalidEncoding'
					}
				],
				contentPattern: { pattern: 'test' },
			};

			return doRipgrepSearchTest(config, 0).then(() => {
				throw new Error('expected fail');
			}, err => {
				assert.equal(err.message, 'Unknown encoding: invalidEncoding');
			});
		});

		test('invalid regex', () => {
			const config = <ITextQuery>{
				type: QueryType.Text,
				folderQueries: ROOT_FOLDER_QUERY,
				contentPattern: { pattern: ')', isRegExp: true },
			};

			return doRipgrepSearchTest(config, 0).then(() => {
				throw new Error('expected fail');
			}, err => {
				assert.equal(err.message, 'Regex parse error');
			});
		});

		test('invalid glob', () => {
			const config = <ITextQuery>{
				type: QueryType.Text,
				folderQueries: ROOT_FOLDER_QUERY,
				contentPattern: { pattern: 'foo' },
				includePattern: {
					'***': true
				}
			};

			return doRipgrepSearchTest(config, 0).then(() => {
				throw new Error('expected fail');
			}, err => {
				assert.equal(err.message, 'Error parsing glob \'***\': invalid use of **; must be one path component');
			});
		});

		test('invalid literal', () => {
			const config = <ITextQuery>{
				type: QueryType.Text,
				folderQueries: ROOT_FOLDER_QUERY,
				contentPattern: { pattern: 'foo\nbar', isRegExp: true }
			};

			return doRipgrepSearchTest(config, 0).then(() => {
				throw new Error('expected fail');
			}, err => {
				assert.equal(err.message, 'The literal \'"\\n"\' is not allowed in a regex');
			});
		});

		test('Text: 语', () => {
			const config = <ITextQuery>{
				type: QueryType.Text,
				folderQueries: ROOT_FOLDER_QUERY,
				contentPattern: { pattern: '语' }
			};

			return doRipgrepSearchTest(config, 1).then(results => {
				const matchRange = results[0].matches[0].ranges;
				assert.deepEqual(matchRange, [{
					startLineNumber: 0,
					startColumn: 1,
					endLineNumber: 0,
					endColumn: 2
				}]);
			});
		});
	});
});

function makeExpression(...patterns: string[]): glob.IExpression {
	return patterns.reduce((glob, pattern) => {
		// glob.ts needs forward slashes
		pattern = pattern.replace(/\\/g, '/');
		glob[pattern] = true;
		return glob;
	}, Object.create(null));
}
