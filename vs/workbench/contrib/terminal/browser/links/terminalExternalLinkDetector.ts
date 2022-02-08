/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalLinkDetector, ITerminalSimpleLink, OmitFirstArg } from 'vs/workbench/contrib/terminal/browser/links/links';
import { convertLinkRangeToBuffer, getXtermLineContent } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkHelpers';
import { ITerminalExternalLinkProvider } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IBufferLine, Terminal } from 'xterm';

const enum Constants {
	/**
	 * The max line length to try extract word links from.
	 */
	MaxLineLength = 2000
}

export class TerminalExternalLinkDetector implements ITerminalLinkDetector {
	constructor(
		readonly id: string,
		readonly xterm: Terminal,
		private readonly _provideLinks: OmitFirstArg<ITerminalExternalLinkProvider['provideLinks']>
	) {
	}

	async detect(lines: IBufferLine[], startLine: number, endLine: number): Promise<ITerminalSimpleLink[]> {
		// Get the text representation of the wrapped line
		const text = getXtermLineContent(this.xterm.buffer.active, startLine, endLine, this.xterm.cols);
		if (text === '' || text.length > Constants.MaxLineLength) {
			return [];
		}

		const externalLinks = await this._provideLinks(text);
		if (!externalLinks) {
			return [];
		}

		const result = externalLinks.map(link => {
			const bufferRange = convertLinkRangeToBuffer(lines, this.xterm.cols, {
				startColumn: link.startIndex + 1,
				startLineNumber: 1,
				endColumn: link.startIndex + link.length + 1,
				endLineNumber: 1
			}, startLine);
			const matchingText = text.substring(link.startIndex, link.startIndex + link.length) || '';

			const l: ITerminalSimpleLink = {
				text: matchingText,
				label: link.label,
				bufferRange,
				type: { id: this.id },
				activate: link.activate
			};
			return l;
		});

		return result;
	}
}
