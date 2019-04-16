/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable, combinedDisposable, dispose } from 'vs/base/common/lifecycle';
import { IFileService, IResolveFileOptions, FileChangesEvent, FileOperationEvent, IFileSystemProviderRegistrationEvent, IFileSystemProvider, IFileStat, IResolveFileResult, ICreateFileOptions, IFileSystemProviderActivationEvent, FileOperationError, FileOperationResult, FileOperation, FileSystemProviderCapabilities, FileType, toFileSystemProviderErrorCode, FileSystemProviderErrorCode, IStat, IFileStatWithMetadata, IResolveMetadataFileOptions, etag, hasReadWriteCapability, hasFileFolderCopyCapability, hasOpenReadWriteCloseCapability, toFileOperationResult, IFileSystemProviderWithOpenReadWriteCloseCapability, IFileSystemProviderWithFileReadWriteCapability, IResolveFileResultWithMetadata, IWatchOptions, ILegacyFileService, IWriteFileOptions, IReadFileOptions, IFileStreamContent, IFileContent } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { ServiceIdentifier } from 'vs/platform/instantiation/common/instantiation';
import { isAbsolutePath, dirname, basename, joinPath, isEqual, isEqualOrParent } from 'vs/base/common/resources';
import { localize } from 'vs/nls';
import { TernarySearchTree } from 'vs/base/common/map';
import { isNonEmptyArray, coalesce } from 'vs/base/common/arrays';
import { getBaseLabel } from 'vs/base/common/labels';
import { ILogService } from 'vs/platform/log/common/log';
import { VSBuffer, VSBufferReadable, readableToBuffer, bufferToReadable, streamToBuffer, bufferToStream, VSBufferReadableStream, writeableBufferStream, VSBufferWriteableStream } from 'vs/base/common/buffer';
import { Queue } from 'vs/base/common/async';
import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';

export class FileService2 extends Disposable implements IFileService {

	//#region TODO@Ben HACKS

	private _legacy: ILegacyFileService | null;
	private joinOnLegacy: Promise<ILegacyFileService>;
	private joinOnImplResolve: (service: ILegacyFileService) => void;

	get whenReady(): Promise<void> { return this.joinOnLegacy.then(() => undefined); }

	setLegacyService(legacy: ILegacyFileService): void {
		this._legacy = this._register(legacy);

		this._register(legacy.onAfterOperation(e => this._onAfterOperation.fire(e)));

		this.provider.forEach((provider, scheme) => {
			legacy.registerProvider(scheme, provider);
		});

		this.joinOnImplResolve(legacy);
	}

	//#endregion

	_serviceBrand: ServiceIdentifier<any>;

	private readonly BUFFER_SIZE = 64 * 1024;

	constructor(@ILogService private logService: ILogService) {
		super();

		this.joinOnLegacy = new Promise(resolve => {
			this.joinOnImplResolve = resolve;
		});
	}

	//#region File System Provider

	private _onDidChangeFileSystemProviderRegistrations: Emitter<IFileSystemProviderRegistrationEvent> = this._register(new Emitter<IFileSystemProviderRegistrationEvent>());
	get onDidChangeFileSystemProviderRegistrations(): Event<IFileSystemProviderRegistrationEvent> { return this._onDidChangeFileSystemProviderRegistrations.event; }

	private _onWillActivateFileSystemProvider: Emitter<IFileSystemProviderActivationEvent> = this._register(new Emitter<IFileSystemProviderActivationEvent>());
	get onWillActivateFileSystemProvider(): Event<IFileSystemProviderActivationEvent> { return this._onWillActivateFileSystemProvider.event; }

	private readonly provider = new Map<string, IFileSystemProvider>();

	registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable {
		if (this.provider.has(scheme)) {
			throw new Error(`A provider for the scheme ${scheme} is already registered.`);
		}

		let legacyDisposal: IDisposable;
		if (this._legacy) {
			legacyDisposal = this._legacy.registerProvider(scheme, provider);
		} else {
			legacyDisposal = Disposable.None;
		}

		// Add provider with event
		this.provider.set(scheme, provider);
		this._onDidChangeFileSystemProviderRegistrations.fire({ added: true, scheme, provider });

		// Forward events from provider
		const providerDisposables: IDisposable[] = [];
		providerDisposables.push(provider.onDidChangeFile(changes => this._onFileChanges.fire(new FileChangesEvent(changes))));
		if (typeof provider.onDidErrorOccur === 'function') {
			providerDisposables.push(provider.onDidErrorOccur(error => this._onError.fire(error)));
		}

		return combinedDisposable([
			toDisposable(() => {
				this._onDidChangeFileSystemProviderRegistrations.fire({ added: false, scheme, provider });
				this.provider.delete(scheme);

				dispose(providerDisposables);
			}),
			legacyDisposal
		]);
	}

