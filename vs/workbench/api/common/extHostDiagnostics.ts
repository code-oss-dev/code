/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IMarkerData, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { URI, UriComponents } from 'vs/base/common/uri';
import type * as vscode from 'vscode';
import { MainContext, MainThreadDiagnosticsShape, ExtHostDiagnosticsShape, IMainContext } from './extHost.protocol';
import { DiagnosticSeverity } from './extHostTypes';
import * as converter from './extHostTypeConverters';
import { Event, Emitter, DebounceEmitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ResourceMap } from 'vs/base/common/map';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IExtHostFileSystemInfo } from 'vs/workbench/api/common/extHostFileSystemInfo';
import { IExtUri } from 'vs/base/common/resources';
import { SkipList } from 'vs/base/common/skipList';

export class DiagnosticCollection implements vscode.DiagnosticCollection {

	readonly #proxy: MainThreadDiagnosticsShape | undefined;
	readonly #onDidChangeDiagnostics: Emitter<vscode.Uri[]>;
	readonly #data: SkipList<URI, vscode.Diagnostic[]>;

	private _isDisposed = false;

	constructor(
		private readonly _name: string,
		private readonly _owner: string,
		private readonly _maxDiagnosticsPerFile: number,
		extUri: IExtUri,
		proxy: MainThreadDiagnosticsShape | undefined,
		onDidChangeDiagnostics: Emitter<vscode.Uri[]>
	) {
		this.#data = new SkipList((a, b) => extUri.compare(a, b));
		this.#proxy = proxy;
		this.#onDidChangeDiagnostics = onDidChangeDiagnostics;
	}

	dispose(): void {
		if (!this._isDisposed) {
			this.#onDidChangeDiagnostics.fire([...this.#data.keys()]);
			if (this.#proxy) {
				this.#proxy.$clear(this._owner);
			}
			this.#data.clear();
			this._isDisposed = true;
		}
	}

	get name(): string {
		this._checkDisposed();
		return this._name;
	}

	set(uri: vscode.Uri, diagnostics: ReadonlyArray<vscode.Diagnostic>): void;
	set(entries: ReadonlyArray<[vscode.Uri, ReadonlyArray<vscode.Diagnostic>]>): void;
	set(first: vscode.Uri | ReadonlyArray<[vscode.Uri, ReadonlyArray<vscode.Diagnostic>]>, diagnostics?: ReadonlyArray<vscode.Diagnostic>) {

		if (!first) {
			// this set-call is a clear-call
			this.clear();
			return;
		}

		// the actual implementation for #set

		this._checkDisposed();
		let toSync: vscode.Uri[] = [];

		if (URI.isUri(first)) {

			if (!diagnostics) {
				// remove this entry
				this.delete(first);
				return;
			}

			// update single row
			this.#data.set(first, diagnostics.slice());
			toSync = [first];

		} else if (Array.isArray(first)) {
			// update many rows
			toSync = [];
			let lastUri: vscode.Uri | undefined;

			// ensure stable-sort
			first = [...first].sort(DiagnosticCollection._compareIndexedTuplesByUri);

			for (const tuple of first) {
				const [uri, diagnostics] = tuple;
				if (!lastUri || uri.toString() !== lastUri.toString()) {
					if (lastUri && this.#data.get(lastUri)!.length === 0) {
						this.#data.delete(lastUri);
					}
					lastUri = uri;
					toSync.push(uri);
					this.#data.set(uri, []);
				}

				if (!diagnostics) {
					// [Uri, undefined] means clear this
					const currentDiagnostics = this.#data.get(uri);
					if (currentDiagnostics) {
						currentDiagnostics.length = 0;
					}
				} else {
					const currentDiagnostics = this.#data.get(uri);
					if (currentDiagnostics) {
						currentDiagnostics.push(...diagnostics);
					}
				}
			}
		}

		// send event for extensions
		this.#onDidChangeDiagnostics.fire(toSync);

		// compute change and send to main side
		if (!this.#proxy) {
			return;
		}
		const entries: [URI, IMarkerData[]][] = [];
		for (let uri of toSync) {
			let marker: IMarkerData[] = [];
			const diagnostics = this.#data.get(uri);
			if (diagnostics) {

				// no more than N diagnostics per file
				if (diagnostics.length > this._maxDiagnosticsPerFile) {
					marker = [];
					const order = [DiagnosticSeverity.Error, DiagnosticSeverity.Warning, DiagnosticSeverity.Information, DiagnosticSeverity.Hint];
					orderLoop: for (let i = 0; i < 4; i++) {
						for (let diagnostic of diagnostics) {
							if (diagnostic.severity === order[i]) {
								const len = marker.push(converter.Diagnostic.from(diagnostic));
								if (len === this._maxDiagnosticsPerFile) {
									break orderLoop;
								}
							}
						}
					}

					// add 'signal' marker for showing omitted errors/warnings
					marker.push({
						severity: MarkerSeverity.Info,
						message: localize({ key: 'limitHit', comment: ['amount of errors/warning skipped due to limits'] }, "Not showing {0} further errors and warnings.", diagnostics.length - this._maxDiagnosticsPerFile),
						startLineNumber: marker[marker.length - 1].startLineNumber,
						startColumn: marker[marker.length - 1].startColumn,
						endLineNumber: marker[marker.length - 1].endLineNumber,
						endColumn: marker[marker.length - 1].endColumn
					});
				} else {
					marker = diagnostics.map(diag => converter.Diagnostic.from(diag));
				}
			}

			entries.push([uri, marker]);
		}
		this.#proxy.$changeMany(this._owner, entries);
	}

