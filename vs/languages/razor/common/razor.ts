/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import Modes = require('vs/editor/common/modes');
import supports = require('vs/editor/common/modes/supports');
import htmlMode = require('vs/languages/html/common/html');
import csharpTokenization = require('vs/languages/razor/common/csharpTokenization');
import {createWordRegExp} from 'vs/editor/common/modes/abstractMode';
import {AsyncDescriptor2, createAsyncDescriptor2} from 'vs/platform/instantiation/common/descriptors';
import {OnEnterSupport} from 'vs/editor/common/modes/supports/onEnter';
import razorTokenTypes = require('vs/languages/razor/common/razorTokenTypes');
import {RAZORWorker} from 'vs/languages/razor/common/razorWorker';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IThreadService} from 'vs/platform/thread/common/thread';
import {IModeService} from 'vs/editor/common/services/modeService';
import {RichEditSupport} from 'vs/editor/common/modes/supports/richEditSupport';
import {ILeavingNestedModeData} from 'vs/editor/common/modes/supports/tokenizationSupport';

// for a brief description of the razor syntax see http://www.mikesdotnetting.com/Article/153/Inline-Razor-Syntax-Overview

class RAZORState extends htmlMode.State {

	constructor(mode:Modes.IMode, kind:htmlMode.States, lastTagName:string, lastAttributeName:string, embeddedContentType:string, attributeValueQuote:string, attributeValue:string) {
		super(mode, kind, lastTagName, lastAttributeName, embeddedContentType, attributeValueQuote, attributeValue);
	}

	public makeClone():RAZORState {
		return new RAZORState(this.getMode(), this.kind, this.lastTagName, this.lastAttributeName, this.embeddedContentType, this.attributeValueQuote, this.attributeValue);
	}

	public equals(other:Modes.IState):boolean {
		if (other instanceof RAZORState) {
			return (
				super.equals(other)
			);
		}
		return false;
	}

	public tokenize(stream:Modes.IStream):Modes.ITokenizationResult {

		if (!stream.eos() && stream.peek() === '@') {
			stream.next();
			if (!stream.eos() && stream.peek() === '*') {
				return { nextState: new csharpTokenization.CSComment(this.getMode(), this, '@') };
			}
			if (stream.eos() || stream.peek() !== '@') {
				return { type: razorTokenTypes.EMBED_CS, nextState: new csharpTokenization.CSStatement(this.getMode(), this, 0, 0, true, true, true, false) };
			}
		}

		return super.tokenize(stream);
	}
}

export class RAZORMode extends htmlMode.HTMLMode<RAZORWorker> {

	constructor(
		descriptor:Modes.IModeDescriptor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThreadService threadService: IThreadService,
		@IModeService modeService: IModeService
	) {
		super(descriptor, instantiationService, threadService, modeService);

		this.formattingSupport = null;
	}

	protected _createRichEditSupport(embeddedAutoClosingPairs: Modes.IAutoClosingPair[]): Modes.IRichEditSupport {
		return new RichEditSupport(this.getId(), {

			wordPattern: createWordRegExp('#?%'),

			comments: {
				blockComment: ['<!--', '-->']
			},

			brackets: [
				['<!--', '-->'],
				['{', '}'],
				['(', ')']
			],

			__electricCharacterSupport: {
				brackets: [],
				regexBrackets: [{
					tokenType: htmlMode.htmlTokenTypes.getTag('$1'),
					open: new RegExp(`<(?!(?:${htmlMode.EMPTY_ELEMENTS.join("|")}))(\\w[\\w\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
					closeComplete: '</$1>',
					close: /<\/(\w[\w\d]*)\s*>$/i
				}],
				caseInsensitive: true,
				embeddedElectricCharacters: ['*', '}', ']', ')']
			},

			__characterPairSupport: {
				autoClosingPairs: embeddedAutoClosingPairs.slice(0),
				surroundingPairs: [
					{ open: '"', close: '"' },
					{ open: '\'', close: '\'' }
				]
			}
		});
	}

	protected _getWorkerDescriptor(): AsyncDescriptor2<Modes.IMode, Modes.IWorkerParticipant[], RAZORWorker> {
		return createAsyncDescriptor2('vs/languages/razor/common/razorWorker', 'RAZORWorker');
	}

	public getInitialState(): Modes.IState {
		return new RAZORState(this, htmlMode.States.Content, '', '', '', '', '');
	}

	public getLeavingNestedModeData(line:string, state:Modes.IState): ILeavingNestedModeData {
		var leavingNestedModeData = super.getLeavingNestedModeData(line, state);
		if (leavingNestedModeData) {
			leavingNestedModeData.stateAfterNestedMode = new RAZORState(this, htmlMode.States.Content, '', '', '', '', '');
		}
		return leavingNestedModeData;
	}
}