	async activateProvider(scheme: string): Promise<void> {

		// Emit an event that we are about to activate a provider with the given scheme.
		// Listeners can participate in the activation by registering a provider for it.
		const joiners: Promise<void>[] = [];
		this._onWillActivateFileSystemProvider.fire({
			scheme,
			join(promise) {
				if (promise) {
					joiners.push(promise);
				}
			},
		});

		if (this.provider.has(scheme)) {
			return Promise.resolve(); // provider is already here so we can return directly
		}

		// If the provider is not yet there, make sure to join on the listeners assuming
		// that it takes a bit longer to register the file system provider.
		await Promise.all(joiners);
	}

	canHandleResource(resource: URI): boolean {
		return this.provider.has(resource.scheme);
	}

	hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean {
		const provider = this.provider.get(resource.scheme);

		return !!(provider && (provider.capabilities & capability));
	}

	protected async withProvider(resource: URI): Promise<IFileSystemProvider> {

		// Assert path is absolute
		if (!isAbsolutePath(resource)) {
			throw new FileOperationError(localize('invalidPath', "The path of resource '{0}' must be absolute", resource.toString(true)), FileOperationResult.FILE_INVALID_PATH);
		}

		// Activate provider
		await this.activateProvider(resource.scheme);

		// Assert provider
		const provider = this.provider.get(resource.scheme);
		if (!provider) {
			const err = new Error();
			err.name = 'ENOPRO';
			err.message = `No provider found for ${resource.toString()}`;

			throw err;
		}

		return provider;
	}

	private async withReadWriteProvider(resource: URI): Promise<IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability> {
		const provider = await this.withProvider(resource);

		if (hasOpenReadWriteCloseCapability(provider) || hasReadWriteCapability(provider)) {
			return provider;
		}

		throw new Error('Provider neither has FileReadWrite nor FileOpenReadWriteClose capability which is needed for the operation.');
	}

	//#endregion

	private _onAfterOperation: Emitter<FileOperationEvent> = this._register(new Emitter<FileOperationEvent>());
	get onAfterOperation(): Event<FileOperationEvent> { return this._onAfterOperation.event; }

	private _onError: Emitter<Error> = this._register(new Emitter<Error>());
	get onError(): Event<Error> { return this._onError.event; }

	//#region File Metadata Resolving

