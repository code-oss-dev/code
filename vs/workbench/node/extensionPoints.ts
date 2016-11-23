/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as nls from 'vs/nls';
import * as Platform from 'vs/base/common/platform';
import pfs = require('vs/base/node/pfs');
import { IExtensionDescription, IMessage } from 'vs/platform/extensions/common/extensions';
import Severity from 'vs/base/common/severity';
import { TPromise } from 'vs/base/common/winjs.base';
import { groupBy, values } from 'vs/base/common/collections';
import paths = require('vs/base/common/paths');
import json = require('vs/base/common/json');
import Types = require('vs/base/common/types');
import { isValidExtensionDescription } from 'vs/platform/extensions/node/extensionValidator';
import * as semver from 'semver';

const MANIFEST_FILE = 'package.json';

const devMode = !!process.env['VSCODE_DEV'];
interface NlsConfiguration {
	locale: string;
	pseudo: boolean;
}
const nlsConfig: NlsConfiguration = {
	locale: Platform.locale,
	pseudo: Platform.locale === 'pseudo'
};

export class MessagesCollector {

	private _messages: IMessage[];

	constructor() {
		this._messages = [];
	}

	public getMessages(): IMessage[] {
		return this._messages;
	}

	private _msg(source: string, type: Severity, message: string): void {
		this._messages.push({
			type: type,
			message: message,
			source: source
		});
	}

	public error(source: string, message: string): void {
		this._msg(source, Severity.Error, message);
	}

	public warn(source: string, message: string): void {
		this._msg(source, Severity.Warning, message);
	}

	public info(source: string, message: string): void {
		this._msg(source, Severity.Info, message);
	}
}

abstract class ExtensionManifestHandler {

	protected _ourVersion: string;
	protected _collector: MessagesCollector;
	protected _absoluteFolderPath: string;
	protected _isBuiltin: boolean;
	protected _absoluteManifestPath: string;

	constructor(ourVersion: string, collector: MessagesCollector, absoluteFolderPath: string, isBuiltin: boolean) {
		this._ourVersion = ourVersion;
		this._collector = collector;
		this._absoluteFolderPath = absoluteFolderPath;
		this._isBuiltin = isBuiltin;
		this._absoluteManifestPath = paths.join(absoluteFolderPath, MANIFEST_FILE);
	}
}

class ExtensionManifestParser extends ExtensionManifestHandler {

	public parse(): TPromise<IExtensionDescription> {
		return pfs.readFile(this._absoluteManifestPath).then((manifestContents) => {
			let errors: json.ParseError[] = [];
			const extensionDescription = json.parse(manifestContents.toString(), errors);
			if (errors.length > 0) {
				errors.forEach((error) => {
					this._collector.error(this._absoluteFolderPath, nls.localize('jsonParseFail', "Failed to parse {0}: {1}.", this._absoluteManifestPath, json.getParseErrorMessage(error.error)));
				});
				return null;
			}
			return extensionDescription;
		}, (err) => {
			if (err.code === 'ENOENT') {
				return null;
			}

			this._collector.error(this._absoluteFolderPath, nls.localize('fileReadFail', "Cannot read file {0}: {1}.", this._absoluteManifestPath, err.message));
			return null;
		});
	}
}

class ExtensionManifestNLSReplacer extends ExtensionManifestHandler {

	public replaceNLS(extensionDescription: IExtensionDescription): TPromise<IExtensionDescription> {
		let extension = paths.extname(this._absoluteManifestPath);
		let basename = this._absoluteManifestPath.substr(0, this._absoluteManifestPath.length - extension.length);

		return pfs.fileExists(basename + '.nls' + extension).then(exists => {
			if (!exists) {
				return extensionDescription;
			}
			return ExtensionManifestNLSReplacer.findMessageBundle(basename).then(messageBundle => {
				if (!messageBundle) {
					return extensionDescription;
				}
				return pfs.readFile(messageBundle).then(messageBundleContent => {
					let errors: json.ParseError[] = [];
					let messages: { [key: string]: string; } = json.parse(messageBundleContent.toString(), errors);
					if (errors.length > 0) {
						errors.forEach((error) => {
							this._collector.error(this._absoluteFolderPath, nls.localize('jsonParseFail', "Failed to parse {0}: {1}.", messageBundle, json.getParseErrorMessage(error.error)));
						});
						return extensionDescription;
					}
					ExtensionManifestNLSReplacer._replaceNLStrings(extensionDescription, messages, this._collector, this._absoluteFolderPath);
					return extensionDescription;
				}, (err) => {
					this._collector.error(this._absoluteFolderPath, nls.localize('fileReadFail', "Cannot read file {0}: {1}.", messageBundle, err.message));
					return null;
				});
			});
		});
	}

