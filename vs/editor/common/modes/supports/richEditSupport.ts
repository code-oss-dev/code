/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {ICommentsConfiguration, IRichEditBrackets, IRichEditCharacterPair, IRichEditOnEnter, IRichEditSupport} from 'vs/editor/common/modes';
import {NullMode} from 'vs/editor/common/modes/nullMode';
import {CharacterPairSupport} from 'vs/editor/common/modes/supports/characterPair';
import {ICharacterPairContribution} from 'vs/editor/common/modes/supports/characterPair';
import {BracketElectricCharacterSupport, IBracketElectricCharacterContribution} from 'vs/editor/common/modes/supports/electricCharacter';
import {IIndentationRules, IOnEnterRegExpRules, IOnEnterSupportOptions, OnEnterSupport} from 'vs/editor/common/modes/supports/onEnter';

export type CharacterPair = [string, string];

export interface CommentRule {
	lineComment?: string;
	blockComment?: CharacterPair;
}

export interface IRichEditConfiguration {
	comments?: CommentRule;
	brackets?: CharacterPair[];
	wordPattern?: RegExp;
	indentationRules?: IIndentationRules;
	onEnterRules?: IOnEnterRegExpRules[];
	__electricCharacterSupport?: IBracketElectricCharacterContribution;
	__characterPairSupport?: ICharacterPairContribution;
}

export class RichEditSupport implements IRichEditSupport {

	public electricCharacter: BracketElectricCharacterSupport;
	public comments: ICommentsConfiguration;
	public characterPair: IRichEditCharacterPair;
	public wordDefinition: RegExp;
	public onEnter: IRichEditOnEnter;
	public brackets: IRichEditBrackets;

	constructor(modeId:string, conf:IRichEditConfiguration) {

		this._handleOnEnter(modeId, conf);

		this._handleComments(modeId, conf);

		if (conf.__characterPairSupport) {
			this.characterPair = new CharacterPairSupport(modeId, conf.__characterPairSupport);
		}

		if (conf.__electricCharacterSupport) {
			this.electricCharacter = new BracketElectricCharacterSupport(modeId, conf.__electricCharacterSupport);
			this.brackets = this.electricCharacter.getRichEditBrackets();
		}

		this.wordDefinition = conf.wordPattern || NullMode.DEFAULT_WORD_REGEXP;
	}

	private _handleOnEnter(modeId:string, conf:IRichEditConfiguration): void {
		// on enter
		let onEnter: IOnEnterSupportOptions = {};
		let empty = true;
		let {brackets, indentationRules, onEnterRules} = conf;

		if (brackets) {
			empty = false;
			onEnter.brackets = brackets.map(pair => {
				let [open, close] = pair;
				return { open, close };
			});
		}
		if (indentationRules) {
			empty = false;
			onEnter.indentationRules = indentationRules;
		}
		if (onEnterRules) {
			empty = false;
			onEnter.regExpRules = <any>onEnterRules;
		}

		if (!empty) {
			this.onEnter = new OnEnterSupport(modeId, onEnter);
		}
	}

	private _handleComments(modeId:string, conf:IRichEditConfiguration): void {
		let commentRule = conf.comments;

		// comment configuration
		if (commentRule) {
			this.comments = {};

			if (commentRule.lineComment) {
				this.comments.lineCommentToken = commentRule.lineComment;
			}
			if (commentRule.blockComment) {
				let [blockStart, blockEnd] = commentRule.blockComment;
				this.comments.blockCommentStartToken = blockStart;
				this.comments.blockCommentEndToken = blockEnd;
			}
		}
	}

}
