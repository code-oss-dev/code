/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OnBeforeRequestListenerDetails, session, webContents } from 'electron';
import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { IAddress } from 'vs/platform/remote/common/remoteAgentConnection';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { webviewPartitionId } from 'vs/platform/webview/common/resourceLoader';
import { IWebviewPortMapping, WebviewPortMappingManager } from 'vs/platform/webview/common/webviewPortMapping';

interface OnBeforeRequestListenerDetails_Extended extends OnBeforeRequestListenerDetails {
	readonly lastCommittedOrigin?: string;
}

interface PortMappingData {
	readonly extensionLocation: URI | undefined;
	readonly mappings: readonly IWebviewPortMapping[];
	readonly resolvedAuthority: IAddress | null | undefined;
}

interface WebviewData {
	readonly manager: WebviewPortMappingManager;
	readonly metadata: PortMappingData;
}

export class WebviewPortMappingProvider extends Disposable {

	private readonly _webviewData = new Map<string, WebviewData>();

	constructor(
		@ITunnelService private readonly _tunnelService: ITunnelService,
	) {
		super();

		const sess = session.fromPartition(webviewPartitionId);
		sess.webRequest.onBeforeRequest({
			urls: [
				'*://localhost:*/*',
				'*://127.0.0.1:*/*',
				'*://0.0.0.0:*/*',
			]
		}, async (details: OnBeforeRequestListenerDetails_Extended, callback) => {
			let webviewId: string | undefined;
			try {
				if (details.lastCommittedOrigin) {
					const origin = URI.parse(details.lastCommittedOrigin);
					webviewId = origin.authority;
				} else if (typeof details.webContentsId === 'number') {
					const contents = webContents.fromId(details.webContentsId);
					const url = URI.parse(contents.getURL());
					if (url.scheme === Schemas.vscodeWebview) {
						webviewId = url.authority;
					}
				}
			} catch {
				return callback({});
			}

			if (!webviewId) {
				return callback({});
			}

			const entry = this._webviewData.get(webviewId);
			if (!entry) {
				return callback({});
			}

			const redirect = await entry.manager.getRedirect(entry.metadata.resolvedAuthority, details.url);
			return callback(redirect ? { redirectURL: redirect } : {});
		});
	}

	public async registerWebview(id: string, metadata: PortMappingData): Promise<void> {
		const manager = new WebviewPortMappingManager(
			() => this._webviewData.get(id)?.metadata.extensionLocation,
			() => this._webviewData.get(id)?.metadata.mappings || [],
			this._tunnelService);

		this._webviewData.set(id, { metadata, manager });
	}

	public unregisterWebview(id: string): void {
		const existing = this._webviewData.get(id);
		if (existing) {
			existing.manager.dispose();
			this._webviewData.delete(id);
		}
	}

	public async updateWebviewMetadata(id: string, metadataDelta: Partial<PortMappingData>): Promise<void> {
		const entry = this._webviewData.get(id);
		if (entry) {
			this._webviewData.set(id, {
				...entry,
				...metadataDelta,
			});
		}
	}
}
