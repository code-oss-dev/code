/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {Remotable, IThreadService} from 'vs/platform/thread/common/thread';
import {IMarkerService, IMarkerData} from 'vs/platform/markers/common/markers';
import URI from 'vs/base/common/uri';
import {TPromise} from 'vs/base/common/winjs.base';
import Severity from 'vs/base/common/severity';
import * as vscode from 'vscode';

class DiagnosticCollection implements vscode.DiagnosticCollection {

	private static _maxDiagnosticsPerFile: number = 250;

	private _name: string;
	private _proxy: MainThreadDiagnostics;

	private _isDisposed = false;
	private _data: {[uri:string]: vscode.Diagnostic[]} = Object.create(null);

	constructor(name: string, proxy: MainThreadDiagnostics) {
		this._name = name;
		this._proxy = proxy;
	}

	dispose(): void {
		if (!this._isDisposed) {
			this._isDisposed = true;
			this._proxy.$clear(this.name);
			this._proxy = undefined;
			this._data = undefined;
		}
	}

	get name(): string {
		this._checkDisposed();
		return this._name;
	}

	set(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): void;
	set(entries: [vscode.Uri, vscode.Diagnostic[]][]): void;
	set(first: vscode.Uri | [vscode.Uri, vscode.Diagnostic[]][], diagnostics?: vscode.Diagnostic[]) {

		if (!first) {
			// this set-call is a clear-call
			this.clear();
			return;
		}

		// the actual implementation for #set

		this._checkDisposed();
		let toSync: vscode.Uri[];

		if (first instanceof URI) {
			// update single row
			this._data[first.toString()] = diagnostics;
			toSync = [first];

		} else if (Array.isArray(first)) {
			// update many rows
			toSync = [];
			for (let entry of first) {
				let [uri, diagnostics] = entry;
				this._data[uri.toString()] = diagnostics;
				toSync.push(uri);
			}
		}

		// compute change and send to main side
		const entries: [URI, IMarkerData[]][] = [];
		for (let uri of toSync) {
			let marker: IMarkerData[];
			let diagnostics = this._data[uri.toString()];
			if (diagnostics) {

				// no more than 250 diagnostics per file
				if (diagnostics.length > DiagnosticCollection._maxDiagnosticsPerFile) {
					console.warn('diagnostics for %s will be capped to %d (actually is %d)', uri, DiagnosticCollection._maxDiagnosticsPerFile, diagnostics.length);
					diagnostics = diagnostics.slice(0, DiagnosticCollection._maxDiagnosticsPerFile);
				}
				marker = diagnostics.map(DiagnosticCollection._toMarkerData);
			}

			entries.push([<URI> uri, marker]);
		}

		this._proxy.$changeMany(this.name, entries);
	}

	delete(uri: vscode.Uri): void {
		this._checkDisposed();
		delete this._data[uri.toString()];
		this._proxy.$changeMany(this.name, [[<URI> uri, undefined]]);
	}

	clear(): void {
		this._checkDisposed();
		this._data = Object.create(null);
		this._proxy.$clear(this.name);
	}

	private _checkDisposed() {
		if (this._isDisposed) {
			throw new Error('illegal state - object is disposed');
		}
	}

	private static _toMarkerData(diagnostic: vscode.Diagnostic): IMarkerData {

		let range = diagnostic.range;

		return <IMarkerData>{
			startLineNumber: range.start.line + 1,
			startColumn: range.start.character + 1,
			endLineNumber: range.end.line + 1,
			endColumn: range.end.character + 1,
			message: diagnostic.message,
			source: diagnostic.source,
			severity: DiagnosticCollection._convertDiagnosticsSeverity(diagnostic.severity),
			code: String(diagnostic.code)
		};
	}

	private static _convertDiagnosticsSeverity(severity: number): Severity {
		switch (severity) {
			case 0: return Severity.Error;
			case 1: return Severity.Warning;
			case 2: return Severity.Info;
			case 3: return Severity.Ignore;
			default: return Severity.Error;
		}
	}
}

export class ExtHostDiagnostics {

	private static _idPool: number = 0;
	private _proxy: MainThreadDiagnostics;

	constructor(threadService: IThreadService) {
		this._proxy = threadService.getRemotable(MainThreadDiagnostics);
	}

	createDiagnosticCollection(name: string): vscode.DiagnosticCollection {
		if (!name) {
			name = '_generated_diagnostic_collection_name_#' + ExtHostDiagnostics._idPool++;
		}
		return new DiagnosticCollection(name, this._proxy);
	}
}

@Remotable.MainContext('MainThreadDiagnostics')
export class MainThreadDiagnostics {

	private _markerService: IMarkerService;

	constructor(@IMarkerService markerService: IMarkerService) {
		this._markerService = markerService;
	}

	$changeMany(owner: string, entries: [URI, IMarkerData[]][]): TPromise<any> {
		for (let entry of entries) {
			let [uri, markers] = entry;
			this._markerService.changeOne(owner, uri, markers);
		}
		return undefined;
	}

	$clear(owner: string): TPromise<any> {
		this._markerService.changeAll(owner, undefined);
		return undefined;
	}
}
