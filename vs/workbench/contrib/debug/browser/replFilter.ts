/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesFuzzy } from 'vs/base/common/filters';
import { splitGlobAware } from 'vs/base/common/glob';
import * as strings from 'vs/base/common/strings';
import { ITreeFilter, TreeVisibility, TreeFilterResult } from 'vs/base/browser/ui/tree/tree';
import { IReplElement } from 'vs/workbench/contrib/debug/common/debug';

type ParsedQuery = {
	type: 'include' | 'exclude',
	query: string,
};

export class ReplFilter implements ITreeFilter<IReplElement> {

	static matchQuery = matchesFuzzy;

	constructor(initialQuery: string) {
		this.filterQuery = initialQuery;
	}

	private _parsedQueries: ParsedQuery[] = [];
	set filterQuery(query: string) {
		this._parsedQueries = [];
		query = query.trim();

		if (query && query !== '') {
			const filters = splitGlobAware(query, ',').map(s => s.trim()).filter(s => !!s.length);
			for (const f of filters) {
				if (strings.startsWith(f, '!')) {
					this._parsedQueries.push({ type: 'exclude', query: f.slice(1) });
				} else {
					this._parsedQueries.push({ type: 'include', query: f });
				}
			}
		}
	}

	filter(element: IReplElement, parentVisibility: TreeVisibility): TreeFilterResult<void> {
		if (this._parsedQueries.length === 0) {
			return parentVisibility;
		}

		let includeQueryPresent = false;
		let includeQueryMatched = false;

		const text = element.toString();

		for (let { type, query } of this._parsedQueries) {
			if (type === 'exclude' && ReplFilter.matchQuery(query, text)) {
				// If exclude query matches, ignore all other queries and hide
				return false;
			} else if (type === 'include') {
				includeQueryPresent = true;
				if (ReplFilter.matchQuery(query, text)) {
					includeQueryMatched = true;
				}
			}
		}

		return includeQueryPresent ? includeQueryMatched : parentVisibility;
	}
}
