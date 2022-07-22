/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nls from 'vs/nls';
import { matchesFuzzy } from 'vs/base/common/filters';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IDebugService, IDebugSession } from 'vs/workbench/contrib/debug/common/debug';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { IModelService } from 'vs/editor/common/services/model';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { DisposableStore } from 'vs/base/common/lifecycle';

import { dirname } from 'vs/base/common/resources';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';

export interface IPickerDebugItem extends IQuickPickItem {
	accept(): void;
}

/**
 * This function takes a regular quickpick and makes one for loaded scripts that has persistent headers
 * e.g. when some picks are filtered out, the ones that are visible still have its header.
 */
export async function showLoadedScriptMenu(accessor: ServicesAccessor) {
	const quickInputService = accessor.get(IQuickInputService);
	const debugService = accessor.get(IDebugService);
	const editorService = accessor.get(IEditorService);
	const sessions = debugService.getModel().getSessions(false);
	const modelService = accessor.get(IModelService);
	const languageService = accessor.get(ILanguageService);
	const labelService = accessor.get(ILabelService);

	const localDisposableStore = new DisposableStore();
	const quickPick = quickInputService.createQuickPick<IPickerDebugItem>();
	localDisposableStore.add(quickPick);
	quickPick.matchOnLabel = quickPick.matchOnDescription = quickPick.matchOnDetail = quickPick.sortByLabel = false;
	quickPick.placeholder = nls.localize('moveFocusedView.selectView', "Search loaded scripts by name");
	quickPick.items = await _getPicks(quickPick.value, sessions, editorService, modelService, languageService, labelService);

	localDisposableStore.add(quickPick.onDidChangeValue(async () => {
		quickPick.items = await _getPicks(quickPick.value, sessions, editorService, modelService, languageService, labelService);
	}));
	localDisposableStore.add(quickPick.onDidAccept(() => {
		const selectedItem = quickPick.selectedItems[0];
		selectedItem.accept();
		quickPick.hide();
		localDisposableStore.dispose();
	}));
	quickPick.show();
}

async function _getPicksFromSession(session: IDebugSession, filter: string, editorService: IEditorService, modelService: IModelService, languageService: ILanguageService, labelService: ILabelService): Promise<Array<IPickerDebugItem | IQuickPickSeparator>> {
	const items: Array<IPickerDebugItem | IQuickPickSeparator> = [];
	items.push({ type: 'separator', label: session.name });
	const sources = await session.getLoadedSources();

	sources.forEach((element: Source) => {
		const pick = _createPick(element, filter, editorService, modelService, languageService, labelService);
		if (pick) {
			items.push(pick);
		}

	});
	return items;
}
async function _getPicks(filter: string, sessions: IDebugSession[], editorService: IEditorService, modelService: IModelService, languageService: ILanguageService, labelService: ILabelService): Promise<Array<IPickerDebugItem | IQuickPickSeparator>> {
	const loadedScriptPicks: Array<IPickerDebugItem | IQuickPickSeparator> = [];


	const picks = await Promise.all(
		sessions.map((session) => _getPicksFromSession(session, filter, editorService, modelService, languageService, labelService))
	);

	for (const row of picks) {
		for (const elem of row) {
			loadedScriptPicks.push(elem);
		}
	}
	return loadedScriptPicks;
}

function _createPick(source: Source, filter: string, editorService: IEditorService, modelService: IModelService, languageService: ILanguageService, labelService: ILabelService): IPickerDebugItem | undefined {

	const label = labelService.getUriBasenameLabel(source.uri);
	const desc = labelService.getUriLabel(dirname(source.uri));

	// manually filter so that headers don't get filtered out
	const labelHighlights = matchesFuzzy(filter, label, true);
	const descHighlights = matchesFuzzy(filter, desc, true);
	if (labelHighlights || descHighlights) {
		return {
			label,
			description: desc === '.' ? undefined : desc,
			highlights: { label: labelHighlights ?? undefined, description: descHighlights ?? undefined },
			iconClasses: getIconClasses(modelService, languageService, source.uri),
			accept: () => {
				if (source.available) {
					source.openInEditor(editorService, { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 });
				}
			}
		};
	}
	return undefined;
}
