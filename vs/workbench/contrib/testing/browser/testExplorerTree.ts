/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestRunState } from 'vs/workbench/api/common/extHostTypes';
import { ITestSubscriptionFolder, ITestSubscriptionItem } from 'vs/workbench/contrib/testing/browser/testingCollectionService';


export type TreeElement = ITestSubscriptionFolder | ITestSubscriptionItem;

export type TreeStateNode = { statusNode: true; state: TestRunState; priority: number };

export const isTestItem = (v: TreeElement | undefined): v is ITestSubscriptionItem => !!v && (v as any).depth > 0;

export const getLabel = (item: TreeElement) => isTestItem(item)
	? item.item.label
	: item.folder.name;

/**
 * List of display priorities for different run states. When tests update,
 * the highest-priority state from any of their children will be the state
 * reflected in the parent node.
 */
export const statePriority: { [K in TestRunState]: number } = {
	[TestRunState.Running]: 6,
	[TestRunState.Queued]: 5,
	[TestRunState.Errored]: 4,
	[TestRunState.Failed]: 3,
	[TestRunState.Passed]: 2,
	[TestRunState.Skipped]: 1,
	[TestRunState.Unset]: 0,
};

export const stateNodes = Object.entries(statePriority).reduce(
	(acc, [stateStr, priority]) => {
		const state = Number(stateStr) as TestRunState;
		acc[state] = { statusNode: true, state, priority };
		return acc;
	}, {} as { [K in TestRunState]: TreeStateNode }
);

export const maxPriority = (a: TestRunState, b: TestRunState) => statePriority[a] > statePriority[b] ? a : b;
