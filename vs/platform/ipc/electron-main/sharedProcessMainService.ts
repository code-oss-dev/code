/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const ISharedProcessMainService = createDecorator<ISharedProcessMainService>('sharedProcessMainService');

export interface ISharedProcessMainService {

	readonly _serviceBrand: undefined;

	whenReady(): Promise<void>;

	toggleWindow(): Promise<void>;
}

export interface ISharedProcess {
	whenReady(): Promise<void>;
	toggle(): void;
}

export class SharedProcessMainService implements ISharedProcessMainService {

	declare readonly _serviceBrand: undefined;

	constructor(private sharedProcess: ISharedProcess) { }

	whenReady(): Promise<void> {
		return this.sharedProcess.whenReady();
	}

	async toggleWindow(): Promise<void> {
		return this.sharedProcess.toggle();
	}
}
