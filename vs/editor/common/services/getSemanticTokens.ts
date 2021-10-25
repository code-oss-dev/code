/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { DocumentSemanticTokensProviderRegistry, DocumentSemanticTokensProvider, SemanticTokens, SemanticTokensEdits, SemanticTokensLegend, DocumentRangeSemanticTokensProviderRegistry, DocumentRangeSemanticTokensProvider } from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { assertType } from 'vs/base/common/types';
import { VSBuffer } from 'vs/base/common/buffer';
import { encodeSemanticTokensDto } from 'vs/editor/common/services/semanticTokensDto';
import { Range } from 'vs/editor/common/core/range';
import { Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';

export function isSemanticTokens(v: SemanticTokens | SemanticTokensEdits): v is SemanticTokens {
	return v && !!((<SemanticTokens>v).data);
}

export function isSemanticTokensEdits(v: SemanticTokens | SemanticTokensEdits): v is SemanticTokensEdits {
	return v && Array.isArray((<SemanticTokensEdits>v).edits);
}

export interface IDocumentSemanticTokensResult {
	provider: DocumentSemanticTokensProvider;
	request: Promise<SemanticTokens | SemanticTokensEdits | null | undefined>;
}

export function getDocumentSemanticTokens(model: ITextModel, lastResultId: string | null, token: CancellationToken): IDocumentSemanticTokensResult | null {
	const providerGroup = _getDocumentSemanticTokensProviderHighestGroup(model);
	if (!providerGroup) {
		return null;
	}
	const compositeProvider = new CompositeDocumentSemanticTokensProvider(model, providerGroup);
	return {
		provider: compositeProvider,
		request: Promise.resolve(compositeProvider.provideDocumentSemanticTokens(model, lastResultId, token))
	};
}

class CompositeDocumentSemanticTokensProvider implements DocumentSemanticTokensProvider {

	private readonly disposables = new DisposableStore();

	private readonly didChangeEmitter = this.disposables.add(new Emitter<void>());
	public readonly onDidChange = this.didChangeEmitter.event;

	private lastUsedProvider: DocumentSemanticTokensProvider | undefined = undefined;

	private static providerToLastResult = new WeakMap<DocumentSemanticTokensProvider, string>();

	constructor(model: ITextModel, private readonly providerGroup: DocumentSemanticTokensProvider[]) {
		// Lifetime of this provider is tied to the text model
		model.onWillDispose(() => this.disposables.clear());

		// Mirror did change events
		providerGroup.forEach(p => {
			if (p.onDidChange) {
				p.onDidChange(() => this.didChangeEmitter.fire(), this, this.disposables);
			}
		});
	}

	public async provideDocumentSemanticTokens(model: ITextModel, lastResultId: string | null, token: CancellationToken): Promise<SemanticTokens | SemanticTokensEdits | null | undefined> {
		// Get tokens from the group all at the same time. Return the first
		// that actually returned tokens
		const list = await Promise.all(this.providerGroup.map(async provider => {
			try {
				// If result id is passed in, make sure it's for this provider
				const localLastResultId = lastResultId && CompositeDocumentSemanticTokensProvider.providerToLastResult.get(provider) === lastResultId ? lastResultId : null;

				// Get the result for this provider
				const result = await provider.provideDocumentSemanticTokens(model, localLastResultId, token);

				// Save result id for this provider
				if (result?.resultId) {
					CompositeDocumentSemanticTokensProvider.providerToLastResult.set(provider, result.resultId);
				}

				return result;
			} catch (err) {
				onUnexpectedExternalError(err);
			}
			return undefined;
		}));

		const hasTokensIndex = list.findIndex(l => l);

		// Save last used provider. Use it for the legend if called
		this.lastUsedProvider = this.providerGroup[hasTokensIndex];
		return list[hasTokensIndex];
	}

	public getLegend(): SemanticTokensLegend {
		return this.lastUsedProvider?.getLegend() || this.providerGroup[0].getLegend();
	}

	public releaseDocumentSemanticTokens(resultId: string | undefined): void {
		this.providerGroup.forEach(p => {
			// If this result is for this provider, release it
			if (resultId) {
				if (CompositeDocumentSemanticTokensProvider.providerToLastResult.get(p) === resultId) {
					p.releaseDocumentSemanticTokens(resultId);
					CompositeDocumentSemanticTokensProvider.providerToLastResult.delete(p);
				}
				// Else if the result is empty, release for all providers that aren't waiting for a result id
			} else if (CompositeDocumentSemanticTokensProvider.providerToLastResult.get(p) === undefined) {
				p.releaseDocumentSemanticTokens(undefined);
			}
		});
	}
}

class CompositeDocumentRangeSemanticTokensProvider implements DocumentRangeSemanticTokensProvider {

	private lastUsedProvider: DocumentRangeSemanticTokensProvider | undefined = undefined;

	constructor(
		private readonly providerGroup: DocumentRangeSemanticTokensProvider[]
	) { }

	public async provideDocumentRangeSemanticTokens(model: ITextModel, range: Range, token: CancellationToken): Promise<SemanticTokens | null | undefined> {
		// Get tokens from the group all at the same time. Return the first
		// that actually returned tokens
		const list = await Promise.all(this.providerGroup.map(async provider => {
			try {
				return await provider.provideDocumentRangeSemanticTokens(model, range, token);
			} catch (err) {
				onUnexpectedExternalError(err);
			}
			return undefined;
		}));

		const hasTokensIndex = list.findIndex(l => l);

		// Save last used provider. Use it for the legend if called
		this.lastUsedProvider = this.providerGroup[hasTokensIndex];
		return list[hasTokensIndex];
	}

	getLegend(): SemanticTokensLegend {
		return this.lastUsedProvider?.getLegend() || this.providerGroup[0].getLegend();
	}
}

function _getDocumentSemanticTokensProviderHighestGroup(model: ITextModel): DocumentSemanticTokensProvider[] | null {
	const result = DocumentSemanticTokensProviderRegistry.orderedGroups(model);
	return (result.length > 0 ? result[0] : null);
}

function _getDocumentRangeSemanticTokensProviderHighestGroup(model: ITextModel): DocumentRangeSemanticTokensProvider[] | null {
	const result = DocumentRangeSemanticTokensProviderRegistry.orderedGroups(model);
	return (result.length > 0 ? result[0] : null);
}

export function getDocumentRangeSemanticTokensProvider(model: ITextModel): DocumentRangeSemanticTokensProvider | null {
	const highestGroup = _getDocumentRangeSemanticTokensProviderHighestGroup(model);
	return highestGroup ? new CompositeDocumentRangeSemanticTokensProvider(highestGroup) : null;
}

CommandsRegistry.registerCommand('_provideDocumentSemanticTokensLegend', async (accessor, ...args): Promise<SemanticTokensLegend | undefined> => {
	const [uri] = args;
	assertType(uri instanceof URI);

	const model = accessor.get(IModelService).getModel(uri);
	if (!model) {
		return undefined;
	}

	const providers = _getDocumentSemanticTokensProviderHighestGroup(model);
	if (!providers) {
		// there is no provider => fall back to a document range semantic tokens provider
		return accessor.get(ICommandService).executeCommand('_provideDocumentRangeSemanticTokensLegend', uri);
	}

	return providers[0].getLegend();
});

CommandsRegistry.registerCommand('_provideDocumentSemanticTokens', async (accessor, ...args): Promise<VSBuffer | undefined> => {
	const [uri] = args;
	assertType(uri instanceof URI);

	const model = accessor.get(IModelService).getModel(uri);
	if (!model) {
		return undefined;
	}

	const r = getDocumentSemanticTokens(model, null, CancellationToken.None);
	if (!r) {
		// there is no provider => fall back to a document range semantic tokens provider
		return accessor.get(ICommandService).executeCommand('_provideDocumentRangeSemanticTokens', uri, model.getFullModelRange());
	}

	const { provider, request } = r;

	let result: SemanticTokens | SemanticTokensEdits | null | undefined;
	try {
		result = await request;
	} catch (err) {
		onUnexpectedExternalError(err);
		return undefined;
	}

	if (!result || !isSemanticTokens(result)) {
		return undefined;
	}

	const buff = encodeSemanticTokensDto({
		id: 0,
		type: 'full',
		data: result.data
	});
	if (result.resultId) {
		provider.releaseDocumentSemanticTokens(result.resultId);
	}
	return buff;
});

CommandsRegistry.registerCommand('_provideDocumentRangeSemanticTokensLegend', async (accessor, ...args): Promise<SemanticTokensLegend | undefined> => {
	const [uri] = args;
	assertType(uri instanceof URI);

	const model = accessor.get(IModelService).getModel(uri);
	if (!model) {
		return undefined;
	}

	const provider = getDocumentRangeSemanticTokensProvider(model);
	if (!provider) {
		return undefined;
	}

	return provider.getLegend();
});

CommandsRegistry.registerCommand('_provideDocumentRangeSemanticTokens', async (accessor, ...args): Promise<VSBuffer | undefined> => {
	const [uri, range] = args;
	assertType(uri instanceof URI);
	assertType(Range.isIRange(range));

	const model = accessor.get(IModelService).getModel(uri);
	if (!model) {
		return undefined;
	}

	const provider = getDocumentRangeSemanticTokensProvider(model);
	if (!provider) {
		// there is no provider
		return undefined;
	}

	let result: SemanticTokens | null | undefined;
	try {
		result = await provider.provideDocumentRangeSemanticTokens(model, Range.lift(range), CancellationToken.None);
	} catch (err) {
		onUnexpectedExternalError(err);
		return undefined;
	}

	if (!result || !isSemanticTokens(result)) {
		return undefined;
	}

	return encodeSemanticTokensDto({
		id: 0,
		type: 'full',
		data: result.data
	});
});
