/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import URI from 'vs/base/common/uri';
import { TPromise } from 'vs/base/common/winjs.base';
import { FileOpenFlags, IFileChange, IFileService, IFileSystemProviderBase, ISimpleReadWriteProvider, IStat } from 'vs/platform/files/common/files';
import { extHostNamedCustomer } from 'vs/workbench/api/electron-browser/extHostCustomers';
import { ExtHostContext, ExtHostFileSystemShape, IExtHostContext, IFileChangeDto, MainContext, MainThreadFileSystemShape } from '../node/extHost.protocol';

@extHostNamedCustomer(MainContext.MainThreadFileSystem)
export class MainThreadFileSystem implements MainThreadFileSystemShape {

	private readonly _proxy: ExtHostFileSystemShape;
	private readonly _fileProvider = new Map<number, RemoteFileSystemProvider>();

	constructor(
		extHostContext: IExtHostContext,
		@IFileService private readonly _fileService: IFileService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostFileSystem);
	}

	dispose(): void {
		this._fileProvider.forEach(value => dispose());
		this._fileProvider.clear();
	}

	$registerFileSystemProvider(handle: number, scheme: string): void {
		this._fileProvider.set(handle, new RemoteFileSystemProvider(this._fileService, scheme, handle, this._proxy));
	}
	$unregisterProvider(handle: number): void {
		dispose(this._fileProvider.get(handle));
		this._fileProvider.delete(handle);
	}

	$onFileSystemChange(handle: number, changes: IFileChangeDto[]): void {
		this._fileProvider.get(handle).$onFileSystemChange(changes);
	}
}

class RemoteFileSystemProvider implements ISimpleReadWriteProvider, IFileSystemProviderBase {

	_type: 'simple' = 'simple';

	private readonly _onDidChange = new Emitter<IFileChange[]>();
	private readonly _registrations: IDisposable[];

	readonly onDidChange: Event<IFileChange[]> = this._onDidChange.event;

	constructor(
		fileService: IFileService,
		scheme: string,
		private readonly _handle: number,
		private readonly _proxy: ExtHostFileSystemShape
	) {
		this._registrations = [fileService.registerProvider(scheme, this)];
	}

	dispose(): void {
		dispose(this._registrations);
		this._onDidChange.dispose();
	}

	$onFileSystemChange(changes: IFileChangeDto[]): void {
		this._onDidChange.fire(changes.map(RemoteFileSystemProvider._createFileChange));
	}

	private static _createFileChange(dto: IFileChangeDto): IFileChange {
		return { resource: URI.revive(dto.resource), type: dto.type };
	}

	// --- forwarding calls

	stat(resource: URI): TPromise<IStat, any> {
		return this._proxy.$stat(this._handle, resource);
	}
	readFile(resource: URI, opts: { flags: FileOpenFlags }): TPromise<Uint8Array, any> {
		return this._proxy.$readFile(this._handle, resource, opts.flags).then(encoded => {
			return Buffer.from(encoded, 'base64');
		});
	}
	writeFile(resource: URI, content: Uint8Array, opts: { flags: FileOpenFlags }): TPromise<void, any> {
		let encoded = Buffer.isBuffer(content)
			? content.toString('base64')
			: Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('base64');
		return this._proxy.$writeFile(this._handle, resource, encoded, opts.flags);
	}
	delete(resource: URI): TPromise<void, any> {
		return this._proxy.$delete(this._handle, resource);
	}
	rename(resource: URI, target: URI, opts: { flags: FileOpenFlags }): TPromise<IStat, any> {
		return this._proxy.$rename(this._handle, resource, target, opts.flags);
	}
	mkdir(resource: URI): TPromise<IStat, any> {
		return this._proxy.$mkdir(this._handle, resource);
	}
	readdir(resource: URI): TPromise<[string, IStat][], any> {
		return this._proxy.$readdir(this._handle, resource);
	}
}