	private static findMessageBundle(basename: string): TPromise<string> {
		return new TPromise<string>((c, e, p) => {
			function loop(basename: string, locale: string): void {
				let toCheck = `${basename}.nls.${locale}.json`;
				pfs.fileExists(toCheck).then(exists => {
					if (exists) {
						c(toCheck);
					}
					let index = locale.lastIndexOf('-');
					if (index === -1) {
						c(`${basename}.nls.json`);
					} else {
						locale = locale.substring(0, index);
						loop(basename, locale);
					}
				});
			}

			if (devMode || nlsConfig.pseudo || !nlsConfig.locale) {
				return c(basename + '.nls.json');
			}
			loop(basename, nlsConfig.locale);
		});
	}

	/**
	 * This routine make the following assumptions:
	 * The root element is a object literal
	 * Strings to replace are one values of a key. So for example string[] are ignored.
	 * This is done to speed things up.
	 */
	private static _replaceNLStrings<T>(literal: T, messages: { [key: string]: string; }, collector: MessagesCollector, messageScope: string): void {
		Object.keys(literal).forEach(key => {
			if (literal.hasOwnProperty(key)) {
				let value = literal[key];
				if (Types.isString(value)) {
					let str = <string>value;
					let length = str.length;
					if (length > 1 && str[0] === '%' && str[length - 1] === '%') {
						let messageKey = str.substr(1, length - 2);
						let message = messages[messageKey];
						if (message) {
							if (nlsConfig.pseudo) {
								// FF3B and FF3D is the Unicode zenkaku representation for [ and ]
								message = '\uFF3B' + message.replace(/[aouei]/g, '$&$&') + '\uFF3D';
							}
							literal[key] = message;
						} else {
							collector.warn(messageScope, nls.localize('missingNLSKey', "Couldn't find message for key {0}.", messageKey));
						}
					}
				} else if (Types.isObject(value)) {
					ExtensionManifestNLSReplacer._replaceNLStrings(value, messages, collector, messageScope);
				} else if (Types.isArray(value)) {
					(<any[]>value).forEach(element => {
						if (Types.isObject(element)) {
							ExtensionManifestNLSReplacer._replaceNLStrings(element, messages, collector, messageScope);
						}
					});
				}
			}
		});
	}
}

class ExtensionManifestValidator extends ExtensionManifestHandler {
	validate(_extensionDescription: IExtensionDescription): IExtensionDescription {
		// Relax the readonly properties here, it is the one place where we check and normalize values
		interface IRelaxedExtensionDescription {
			id: string;
			name: string;
			version: string;
			publisher: string;
			isBuiltin: boolean;
			extensionFolderPath: string;
			engines: {
				vscode: string;
			};
			main?: string;
			enableProposedApi?: boolean;
		}
		let extensionDescription = <IRelaxedExtensionDescription>_extensionDescription;
		extensionDescription.isBuiltin = this._isBuiltin;

		let notices: string[] = [];
		if (!isValidExtensionDescription(this._ourVersion, this._absoluteFolderPath, extensionDescription, notices)) {
			notices.forEach((error) => {
				this._collector.error(this._absoluteFolderPath, error);
			});
			return null;
		}

		// in this case the notices are warnings
		notices.forEach((error) => {
			this._collector.warn(this._absoluteFolderPath, error);
		});

		// id := `publisher.name`
		extensionDescription.id = `${extensionDescription.publisher}.${extensionDescription.name}`;

		// main := absolutePath(`main`)
		if (extensionDescription.main) {
			extensionDescription.main = paths.normalize(paths.join(this._absoluteFolderPath, extensionDescription.main));
		}

		extensionDescription.extensionFolderPath = this._absoluteFolderPath;

		return extensionDescription;
	}
}

