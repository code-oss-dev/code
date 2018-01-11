/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { DefaultEndOfLine } from 'vs/editor/common/model';

/**
 * Raw text buffer for Piece Table.
 */
export interface IRawPTBuffer {
	text: string;
	lineStarts: number[];
}

/**
 * A processed string ready to be turned into an editor model.
 */
export interface IRawTextSource {
	/**
	 * The text split into lines.
	 */
	readonly chunks: IRawPTBuffer[];
	readonly lineFeedCnt: number;
	/**
	 * The BOM (leading character sequence of the file).
	 */
	readonly BOM: string;
	/**
	 * The number of lines ending with '\r\n'
	 */
	readonly totalCRCount: number;
	/**
	 * The text contains Unicode characters classified as "R" or "AL".
	 */
	readonly containsRTL: boolean;
	/**
	 * The text contains only characters inside the ASCII range 32-126 or \t \r \n
	 */
	readonly isBasicASCII: boolean;
}

/**
 * A processed string with its EOL resolved ready to be turned into an editor model.
 */
export interface ITextSource {
	/**
	 * The text split into lines.
	 */
	readonly chunks: IRawPTBuffer[];
	readonly lineFeedCnt: number;
	/**
	 * The BOM (leading character sequence of the file).
	 */
	readonly BOM: string;
	/**
	 * The end of line sequence.
	 */
	readonly EOL: string;
	/**
	 * The text contains Unicode characters classified as "R" or "AL".
	 */
	readonly containsRTL: boolean;
	/**
	 * The text contains only characters inside the ASCII range 32-126 or \t \r \n
	 */
	readonly isBasicASCII: boolean;
}

export class TextSource {

	/**
	 * if text source is empty or with precisely one line, returns null. No end of line is detected.
	 * if text source contains more lines ending with '\r\n', returns '\r\n'.
	 * Otherwise returns '\n'. More lines end with '\n'.
	 */
	private static _getEOL(rawTextSource: IRawTextSource, defaultEOL: DefaultEndOfLine): '\r\n' | '\n' {
		let lineFeedCnt = rawTextSource.lineFeedCnt;
		// const lineFeedCnt = rawTextSource.lines.length - 1;
		if (lineFeedCnt === 0) {
			// This is an empty file or a file with precisely one line
			return (defaultEOL === DefaultEndOfLine.LF ? '\n' : '\r\n');
		}
		if (rawTextSource.totalCRCount > lineFeedCnt / 2) {
			// More than half of the file contains \r\n ending lines
			return '\r\n';
		}
		// At least one line more ends in \n
		return '\n';
	}

	public static fromRawTextSource(rawTextSource: IRawTextSource, defaultEOL: DefaultEndOfLine): ITextSource {
		return {
			chunks: rawTextSource.chunks,
			lineFeedCnt: rawTextSource.lineFeedCnt,
			BOM: rawTextSource.BOM,
			EOL: this._getEOL(rawTextSource, defaultEOL),
			containsRTL: rawTextSource.containsRTL,
			isBasicASCII: rawTextSource.isBasicASCII,
		};
	}
}
