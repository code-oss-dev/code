/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { stringify, parse } from 'vs/base/common/marshalling';
import { FileDeleteOptions, FileOverwriteOptions, FileSystemProviderCapabilities, FileType, FileWriteOptions, hasReadWriteCapability, IFileService, IFileSystemProvider, IFileSystemProviderWithFileReadWriteCapability, IStat, IWatchOptions } from 'vs/platform/files/common/files';
import { ResourceLabelFormatter, ResourceLabelFormatting } from 'vs/platform/label/common/label';
import { sep } from 'vs/base/common/path';
import { basename, isEqual } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';

export interface ILocalHistoryResource {

	/**
	 * The label to use for the local history entry.
	 */
	label: string;

	/**
	 * The location of the local history entry to read from.
	 */
	location: URI;

	/**
	 * The associated resource the local history entry is about.
	 */
	associatedResource: URI;
}

/**
 * A wrapper around a standard file system provider
 * that is entirely readonly.
 */
export class LocalHistoryFileSystemProvider implements IFileSystemProvider, IFileSystemProviderWithFileReadWriteCapability {

	static readonly SCHEMA = 'vscode-local-history';

	static toLocalHistoryFileSystem(resource: ILocalHistoryResource): URI {
		return URI.from({
			scheme: LocalHistoryFileSystemProvider.SCHEMA,
			path: `/${basename(resource.location)}`,
			query: stringify(resource)
		});
	}

	static fromLocalHistoryFileSystem(resource: URI): ILocalHistoryResource {
		return parse(resource.query);
	}

	private static readonly EMPTY_RESOURCE = URI.from({ scheme: LocalHistoryFileSystemProvider.SCHEMA, path: '/empty' });

	static readonly EMPTY: ILocalHistoryResource = {
		location: LocalHistoryFileSystemProvider.EMPTY_RESOURCE,
		associatedResource: LocalHistoryFileSystemProvider.EMPTY_RESOURCE,
		label: ''
	};

	get capabilities() {
		return FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.Readonly;
	}

	constructor(private readonly fileService: IFileService) { }

	private readonly mapSchemeToProvider = new Map<string, Promise<IFileSystemProvider>>();

	private async withProvider(resource: URI): Promise<IFileSystemProvider> {
		const scheme = resource.scheme;

		let providerPromise = this.mapSchemeToProvider.get(scheme);
		if (!providerPromise) {

			// Resolve early when provider already exists
			const provider = this.fileService.getProvider(scheme);
			if (provider) {
				providerPromise = Promise.resolve(provider);
			}

			// Otherwise wait for registration
			else {
				providerPromise = new Promise<IFileSystemProvider>(resolve => {
					const disposable = this.fileService.onDidChangeFileSystemProviderRegistrations(e => {
						if (e.added && e.provider && e.scheme === scheme) {
							disposable.dispose();

							resolve(e.provider);
						}
					});
				});
			}

			this.mapSchemeToProvider.set(scheme, providerPromise);
		}

		return providerPromise;
	}

	//#region Supported File Operations

	async stat(resource: URI): Promise<IStat> {
		const location = LocalHistoryFileSystemProvider.fromLocalHistoryFileSystem(resource).location;

		// Special case: empty resource
		if (isEqual(LocalHistoryFileSystemProvider.EMPTY_RESOURCE, location)) {
			return { type: FileType.File, ctime: 0, mtime: 0, size: 0 };
		}

		// Otherwise delegate to provider
		return (await this.withProvider(location)).stat(location);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const location = LocalHistoryFileSystemProvider.fromLocalHistoryFileSystem(resource).location;

		// Special case: empty resource
		if (isEqual(LocalHistoryFileSystemProvider.EMPTY_RESOURCE, location)) {
			return VSBuffer.fromString('').buffer;
		}

		// Otherwise delegate to provider
		const provider = await this.withProvider(location);
		if (hasReadWriteCapability(provider)) {
			return provider.readFile(location);
		}

		throw new Error('Unsupported');
	}

	//#endregion

	//#region Unsupported File Operations

	readonly onDidChangeCapabilities = Event.None;
	readonly onDidChangeFile = Event.None;

	async writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> { }

	async mkdir(resource: URI): Promise<void> { }
	async readdir(resource: URI): Promise<[string, FileType][]> { return []; }

	async rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> { }
	async delete(resource: URI, opts: FileDeleteOptions): Promise<void> { }

	watch(resource: URI, opts: IWatchOptions): IDisposable { return Disposable.None; }

	//#endregion
}

export class LocalHistoryFileLabelFormatter implements ResourceLabelFormatter {

	readonly scheme: string = LocalHistoryFileSystemProvider.SCHEMA;

	readonly formatting: ResourceLabelFormatting = {
		label: '${query.label}',
		separator: sep,
		tildify: false,
		normalizeDriveLetter: false,
		authorityPrefix: sep + sep,
		workspaceSuffix: ''
	};
}