	async resolve(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	async resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;
	async resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat> {
		try {
			return await this.doResolveFile(resource, options);
		} catch (error) {

			// Specially handle file not found case as file operation result
			if (toFileSystemProviderErrorCode(error) === FileSystemProviderErrorCode.FileNotFound) {
				throw new FileOperationError(
					localize('fileNotFoundError', "File not found ({0})", resource.toString(true)),
					FileOperationResult.FILE_NOT_FOUND
				);
			}

			// Bubble up any other error as is
			throw error;
		}
	}

	private async doResolveFile(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	private async doResolveFile(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;
	private async doResolveFile(resource: URI, options?: IResolveFileOptions): Promise<IFileStat> {
		const provider = await this.withProvider(resource);

		// leverage a trie to check for recursive resolving
		const resolveTo = options && options.resolveTo;
		const trie = TernarySearchTree.forPaths<true>();
		trie.set(resource.toString(), true);
		if (isNonEmptyArray(resolveTo)) {
			resolveTo.forEach(uri => trie.set(uri.toString(), true));
		}

		const resolveSingleChildDescendants = !!(options && options.resolveSingleChildDescendants);
		const resolveMetadata = !!(options && options.resolveMetadata);

		const stat = await provider.stat(resource);

		return this.toFileStat(provider, resource, stat, undefined, resolveMetadata, (stat, siblings) => {

			// check for recursive resolving
			if (Boolean(trie.findSuperstr(stat.resource.toString()) || trie.get(stat.resource.toString()))) {
				return true;
			}

			// check for resolving single child folders
			if (stat.isDirectory && resolveSingleChildDescendants) {
				return siblings === 1;
			}

			return false;
		});
	}

	private async toFileStat(provider: IFileSystemProvider, resource: URI, stat: IStat | { type: FileType } & Partial<IStat>, siblings: number | undefined, resolveMetadata: boolean, recurse: (stat: IFileStat, siblings?: number) => boolean): Promise<IFileStat> {

		// convert to file stat
		const fileStat: IFileStat = {
			resource,
			name: getBaseLabel(resource),
			isDirectory: (stat.type & FileType.Directory) !== 0,
			isSymbolicLink: (stat.type & FileType.SymbolicLink) !== 0,
			isReadonly: !!(provider.capabilities & FileSystemProviderCapabilities.Readonly),
			mtime: stat.mtime,
			size: stat.size,
			etag: etag(stat.mtime, stat.size)
		};

		// check to recurse for directories
		if (fileStat.isDirectory && recurse(fileStat, siblings)) {
			try {
				const entries = await provider.readdir(resource);
				const resolvedEntries = await Promise.all(entries.map(async ([name, type]) => {
					try {
						const childResource = joinPath(resource, name);
						const childStat = resolveMetadata ? await provider.stat(childResource) : { type };

						return await this.toFileStat(provider, childResource, childStat, entries.length, resolveMetadata, recurse);
					} catch (error) {
						this.logService.trace(error);

						return null; // can happen e.g. due to permission errors
					}
				}));

				// make sure to get rid of null values that signal a failure to resolve a particular entry
				fileStat.children = coalesce(resolvedEntries);
			} catch (error) {
				this.logService.trace(error);

				fileStat.children = []; // gracefully handle errors, we may not have permissions to read
			}

			return fileStat;
		}

		return Promise.resolve(fileStat);
	}

	async resolveAll(toResolve: { resource: URI, options?: IResolveFileOptions }[]): Promise<IResolveFileResult[]>;
	async resolveAll(toResolve: { resource: URI, options: IResolveMetadataFileOptions }[]): Promise<IResolveFileResultWithMetadata[]>;
	async resolveAll(toResolve: { resource: URI; options?: IResolveFileOptions; }[]): Promise<IResolveFileResult[]> {
		return Promise.all(toResolve.map(async entry => {
			try {
				return { stat: await this.doResolveFile(entry.resource, entry.options), success: true };
			} catch (error) {
				this.logService.trace(error);

				return { stat: undefined, success: false };
			}
		}));
	}

	async exists(resource: URI): Promise<boolean> {
		try {
			return !!(await this.resolve(resource));
		} catch (error) {
			return false;
		}
	}

	//#endregion

	//#region File Reading/Writing

	async createFile(resource: URI, bufferOrReadable: VSBuffer | VSBufferReadable = VSBuffer.fromString(''), options?: ICreateFileOptions): Promise<IFileStatWithMetadata> {

		// validate overwrite
		const overwrite = !!(options && options.overwrite);
		if (!overwrite && await this.exists(resource)) {
			throw new FileOperationError(localize('fileExists', "File to create already exists ({0})", resource.toString(true)), FileOperationResult.FILE_MODIFIED_SINCE, options);
		}

		// do write into file (this will create it too)
		const fileStat = await this.writeFile(resource, bufferOrReadable);

		// events
		this._onAfterOperation.fire(new FileOperationEvent(resource, FileOperation.CREATE, fileStat));

		return fileStat;
	}

	async writeFile(resource: URI, bufferOrReadable: VSBuffer | VSBufferReadable, options?: IWriteFileOptions): Promise<IFileStatWithMetadata> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withReadWriteProvider(resource));

		try {

			// validate write
			const stat = await this.validateWriteFile(provider, resource, options);

			// mkdir recursively as needed
			if (!stat) {
				await this.mkdirp(provider, dirname(resource));
			}

			// write file: buffered
			if (hasOpenReadWriteCloseCapability(provider)) {
				await this.doWriteBuffered(provider, resource, bufferOrReadable instanceof VSBuffer ? bufferToReadable(bufferOrReadable) : bufferOrReadable);
			}

			// write file: unbuffered
			else {
				await this.doWriteUnbuffered(provider, resource, bufferOrReadable);
			}
		} catch (error) {
			throw new FileOperationError(localize('err.write', "Failed to write file {0}", resource.toString(false)), toFileOperationResult(error), options);
		}

		return this.resolve(resource, { resolveMetadata: true });
	}

	private async validateWriteFile(provider: IFileSystemProvider, resource: URI, options?: IWriteFileOptions): Promise<IStat | undefined> {
		let stat: IStat | undefined = undefined;
		try {
			stat = await provider.stat(resource);
		} catch (error) {
			return undefined; // file might not exist
		}

		// file cannot be directory
		if ((stat.type & FileType.Directory) !== 0) {
			throw new FileOperationError(localize('fileIsDirectoryError', "Expected file {0} is actually a directory", resource.toString()), FileOperationResult.FILE_IS_DIRECTORY, options);
		}

		// Dirty write prevention: if the file on disk has been changed and does not match our expected
		// mtime and etag, we bail out to prevent dirty writing.
		//
		// First, we check for a mtime that is in the future before we do more checks. The assumption is
		// that only the mtime is an indicator for a file that has changd on disk.
		//
		// Second, if the mtime has advanced, we compare the size of the file on disk with our previous
		// one using the etag() function. Relying only on the mtime check has prooven to produce false
		// positives due to file system weirdness (especially around remote file systems). As such, the
		// check for size is a weaker check because it can return a false negative if the file has changed
		// but to the same length. This is a compromise we take to avoid having to produce checksums of
		// the file content for comparison which would be much slower to compute.
		if (options && typeof options.mtime === 'number' && typeof options.etag === 'string' && options.mtime < stat.mtime && options.etag !== etag(stat.size, options.mtime)) {
			throw new FileOperationError(localize('fileModifiedError', "File Modified Since"), FileOperationResult.FILE_MODIFIED_SINCE, options);
		}

		return stat;
	}

	async readFile(resource: URI, options?: IReadFileOptions): Promise<IFileContent> {
		const stream = await this.readFileStream(resource, options);

		return {
			...stream,
			value: await streamToBuffer(stream.value)
		};
	}

	async readFileStream(resource: URI, options?: IReadFileOptions): Promise<IFileStreamContent> {
		const provider = await this.withReadWriteProvider(resource);

		// install a cancellation token that gets cancelled
		// when any error occurs. this allows us to resolve
		// the content of the file while resolving metadata
		// but still cancel the operation in certain cases.
		const cancellableSource = new CancellationTokenSource();

		// validate read operation
		const statPromise = this.validateReadFile(resource, options).then(stat => stat, error => {
			cancellableSource.cancel();

			throw error;
		});

		try {

			// if the etag is provided, we await the result of the validation
			// due to the likelyhood of hitting a NOT_MODIFIED_SINCE result.
			// otherwise, we let it run in parallel to the file reading for
			// optimal startup performance.
			if (options && options.etag) {
				await statPromise;
			}

			let fileStreamPromise: Promise<VSBufferReadableStream>;

			// read buffered
			if (hasOpenReadWriteCloseCapability(provider)) {
				fileStreamPromise = Promise.resolve(this.readFileBuffered(provider, resource, cancellableSource.token, options));
			}

			// read unbuffered
			else {
				fileStreamPromise = this.readFileUnbuffered(provider, resource, options);
			}

			const [fileStat, fileStream] = await Promise.all([statPromise, fileStreamPromise]);

			return {
				...fileStat,
				value: fileStream
			};
		} catch (error) {
			throw new FileOperationError(localize('err.read', "Failed to read file {0}", resource.toString(false)), toFileOperationResult(error), options);
		}
	}

	private readFileBuffered(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, token: CancellationToken, options?: IReadFileOptions): VSBufferReadableStream {
		const stream = writeableBufferStream();

		// do not await reading but simply return
		// the stream directly since it operates
		// via events. finally end the stream and
		// send through the possible error
		let error: Error | undefined = undefined;
		this.doReadFileBuffered(provider, resource, stream, token, options).then(undefined, err => error = err).finally(() => stream.end(error));

		return stream;
	}

	private async doReadFileBuffered(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, stream: VSBufferWriteableStream, token: CancellationToken, options?: IReadFileOptions): Promise<void> {

		// open handle through provider
		const handle = await provider.open(resource, { create: false });

		try {
			let buffer = VSBuffer.alloc(this.BUFFER_SIZE);

			let totalBytesRead = 0;
			let posInFile = options && typeof options.position === 'number' ? options.position : 0;
			let bytesRead = 0;
			let posInBuffer = 0;
			do {
				// read from source (handle) at current position (pos) into buffer (buffer) at
				// buffer position (posInBuffer) up to the size of the buffer (buffer.byteLength).
				bytesRead = await provider.read(handle, posInFile, buffer.buffer, posInBuffer, buffer.byteLength - posInBuffer);

				posInFile += bytesRead;
				posInBuffer += bytesRead;
				totalBytesRead += bytesRead;

				// when buffer full, create a new one and emit it through stream
				if (posInBuffer === buffer.byteLength) {
					stream.write(buffer);

					buffer = VSBuffer.alloc(this.BUFFER_SIZE);

					posInBuffer = 0;
				}
			} while (bytesRead > 0 && this.throwIfCancelled(token) && this.throwIfTooLarge(totalBytesRead, options));

			// wrap up with last buffer
			if (posInBuffer > 0) {
				stream.write(buffer.slice(0, posInBuffer));
			}
		} catch (error) {
			throw error;
		} finally {
			await provider.close(handle);
		}
	}

	private async readFileUnbuffered(provider: IFileSystemProviderWithFileReadWriteCapability, resource: URI, options?: IReadFileOptions): Promise<VSBufferReadableStream> {
		let buffer = await provider.readFile(resource);

		// respect position option
		if (options && typeof options.position === 'number') {
			buffer = buffer.slice(options.position);
		}

		return bufferToStream(VSBuffer.wrap(buffer));
	}

	private async validateReadFile(resource: URI, options?: IReadFileOptions): Promise<IFileStatWithMetadata> {
		const stat = await this.resolve(resource, { resolveMetadata: true });

		// Return early if resource is a directory
		if (stat.isDirectory) {
			throw new FileOperationError(localize('fileIsDirectoryError', "Expected file {0} is actually a directory", resource.toString()), FileOperationResult.FILE_IS_DIRECTORY, options);
		}

		// Return early if file not modified since
		if (options && options.etag && options.etag === stat.etag) {
			throw new FileOperationError(localize('fileNotModifiedError', "File not modified since"), FileOperationResult.FILE_NOT_MODIFIED_SINCE, options);
		}

		// Return early if file is too large to load
		if (options && options.limits) {
			if (typeof options.limits.memory === 'number' && stat.size > options.limits.memory) {
				throw new FileOperationError(localize('fileTooLargeForHeapError', "To open a file of this size, you need to restart and allow it to use more memory"), FileOperationResult.FILE_EXCEED_MEMORY_LIMIT);
			}

			if (typeof options.limits.size === 'number' && stat.size > options.limits.size) {
				throw new FileOperationError(localize('fileTooLargeError', "File is too large to open"), FileOperationResult.FILE_TOO_LARGE);
			}
		}

		return stat;
	}

	//#endregion

	//#region Move/Copy/Delete/Create Folder

	async move(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata> {
		const sourceProvider = this.throwIfFileSystemIsReadonly(await this.withReadWriteProvider(source));
		const targetProvider = this.throwIfFileSystemIsReadonly(await this.withReadWriteProvider(target));

		// move
		const mode = await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'move', overwrite);

		// resolve and send events
		const fileStat = await this.resolve(target, { resolveMetadata: true });
		this._onAfterOperation.fire(new FileOperationEvent(source, mode === 'move' ? FileOperation.MOVE : FileOperation.COPY, fileStat));

		return fileStat;
	}

	async copy(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata> {
		const sourceProvider = await this.withReadWriteProvider(source);
		const targetProvider = this.throwIfFileSystemIsReadonly(await this.withReadWriteProvider(target));

		// copy
		const mode = await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'copy', overwrite);

		// resolve and send events
		const fileStat = await this.resolve(target, { resolveMetadata: true });
		this._onAfterOperation.fire(new FileOperationEvent(source, mode === 'copy' ? FileOperation.COPY : FileOperation.MOVE, fileStat));

		return fileStat;
	}

	private async doMoveCopy(sourceProvider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI, mode: 'move' | 'copy', overwrite?: boolean): Promise<'move' | 'copy'> {

		// validation
		const { exists, isCaseChange } = await this.doValidateMoveCopy(sourceProvider, source, targetProvider, target, overwrite);

		// delete as needed
		if (exists && !isCaseChange && overwrite) {
			await this.del(target, { recursive: true });
		}

		// create parent folders
		await this.mkdirp(targetProvider, dirname(target));

		// copy source => target
		if (mode === 'copy') {

			// same provider with fast copy: leverage copy() functionality
			if (sourceProvider === targetProvider && hasFileFolderCopyCapability(sourceProvider)) {
				return sourceProvider.copy(source, target, { overwrite: !!overwrite }).then(() => mode);
			}

			// when copying via buffer/unbuffered, we have to manually
			// traverse the source if it is a folder and not a file
			const sourceFile = await this.resolve(source);
			if (sourceFile.isDirectory) {
				return this.doCopyFolder(sourceProvider, sourceFile, targetProvider, target).then(() => mode);
			} else {
				return this.doCopyFile(sourceProvider, source, targetProvider, target).then(() => mode);
			}
		}

		// move source => target
		else {

			// same provider: leverage rename() functionality
			if (sourceProvider === targetProvider) {
				return sourceProvider.rename(source, target, { overwrite: !!overwrite }).then(() => mode);
			}

			// across providers: copy to target & delete at source
			else {
				await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'copy', overwrite);

				return this.del(source, { recursive: true }).then(() => 'copy' as 'move' | 'copy');
			}
		}
	}

