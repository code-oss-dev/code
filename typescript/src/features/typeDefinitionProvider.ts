/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypeDefinitionProvider, TextDocument, Position, CancellationToken, Definition } from 'vscode';

import { ITypescriptServiceClient } from '../typescriptService';
import DefinitionProviderBase from './definitionProviderBase';

export default class TypeScriptTypeDefinitionProvider extends DefinitionProviderBase implements TypeDefinitionProvider {
	constructor(client: ITypescriptServiceClient) {
		super(client);
	}

	public provideTypeDefinition(document: TextDocument, position: Position, token: CancellationToken | boolean): Promise<Definition | null> {
		return this.getSymbolLocations('typeDefinition', document, position, token);
	}
}