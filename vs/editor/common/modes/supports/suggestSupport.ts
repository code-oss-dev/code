/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import {TPromise} from 'vs/base/common/winjs.base';
import {IPosition} from 'vs/editor/common/editorCommon';
import {ILineContext, IMode, ISuggestResult, ISuggestSupport, ISuggestion} from 'vs/editor/common/modes';
import {IFilter, matchesStrictPrefix, fuzzyContiguousFilter} from 'vs/base/common/filters';
import {handleEvent, isLineToken} from 'vs/editor/common/modes/supports';
import {IEditorWorkerService} from 'vs/editor/common/services/editorWorkerService';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {IConfigurationRegistry, Extensions} from 'vs/platform/configuration/common/configurationRegistry';
import {Registry} from 'vs/platform/platform';
import {localize} from 'vs/nls';

export interface ISuggestContribution {
	triggerCharacters: string[];
	disableAutoTrigger?: boolean;
	excludeTokens: string[];
	suggest: (resource: URI, position: IPosition) => TPromise<ISuggestResult[]>;
	getSuggestionDetails? : (resource:URI, position:IPosition, suggestion:ISuggestion) => TPromise<ISuggestion>;
}

export class SuggestSupport implements ISuggestSupport {

	private _modeId: string;
	private contribution: ISuggestContribution;

	public suggest : (resource:URI, position:IPosition) => TPromise<ISuggestResult[]>;
	public getSuggestionDetails : (resource:URI, position:IPosition, suggestion:ISuggestion) => TPromise<ISuggestion>;

	constructor(modeId: string, contribution : ISuggestContribution){
		this._modeId = modeId;
		this.contribution = contribution;
		this.suggest = (resource, position) => contribution.suggest(resource, position);

		if (typeof contribution.getSuggestionDetails === 'function') {
			this.getSuggestionDetails = (resource, position, suggestion) => contribution.getSuggestionDetails(resource, position, suggestion);
		}
	}

	shouldAutotriggerSuggest(context: ILineContext, offset: number, triggeredByCharacter: string): boolean {
		return handleEvent(context, offset, (nestedMode:IMode, context:ILineContext, offset:number) => {
			if (this._modeId === nestedMode.getId()) {
				if (this.contribution.disableAutoTrigger) {
					return false;
				}
				if (!Array.isArray(this.contribution.excludeTokens)) {
					return true;
				}
				if (this.contribution.excludeTokens.length === 1 && this.contribution.excludeTokens[0] === '*') {
					return false;
				}
				return !isLineToken(context, offset-1, this.contribution.excludeTokens, true);
			}
			return true;
		});
	}

	public getTriggerCharacters(): string[] {
		return this.contribution.triggerCharacters;
	}
}

export class TextualSuggestSupport implements ISuggestSupport {

	/* tslint:disable */
	private static _c = Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
		type: 'object',
		properties: {
			'editor.wordBasedSuggestions': {
				'type': 'boolean',
				'description': localize('editor.wordBasedSuggestions', "Enable word based suggestions."),
				'default': true
			}
		}
	});
	/* tslint:enable */

	private _modeId: string;
	private _editorWorkerService: IEditorWorkerService;
	private _configurationService: IConfigurationService;

	constructor(modeId: string, editorWorkerService: IEditorWorkerService, configurationService: IConfigurationService) {
		this._modeId = modeId;
		this._editorWorkerService = editorWorkerService;
		this._configurationService = configurationService;
	}

	public suggest(resource: URI, position: IPosition, triggerCharacter?: string): TPromise<ISuggestResult[]> {
		let config = this._configurationService.getConfiguration<{ wordBasedSuggestions: boolean }>('editor');
		return (!config || config.wordBasedSuggestions)
			? this._editorWorkerService.textualSuggest(resource, position)
			: TPromise.as([]);
	}

	public get filter(): IFilter {
		return matchesStrictPrefix;
	}

	public getTriggerCharacters(): string[] {
		return [];
	}

	public shouldAutotriggerSuggest(context: ILineContext, offset: number, triggeredByCharacter: string): boolean {
		return handleEvent(context, offset, (nestedMode:IMode, context:ILineContext, offset:number) => {
			if (this._modeId === nestedMode.getId()) {
				return true;
			}
			return true;
		});
	}

}

export function filterSuggestions(value: ISuggestResult): ISuggestResult[] {
	if (!value) {
		return;
	}
	// filter suggestions
	var accept = fuzzyContiguousFilter,
		result: ISuggestResult[] = [];

	result.push({
		currentWord: value.currentWord,
		suggestions: value.suggestions.filter((element) => !!accept(value.currentWord, element.label)),
		incomplete: value.incomplete
	});

	return result;
}
