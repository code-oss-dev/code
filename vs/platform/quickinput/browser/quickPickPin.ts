/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { localize } from 'vs/nls';
import { IQuickPick, IQuickPickItem, QuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';

const pinButtonClass = ThemeIcon.asClassName(Codicon.pin);
const pinnedButtonClass = ThemeIcon.asClassName(Codicon.pinned);
const buttonClasses = [pinButtonClass, pinnedButtonClass];
/**
 * Initially, adds pin buttons to all @param quickPick items.
 * When pinned, a copy of the item will be moved to the end of the pinned list and any duplicate within the pinned list will
 * be removed if @param filterDupliates has been provided. Pin and pinned button events trigger updates to the underlying storage.
 * Shows the quickpick once formatted.
 */
export async function showWithPinnedItems(storageService: IStorageService, storageKey: string, quickPick: IQuickPick<IQuickPickItem>, filterDuplicates?: boolean): Promise<void> {
	quickPick.onDidTriggerItemButton(async buttonEvent => {
		const expectedButton = buttonEvent.button.iconClass && buttonClasses.includes(buttonEvent.button.iconClass);
		if (expectedButton) {
			quickPick.items = await _formatPinnedItems(storageKey, quickPick, storageService, buttonEvent.item, filterDuplicates);
		}
	});
	quickPick.onDidChangeValue(async value => {
		// don't show pinned items in the search results
		quickPick.items = value ? quickPick.items.filter(i => i.type !== 'separator' && !i.buttons?.find(b => b.iconClass === pinnedButtonClass)) : quickPick.items;
	});
	quickPick.items = await _formatPinnedItems(storageKey, quickPick, storageService, undefined, filterDuplicates);
	await quickPick.show();
}

function _formatPinnedItems(storageKey: string, quickPick: IQuickPick<IQuickPickItem>, storageService: IStorageService, changedItem?: IQuickPickItem, filterDuplicates?: boolean): QuickPickItem[] {
	const formattedItems: QuickPickItem[] = [];
	let pinnedItems;
	if (changedItem) {
		pinnedItems = updatePinnedItems(storageKey, changedItem, storageService);
	} else {
		pinnedItems = getPinnedItems(storageKey, storageService);
	}
	if (pinnedItems.length) {
		formattedItems.push({ type: 'separator', label: localize("terminal.commands.pinned", 'Pinned') });
	}
	const pinnedIds = new Set();
	for (const itemToFind of pinnedItems) {
		const itemToPin = quickPick.items.find(item => itemsMatch(item, itemToFind));
		if (itemToPin) {
			const pinnedItemId = getItemIdentifier(itemToPin);
			const pinnedItem: IQuickPickItem = Object.assign({} as IQuickPickItem, itemToPin);
			if (!filterDuplicates || !pinnedIds.has(pinnedItemId)) {
				pinnedIds.add(pinnedItemId);
				updateButtons(pinnedItem, false);
				formattedItems.push(pinnedItem);
			}
		}
	}

	for (const item of quickPick.items) {
		updateButtons(item, true);
		formattedItems.push(item);
	}
	return formattedItems;
}

function getItemIdentifier(item: QuickPickItem): string {
	return item.type === 'separator' ? '' : item.id || `${item.label}${item.description}${item.detail}}`;
}

function updateButtons(item: QuickPickItem, removePin: boolean): void {
	if (item.type === 'separator') {
		return;
	}
	// remove button classes before adding the new one
	item.buttons = item.buttons ? item.buttons?.filter(button => button.iconClass && !buttonClasses.includes(button.iconClass)) : [];
	item.buttons.unshift({
		iconClass: removePin ? pinButtonClass : pinnedButtonClass,
		tooltip: removePin ? localize('pinCommand', "Pin command") : localize('pinnedCommand', "Pinned command"),
		alwaysVisible: false
	});
}

function itemsMatch(itemA: QuickPickItem, itemB: QuickPickItem): boolean {
	return getItemIdentifier(itemA) === getItemIdentifier(itemB);
}

function updatePinnedItems(storageKey: string, changedItem: IQuickPickItem, storageService: IStorageService): IQuickPickItem[] {
	const removePin = changedItem.buttons?.find(b => b.iconClass === pinnedButtonClass);
	let items = getPinnedItems(storageKey, storageService);
	if (removePin) {
		items = items.filter(item => getItemIdentifier(item) !== getItemIdentifier(changedItem));
	} else {
		items.push(changedItem);
	}
	storageService.store(storageKey, JSON.stringify(items), StorageScope.WORKSPACE, StorageTarget.USER);
	return items;
}

function getPinnedItems(storageKey: string, storageService: IStorageService): IQuickPickItem[] {
	const items = storageService.get(storageKey, StorageScope.WORKSPACE);
	return items ? JSON.parse(items) : [];
}
