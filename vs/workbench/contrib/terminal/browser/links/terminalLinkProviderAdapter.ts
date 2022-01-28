/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITerminalSimpleLink, ITerminalLinkDetector, TerminalLinkType } from 'vs/workbench/contrib/terminal/browser/links/links';
import { TerminalLink } from 'vs/workbench/contrib/terminal/browser/links/terminalLink';
import { XtermLinkMatcherHandler } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkManager';
import { IBufferLine, ILink, ILinkProvider } from 'xterm';

/**
 * Wrap a link detector object so it can be used in xterm.js
 */
export class TerminalLinkProviderAdapter extends Disposable implements ILinkProvider {
	private _activeLinks: TerminalLink[] | undefined;

	private readonly _onDidActivateLink = this._register(new Emitter<ITerminalSimpleLink>());
	readonly onDidActivateLink = this._onDidActivateLink.event;

	constructor(
		private readonly _detector: ITerminalLinkDetector,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	async provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
		this._activeLinks?.forEach(l => l.dispose());
		this._activeLinks = await this._provideLinks(bufferLineNumber);
		callback(this._activeLinks);
	}

	private async _provideLinks(bufferLineNumber: number): Promise<TerminalLink[]> {
		// Dispose of all old links if new links are provides, links are only cached for the current line
		const links: TerminalLink[] = [];

		let startLine = bufferLineNumber - 1;
		let endLine = startLine;

		const lines: IBufferLine[] = [
			this._detector.xterm.buffer.active.getLine(startLine)!
		];

		while (startLine >= 0 && this._detector.xterm.buffer.active.getLine(startLine)?.isWrapped) {
			lines.unshift(this._detector.xterm.buffer.active.getLine(startLine - 1)!);
			startLine--;
		}

		while (endLine < this._detector.xterm.buffer.active.length && this._detector.xterm.buffer.active.getLine(endLine + 1)?.isWrapped) {
			lines.push(this._detector.xterm.buffer.active.getLine(endLine + 1)!);
			endLine++;
		}

		const detectedLinks = await this._detector.detect(startLine, endLine);
		for (const l of detectedLinks) {
			// TODO: This probably shouldn't be async
			links.push(this._createTerminalLink(l, async () => {
				this._onDidActivateLink.fire(l);
			}));
		}

		return links;
	}

	private _createTerminalLink(l: ITerminalSimpleLink, activateCallback: XtermLinkMatcherHandler): TerminalLink {
		// Remove trailing colon if there is one so the link is more useful
		if (l.text.length > 0 && l.text.charAt(l.text.length - 1) === ':') {
			l.text = l.text.slice(0, -1);
			l.bufferRange.end.x--;
		}
		return this._instantiationService.createInstance(TerminalLink,
			this._detector.xterm,
			l.bufferRange,
			l.text,
			this._detector.xterm.buffer.active.viewportY,
			activateCallback,
			// TODO: Handle tooltip
			() => { },
			// this._tooltipCallback,
			false,
			// TODO: Move this into TerminalLink?
			this._getLabel(l.type)
		);
	}

	private _getLabel(type: TerminalLinkType): string {
		switch (type) {
			case TerminalLinkType.Search: localize('searchWorkspace', 'Search workspace');
			default:
				return 'TODO'; // TODO
		}
	}
}
