/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Match, searchMatchComparer, FileMatch, SearchResult, SearchModel } from 'vs/workbench/contrib/search/common/searchModel';
import { repeat } from 'vs/base/common/strings';
import { ILabelService } from 'vs/platform/label/common/label';
import { coalesce, flatten } from 'vs/base/common/arrays';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { URI } from 'vs/base/common/uri';
import { ITextQuery, IPatternInfo, ISearchConfigurationProperties } from 'vs/workbench/services/search/common/search';
import * as network from 'vs/base/common/network';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel, TrackedRangeStickiness } from 'vs/editor/common/model';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITextQueryBuilderOptions, QueryBuilder } from 'vs/workbench/contrib/search/common/queryBuilder';
import { getOutOfWorkspaceEditorResources } from 'vs/workbench/contrib/search/common/search';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

// Using \r\n on Windows inserts an extra newline between results.
const lineDelimiter = '\n';

const translateRangeLines =
	(n: number) =>
		(range: Range) =>
			new Range(range.startLineNumber + n, range.startColumn, range.endLineNumber + n, range.endColumn);

const matchToSearchResultFormat = (match: Match): { line: string, ranges: Range[], lineNumber: string }[] => {
	const getLinePrefix = (i: number) => `${match.range().startLineNumber + i}`;

	const fullMatchLines = match.fullPreviewLines();
	const largestPrefixSize = fullMatchLines.reduce((largest, _, i) => Math.max(getLinePrefix(i).length, largest), 0);


	const results: { line: string, ranges: Range[], lineNumber: string }[] = [];

	fullMatchLines
		.forEach((sourceLine, i) => {
			const lineNumber = getLinePrefix(i);
			const paddingStr = repeat(' ', largestPrefixSize - lineNumber.length);
			const prefix = `  ${lineNumber}: ${paddingStr}`;
			const prefixOffset = prefix.length;

			const line = (prefix + sourceLine);

			const rangeOnThisLine = ({ start, end }: { start?: number; end?: number; }) => new Range(1, (start ?? 1) + prefixOffset, 1, (end ?? sourceLine.length + 1) + prefixOffset);

			const matchRange = match.range();
			const matchIsSingleLine = matchRange.startLineNumber === matchRange.endLineNumber;

			let lineRange;
			if (matchIsSingleLine) { lineRange = (rangeOnThisLine({ start: matchRange.startColumn, end: matchRange.endColumn })); }
			else if (i === 0) { lineRange = (rangeOnThisLine({ start: matchRange.startColumn })); }
			else if (i === fullMatchLines.length - 1) { lineRange = (rangeOnThisLine({ end: matchRange.endColumn })); }
			else { lineRange = (rangeOnThisLine({})); }

			results.push({ lineNumber: lineNumber, line, ranges: [lineRange] });
		});

	return results;
};

type SearchResultSerialization = { text: string[], matchRanges: Range[] };
function fileMatchToSearchResultFormat(fileMatch: FileMatch, labelFormatter: (x: URI) => string): SearchResultSerialization {
	const serializedMatches = flatten(fileMatch.matches()
		.sort(searchMatchComparer)
		.map(match => matchToSearchResultFormat(match)));

	const uriString = labelFormatter(fileMatch.resource);
	let text: string[] = [`${uriString}:`];
	let matchRanges: Range[] = [];

	const targetLineNumberToOffset: Record<string, number> = {};

	const seenLines = new Set<string>();
	serializedMatches.forEach(match => {
		if (!seenLines.has(match.line)) {
			targetLineNumberToOffset[match.lineNumber] = text.length;
			seenLines.add(match.line);
			text.push(match.line);
		}

		matchRanges.push(...match.ranges.map(translateRangeLines(targetLineNumberToOffset[match.lineNumber])));
	});


	return { text, matchRanges };
}

const flattenSearchResultSerializations = (serializations: SearchResultSerialization[]): SearchResultSerialization => {
	let text: string[] = [];
	let matchRanges: Range[] = [];

	serializations.forEach(serialized => {
		serialized.matchRanges.map(translateRangeLines(text.length)).forEach(range => matchRanges.push(range));
		serialized.text.forEach(line => text.push(line));
		text.push(''); // new line
	});

	return { text, matchRanges };
};

const contentPatternToSearchResultHeader = (pattern: ITextQuery | null, includes: string, excludes: string): string[] => {
	if (!pattern) { return []; }

	const removeNullFalseAndUndefined = <T>(a: (T | null | false | undefined)[]) => a.filter(a => a !== false && a !== null && a !== undefined) as T[];

	const escapeNewlines = (str: string) => str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');

	return removeNullFalseAndUndefined([
		`# Query: ${escapeNewlines(pattern.contentPattern.pattern)}`,

		(pattern.contentPattern.isCaseSensitive || pattern.contentPattern.isWordMatch || pattern.contentPattern.isRegExp || pattern.userDisabledExcludesAndIgnoreFiles)
		&& `# Flags: ${coalesce([
			pattern.contentPattern.isCaseSensitive && 'CaseSensitive',
			pattern.contentPattern.isWordMatch && 'WordMatch',
			pattern.contentPattern.isRegExp && 'RegExp',
			pattern.userDisabledExcludesAndIgnoreFiles && 'IgnoreExcludeSettings'
		]).join(' ')}`,
		includes ? `# Including: ${includes}` : undefined,
		excludes ? `# Excluding: ${excludes}` : undefined,
		''
	]);
};

