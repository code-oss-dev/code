/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { registerModelAndPositionCommand } from 'vs/editor/browser/editorExtensions';
import { Position } from 'vs/editor/common/core/position';
import { ITextModel } from 'vs/editor/common/model';
import { DeclarationProviderRegistry, DefinitionProviderRegistry, ImplementationProviderRegistry, LocationLink, ProviderResult, ReferenceProvider, TypeDefinitionProviderRegistry } from 'vs/editor/common/languages';
import { LanguageFeatureRegistry } from 'vs/editor/common/languageFeatureRegistry';
import { ReferencesModel } from 'vs/editor/contrib/gotoSymbol/browser/referencesModel';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';

function getLocationLinks<T>(
	model: ITextModel,
	position: Position,
	registry: LanguageFeatureRegistry<T>,
	provide: (provider: T, model: ITextModel, position: Position) => ProviderResult<LocationLink | LocationLink[]>
): Promise<LocationLink[]> {
	const provider = registry.ordered(model);

	// get results
	const promises = provider.map((provider): Promise<LocationLink | LocationLink[] | undefined> => {
		return Promise.resolve(provide(provider, model, position)).then(undefined, err => {
			onUnexpectedExternalError(err);
			return undefined;
		});
	});

	return Promise.all(promises).then(values => {
		const result: LocationLink[] = [];
		for (let value of values) {
			if (Array.isArray(value)) {
				result.push(...value);
			} else if (value) {
				result.push(value);
			}
		}
		return result;
	});
}

export function getDefinitionsAtPosition(model: ITextModel, position: Position, token: CancellationToken): Promise<LocationLink[]> {
	return getLocationLinks(model, position, DefinitionProviderRegistry, (provider, model, position) => {
		return provider.provideDefinition(model, position, token);
	});
}

export function getDeclarationsAtPosition(model: ITextModel, position: Position, token: CancellationToken): Promise<LocationLink[]> {
	return getLocationLinks(model, position, DeclarationProviderRegistry, (provider, model, position) => {
		return provider.provideDeclaration(model, position, token);
	});
}

export function getImplementationsAtPosition(model: ITextModel, position: Position, token: CancellationToken): Promise<LocationLink[]> {
	return getLocationLinks(model, position, ImplementationProviderRegistry, (provider, model, position) => {
		return provider.provideImplementation(model, position, token);
	});
}

export function getTypeDefinitionsAtPosition(model: ITextModel, position: Position, token: CancellationToken): Promise<LocationLink[]> {
	return getLocationLinks(model, position, TypeDefinitionProviderRegistry, (provider, model, position) => {
		return provider.provideTypeDefinition(model, position, token);
	});
}

export function getReferencesAtPosition(registry: LanguageFeatureRegistry<ReferenceProvider>, model: ITextModel, position: Position, compact: boolean, token: CancellationToken): Promise<LocationLink[]> {
	return getLocationLinks(model, position, registry, async (provider, model, position) => {
		const result = await provider.provideReferences(model, position, { includeDeclaration: true }, token);
		if (!compact || !result || result.length !== 2) {
			return result;
		}
		const resultWithoutDeclaration = await provider.provideReferences(model, position, { includeDeclaration: false }, token);
		if (resultWithoutDeclaration && resultWithoutDeclaration.length === 1) {
			return resultWithoutDeclaration;
		}
		return result;
	});
}

// -- API commands ----

async function _sortedAndDeduped(callback: () => Promise<LocationLink[]>): Promise<LocationLink[]> {
	const rawLinks = await callback();
	const model = new ReferencesModel(rawLinks, '');
	const modelLinks = model.references.map(ref => ref.link);
	model.dispose();
	return modelLinks;
}

registerModelAndPositionCommand('_executeDefinitionProvider', (_accessor, model, position) => _sortedAndDeduped(() => getDefinitionsAtPosition(model, position, CancellationToken.None)));
registerModelAndPositionCommand('_executeDeclarationProvider', (_accessor, model, position) => _sortedAndDeduped(() => getDeclarationsAtPosition(model, position, CancellationToken.None)));
registerModelAndPositionCommand('_executeImplementationProvider', (_accessor, model, position) => _sortedAndDeduped(() => getImplementationsAtPosition(model, position, CancellationToken.None)));
registerModelAndPositionCommand('_executeTypeDefinitionProvider', (_accessor, model, position) => _sortedAndDeduped(() => getTypeDefinitionsAtPosition(model, position, CancellationToken.None)));
registerModelAndPositionCommand('_executeReferenceProvider', (accessor, model, position) => {
	const languageFeaturesService = accessor.get(ILanguageFeaturesService);
	const promise = getReferencesAtPosition(languageFeaturesService.referenceProvider, model, position, false, CancellationToken.None);
	return _sortedAndDeduped(() => promise);
});