	delete(uri: vscode.Uri): void {
		this._checkDisposed();
		this.#onDidChangeDiagnostics.fire([uri]);
		this.#data.delete(uri);
		if (this.#proxy) {
			this.#proxy.$changeMany(this._owner, [[uri, undefined]]);
		}
	}

	clear(): void {
		this._checkDisposed();
		this.#onDidChangeDiagnostics.fire([...this.#data.keys()]);
		this.#data.clear();
		if (this.#proxy) {
			this.#proxy.$clear(this._owner);
		}
	}

	forEach(callback: (uri: URI, diagnostics: ReadonlyArray<vscode.Diagnostic>, collection: DiagnosticCollection) => any, thisArg?: any): void {
		this._checkDisposed();
		for (let uri of this.#data.keys()) {
			callback.apply(thisArg, [uri, this.get(uri), this]);
		}
	}

	get(uri: URI): ReadonlyArray<vscode.Diagnostic> {
		this._checkDisposed();
		const result = this.#data.get(uri);
		if (Array.isArray(result)) {
			return <ReadonlyArray<vscode.Diagnostic>>Object.freeze(result.slice(0));
		}
		return [];
	}

	has(uri: URI): boolean {
		this._checkDisposed();
		return Array.isArray(this.#data.get(uri));
	}

	private _checkDisposed() {
		if (this._isDisposed) {
			throw new Error('illegal state - object is disposed');
		}
	}

	private static _compareIndexedTuplesByUri(a: [vscode.Uri, readonly vscode.Diagnostic[]], b: [vscode.Uri, readonly vscode.Diagnostic[]]): number {
		if (a[0].toString() < b[0].toString()) {
			return -1;
		} else if (a[0].toString() > b[0].toString()) {
			return 1;
		} else {
			return 0;
		}
	}
}

export class ExtHostDiagnostics implements ExtHostDiagnosticsShape {

	private static _idPool: number = 0;
	private static readonly _maxDiagnosticsPerFile: number = 1000;

	private readonly _proxy: MainThreadDiagnosticsShape;
	private readonly _collections = new Map<string, DiagnosticCollection>();
	private readonly _onDidChangeDiagnostics = new DebounceEmitter<vscode.Uri[]>({ merge: all => all.flat(), delay: 50 });

	static _mapper(last: vscode.Uri[]): { uris: readonly vscode.Uri[] } {
		const map = new ResourceMap<vscode.Uri>();
		for (const uri of last) {
			map.set(uri, uri);
		}
		return { uris: Object.freeze(Array.from(map.values())) };
	}

	readonly onDidChangeDiagnostics: Event<vscode.DiagnosticChangeEvent> = Event.map(this._onDidChangeDiagnostics.event, ExtHostDiagnostics._mapper);

