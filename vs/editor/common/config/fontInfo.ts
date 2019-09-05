/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/base/common/platform';
import { EDITOR_FONT_DEFAULTS, EditorOptions, ValidatedEditorOptions, EditorOption } from 'vs/editor/common/config/editorOptions';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';

/**
 * Determined from empirical observations.
 * @internal
 */
const GOLDEN_LINE_HEIGHT_RATIO = platform.isMacintosh ? 1.5 : 1.35;

/**
 * Font settings maximum and minimum limits
 */
const MINIMUM_FONT_SIZE = 8;
const MINIMUM_LINE_HEIGHT = 8;

export class BareFontInfo {
	readonly _bareFontInfoBrand: void;

	/**
	 * @internal
	 */
	public static createFromValidatedSettings(options: ValidatedEditorOptions, zoomLevel: number, ignoreEditorZoom: boolean): BareFontInfo {
		const fontFamily = options.get(EditorOption.fontFamily);
		const fontWeight = options.get(EditorOption.fontWeight);
		const fontSize = options.get(EditorOption.fontSize);
		const lineHeight = options.get(EditorOption.lineHeight);
		const letterSpacing = options.get(EditorOption.letterSpacing);
		return BareFontInfo._create(fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, zoomLevel, ignoreEditorZoom);
	}

	/**
	 * @internal
	 */
	public static createFromRawSettings(opts: { fontFamily?: string; fontWeight?: string; fontSize?: number; lineHeight?: number; letterSpacing?: number; }, zoomLevel: number, ignoreEditorZoom: boolean = false): BareFontInfo {
		const fontFamily = EditorOptions.fontFamily.validate(opts.fontFamily);
		const fontWeight = EditorOptions.fontWeight.validate(opts.fontWeight);
		const fontSize = EditorOptions.fontSize.validate(opts.fontSize);
		const lineHeight = EditorOptions.lineHeight.validate(opts.lineHeight);
		const letterSpacing = EditorOptions.letterSpacing.validate(opts.letterSpacing);
		return BareFontInfo._create(fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, zoomLevel, ignoreEditorZoom);
	}

	/**
	 * @internal
	 */
	private static _create(fontFamily: string, fontWeight: string, fontSize: number, lineHeight: number, letterSpacing: number, zoomLevel: number, ignoreEditorZoom: boolean): BareFontInfo {
		if (fontSize === 0) {
			fontSize = EDITOR_FONT_DEFAULTS.fontSize;
		} else if (fontSize < MINIMUM_FONT_SIZE) {
			fontSize = MINIMUM_FONT_SIZE;
		}

		if (lineHeight === 0) {
			lineHeight = Math.round(GOLDEN_LINE_HEIGHT_RATIO * fontSize);
		} else if (lineHeight < MINIMUM_LINE_HEIGHT) {
			lineHeight = MINIMUM_LINE_HEIGHT;
		}

		const editorZoomLevelMultiplier = 1 + (ignoreEditorZoom ? 0 : EditorZoom.getZoomLevel() * 0.1);
		fontSize *= editorZoomLevelMultiplier;
		lineHeight *= editorZoomLevelMultiplier;

		return new BareFontInfo({
			zoomLevel: zoomLevel,
			fontFamily: fontFamily,
			fontWeight: fontWeight,
			fontSize: fontSize,
			lineHeight: lineHeight,
			letterSpacing: letterSpacing
		});
	}

	readonly zoomLevel: number;
	readonly fontFamily: string;
	readonly fontWeight: string;
	readonly fontSize: number;
	readonly lineHeight: number;
	readonly letterSpacing: number;

	/**
	 * @internal
	 */
	protected constructor(opts: {
		zoomLevel: number;
		fontFamily: string;
		fontWeight: string;
		fontSize: number;
		lineHeight: number;
		letterSpacing: number;
	}) {
		this.zoomLevel = opts.zoomLevel;
		this.fontFamily = String(opts.fontFamily);
		this.fontWeight = String(opts.fontWeight);
		this.fontSize = opts.fontSize;
		this.lineHeight = opts.lineHeight | 0;
		this.letterSpacing = opts.letterSpacing;
	}

	/**
	 * @internal
	 */
	public getId(): string {
		return this.zoomLevel + '-' + this.fontFamily + '-' + this.fontWeight + '-' + this.fontSize + '-' + this.lineHeight + '-' + this.letterSpacing;
	}

	/**
	 * @internal
	 */
	public getMassagedFontFamily(): string {
		if (/[,"']/.test(this.fontFamily)) {
			// Looks like the font family might be already escaped
			return this.fontFamily;
		}
		if (/[+ ]/.test(this.fontFamily)) {
			// Wrap a font family using + or <space> with quotes
			return `"${this.fontFamily}"`;
		}

		return this.fontFamily;
	}
}

export class FontInfo extends BareFontInfo {
	readonly _editorStylingBrand: void;

	readonly isTrusted: boolean;
	readonly isMonospace: boolean;
	readonly typicalHalfwidthCharacterWidth: number;
	readonly typicalFullwidthCharacterWidth: number;
	readonly canUseHalfwidthRightwardsArrow: boolean;
	readonly spaceWidth: number;
	readonly maxDigitWidth: number;

	/**
	 * @internal
	 */
	constructor(opts: {
		zoomLevel: number;
		fontFamily: string;
		fontWeight: string;
		fontSize: number;
		lineHeight: number;
		letterSpacing: number;
		isMonospace: boolean;
		typicalHalfwidthCharacterWidth: number;
		typicalFullwidthCharacterWidth: number;
		canUseHalfwidthRightwardsArrow: boolean;
		spaceWidth: number;
		maxDigitWidth: number;
	}, isTrusted: boolean) {
		super(opts);
		this.isTrusted = isTrusted;
		this.isMonospace = opts.isMonospace;
		this.typicalHalfwidthCharacterWidth = opts.typicalHalfwidthCharacterWidth;
		this.typicalFullwidthCharacterWidth = opts.typicalFullwidthCharacterWidth;
		this.canUseHalfwidthRightwardsArrow = opts.canUseHalfwidthRightwardsArrow;
		this.spaceWidth = opts.spaceWidth;
		this.maxDigitWidth = opts.maxDigitWidth;
	}

	/**
	 * @internal
	 */
	public equals(other: FontInfo): boolean {
		return (
			this.fontFamily === other.fontFamily
			&& this.fontWeight === other.fontWeight
			&& this.fontSize === other.fontSize
			&& this.lineHeight === other.lineHeight
			&& this.letterSpacing === other.letterSpacing
			&& this.typicalHalfwidthCharacterWidth === other.typicalHalfwidthCharacterWidth
			&& this.typicalFullwidthCharacterWidth === other.typicalFullwidthCharacterWidth
			&& this.canUseHalfwidthRightwardsArrow === other.canUseHalfwidthRightwardsArrow
			&& this.spaceWidth === other.spaceWidth
			&& this.maxDigitWidth === other.maxDigitWidth
		);
	}
}
