/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Token, TokenizationResult, EncodedTokenizationResult } from 'vs/editor/common/core/token';
import { ColorId, FontStyle, IState, LanguageId, MetadataConsts, StandardTokenType } from 'vs/editor/common/modes';

class NullStateImpl implements IState {

	public clone(): IState {
		return this;
	}

	public equals(other: IState): boolean {
		return (this === other);
	}
}

export const NULL_STATE: IState = new NullStateImpl();

export function nullTokenize(languageId: string, state: IState): TokenizationResult {
	return new TokenizationResult([new Token(0, '', languageId)], state);
}

export function nullTokenizeEncoded(languageId: LanguageId, state: IState | null): EncodedTokenizationResult {
	let tokens = new Uint32Array(2);
	tokens[0] = 0;
	tokens[1] = (
		(languageId << MetadataConsts.LANGUAGEID_OFFSET)
		| (StandardTokenType.Other << MetadataConsts.TOKEN_TYPE_OFFSET)
		| (FontStyle.None << MetadataConsts.FONT_STYLE_OFFSET)
		| (ColorId.DefaultForeground << MetadataConsts.FOREGROUND_OFFSET)
		| (ColorId.DefaultBackground << MetadataConsts.BACKGROUND_OFFSET)
	) >>> 0;

	return new EncodedTokenizationResult(tokens, state === null ? NULL_STATE : state);
}
