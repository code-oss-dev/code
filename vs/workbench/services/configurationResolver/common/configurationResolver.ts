/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise } from 'vs/base/common/winjs.base';
import { IStringDictionary } from 'vs/base/common/collections';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

export const IConfigurationResolverService = createDecorator<IConfigurationResolverService>('configurationResolverService');

export interface IConfigurationResolverService {
	_serviceBrand: any;

	// TODO@Isidor improve this API
	resolve(root: IWorkspaceFolder, value: string): string;
	resolve(root: IWorkspaceFolder, value: string[]): string[];
	resolve(root: IWorkspaceFolder, value: IStringDictionary<string>): IStringDictionary<string>;
	resolveAny<T>(root: IWorkspaceFolder, value: T): T;
	resolveInteractiveVariables(configuration: any, interactiveVariablesMap: { [key: string]: string }): TPromise<any>;
}