	private async doCopyFile(sourceProvider: IFileSystemProvider, source: URI, targetProvider: IFileSystemProvider, target: URI): Promise<void> {

		// copy: source (buffered) => target (buffered)
		if (hasOpenReadWriteCloseCapability(sourceProvider) && hasOpenReadWriteCloseCapability(targetProvider)) {
			return this.doPipeBuffered(sourceProvider, source, targetProvider, target);
		}

		// copy: source (buffered) => target (unbuffered)
		if (hasOpenReadWriteCloseCapability(sourceProvider) && hasReadWriteCapability(targetProvider)) {
			return this.doPipeBufferedToUnbuffered(sourceProvider, source, targetProvider, target);
		}

		// copy: source (unbuffered) => target (buffered)
		if (hasReadWriteCapability(sourceProvider) && hasOpenReadWriteCloseCapability(targetProvider)) {
			return this.doPipeUnbufferedToBuffered(sourceProvider, source, targetProvider, target);
		}

		// copy: source (unbuffered) => target (unbuffered)
		if (hasReadWriteCapability(sourceProvider) && hasReadWriteCapability(targetProvider)) {
			return this.doPipeUnbuffered(sourceProvider, source, targetProvider, target);
		}
	}

	private async doCopyFolder(sourceProvider: IFileSystemProvider, sourceFolder: IFileStat, targetProvider: IFileSystemProvider, targetFolder: URI): Promise<void> {

		// create folder in target
		await targetProvider.mkdir(targetFolder);

		// create children in target
		if (Array.isArray(sourceFolder.children)) {
			await Promise.all(sourceFolder.children.map(async sourceChild => {
				const targetChild = joinPath(targetFolder, sourceChild.name);
				if (sourceChild.isDirectory) {
					return this.doCopyFolder(sourceProvider, await this.resolve(sourceChild.resource), targetProvider, targetChild);
				} else {
					return this.doCopyFile(sourceProvider, sourceChild.resource, targetProvider, targetChild);
				}
			}));
		}
	}

