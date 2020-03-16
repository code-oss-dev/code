/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IPickerQuickAccessItem, PickerQuickAccessProvider, TriggerAction } from 'vs/platform/quickinput/common/quickAccess';
import { fuzzyScore, createMatches, FuzzyScore } from 'vs/base/common/filters';
import { stripWildcards } from 'vs/base/common/strings';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ThrottledDelayer } from 'vs/base/common/async';
import { getWorkspaceSymbols, IWorkspaceSymbol, IWorkspaceSymbolProvider } from 'vs/workbench/contrib/search/common/search';
import { SymbolKinds, SymbolTag } from 'vs/editor/common/modes';
import { ILabelService } from 'vs/platform/label/common/label';
import { Schemas } from 'vs/base/common/network';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { Range } from 'vs/editor/common/core/range';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchEditorConfiguration } from 'vs/workbench/common/editor';
import { IKeyMods } from 'vs/platform/quickinput/common/quickInput';

interface ISymbolsQuickPickItem extends IPickerQuickAccessItem {
	score: FuzzyScore;
	symbol: IWorkspaceSymbol;
}

export class SymbolsQuickAccessProvider extends PickerQuickAccessProvider<ISymbolsQuickPickItem> {

	static PREFIX = '#';

	private static readonly TYPING_SEARCH_DELAY = 200; // this delay accommodates for the user typing a word and then stops typing to start searching

	private delayer = new ThrottledDelayer<ISymbolsQuickPickItem[]>(SymbolsQuickAccessProvider.TYPING_SEARCH_DELAY);

	constructor(
		@ILabelService private readonly labelService: ILabelService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(SymbolsQuickAccessProvider.PREFIX);
	}

	private get configuration() {
		const editorConfig = this.configurationService.getValue<IWorkbenchEditorConfiguration>().workbench.editor;

		return {
			openEditorPinned: !editorConfig.enablePreviewFromQuickOpen,
			openSideBySideDirection: editorConfig.openSideBySideDirection
		};
	}

	protected getPicks(filter: string, disposables: DisposableStore, token: CancellationToken): Promise<Array<ISymbolsQuickPickItem>> {
		return this.delayer.trigger(async () => {
			if (token.isCancellationRequested) {
				return [];
			}

			return this.doGetSymbolPicks(filter, token);
		});
	}

