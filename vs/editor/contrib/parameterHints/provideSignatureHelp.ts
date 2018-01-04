/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { IModel } from 'vs/editor/common/model/model';
import { registerDefaultLanguageCommand } from 'vs/editor/browser/editorExtensions';
import { SignatureHelp, SignatureHelpProviderRegistry } from 'vs/editor/common/modes';
import { asWinJsPromise, sequence } from 'vs/base/common/async';
import { Position } from 'vs/editor/common/core/position';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export const Context = {
	Visible: new RawContextKey<boolean>('parameterHintsVisible', false),
	MultipleSignatures: new RawContextKey<boolean>('parameterHintsMultipleSignatures', false),
};

export function provideSignatureHelp(model: IModel, position: Position): TPromise<SignatureHelp> {

	const supports = SignatureHelpProviderRegistry.ordered(model);
	let result: SignatureHelp;

	return sequence(supports.map(support => () => {

		if (result) {
			// stop when there is a result
			return undefined;
		}

		return asWinJsPromise(token => support.provideSignatureHelp(model, position, token)).then(thisResult => {
			result = thisResult;
		}, onUnexpectedExternalError);

	})).then(() => result);
}

registerDefaultLanguageCommand('_executeSignatureHelpProvider', provideSignatureHelp);
