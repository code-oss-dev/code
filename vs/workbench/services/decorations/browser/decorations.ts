/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import URI from 'vs/base/common/uri';
import Event from 'vs/base/common/event';
import Severity from 'vs/base/common/severity';
import { ColorIdentifier } from 'vs/platform/theme/common/colorRegistry';
import { IDisposable } from 'vs/base/common/lifecycle';

export const IResourceDecorationsService = createDecorator<IResourceDecorationsService>('IFileDecorationsService');

export interface IResourceDecoration {
	readonly severity: Severity;
	readonly tooltip?: string;
	readonly prefix?: string;
	readonly suffix?: string;
	readonly color?: ColorIdentifier;
	readonly icon?: { light: URI, dark: URI };
	readonly leafOnly?: boolean;
}

export interface IDecorationsProvider {
	readonly label: string;
	readonly onDidChange: Event<URI[]>;
	provideDecorations(uri: URI): IResourceDecoration | Thenable<IResourceDecoration>;
}

export interface IResourceDecorationChangeEvent {
	affectsResource(uri: URI): boolean;
}

export interface IResourceDecorationsService {

	readonly _serviceBrand: any;

	readonly onDidChangeDecorations: Event<IResourceDecorationChangeEvent>;

	registerDecortionsProvider(provider: IDecorationsProvider): IDisposable;

	getTopDecoration(uri: URI, includeChildren: boolean): IResourceDecoration;
}