	private async doGetSymbolPicks(filter: string, token: CancellationToken): Promise<Array<ISymbolsQuickPickItem>> {
		const workspaceSymbols = await getWorkspaceSymbols(filter, token);
		if (token.isCancellationRequested) {
			return [];
		}

		const symbolPicks: Array<ISymbolsQuickPickItem> = [];

		// Normalize filter
		const [symbolFilter, containerFilter] = stripWildcards(filter).split(' ') as [string, string | undefined];
		const symbolFilterLow = symbolFilter.toLowerCase();
		const containerFilterLow = containerFilter?.toLowerCase();

		// Convert to symbol picks and apply filtering
		const openSideBySideDirection = this.configuration.openSideBySideDirection;
		for (const [provider, symbols] of workspaceSymbols) {
			for (const symbol of symbols) {
				const symbolLabel = symbol.name;
				const symbolLabelWithIcon = `$(symbol-${SymbolKinds.toString(symbol.kind) || 'property'}) ${symbolLabel}`;

				let containerLabel: string | undefined = undefined;
				if (symbol.location.uri) {
					const containerPath = this.labelService.getUriLabel(symbol.location.uri, { relative: true });
					if (symbol.containerName) {
						containerLabel = `${symbol.containerName} • ${containerPath}`;
					} else {
						containerLabel = containerPath;
					}
				}

				// Score by symbol
				const symbolScore = fuzzyScore(symbolFilter, symbolFilterLow, 0, symbolLabel, symbolLabel.toLowerCase(), 0, true);
				let containerScore: FuzzyScore | undefined = undefined;
				if (!symbolScore) {
					continue;
				}

				// Score by container if specified
				if (containerFilter && containerFilterLow) {
					if (containerLabel) {
						containerScore = fuzzyScore(containerFilter, containerFilterLow, 0, containerLabel, containerLabel.toLowerCase(), 0, true);
					}

					if (!containerScore) {
						continue;
					}
				}

				const deprecated = symbol.tags ? symbol.tags.indexOf(SymbolTag.Deprecated) >= 0 : false;

				symbolPicks.push({
					symbol,
					score: symbolScore,
					label: symbolLabelWithIcon,
					ariaLabel: localize('symbolAriaLabel', "{0}, symbols picker", symbolLabel),
					highlights: deprecated ? undefined : {
						label: createMatches(symbolScore, symbolLabelWithIcon.length - symbolLabel.length /* Readjust matches to account for codicons in label */),
						description: createMatches(containerScore)
					},
					description: containerLabel,
					strikethrough: deprecated,
					buttons: [
						{
							iconClass: openSideBySideDirection === 'right' ? 'codicon-split-horizontal' : 'codicon-split-vertical',
							tooltip: openSideBySideDirection === 'right' ? localize('openToSide', "Open to the Side") : localize('openToBottom', "Open to the Bottom")
						}
					],
					accept: async keyMods => this.openSymbol(provider, symbol, token, keyMods),
					trigger: async (buttonIndex, keyMods) => {
						this.openSymbol(provider, symbol, token, keyMods, true);

						return TriggerAction.CLOSE_PICKER;
					}
				});
			}
		}

		// Sort picks
		symbolPicks.sort((symbolA, symbolB) => this.compareSymbols(symbolA, symbolB));

		return symbolPicks;
	}

	private async openSymbol(provider: IWorkspaceSymbolProvider, symbol: IWorkspaceSymbol, token: CancellationToken, keyMods: IKeyMods, forceOpenSideBySide = false): Promise<void> {

		// Resolve actual symbol to open for providers that can resolve
		let symbolToOpen = symbol;
		if (typeof provider.resolveWorkspaceSymbol === 'function' && !symbol.location.range) {
			symbolToOpen = await provider.resolveWorkspaceSymbol(symbol, token) || symbol;

			if (token.isCancellationRequested) {
				return;
			}
		}

		// Open HTTP(s) links with opener service
		if (symbolToOpen.location.uri.scheme === Schemas.http || symbolToOpen.location.uri.scheme === Schemas.https) {
			this.openerService.open(symbolToOpen.location.uri, { fromUserGesture: true });
		}

		// Otherwise open as editor
		else {
			this.editorService.openEditor({
				resource: symbolToOpen.location.uri,
				options: {
					pinned: keyMods.alt || forceOpenSideBySide || this.configuration.openEditorPinned,
					selection: symbolToOpen.location.range ? Range.collapseToStart(symbolToOpen.location.range) : undefined
				}
			}, keyMods.ctrlCmd || forceOpenSideBySide ? SIDE_GROUP : ACTIVE_GROUP);
		}
	}

	private compareSymbols(symbolA: ISymbolsQuickPickItem, symbolB: ISymbolsQuickPickItem): number {

		// By score
		if (symbolA.score && symbolB.score) {
			if (symbolA.score[0] > symbolB.score[0]) {
				return -1;
			} else if (symbolA.score[0] < symbolB.score[0]) {
				return 1;
			}
		}

		// By name
		const symbolAName = symbolA.symbol.name.toLowerCase();
		const symbolBName = symbolB.symbol.name.toLowerCase();
		const res = symbolAName.localeCompare(symbolBName);
		if (res !== 0) {
			return res;
		}

		// By kind
		const symbolAKind = SymbolKinds.toCssClassName(symbolA.symbol.kind);
		const symbolBKind = SymbolKinds.toCssClassName(symbolB.symbol.kind);
		return symbolAKind.localeCompare(symbolBKind);
	}
}
