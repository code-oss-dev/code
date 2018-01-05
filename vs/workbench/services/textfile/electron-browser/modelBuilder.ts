/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { IStringStream } from 'vs/platform/files/common/files';
import * as strings from 'vs/base/common/strings';
import { TPromise } from 'vs/base/common/winjs.base';
import { CharCode } from 'vs/base/common/charCode';
import { ITextBufferFactory, ITextBufferBuilder } from 'vs/editor/common/model';
import { TextBufferFactory } from 'vs/editor/common/model/textBuffer';

const AVOID_SLICED_STRINGS = true;
const PREALLOC_BUFFER_CHARS = 1000;

const emptyString = '';
const asciiStrings: string[] = [];
for (let i = 0; i < 128; i++) {
	asciiStrings[i] = String.fromCharCode(i);
}

function optimizeStringMemory(buff: Buffer, s: string): string {
	const len = s.length;

	if (len === 0) {
		return emptyString;
	}

	if (len === 1) {
		const charCode = s.charCodeAt(0);
		if (charCode < 128) {
			return asciiStrings[charCode];
		}
	}

	if (AVOID_SLICED_STRINGS) {
		// See https://bugs.chromium.org/p/v8/issues/detail?id=2869
		// See https://github.com/nodejs/help/issues/711

		if (len < PREALLOC_BUFFER_CHARS) {
			// Use the same buffer instance that we have allocated and that can fit `PREALLOC_BUFFER_CHARS` characters
			const byteLen = buff.write(s, 0);
			return buff.toString(undefined, 0, byteLen);
		}

		return Buffer.from(s).toString();
	}

	return s;
}

class ModelLineBasedBuilder {

	private buff: Buffer;
	private BOM: string;
	private lines: string[];
	private currLineIndex: number;

	constructor() {
		this.BOM = '';
		this.lines = [];
		this.currLineIndex = 0;
		this.buff = Buffer.alloc(3/*any UTF16 code unit could expand to up to 3 UTF8 code units*/ * PREALLOC_BUFFER_CHARS);
	}

	public acceptLines(lines: string[]): void {
		if (this.currLineIndex === 0) {
			// Remove the BOM (if present)
			if (strings.startsWithUTF8BOM(lines[0])) {
				this.BOM = strings.UTF8_BOM_CHARACTER;
				lines[0] = lines[0].substr(1);
			}
		}

		for (let i = 0, len = lines.length; i < len; i++) {
			this.lines[this.currLineIndex++] = optimizeStringMemory(this.buff, lines[i]);
		}
	}

	public finish(length: number, carriageReturnCnt: number, containsRTL: boolean, isBasicASCII: boolean): TextBufferFactory {
		return new TextBufferFactory({
			BOM: this.BOM,
			lines: this.lines,
			length,
			containsRTL: containsRTL,
			totalCRCount: carriageReturnCnt,
			isBasicASCII,
		});
	}
}

export class ModelBuilder implements ITextBufferBuilder {

	private leftoverPrevChunk: string;
	private leftoverEndsInCR: boolean;
	private totalCRCount: number;
	private lineBasedBuilder: ModelLineBasedBuilder;
	private totalLength: number;
	private containsRTL: boolean;
	private isBasicASCII: boolean;

	public static fromStringStream(stream: IStringStream): TPromise<ITextBufferFactory> {
		return new TPromise<ITextBufferFactory>((c, e, p) => {
			let done = false;
			let builder = new ModelBuilder();

			stream.on('data', (chunk) => {
				builder.acceptChunk(chunk);
			});

			stream.on('error', (error) => {
				if (!done) {
					done = true;
					e(error);
				}
			});

			stream.on('end', () => {
				if (!done) {
					done = true;
					c(builder.finish());
				}
			});
		});
	}

	constructor() {
		this.leftoverPrevChunk = '';
		this.leftoverEndsInCR = false;
		this.totalCRCount = 0;
		this.lineBasedBuilder = new ModelLineBasedBuilder();
		this.totalLength = 0;
		this.containsRTL = false;
		this.isBasicASCII = true;
	}

	private _updateCRCount(chunk: string): void {
		// Count how many \r are present in chunk to determine the majority EOL sequence
		let chunkCarriageReturnCnt = 0;
		let lastCarriageReturnIndex = -1;
		while ((lastCarriageReturnIndex = chunk.indexOf('\r', lastCarriageReturnIndex + 1)) !== -1) {
			chunkCarriageReturnCnt++;
		}
		this.totalCRCount += chunkCarriageReturnCnt;
	}

	public acceptChunk(chunk: string): void {
		if (chunk.length === 0) {
			return;
		}
		this.totalLength += chunk.length;

		this._updateCRCount(chunk);

		if (!this.containsRTL) {
			this.containsRTL = strings.containsRTL(chunk);
		}
		if (this.isBasicASCII) {
			this.isBasicASCII = strings.isBasicASCII(chunk);
		}

		// Avoid dealing with a chunk that ends in \r (push the \r to the next chunk)
		if (this.leftoverEndsInCR) {
			chunk = '\r' + chunk;
		}
		if (chunk.charCodeAt(chunk.length - 1) === CharCode.CarriageReturn) {
			this.leftoverEndsInCR = true;
			chunk = chunk.substr(0, chunk.length - 1);
		} else {
			this.leftoverEndsInCR = false;
		}

		let lines = chunk.split(/\r\n|\r|\n/);

		if (lines.length === 1) {
			// no \r or \n encountered
			this.leftoverPrevChunk += lines[0];
			return;
		}

		lines[0] = this.leftoverPrevChunk + lines[0];
		this.lineBasedBuilder.acceptLines(lines.slice(0, lines.length - 1));
		this.leftoverPrevChunk = lines[lines.length - 1];
	}

	public finish(): TextBufferFactory {
		let finalLines = [this.leftoverPrevChunk];
		if (this.leftoverEndsInCR) {
			finalLines.push('');
		}
		this.lineBasedBuilder.acceptLines(finalLines);
		return this.lineBasedBuilder.finish(this.totalLength, this.totalCRCount, this.containsRTL, this.isBasicASCII);
	}
}
