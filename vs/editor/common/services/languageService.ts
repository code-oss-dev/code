/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ILanguageIdCodec } from 'vs/editor/common/modes';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const ILanguageService = createDecorator<ILanguageService>('languageService');

export interface ILanguageExtensionPoint {
	id: string;
	extensions?: string[];
	filenames?: string[];
	filenamePatterns?: string[];
	firstLine?: string;
	aliases?: string[];
	mimetypes?: string[];
	configuration?: URI;
}

export interface ILanguageSelection {
	readonly languageId: string;
	readonly onDidChange: Event<string>;
}

export interface ILanguageNameIdPair {
	languageName: string;
	languageId: string;
}

export interface ILanguageService {
	readonly _serviceBrand: undefined;

	readonly languageIdCodec: ILanguageIdCodec;

	onDidEncounterLanguage: Event<string>;
	onLanguagesMaybeChanged: Event<void>;

	isRegisteredLanguageId(languageId: string): boolean;
	validateLanguageId(languageId: string): string | null;

	/**
	 * Get a list of all registered languages.
	 */
	getRegisteredLanguageIds(): string[];

	/**
	 * Get a list of all registered languages with a name.
	 * If a language is explicitly registered without a name, it will not be part of the result.
	 * The result is sorted using by name case insensitive.
	 */
	getSortedRegisteredLanguageNames(): ILanguageNameIdPair[];

	/**
	 * Get the preferred language name for a language.
	 */
	getLanguageName(languageId: string): string | null;

	/**
	 * Get the mimetype for a language.
	 */
	getMimeType(languageId: string): string | null;

	/**
	 * Get all file extensions for a language.
	 */
	getExtensions(languageId: string): ReadonlyArray<string>;

	/**
	 * Get all file names for a language.
	 */
	getFilenames(languageId: string): ReadonlyArray<string>;

	/**
	 * Get all language configuration files for a language.
	 */
	getConfigurationFiles(languageId: string): ReadonlyArray<URI>;

	/**
	 * Look up a language by its name case insensitive.
	 */
	getLanguageIdByLanguageName(languageName: string): string | null;

	/**
	 * Look up a language by its mime type.
	 */
	getLanguageIdByMimeType(mimeType: string | null | undefined): string | null;

	/**
	 * Guess the language id for a resource.
	 */
	guessLanguageIdByFilepathOrFirstLine(resource: URI, firstLine?: string): string | null;

	/**
	 * Will fall back to 'plaintext' if `languageId` is unknown.
	 */
	createById(languageId: string | null | undefined): ILanguageSelection;

	/**
	 * Will fall back to 'plaintext' if `mimeType` is unknown.
	 */
	createByMimeType(mimeType: string | null | undefined): ILanguageSelection;

	/**
	 * Will fall back to 'plaintext' if the `languageId` cannot be determined.
	 */
	createByFilepathOrFirstLine(resource: URI | null, firstLine?: string): ILanguageSelection;
}
