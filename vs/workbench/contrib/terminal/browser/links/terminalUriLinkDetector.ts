/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import { withUndefinedAsNull } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { ILinkComputerTarget, LinkComputer } from 'vs/editor/common/languages/linkComputer';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ITerminalLinkDetector, ITerminalSimpleLink, TerminalLinkType } from 'vs/workbench/contrib/terminal/browser/links/links';
import { convertLinkRangeToBuffer, getXtermLineContent } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkHelpers';
import { IBufferLine, Terminal } from 'xterm';

// TODO: Share caching code with local link detector
const cachedValidatedLinks = new Map<string, { uri: URI, link: string, isDirectory: boolean } | null>();

export class TerminalUriLinkDetector implements ITerminalLinkDetector {
	static id = 'uri';

	private _cacheTilTimeout = 0;
	protected _enableCaching = true;

	constructor(
		readonly xterm: Terminal,
		private readonly _resolvePath: (link: string, uri?: URI) => Promise<{ uri: URI, link: string, isDirectory: boolean } | undefined>,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
	) {
	}

	async detect(lines: IBufferLine[], startLine: number, endLine: number): Promise<ITerminalSimpleLink[]> {
		const links: ITerminalSimpleLink[] = [];

		// Reset cached link TTL
		if (this._enableCaching) {
			if (this._cacheTilTimeout) {
				window.clearTimeout(this._cacheTilTimeout);
			}
			this._cacheTilTimeout = window.setTimeout(() => cachedValidatedLinks.clear(), 10000);
		}

		const linkComputerTarget = new TerminalLinkAdapter(this.xterm, startLine, endLine);
		const computedLinks = LinkComputer.computeLinks(linkComputerTarget);

		for (const computedLink of computedLinks) {
			const bufferRange = convertLinkRangeToBuffer(lines, this.xterm.cols, computedLink.range, startLine);

			// Check if the link is within the mouse position
			const uri = computedLink.url
				? (typeof computedLink.url === 'string' ? URI.parse(computedLink.url) : computedLink.url)
				: undefined;

			if (!uri) {
				continue;
			}

			const text = computedLink.url?.toString() || '';

			// Handle non-file scheme links
			if (uri.scheme !== Schemas.file) {
				links.push({
					text,
					uri,
					bufferRange,
					type: TerminalLinkType.Url
				});
				continue;
			}

			// Filter out any URI with an authority, none are supported currently
			if (uri.authority !== '') {
				continue;
			}

			let linkStat = cachedValidatedLinks.get(text);

			// The link is cached as doesn't exist
			if (linkStat === null) {
				continue;
			}

			// The link isn't cached
			if (linkStat === undefined) {
				const linkStat = await this._resolvePath(text, uri);
				if (this._enableCaching) {
					cachedValidatedLinks.set(text, withUndefinedAsNull(linkStat));
				}
			}

			// Create the link if validated
			if (linkStat) {
				let type: TerminalLinkType;
				if (linkStat.isDirectory) {
					if (this._isDirectoryInsideWorkspace(linkStat.uri)) {
						type = TerminalLinkType.LocalFolderInWorkspace;
					} else {
						type = TerminalLinkType.LocalFolderOutsideWorkspace;
					}
				} else {
					type = TerminalLinkType.LocalFile;
				}
				links.push({
					text: linkStat.link,
					uri: linkStat.uri,
					bufferRange,
					type
				});
			}
		}

		return links;
	}

	private _isDirectoryInsideWorkspace(uri: URI) {
		const folders = this._workspaceContextService.getWorkspace().folders;
		for (let i = 0; i < folders.length; i++) {
			if (this._uriIdentityService.extUri.isEqualOrParent(uri, folders[i].uri)) {
				return true;
			}
		}
		return false;
	}
}

class TerminalLinkAdapter implements ILinkComputerTarget {
	constructor(
		private _xterm: Terminal,
		private _lineStart: number,
		private _lineEnd: number
	) { }

	getLineCount(): number {
		return 1;
	}

	getLineContent(): string {
		return getXtermLineContent(this._xterm.buffer.active, this._lineStart, this._lineEnd, this._xterm.cols);
	}
}