	private async doValidateMoveCopy(sourceProvider: IFileSystemProvider, source: URI, targetProvider: IFileSystemProvider, target: URI, overwrite?: boolean): Promise<{ exists: boolean, isCaseChange: boolean }> {
		let isCaseChange = false;
		let isPathCaseSensitive = false;

		// Check if source is equal or parent to target (requires providers to be the same)
		if (sourceProvider === targetProvider) {
			const isPathCaseSensitive = !!(sourceProvider.capabilities & FileSystemProviderCapabilities.PathCaseSensitive);
			isCaseChange = isPathCaseSensitive ? false : isEqual(source, target, true /* ignore case */);
			if (!isCaseChange && isEqualOrParent(target, source, !isPathCaseSensitive)) {
				throw new Error(localize('unableToMoveCopyError1', "Unable to move/copy when source path is equal or parent of target path"));
			}
		}

		// Extra checks if target exists and this is not a rename
		const exists = await this.exists(target);
		if (exists && !isCaseChange) {

			// Bail out if target exists and we are not about to overwrite
			if (!overwrite) {
				throw new FileOperationError(localize('unableToMoveCopyError2', "Unable to move/copy. File already exists at destination."), FileOperationResult.FILE_MOVE_CONFLICT);
			}

			// Special case: if the target is a parent of the source, we cannot delete
			// it as it would delete the source as well. In this case we have to throw
			if (sourceProvider === targetProvider && isEqualOrParent(source, target, !isPathCaseSensitive)) {
				throw new Error(localize('unableToMoveCopyError3', "Unable to move/copy. File would replace folder it is contained in."));
			}
		}

		return { exists, isCaseChange };
	}

