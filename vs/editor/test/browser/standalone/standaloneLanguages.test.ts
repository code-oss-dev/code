/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { TokenizationSupport2Adapter, TokensProvider, ILineTokens, IToken } from "vs/editor/browser/standalone/standaloneLanguages";
import { IStandaloneThemeService, IStandaloneThemeData, IStandaloneTheme } from "vs/editor/common/services/standaloneThemeService";
import Event from 'vs/base/common/event';
import { ITheme, LIGHT } from "vs/platform/theme/common/themeService";
import { LanguageIdentifier, LanguageId, IState, MetadataConsts } from "vs/editor/common/modes";
import { Token } from "vs/editor/common/core/token";
import { TokenTheme } from "vs/editor/common/modes/supports/tokenization";
import { ColorIdentifier } from "vs/platform/theme/common/colorRegistry";
import { Color } from "vs/base/common/color";

suite('TokenizationSupport2Adapter', () => {

	const languageIdentifier = new LanguageIdentifier('tttt', LanguageId.PlainText);
	const tokenMetadata = (languageIdentifier.id << MetadataConsts.LANGUAGEID_OFFSET);

	class MockTokenTheme extends TokenTheme {
		private counter = 0;
		constructor() {
			super(null, null);
		}
		public match(languageId: LanguageId, token: string): number {
			return (
				((this.counter++) << MetadataConsts.FOREGROUND_OFFSET)
				| (languageId << MetadataConsts.LANGUAGEID_OFFSET)
			) >>> 0;
		}
	}

	class MockThemeService implements IStandaloneThemeService {
		_serviceBrand = null;
		public setTheme(themeName: string): string {
			throw new Error('Not implemented');
		}
		public defineTheme(themeName: string, themeData: IStandaloneThemeData): void {
			throw new Error('Not implemented');
		}
		public getTheme(): IStandaloneTheme {
			return {
				tokenTheme: new MockTokenTheme(),

				type: LIGHT,

				getColor: (color: ColorIdentifier, useDefault?: boolean): Color => {
					throw new Error('Not implemented');
				},

				defines: (color: ColorIdentifier): boolean => {
					throw new Error('Not implemented');
				}
			};
		}
		public onThemeChange: Event<ITheme> = null;
	}

	class MockState implements IState {
		public static INSTANCE = new MockState();
		private constructor() { }
		public clone(): IState {
			return this;
		}
		public equals(other: IState): boolean {
			return this === other;
		}
	}

	function testBadTokensProvider(providerTokens: IToken[], offsetDelta: number, expectedClassicTokens: Token[], expectedModernTokens: number[]): void {

		class BadTokensProvider implements TokensProvider {
			public getInitialState(): IState {
				return MockState.INSTANCE;
			}
			public tokenize(line: string, state: IState): ILineTokens {
				return {
					tokens: providerTokens,
					endState: MockState.INSTANCE
				};
			}
		}

		const adapter = new TokenizationSupport2Adapter(new MockThemeService(), languageIdentifier, new BadTokensProvider());

		const actualClassicTokens = adapter.tokenize('whatever', MockState.INSTANCE, offsetDelta);
		assert.deepEqual(actualClassicTokens.tokens, expectedClassicTokens);

		const actualModernTokens = adapter.tokenize2('whatever', MockState.INSTANCE, offsetDelta);
		const modernTokens: number[] = [];
		for (let i = 0; i < actualModernTokens.tokens.length; i++) {
			modernTokens[i] = actualModernTokens.tokens[i];
		}
		assert.deepEqual(modernTokens, expectedModernTokens);
	}

	test('tokens always start at index 0 (no offset delta)', () => {
		testBadTokensProvider(
			[
				{ startIndex: 7, scopes: 'foo' },
				{ startIndex: 0, scopes: 'bar' }
			],
			0,
			[
				new Token(0, 'foo', languageIdentifier.language),
				new Token(0, 'bar', languageIdentifier.language),
			],
			[
				0, tokenMetadata | (0 << MetadataConsts.FOREGROUND_OFFSET),
				0, tokenMetadata | (1 << MetadataConsts.FOREGROUND_OFFSET)
			]
		);
	});

	test('tokens always start after each other (no offset delta)', () => {
		testBadTokensProvider(
			[
				{ startIndex: 0, scopes: 'foo' },
				{ startIndex: 5, scopes: 'bar' },
				{ startIndex: 3, scopes: 'foo' },
			],
			0,
			[
				new Token(0, 'foo', languageIdentifier.language),
				new Token(5, 'bar', languageIdentifier.language),
				new Token(5, 'foo', languageIdentifier.language),
			],
			[
				0, tokenMetadata | (0 << MetadataConsts.FOREGROUND_OFFSET),
				5, tokenMetadata | (1 << MetadataConsts.FOREGROUND_OFFSET),
				5, tokenMetadata | (2 << MetadataConsts.FOREGROUND_OFFSET)
			]
		);
	});

	test('tokens always start at index 0 (with offset delta)', () => {
		testBadTokensProvider(
			[
				{ startIndex: 7, scopes: 'foo' },
				{ startIndex: 0, scopes: 'bar' }
			],
			7,
			[
				new Token(7, 'foo', languageIdentifier.language),
				new Token(7, 'bar', languageIdentifier.language),
			],
			[
				7, tokenMetadata | (0 << MetadataConsts.FOREGROUND_OFFSET),
				7, tokenMetadata | (1 << MetadataConsts.FOREGROUND_OFFSET)
			]
		);
	});

	test('tokens always start after each other (with offset delta)', () => {
		testBadTokensProvider(
			[
				{ startIndex: 0, scopes: 'foo' },
				{ startIndex: 5, scopes: 'bar' },
				{ startIndex: 3, scopes: 'foo' },
			],
			7,
			[
				new Token(7, 'foo', languageIdentifier.language),
				new Token(12, 'bar', languageIdentifier.language),
				new Token(12, 'foo', languageIdentifier.language),
			],
			[
				7, tokenMetadata | (0 << MetadataConsts.FOREGROUND_OFFSET),
				12, tokenMetadata | (1 << MetadataConsts.FOREGROUND_OFFSET),
				12, tokenMetadata | (2 << MetadataConsts.FOREGROUND_OFFSET)
			]
		);
	});

});