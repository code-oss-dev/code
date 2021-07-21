/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataTransfers } from 'vs/base/browser/dnd';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';

export function parseTerminalUri(resource: URI): ITerminalIdentifier {
	const [, workspaceId, instanceId] = resource.path.split('/');
	if (!workspaceId || !Number.parseInt(instanceId)) {
		throw new Error(`Could not parse terminal uri for resource ${resource}`);
	}
	return { workspaceId, instanceId: Number.parseInt(instanceId) };
}

export function getTerminalUri(workspaceId: string, instanceId: number, title?: string): URI {
	return URI.from({
		scheme: Schemas.vscodeTerminal,
		path: `/${workspaceId}/${instanceId}`,
		fragment: title || undefined,
	});
}

export interface ITerminalIdentifier {
	workspaceId: string;
	instanceId: number | undefined;
}

export interface IPartialDragEvent {
	dataTransfer: Pick<DataTransfer, 'getData'> | null;
}

export function getTerminalResourcesFromDragEvent(event: IPartialDragEvent): URI[] | undefined {
	const resources = event.dataTransfer?.getData(DataTransfers.TERMINALS);
	if (resources) {
		const json = JSON.parse(resources);
		const result = [];
		for (const entry of json) {
			result.push(URI.parse(entry));
		}
		return result.length === 0 ? undefined : result;
	}
	return undefined;
}
