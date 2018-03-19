/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TextDocument, CompletionList, CompletionItemKind, CompletionItem, TextEdit, Range, Position } from 'vscode-languageserver-types';
import { Proposed } from 'vscode-languageserver-protocol';
import * as path from 'path';
import * as fs from 'fs';
import URI from 'vscode-uri';
import { ICompletionParticipant } from 'vscode-css-languageservice/lib/umd/cssLanguageService';
import { startsWith } from './utils/strings';

export function getPathCompletionParticipant(
	document: TextDocument,
	workspaceFolders: Proposed.WorkspaceFolder[] | undefined,
	result: CompletionList
): ICompletionParticipant {
	return {
		onCssURILiteralValue: (context: { uriValue: string, position: Position, range: Range; }) => {
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return;
			}
			const workspaceRoot = resolveWorkspaceRoot(document, workspaceFolders);

			const suggestions = providePathSuggestions(context.uriValue, context.range, URI.parse(document.uri).fsPath, workspaceRoot);
			result.items = [...suggestions, ...result.items];
		}
	};
}

export function providePathSuggestions(value: string, range: Range, activeDocFsPath: string, root?: string): CompletionItem[] {
	if (startsWith(value, '/') && !root) {
		return [];
	}

	let replaceRange: Range;
	const lastIndexOfSlash = value.lastIndexOf('/');
	if (lastIndexOfSlash === -1) {
		replaceRange = getFullReplaceRange(range);
	} else {
		const valueAfterLastSlash = value.slice(lastIndexOfSlash + 1);
		replaceRange = getReplaceRange(range, valueAfterLastSlash);
	}

	let parentDir: string;
	if (lastIndexOfSlash === -1) {
		parentDir = path.resolve(root);
	} else {
		const valueBeforeLastSlash = value.slice(0, lastIndexOfSlash + 1);

		parentDir = startsWith(value, '/')
			? path.resolve(root, '.' + valueBeforeLastSlash)
			: path.resolve(activeDocFsPath, '..', valueBeforeLastSlash);
	}

	try {
		return fs.readdirSync(parentDir).map(f => {
			if (isDir(path.resolve(parentDir, f))) {
				return {
					label: f + '/',
					kind: CompletionItemKind.Folder,
					textEdit: TextEdit.replace(replaceRange, f + '/'),
					command: {
						title: 'Suggest',
						command: 'editor.action.triggerSuggest'
					}
				};
			} else {
				return {
					label: f,
					kind: CompletionItemKind.File,
					textEdit: TextEdit.replace(replaceRange, f)
				};
			}
		});
	} catch (e) {
		return [];
	}
}

const isDir = (p: string) => {
	return fs.statSync(p).isDirectory();
};

function resolveWorkspaceRoot(activeDoc: TextDocument, workspaceFolders: Proposed.WorkspaceFolder[]): string | undefined {
	for (let i = 0; i < workspaceFolders.length; i++) {
		if (startsWith(activeDoc.uri, workspaceFolders[i].uri)) {
			return path.resolve(URI.parse(workspaceFolders[i].uri).fsPath);
		}
	}
}

function getFullReplaceRange(valueRange: Range) {
	const start = Position.create(valueRange.end.line, valueRange.start.character);
	const end = Position.create(valueRange.end.line, valueRange.end.character);
	return Range.create(start, end);
}
function getReplaceRange(valueRange: Range, valueAfterLastSlash: string) {
	const start = Position.create(valueRange.end.line, valueRange.end.character - valueAfterLastSlash.length);
	const end = Position.create(valueRange.end.line, valueRange.end.character);
	return Range.create(start, end);
}
