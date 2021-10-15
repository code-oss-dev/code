/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { LanguageId, LanguageIdentifier } from 'vs/editor/common/modes';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';

export const IModeService = createDecorator<IModeService>('modeService');

export interface ILanguageExtensionPoint {
	id: string;
	extensions?: string[];
	filenames?: string[];
	filenamePatterns?: string[];
	firstLine?: string;
	aliases?: string[];
	mimetypes?: string[];
	configuration?: URI;
	/**
	 * @internal
	 */
	icon?: ThemeIcon;
}

export interface ILanguageSelection {
	readonly languageIdentifier: LanguageIdentifier;
	readonly onDidChange: Event<LanguageIdentifier>;
}

export interface IModeService {
	readonly _serviceBrand: undefined;

	onDidEncounterLanguage: Event<LanguageIdentifier>;
	onLanguagesMaybeChanged: Event<void>;

	// --- reading
	isRegisteredMode(mimetypeOrModeId: string): boolean;
	getRegisteredModes(): string[];
	getRegisteredLanguageNames(): string[];
	getExtensions(alias: string): string[];
	getFilenames(alias: string): string[];
	getMimeForMode(modeId: string): string | null;
	getIconForMode(modeId: string): ThemeIcon | null;
	getLanguageName(modeId: string): string | null;
	getModeIdForLanguageName(alias: string): string | null;
	getModeIdByFilepathOrFirstLine(resource: URI, firstLine?: string): string | null;
	getModeId(commaSeparatedMimetypesOrCommaSeparatedIds: string): string | null;
	getLanguageIdentifier(modeId: string | LanguageId): LanguageIdentifier | null;
	getConfigurationFiles(modeId: string): URI[];

	// --- instantiation
	create(commaSeparatedMimetypesOrCommaSeparatedIds: string | undefined): ILanguageSelection;
	createByLanguageName(languageName: string): ILanguageSelection;
	createByFilepathOrFirstLine(resource: URI | null, firstLine?: string): ILanguageSelection;

	triggerMode(commaSeparatedMimetypesOrCommaSeparatedIds: string): void;
}
