/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Event } from 'vs/base/common/event';
import { TPromise } from 'vs/base/common/winjs.base';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IMode, LanguageId, LanguageIdentifier } from 'vs/editor/common/modes';
import { URI } from 'vs/base/common/uri';

export const ITokenizationService = createDecorator<ITokenizationService>('tokenizationService');

export interface ITokenizationService {
	_serviceBrand: any;

	onDidCreateMode: Event<IMode>;

	// --- reading
	isRegisteredMode(mimetypeOrModeId: string): boolean;
	getRegisteredModes(): string[];
	getRegisteredLanguageNames(): string[];
	getExtensions(alias: string): string[];
	getFilenames(alias: string): string[];
	getMimeForMode(modeId: string): string;
	getLanguageName(modeId: string): string;
	getModeIdForLanguageName(alias: string): string;
	getModeIdByFilenameOrFirstLine(filename: string, firstLine?: string): string;
	getModeId(commaSeparatedMimetypesOrCommaSeparatedIds: string): string;
	getLanguageIdentifier(modeId: string | LanguageId): LanguageIdentifier;
	getConfigurationFiles(modeId: string): URI[];

	// --- instantiation
	getMode(commaSeparatedMimetypesOrCommaSeparatedIds: string): IMode;
	getOrCreateMode(commaSeparatedMimetypesOrCommaSeparatedIds: string): TPromise<IMode>;
	getOrCreateModeByLanguageName(languageName: string): TPromise<IMode>;
	getOrCreateModeByFilenameOrFirstLine(filename: string, firstLine?: string): TPromise<IMode>;
}