	constructor(
		mainContext: IMainContext,
		@ILogService private readonly _logService: ILogService,
		@IExtHostFileSystemInfo private readonly _fileSystemInfoService: IExtHostFileSystemInfo,
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadDiagnostics);
	}

	createDiagnosticCollection(extensionId: ExtensionIdentifier, name?: string): vscode.DiagnosticCollection {

		const { _collections, _proxy, _onDidChangeDiagnostics, _logService, _fileSystemInfoService } = this;

		const loggingProxy = new class implements MainThreadDiagnosticsShape {
			$changeMany(owner: string, entries: [UriComponents, IMarkerData[] | undefined][]): void {
				_proxy.$changeMany(owner, entries);
				_logService.trace('[DiagnosticCollection] change many (extension, owner, uris)', extensionId.value, owner, entries.length === 0 ? 'CLEARING' : entries);
			}
			$clear(owner: string): void {
				_proxy.$clear(owner);
				_logService.trace('[DiagnosticCollection] remove all (extension, owner)', extensionId.value, owner);
			}
			dispose(): void {
				_proxy.dispose();
			}
		};


		let owner: string;
		if (!name) {
			name = '_generated_diagnostic_collection_name_#' + ExtHostDiagnostics._idPool++;
			owner = name;
		} else if (!_collections.has(name)) {
			owner = name;
		} else {
			this._logService.warn(`DiagnosticCollection with name '${name}' does already exist.`);
			do {
				owner = name + ExtHostDiagnostics._idPool++;
			} while (_collections.has(owner));
		}

		const result = new class extends DiagnosticCollection {
			constructor() {
				super(name!, owner, ExtHostDiagnostics._maxDiagnosticsPerFile, _fileSystemInfoService.extUri, loggingProxy, _onDidChangeDiagnostics);
				_collections.set(owner, this);
			}
			override dispose() {
				super.dispose();
				_collections.delete(owner);
			}
		};

		return result;
	}

	getDiagnostics(resource: vscode.Uri): ReadonlyArray<vscode.Diagnostic>;
	getDiagnostics(): ReadonlyArray<[vscode.Uri, ReadonlyArray<vscode.Diagnostic>]>;
	getDiagnostics(resource?: vscode.Uri): ReadonlyArray<vscode.Diagnostic> | ReadonlyArray<[vscode.Uri, ReadonlyArray<vscode.Diagnostic>]>;
	getDiagnostics(resource?: vscode.Uri): ReadonlyArray<vscode.Diagnostic> | ReadonlyArray<[vscode.Uri, ReadonlyArray<vscode.Diagnostic>]> {
		if (resource) {
			return this._getDiagnostics(resource);
		} else {
			const index = new Map<string, number>();
			const res: [vscode.Uri, vscode.Diagnostic[]][] = [];
			for (const collection of this._collections.values()) {
				collection.forEach((uri, diagnostics) => {
					let idx = index.get(uri.toString());
					if (typeof idx === 'undefined') {
						idx = res.length;
						index.set(uri.toString(), idx);
						res.push([uri, []]);
					}
					res[idx][1] = res[idx][1].concat(...diagnostics);
				});
			}
			return res;
		}
	}

	private _getDiagnostics(resource: vscode.Uri): ReadonlyArray<vscode.Diagnostic> {
		let res: vscode.Diagnostic[] = [];
		for (let collection of this._collections.values()) {
			if (collection.has(resource)) {
				res = res.concat(collection.get(resource));
			}
		}
		return res;
	}

	private _mirrorCollection: vscode.DiagnosticCollection | undefined;

	$acceptMarkersChange(data: [UriComponents, IMarkerData[]][]): void {

		if (!this._mirrorCollection) {
			const name = '_generated_mirror';
			const collection = new DiagnosticCollection(name, name, ExtHostDiagnostics._maxDiagnosticsPerFile, this._fileSystemInfoService.extUri, undefined, this._onDidChangeDiagnostics);
			this._collections.set(name, collection);
			this._mirrorCollection = collection;
		}

		for (const [uri, markers] of data) {
			this._mirrorCollection.set(URI.revive(uri), markers.map(converter.Diagnostic.to));
		}
	}
}