	async createFolder(resource: URI): Promise<IFileStatWithMetadata> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withProvider(resource));

		// mkdir recursively
		await this.mkdirp(provider, resource);

		// events
		const fileStat = await this.resolve(resource, { resolveMetadata: true });
		this._onAfterOperation.fire(new FileOperationEvent(resource, FileOperation.CREATE, fileStat));

		return fileStat;
	}

	private async mkdirp(provider: IFileSystemProvider, directory: URI): Promise<void> {
		const directoriesToCreate: string[] = [];

		// mkdir until we reach root
		while (!isEqual(directory, dirname(directory))) {
			try {
				const stat = await provider.stat(directory);
				if ((stat.type & FileType.Directory) === 0) {
					throw new Error(localize('mkdirExistsError', "{0} exists, but is not a directory", directory.toString()));
				}

				break; // we have hit a directory that exists -> good
			} catch (error) {

				// Bubble up any other error that is not file not found
				if (toFileSystemProviderErrorCode(error) !== FileSystemProviderErrorCode.FileNotFound) {
					throw error;
				}

				// Upon error, remember directories that need to be created
				directoriesToCreate.push(basename(directory));

				// Continue up
				directory = dirname(directory);
			}
		}

		// Create directories as needed
		for (let i = directoriesToCreate.length - 1; i >= 0; i--) {
			directory = joinPath(directory, directoriesToCreate[i]);
			await provider.mkdir(directory);
		}
	}

	async del(resource: URI, options?: { useTrash?: boolean; recursive?: boolean; }): Promise<void> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withProvider(resource));

		// Validate trash support
		const useTrash = !!(options && options.useTrash);
		if (useTrash && !(provider.capabilities & FileSystemProviderCapabilities.Trash)) {
			throw new Error(localize('err.trash', "Provider does not support trash."));
		}

		// Validate recursive
		const recursive = !!(options && options.recursive);
		if (!recursive && await this.exists(resource)) {
			const stat = await this.resolve(resource);
			if (stat.isDirectory && Array.isArray(stat.children) && stat.children.length > 0) {
				throw new Error(localize('deleteFailed', "Failed to delete non-empty folder '{0}'.", resource.toString()));
			}
		}

		// Delete through provider
		await provider.delete(resource, { recursive, useTrash });

		// Events
		this._onAfterOperation.fire(new FileOperationEvent(resource, FileOperation.DELETE));
	}

	//#endregion

	//#region File Watching

	private _onFileChanges: Emitter<FileChangesEvent> = this._register(new Emitter<FileChangesEvent>());
	get onFileChanges(): Event<FileChangesEvent> { return this._onFileChanges.event; }

	private activeWatchers = new Map<string, { disposable: IDisposable, count: number }>();

	watch(resource: URI, options: IWatchOptions = { recursive: false, excludes: [] }): IDisposable {
		let watchDisposed = false;
		let watchDisposable = toDisposable(() => watchDisposed = true);

		// Watch and wire in disposable which is async but
		// check if we got disposed meanwhile and forward
		this.doWatch(resource, options).then(disposable => {
			if (watchDisposed) {
				dispose(disposable);
			} else {
				watchDisposable = disposable;
			}
		}, error => this.logService.error(error));

		return toDisposable(() => dispose(watchDisposable));
	}

	async doWatch(resource: URI, options: IWatchOptions): Promise<IDisposable> {
		const provider = await this.withProvider(resource);
		const key = this.toWatchKey(provider, resource, options);

		// Only start watching if we are the first for the given key
		const watcher = this.activeWatchers.get(key) || { count: 0, disposable: provider.watch(resource, options) };
		if (!this.activeWatchers.has(key)) {
			this.activeWatchers.set(key, watcher);
		}

		// Increment usage counter
		watcher.count += 1;

		return toDisposable(() => {

			// Unref
			watcher.count--;

			// Dispose only when last user is reached
			if (watcher.count === 0) {
				dispose(watcher.disposable);
				this.activeWatchers.delete(key);
			}
		});
	}

	private toWatchKey(provider: IFileSystemProvider, resource: URI, options: IWatchOptions): string {
		return [
			this.toMapKey(provider, resource), 	// lowercase path if the provider is case insensitive
			String(options.recursive),			// use recursive: true | false as part of the key
			options.excludes.join()				// use excludes as part of the key
		].join();
	}

	dispose(): void {
		super.dispose();

		this.activeWatchers.forEach(watcher => dispose(watcher.disposable));
		this.activeWatchers.clear();
	}

	//#endregion

	//#region Helpers

	private writeQueues: Map<string, Queue<void>> = new Map();

	private ensureWriteQueue(provider: IFileSystemProvider, resource: URI): Queue<void> {
		// ensure to never write to the same resource without finishing
		// the one write. this ensures a write finishes consistently
		// (even with error) before another write is done.
		const queueKey = this.toMapKey(provider, resource);
		let writeQueue = this.writeQueues.get(queueKey);
		if (!writeQueue) {
			writeQueue = new Queue<void>();
			this.writeQueues.set(queueKey, writeQueue);

			const onFinish = Event.once(writeQueue.onFinished);
			onFinish(() => {
				this.writeQueues.delete(queueKey);
				dispose(writeQueue);
			});
		}

		return writeQueue;
	}

	private toMapKey(provider: IFileSystemProvider, resource: URI): string {
		const isPathCaseSensitive = !!(provider.capabilities & FileSystemProviderCapabilities.PathCaseSensitive);

		return isPathCaseSensitive ? resource.toString() : resource.toString().toLowerCase();
	}

	private async doWriteBuffered(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, readable: VSBufferReadable): Promise<void> {
		return this.ensureWriteQueue(provider, resource).queue(() => this.doWriteBufferedQueued(provider, resource, readable));
	}

	private async doWriteBufferedQueued(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, readable: VSBufferReadable): Promise<void> {

		// open handle
		const handle = await provider.open(resource, { create: true });

		// write into handle until all bytes from buffer have been written
		try {
			let posInFile = 0;

			let chunk: VSBuffer | null;
			while (chunk = readable.read()) {
				await this.doWriteBuffer(provider, handle, chunk, chunk.byteLength, posInFile, 0);

				posInFile += chunk.byteLength;
			}
		} catch (error) {
			throw error;
		} finally {
			await provider.close(handle);
		}
	}

	private async doWriteBuffer(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, handle: number, buffer: VSBuffer, length: number, posInFile: number, posInBuffer: number): Promise<void> {
		let totalBytesWritten = 0;
		while (totalBytesWritten < length) {
			const bytesWritten = await provider.write(handle, posInFile + totalBytesWritten, buffer.buffer, posInBuffer + totalBytesWritten, length - totalBytesWritten);
			totalBytesWritten += bytesWritten;
		}
	}

	private async doWriteUnbuffered(provider: IFileSystemProviderWithFileReadWriteCapability, resource: URI, bufferOrReadable: VSBuffer | VSBufferReadable): Promise<void> {
		return this.ensureWriteQueue(provider, resource).queue(() => this.doWriteUnbufferedQueued(provider, resource, bufferOrReadable));
	}

	private async doWriteUnbufferedQueued(provider: IFileSystemProviderWithFileReadWriteCapability, resource: URI, bufferOrReadable: VSBuffer | VSBufferReadable): Promise<void> {
		let buffer: VSBuffer;
		if (bufferOrReadable instanceof VSBuffer) {
			buffer = bufferOrReadable;
		} else {
			buffer = readableToBuffer(bufferOrReadable);
		}

		return provider.writeFile(resource, buffer.buffer, { create: true, overwrite: true });
	}

	private async doPipeBuffered(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		return this.ensureWriteQueue(targetProvider, target).queue(() => this.doPipeBufferedQueued(sourceProvider, source, targetProvider, target));
	}

	private async doPipeBufferedQueued(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		let sourceHandle: number | undefined = undefined;
		let targetHandle: number | undefined = undefined;

		try {

			// Open handles
			sourceHandle = await sourceProvider.open(source, { create: false });
			targetHandle = await targetProvider.open(target, { create: true });

			const buffer = VSBuffer.alloc(this.BUFFER_SIZE);

			let posInFile = 0;
			let posInBuffer = 0;
			let bytesRead = 0;
			do {
				// read from source (sourceHandle) at current position (posInFile) into buffer (buffer) at
				// buffer position (posInBuffer) up to the size of the buffer (buffer.byteLength).
				bytesRead = await sourceProvider.read(sourceHandle, posInFile, buffer.buffer, posInBuffer, buffer.byteLength - posInBuffer);

				// write into target (targetHandle) at current position (posInFile) from buffer (buffer) at
				// buffer position (posInBuffer) all bytes we read (bytesRead).
				await this.doWriteBuffer(targetProvider, targetHandle, buffer, bytesRead, posInFile, posInBuffer);

				posInFile += bytesRead;
				posInBuffer += bytesRead;

				// when buffer full, fill it again from the beginning
				if (posInBuffer === buffer.byteLength) {
					posInBuffer = 0;
				}
			} while (bytesRead > 0);
		} catch (error) {
			throw error;
		} finally {
			await Promise.all([
				typeof sourceHandle === 'number' ? sourceProvider.close(sourceHandle) : Promise.resolve(),
				typeof targetHandle === 'number' ? targetProvider.close(targetHandle) : Promise.resolve(),
			]);
		}
	}

	private async doPipeUnbuffered(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {
		return this.ensureWriteQueue(targetProvider, target).queue(() => this.doPipeUnbufferedQueued(sourceProvider, source, targetProvider, target));
	}

	private async doPipeUnbufferedQueued(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {
		return targetProvider.writeFile(target, await sourceProvider.readFile(source), { create: true, overwrite: true });
	}

	private async doPipeUnbufferedToBuffered(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		return this.ensureWriteQueue(targetProvider, target).queue(() => this.doPipeUnbufferedToBufferedQueued(sourceProvider, source, targetProvider, target));
	}

	private async doPipeUnbufferedToBufferedQueued(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {

		// Open handle
		const targetHandle = await targetProvider.open(target, { create: true });

		// Read entire buffer from source and write buffered
		try {
			const buffer = await sourceProvider.readFile(source);
			await this.doWriteBuffer(targetProvider, targetHandle, VSBuffer.wrap(buffer), buffer.byteLength, 0, 0);
		} catch (error) {
			throw error;
		} finally {
			await targetProvider.close(targetHandle);
		}
	}

	private async doPipeBufferedToUnbuffered(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {

		// Read buffer via stream buffered
		const buffer = await streamToBuffer(this.readFileBuffered(sourceProvider, source, CancellationToken.None));

		// Write buffer into target at once
		await this.doWriteUnbuffered(targetProvider, target, buffer);
	}

	protected throwIfFileSystemIsReadonly<T extends IFileSystemProvider>(provider: T): T {
		if (provider.capabilities & FileSystemProviderCapabilities.Readonly) {
			throw new FileOperationError(localize('err.readonly', "Resource can not be modified."), FileOperationResult.FILE_PERMISSION_DENIED);
		}

		return provider;
	}

	private throwIfCancelled(token: CancellationToken): boolean {
		if (token.isCancellationRequested) {
			throw new Error('cancelled');
		}

		return true;
	}

	private throwIfTooLarge(totalBytesRead: number, options?: IReadFileOptions): boolean {

		// Return early if file is too large to load
		if (options && options.limits) {
			if (typeof options.limits.memory === 'number' && totalBytesRead > options.limits.memory) {
				throw new FileOperationError(localize('fileTooLargeForHeapError', "To open a file of this size, you need to restart and allow it to use more memory"), FileOperationResult.FILE_EXCEED_MEMORY_LIMIT);
			}

			if (typeof options.limits.size === 'number' && totalBytesRead > options.limits.size) {
				throw new FileOperationError(localize('fileTooLargeError', "File is too large to open"), FileOperationResult.FILE_TOO_LARGE);
			}
		}

		return true;
	}

	//#endregion
}