export class ExtensionScanner {

	/**
	 * Read the extension defined in `absoluteFolderPath`
	 */
	public static scanExtension(
		version: string,
		collector: MessagesCollector,
		absoluteFolderPath: string,
		isBuiltin: boolean
	): TPromise<IExtensionDescription> {
		absoluteFolderPath = paths.normalize(absoluteFolderPath);

		let parser = new ExtensionManifestParser(version, collector, absoluteFolderPath, isBuiltin);
		return parser.parse().then((extensionDescription) => {
			if (extensionDescription === null) {
				return null;
			}

			let nlsReplacer = new ExtensionManifestNLSReplacer(version, collector, absoluteFolderPath, isBuiltin);
			return nlsReplacer.replaceNLS(extensionDescription);
		}).then((extensionDescription) => {
			if (extensionDescription === null) {
				return null;
			}

			let validator = new ExtensionManifestValidator(version, collector, absoluteFolderPath, isBuiltin);
			return validator.validate(extensionDescription);
		});
	}

	/**
	 * Scan a list of extensions defined in `absoluteFolderPath`
	 */
	public static scanExtensions(
		version: string,
		collector: MessagesCollector,
		absoluteFolderPath: string,
		isBuiltin: boolean
	): TPromise<IExtensionDescription[]> {
		let obsolete = TPromise.as({});

		if (!isBuiltin) {
			obsolete = pfs.readFile(paths.join(absoluteFolderPath, '.obsolete'), 'utf8')
				.then(raw => JSON.parse(raw))
				.then(null, err => ({}));
		}

		return obsolete.then(obsolete => {
			return pfs.readDirsInDir(absoluteFolderPath)
				.then(folders => {
					if (isBuiltin) {
						return folders;
					}

					// TODO: align with extensionsService
					const nonGallery: string[] = [];
					const gallery: { folder: string; id: string; version: string; }[] = [];

					folders.forEach(folder => {
						if (obsolete[folder]) {
							return;
						}

						const match = /^([^.]+\..+)-(\d+\.\d+\.\d+)$/.exec(folder);

						if (!match) {
							nonGallery.push(folder);
							return;
						}

						const id = match[1];
						const version = match[2];
						gallery.push({ folder, id, version });
					});

					const byId = values(groupBy(gallery, p => p.id));
					const latest = byId.map(p => p.sort((a, b) => semver.rcompare(a.version, b.version))[0])
						.map(a => a.folder);

					return [...nonGallery, ...latest];
				})
				.then(folders => TPromise.join(folders.map(f => this.scanExtension(version, collector, paths.join(absoluteFolderPath, f), isBuiltin))))
				.then(extensionDescriptions => extensionDescriptions.filter(item => item !== null))
				.then(null, err => {
					collector.error(absoluteFolderPath, err);
					return [];
				});
		});
	}

	/**
	 * Combination of scanExtension and scanExtensions: If an extension manifest is found at root, we load just this extension,
	 * otherwise we assume the folder contains multiple extensions.
	 */
	public static scanOneOrMultipleExtensions(
		version: string,
		collector: MessagesCollector,
		absoluteFolderPath: string,
		isBuiltin: boolean
	): TPromise<IExtensionDescription[]> {
		return pfs.fileExists(paths.join(absoluteFolderPath, MANIFEST_FILE)).then((exists) => {
			if (exists) {
				return this.scanExtension(version, collector, absoluteFolderPath, isBuiltin).then((extensionDescription) => {
					if (extensionDescription === null) {
						return [];
					}
					return [extensionDescription];
				});
			}
			return this.scanExtensions(version, collector, absoluteFolderPath, isBuiltin);
		}, (err) => {
			collector.error(absoluteFolderPath, err);
			return [];
		});
	}
}