/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkerService, IMarkerData } from 'vs/platform/markers/common/markers';
import { URI, UriComponents } from 'vs/base/common/uri';
import { MainThreadDiagnosticsShape, MainContext, IExtHostContext, ExtHostDiagnosticsShape, ExtHostContext } from '../common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IDisposable } from 'vs/base/common/lifecycle';

@extHostNamedCustomer(MainContext.MainThreadDiagnostics)
export class MainThreadDiagnostics implements MainThreadDiagnosticsShape {

	private readonly _activeOwners = new Set<string>();

	private readonly _proxy: ExtHostDiagnosticsShape;
	private readonly _markerService: IMarkerService;
	private readonly _markerListener: IDisposable;

	constructor(
		extHostContext: IExtHostContext,
		@IMarkerService markerService: IMarkerService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostDiagnostics);
		this._markerService = markerService;
		this._markerListener = this._markerService.onMarkerChanged(this._forwardMarkers, this);
	}

	dispose(): void {
		this._markerListener.dispose();
		this._activeOwners.forEach(owner => this._markerService.changeAll(owner, []));
		this._activeOwners.clear();
	}

	private _forwardMarkers(resources: URI[]): void {
		const data: [UriComponents, IMarkerData[]][] = [];
		for (const resource of resources) {
			data.push([
				resource,
				this._markerService.read({ resource }).filter(marker => !this._activeOwners.has(marker.owner))
			]);
		}
		this._proxy.$acceptMarkersChange(data);
	}

	$changeMany(owner: string, entries: [UriComponents, IMarkerData[]][]): void {
		for (let entry of entries) {
			let [uri, markers] = entry;
			if (markers) {
				for (const marker of markers) {
					if (marker.relatedInformation) {
						for (const relatedInformation of marker.relatedInformation) {
							relatedInformation.resource = URI.revive(relatedInformation.resource);
						}
					}
				}
			}
			this._markerService.changeOne(owner, URI.revive(uri), markers);
		}
		this._activeOwners.add(owner);
	}

	$clear(owner: string): void {
		this._markerService.changeAll(owner, []);
		this._activeOwners.delete(owner);
	}
}
