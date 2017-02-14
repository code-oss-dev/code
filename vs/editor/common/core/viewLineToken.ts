/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { ColorId } from 'vs/editor/common/modes';
import { TokenMetadata } from 'vs/editor/common/model/tokensBinaryEncoding';

/**
 * A token on a line.
 */
export class ViewLineToken {
	_viewLineTokenBrand: void;

	/**
	 * last char index of this token (not inclusive).
	 */
	public readonly endIndex: number;
	public readonly type: string;

	constructor(endIndex: number, type: string) {
		this.endIndex = endIndex;
		this.type = type;
	}

	private static _equals(a: ViewLineToken, b: ViewLineToken): boolean {
		return (
			a.endIndex === b.endIndex
			&& a.type === b.type
		);
	}

	public static equalsArr(a: ViewLineToken[], b: ViewLineToken[]): boolean {
		const aLen = a.length;
		const bLen = b.length;
		if (aLen !== bLen) {
			return false;
		}
		for (let i = 0; i < aLen; i++) {
			if (!this._equals(a[i], b[i])) {
				return false;
			}
		}
		return true;
	}
}

/**
 * A token on a line.
 */
export class ViewLineToken2 {
	_viewLineToken2Brand: void;

	/**
	 * last char index of this token (not inclusive).
	 */
	public readonly endIndex: number;
	private readonly _metadata: number;

	constructor(endIndex: number, metadata: number) {
		this.endIndex = endIndex;
		this._metadata = metadata;
	}

	public getForeground(): ColorId {
		return TokenMetadata.getForeground(this._metadata);
	}

	public getType(): string {
		return TokenMetadata.getClassNameFromMetadata(this._metadata);
	}

	private static _equals(a: ViewLineToken2, b: ViewLineToken2): boolean {
		return (
			a.endIndex === b.endIndex
			&& a._metadata === b._metadata
		);
	}

	public static equalsArr(a: ViewLineToken2[], b: ViewLineToken2[]): boolean {
		const aLen = a.length;
		const bLen = b.length;
		if (aLen !== bLen) {
			return false;
		}
		for (let i = 0; i < aLen; i++) {
			if (!this._equals(a[i], b[i])) {
				return false;
			}
		}
		return true;
	}
}

export class ViewLineTokenFactory {

	public static inflateArr(tokens: Uint32Array, lineLength: number): ViewLineToken[] {
		let result: ViewLineToken[] = [];

		for (let i = 0, len = (tokens.length >>> 1); i < len; i++) {
			let endOffset = (i + 1 < len ? tokens[((i + 1) << 1)] : lineLength);
			let metadata = tokens[(i << 1) + 1];

			result[i] = new ViewLineToken(endOffset, TokenMetadata.getClassNameFromMetadata(metadata));
		}

		return result;
	}

	public static inflateArr2(tokens: Uint32Array, lineLength: number): ViewLineToken2[] {
		let result: ViewLineToken2[] = [];

		for (let i = 0, len = (tokens.length >>> 1); i < len; i++) {
			let endOffset = (i + 1 < len ? tokens[((i + 1) << 1)] : lineLength);
			let metadata = tokens[(i << 1) + 1];

			result[i] = new ViewLineToken2(endOffset, metadata);
		}

		return result;
	}

	public static sliceAndInflate(tokens: Uint32Array, startOffset: number, endOffset: number, deltaOffset: number, lineLength: number): ViewLineToken[] {
		let tokenIndex = this.findIndexInSegmentsArray(tokens, startOffset);
		let result: ViewLineToken[] = [], resultLen = 0;

		for (let i = tokenIndex, len = (tokens.length >>> 1); i < len; i++) {
			let tokenStartOffset = tokens[(i << 1)];

			if (tokenStartOffset >= endOffset) {
				break;
			}

			let tokenEndOffset = (i + 1 < len ? tokens[((i + 1) << 1)] : lineLength);
			let newEndOffset = tokenEndOffset - startOffset + deltaOffset;
			let metadata = tokens[(i << 1) + 1];

			result[resultLen++] = new ViewLineToken(newEndOffset, TokenMetadata.getClassNameFromMetadata(metadata));
		}

		return result;
	}

	public static sliceAndInflate2(tokens: Uint32Array, startOffset: number, endOffset: number, deltaOffset: number, lineLength: number): ViewLineToken2[] {
		let tokenIndex = this.findIndexInSegmentsArray(tokens, startOffset);
		let result: ViewLineToken2[] = [], resultLen = 0;

		for (let i = tokenIndex, len = (tokens.length >>> 1); i < len; i++) {
			let tokenStartOffset = tokens[(i << 1)];

			if (tokenStartOffset >= endOffset) {
				break;
			}

			let tokenEndOffset = (i + 1 < len ? tokens[((i + 1) << 1)] : lineLength);
			let newEndOffset = tokenEndOffset - startOffset + deltaOffset;
			let metadata = tokens[(i << 1) + 1];

			result[resultLen++] = new ViewLineToken2(newEndOffset, metadata);
		}

		return result;
	}

	public static findIndexInSegmentsArray(tokens: Uint32Array, desiredIndex: number): number {

		let low = 0;
		let high = (tokens.length >>> 1) - 1;

		while (low < high) {

			let mid = low + Math.ceil((high - low) / 2);

			let value = tokens[(mid << 1)];

			if (value > desiredIndex) {
				high = mid - 1;
			} else {
				low = mid;
			}
		}

		return low;
	}
}
