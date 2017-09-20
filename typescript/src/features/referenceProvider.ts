/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReferenceProvider, Location, TextDocument, Position, CancellationToken } from 'vscode';

import * as Proto from '../protocol';
import { ITypescriptServiceClient } from '../typescriptService';
import { textSpanToRange } from '../utils/convert';

export default class TypeScriptReferenceSupport implements ReferenceProvider {
	public constructor(
		private client: ITypescriptServiceClient) { }

	public provideReferences(document: TextDocument, position: Position, options: { includeDeclaration: boolean }, token: CancellationToken): Promise<Location[]> {
		const filepath = this.client.normalizePath(document.uri);
		if (!filepath) {
			return Promise.resolve<Location[]>([]);
		}
		const args: Proto.FileLocationRequestArgs = {
			file: filepath,
			line: position.line + 1,
			offset: position.character + 1
		};
		const apiVersion = this.client.apiVersion;
		return this.client.execute('references', args, token).then((msg) => {
			const result: Location[] = [];
			if (!msg.body) {
				return result;
			}
			const refs = msg.body.refs;
			for (let i = 0; i < refs.length; i++) {
				const ref = refs[i];
				if (!options.includeDeclaration && apiVersion.has203Features() && ref.isDefinition) {
					continue;
				}
				const url = this.client.asUrl(ref.file);
				const location = new Location(url, textSpanToRange(ref));
				result.push(location);
			}
			return result;
		}, () => {
			return [];
		});
	}
}