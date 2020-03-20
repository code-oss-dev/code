/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/editorquickaccess';
import { localize } from 'vs/nls';
import { IQuickPickSeparator, quickPickItemScorerAccessor, IQuickPickItemWithResource, IQuickPick } from 'vs/platform/quickinput/common/quickInput';
import { PickerQuickAccessProvider, IPickerQuickAccessItem, TriggerAction } from 'vs/platform/quickinput/browser/pickerQuickAccess';
import { IEditorGroupsService, GroupsOrder } from 'vs/workbench/services/editor/common/editorGroupsService';
import { EditorsOrder, IEditorIdentifier, toResource, SideBySideEditor } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { prepareQuery, scoreItem, compareItemsByScore, ScorerCache } from 'vs/base/common/fuzzyScorer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IDisposable } from 'vs/base/common/lifecycle';

interface IEditorQuickPickItem extends IQuickPickItemWithResource, IEditorIdentifier, IPickerQuickAccessItem { }

export abstract class BaseEditorQuickAccessProvider extends PickerQuickAccessProvider<IEditorQuickPickItem> {

	private readonly pickState = new class {

		scorerCache: ScorerCache = Object.create(null);
		isQuickNavigating: boolean | undefined = undefined;

		reset(isQuickNavigating: boolean): void {

			// Caches
			if (!isQuickNavigating) {
				this.scorerCache = Object.create(null);
			}

			// Other
			this.isQuickNavigating = isQuickNavigating;
		}
	};

	constructor(
		prefix: string,
		@IEditorGroupsService protected readonly editorGroupService: IEditorGroupsService,
		@IEditorService protected readonly editorService: IEditorService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService
	) {
		super(prefix, { canAcceptInBackground: true });
	}

	provide(picker: IQuickPick<IEditorQuickPickItem>, token: CancellationToken): IDisposable {

		// Reset the pick state for this run
		this.pickState.reset(!!picker.quickNavigate);

		// Start picker
		return super.provide(picker, token);
	}

	protected getPicks(filter: string): Array<IEditorQuickPickItem | IQuickPickSeparator> {
		const query = prepareQuery(filter);

		// Filtering
		const filteredEditorEntries = this.doGetEditorPickItems().filter(entry => {
			if (!query.value) {
				return true;
			}

			// Score on label and description
			const itemScore = scoreItem(entry, query, true, quickPickItemScorerAccessor, this.pickState.scorerCache);
			if (!itemScore.score) {
				return false;
			}

			// Apply highlights
			entry.highlights = { label: itemScore.labelMatch, description: itemScore.descriptionMatch };

			return true;
		});

		// Sorting
		if (query.value) {
			const groups = this.editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => group.id);
			filteredEditorEntries.sort((entryA, entryB) => {
				if (entryA.groupId !== entryB.groupId) {
					return groups.indexOf(entryA.groupId) - groups.indexOf(entryB.groupId); // older groups first
				}

				return compareItemsByScore(entryA, entryB, query, true, quickPickItemScorerAccessor, this.pickState.scorerCache);
			});
		}

		// Grouping (for more than one group)
		const filteredEditorEntriesWithSeparators: Array<IEditorQuickPickItem | IQuickPickSeparator> = [];
		if (this.editorGroupService.count > 1) {
			let lastGroupId: number | undefined = undefined;
			for (const entry of filteredEditorEntries) {
				if (typeof lastGroupId !== 'number' || lastGroupId !== entry.groupId) {
					const group = this.editorGroupService.getGroup(entry.groupId);
					if (group) {
						filteredEditorEntriesWithSeparators.push({ type: 'separator', label: group.label });
					}
					lastGroupId = entry.groupId;
				}

				filteredEditorEntriesWithSeparators.push(entry);
			}
		} else {
			filteredEditorEntriesWithSeparators.push(...filteredEditorEntries);
		}

		return filteredEditorEntriesWithSeparators;
	}

	private doGetEditorPickItems(): Array<IEditorQuickPickItem> {
		return this.doGetEditors().map(({ editor, groupId }): IEditorQuickPickItem => {
			const resource = toResource(editor, { supportSideBySide: SideBySideEditor.MASTER });
			const isDirty = editor.isDirty() && !editor.isSaving();

			return {
				editor,
				groupId,
				resource,
				label: editor.getName(),
				ariaLabel: localize('entryAriaLabel', "{0}, editors picker", editor.getName()),
				description: editor.getDescription(),
				iconClasses: getIconClasses(this.modelService, this.modeService, resource),
				italic: !this.editorGroupService.getGroup(groupId)?.isPinned(editor),
				buttons: (() => {
					if (this.pickState.isQuickNavigating) {
						return undefined; // no actions when quick navigating
					}

					return [
						{
							iconClass: isDirty ? 'dirty-editor codicon-circle-filled' : 'codicon-close',
							tooltip: localize('closeEditor', "Close Editor"),
							alwaysVisible: isDirty
						}
					];
				})(),
				trigger: async () => {
					await this.editorGroupService.getGroup(groupId)?.closeEditor(editor, { preserveFocus: true });

					return TriggerAction.REFRESH_PICKER;
				},
				accept: (keyMods, event) => this.editorGroupService.getGroup(groupId)?.openEditor(editor, { preserveFocus: event.inBackground }),
			};
		});
	}

	protected abstract doGetEditors(): IEditorIdentifier[];
}

//#region Active Editor Group Editors by Most Recently Used

export class ActiveGroupEditorsByMostRecentlyUsedQuickAccess extends BaseEditorQuickAccessProvider {

	static PREFIX = 'edt active ';

	constructor(
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService
	) {
		super(ActiveGroupEditorsByMostRecentlyUsedQuickAccess.PREFIX, editorGroupService, editorService, modelService, modeService);
	}

	protected doGetEditors(): IEditorIdentifier[] {
		const group = this.editorGroupService.activeGroup;

		return group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).map(editor => ({ editor, groupId: group.id }));
	}
}

//#endregion


//#region All Editors by Appearance

export class AllEditorsByAppearanceQuickAccess extends BaseEditorQuickAccessProvider {

	static PREFIX = 'edt ';

	constructor(
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService
	) {
		super(AllEditorsByAppearanceQuickAccess.PREFIX, editorGroupService, editorService, modelService, modeService);
	}

	protected doGetEditors(): IEditorIdentifier[] {
		const entries: IEditorIdentifier[] = [];

		for (const group of this.editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE)) {
			for (const editor of group.getEditors(EditorsOrder.SEQUENTIAL)) {
				entries.push({ editor, groupId: group.id });
			}
		}

		return entries;
	}
}

//#endregion


//#region All Editors by Most Recently Used

export class AllEditorsByMostRecentlyUsedQuickAccess extends BaseEditorQuickAccessProvider {

	static PREFIX = 'edt mru ';

	constructor(
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService
	) {
		super(AllEditorsByMostRecentlyUsedQuickAccess.PREFIX, editorGroupService, editorService, modelService, modeService);
	}

	protected doGetEditors(): IEditorIdentifier[] {
		const entries: IEditorIdentifier[] = [];

		for (const editor of this.editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			entries.push(editor);
		}

		return entries;
	}
}

//#endregion