const searchHeaderToContentPattern = (header: string[]): { pattern: string, flags: { regex: boolean, wholeWord: boolean, caseSensitive: boolean, ignoreExcludes: boolean }, includes: string, excludes: string } => {
	const query = {
		pattern: '',
		flags: { regex: false, caseSensitive: false, ignoreExcludes: false, wholeWord: false },
		includes: '',
		excludes: ''
	};

	const unescapeNewlines = (str: string) => str.replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
	const parseYML = /^# ([^:]*): (.*)$/;
	for (const line of header) {
		const parsed = parseYML.exec(line);
		if (!parsed) { continue; }
		const [, key, value] = parsed;
		switch (key) {
			case 'Query': query.pattern = unescapeNewlines(value); break;
			case 'Including': query.includes = value; break;
			case 'Excluding': query.excludes = value; break;
			case 'Flags': {
				query.flags = {
					regex: value.indexOf('RegExp') !== -1,
					caseSensitive: value.indexOf('CaseSensitive') !== -1,
					ignoreExcludes: value.indexOf('IgnoreExcludeSettings') !== -1,
					wholeWord: value.indexOf('WordMatch') !== -1
				};
			}
		}
	}

	return query;
};

const serializeSearchResultForEditor = (searchResult: SearchResult, rawIncludePattern: string, rawExcludePattern: string, labelFormatter: (x: URI) => string): SearchResultSerialization => {
	const header = contentPatternToSearchResultHeader(searchResult.query, rawIncludePattern, rawExcludePattern);
	const allResults =
		flattenSearchResultSerializations(
			flatten(searchResult.folderMatches().sort(searchMatchComparer)
				.map(folderMatch => folderMatch.matches().sort(searchMatchComparer)
					.map(fileMatch => fileMatchToSearchResultFormat(fileMatch, labelFormatter)))));

	return { matchRanges: allResults.matchRanges.map(translateRangeLines(header.length)), text: header.concat(allResults.text) };
};

export const refreshActiveEditorSearch =
	async (editorService: IEditorService, instantiationService: IInstantiationService, contextService: IWorkspaceContextService, labelService: ILabelService, configurationService: IConfigurationService) => {
		const model = editorService.activeTextEditorWidget?.getModel();
		if (!model) { return; }

		const textModel = model as ITextModel;

		const header = textModel.getValueInRange(new Range(1, 1, 5, 1))
			.split(lineDelimiter)
			.filter(line => line.indexOf('# ') === 0);

		const contentPattern = searchHeaderToContentPattern(header);

		const content: IPatternInfo = {
			pattern: contentPattern.pattern,
			isRegExp: contentPattern.flags.regex,
			isCaseSensitive: contentPattern.flags.caseSensitive,
			isWordMatch: contentPattern.flags.wholeWord
		};

		const options: ITextQueryBuilderOptions = {
			_reason: 'searchEditor',
			extraFileResources: instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
			maxResults: 10000,
			disregardIgnoreFiles: contentPattern.flags.ignoreExcludes,
			disregardExcludeSettings: contentPattern.flags.ignoreExcludes,
			excludePattern: contentPattern.excludes,
			includePattern: contentPattern.includes,
			previewOptions: {
				matchLines: 1,
				charsPerLine: 1000
			},
			isSmartCase: configurationService.getValue<ISearchConfigurationProperties>('search').smartCase,
			expandPatterns: true
		};

		const folderResources = contextService.getWorkspace().folders;

		let query: ITextQuery;
		try {
			const queryBuilder = instantiationService.createInstance(QueryBuilder);
			query = queryBuilder.text(content, folderResources.map(folder => folder.uri), options);
		} catch (err) {
			return;
		}

		const searchModel = instantiationService.createInstance(SearchModel);
		await searchModel.search(query);

		const labelFormatter = (uri: URI): string => labelService.getUriLabel(uri, { relative: true });
		const results = serializeSearchResultForEditor(searchModel.searchResult, '', '', labelFormatter);

		textModel.setValue(results.text.join(lineDelimiter));
		textModel.deltaDecorations([], results.matchRanges.map(range => ({ range, options: { className: 'findMatch', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } })));
	};


export const createEditorFromSearchResult =
	async (searchResult: SearchResult, rawIncludePattern: string, rawExcludePattern: string, labelService: ILabelService, editorService: IEditorService) => {
		const searchTerm = searchResult.query?.contentPattern.pattern.replace(/[^\w-_.]/g, '') || 'Search';

		const labelFormatter = (uri: URI): string => labelService.getUriLabel(uri, { relative: true });

		const results = serializeSearchResultForEditor(searchResult, rawIncludePattern, rawExcludePattern, labelFormatter);

		let possible = {
			contents: results.text.join(lineDelimiter),
			mode: 'search-result',
			resource: URI.from({ scheme: network.Schemas.untitled, path: searchTerm })
		};

		let id = 0;
		while (editorService.getOpened(possible)) {
			possible.resource = possible.resource.with({ path: searchTerm + '-' + ++id });
		}

		const editor = await editorService.openEditor(possible);
		const control = editor?.getControl()!;
		control.updateOptions({ lineNumbers: 'off' });

		const model = control.getModel() as ITextModel;

		model.deltaDecorations([], results.matchRanges.map(range => ({ range, options: { className: 'findMatch', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } })));
	};
