/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';

export class RGBA {
	_rgbaBrand: void;

	/**
	 * Red: integer in [0-255]
	 */
	readonly r: number;
	/**
	 * Green: integer in [0-255]
	 */
	readonly g: number;
	/**
	 * Blue: integer in [0-255]
	 */
	readonly b: number;
	/**
	 * Alpha: integer in [0-255]
	 */
	readonly a: number;

	constructor(r: number, g: number, b: number, a: number = 255) {
		this.r = RGBA._clampInt_0_255(r);
		this.g = RGBA._clampInt_0_255(g);
		this.b = RGBA._clampInt_0_255(b);
		this.a = RGBA._clampInt_0_255(a);
	}

	static equals(a: RGBA, b: RGBA): boolean {
		return (
			a.r === b.r
			&& a.g === b.g
			&& a.b === b.b
			&& a.a === b.a
		);
	}

	private static _clampInt_0_255(c: number): number {
		if (c < 0) {
			return 0;
		}
		if (c > 255) {
			return 255;
		}
		return c | 0;
	}
}

/**
 * http://en.wikipedia.org/wiki/HSL_color_space
 */
export class HSLA {
	_hslaBrand: void;

	/**
	 * Hue: float in [0, 360]
	 */
	readonly h: number;
	/**
	 * Saturation: float in [0, 1]
	 */
	readonly s: number;
	/**
	 * Luminosity: float in [0, 1]
	 */
	readonly l: number;
	/**
	 * Alpha: float in [0, 1]
	 */
	readonly a: number;

	constructor(h: number, s: number, l: number, a: number) {
		this.h = HSLA._clampFloat_0_360(h);
		this.s = HSLA._clampFloat_0_1(s);
		this.l = HSLA._clampFloat_0_1(l);
		this.a = HSLA._clampFloat_0_1(a);
	}

	private static _clampFloat_0_360(hue: number): number {
		if (hue < 0) {
			return 0.0;
		}
		if (hue > 360) {
			return 360.0;
		}
		return hue;
	}

	private static _clampFloat_0_1(n: number): number {
		if (n < 0) {
			return 0.0;
		}
		if (n > 1) {
			return 1.0;
		}
		return n;
	}
}

const colorPattern = /^#[0-9A-Fa-f]{3,8}$/i;

export function isValidHexColor(hex: string): boolean {
	return colorPattern.test(hex) && hex.length !== 6 && hex.length !== 8;
}

function _parseHexDigit(charCode: CharCode): number {
	switch (charCode) {
		case CharCode.Digit0: return 0;
		case CharCode.Digit1: return 1;
		case CharCode.Digit2: return 2;
		case CharCode.Digit3: return 3;
		case CharCode.Digit4: return 4;
		case CharCode.Digit5: return 5;
		case CharCode.Digit6: return 6;
		case CharCode.Digit7: return 7;
		case CharCode.Digit8: return 8;
		case CharCode.Digit9: return 9;
		case CharCode.a: return 10;
		case CharCode.A: return 10;
		case CharCode.b: return 11;
		case CharCode.B: return 11;
		case CharCode.c: return 12;
		case CharCode.C: return 12;
		case CharCode.d: return 13;
		case CharCode.D: return 13;
		case CharCode.e: return 14;
		case CharCode.E: return 14;
		case CharCode.f: return 15;
		case CharCode.F: return 15;
	}
	return 0;
}

/**
 * Converts an RGB color value to HSL. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h in the set [0, 360], s, and l in the set [0, 1].
 */
function rgba2hsla(rgba: RGBA): HSLA {
	const r = rgba.r / 255;
	const g = rgba.g / 255;
	const b = rgba.b / 255;
	const a = rgba.a / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	const l = Math.round(((min + max) / 2) * 1000) / 1000;
	const chroma = max - min;

	if (chroma > 0) {
		s = Math.min(Math.round((l <= 0.5 ? chroma / (2 * l) : chroma / (2 - (2 * l))) * 1000) / 1000, 1);
		switch (max) {
			case r: h = (g - b) / chroma + (g < b ? 6 : 0); break;
			case g: h = (b - r) / chroma + 2; break;
			case b: h = (r - g) / chroma + 4; break;
		}
		h *= 60;
		h = Math.round(h);
	}
	return new HSLA(h, s, l, a);
}

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h in the set [0, 360] s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 255].
 */
function hsla2rgba(hsla: HSLA): RGBA {
	const h = hsla.h / 360;
	const s = Math.min(hsla.s, 1);
	const l = Math.min(hsla.l, 1);
	const a = hsla.a;
	let r: number, g: number, b: number;

	if (s === 0) {
		r = g = b = l; // achromatic
	} else {
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = _hue2rgb(p, q, h + 1 / 3);
		g = _hue2rgb(p, q, h);
		b = _hue2rgb(p, q, h - 1 / 3);
	}

	return new RGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(a * 255));
}

function _hue2rgb(p: number, q: number, t: number) {
	if (t < 0) {
		t += 1;
	}
	if (t > 1) {
		t -= 1;
	}
	if (t < 1 / 6) {
		return p + (q - p) * 6 * t;
	}
	if (t < 1 / 2) {
		return q;
	}
	if (t < 2 / 3) {
		return p + (q - p) * (2 / 3 - t) * 6;
	}
	return p;
}

function _toTwoDigitHex(n: number): string {
	const r = n.toString(16);
	return r.length !== 2 ? '0' + r : r;
}

export class Color {

	/**
	 * Creates a color from a hex string (#RRGGBB or #RRGGBBAA).
	 */
	static fromHex(hex: string): Color {
		return Color.Format.CSS.parseHexH(hex);
	}

	/**
	 *	Creates a color from HSV values
	 *	hue [0..360)
	 *	saturation [0..1]
	 *	value [0..1]
	 */
	static fromHSV(hue: number, saturation: number, value: number, opacity: number = 255, parseErrorColor = Color.red) {
		if (hue < 0 || hue >= 360 || saturation < 0 || saturation > 1 || value < 0 || value > 1) {
			return parseErrorColor;
		}

		const c = value * saturation;
		const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
		const m = value - c;

		let [red, green, blue] = [0, 0, 0];
		if (hue < 60) {
			red = c;
			green = x;
		} else if (hue < 120) {
			red = x;
			green = c;
		} else if (hue < 180) {
			green = c;
			blue = x;
		} else if (hue < 240) {
			green = x;
			blue = c;
		} else if (hue < 300) {
			red = x;
			blue = c;
		} else if (hue < 360) {
			red = c;
			blue = x;
		}

		red = (red + m) * 255;
		green = (green + m) * 255;
		blue = (blue + m) * 255;

		return new Color(new RGBA(red, green, blue, opacity));
	}

	private _rgba: RGBA;
	private _hsla: HSLA;

	get rgba(): RGBA {
		if (!this._rgba) {
			this._rgba = hsla2rgba(this.hsla);
		}

		return this._rgba;
	}

	get hsla(): HSLA {
		if (!this._hsla) {
			this._hsla = rgba2hsla(this.rgba);
		}

		return this._hsla;
	}

	constructor(arg: RGBA | HSLA) {
		if (arg instanceof RGBA) {
			this._rgba = arg;
		} else {
			this._hsla = arg;
		}
	}

	equals(other: Color): boolean {
		return !!other && RGBA.equals(this.rgba, other.rgba);
	}

	/**
	 * http://www.w3.org/TR/WCAG20/#relativeluminancedef
	 * Returns the number in the set [0, 1]. O => Darkest Black. 1 => Lightest white.
	 */
	getLuminosity(): number {
		const R = Color._luminosityFor(this.rgba.r);
		const G = Color._luminosityFor(this.rgba.g);
		const B = Color._luminosityFor(this.rgba.b);
		const luminosity = 0.2126 * R + 0.7152 * G + 0.0722 * B;
		return Math.round(luminosity * 10000) / 10000;
	}

	private static _luminosityFor(color: number): number {
		const c = color / 255;
		return (c <= 0.03928) ? c / 12.92 : Math.pow(((c + 0.055) / 1.055), 2.4);
	}

	/**
	 * http://www.w3.org/TR/WCAG20/#contrast-ratiodef
	 * Returns the contrast ration number in the set [1, 21].
	 */
	getContrast(another: Color): number {
		const lum1 = this.getLuminosity();
		const lum2 = another.getLuminosity();
		return lum1 > lum2 ? (lum1 + 0.05) / (lum2 + 0.05) : (lum2 + 0.05) / (lum1 + 0.05);
	}

	getHue(): number {
		const [r, g, b] = [this.rgba.r / 255, this.rgba.g / 255, this.rgba.b / 255];
		const cmax = Math.max(r, g, b);
		const cmin = Math.min(r, g, b);
		const delta = cmax - cmin;
		let hue;

		if (delta === 0) {
			hue = 0;
		} else if (cmax === r) {
			hue = 60 * (((g - b) / delta) % 6);
		} else if (cmax === g) {
			hue = 60 * (((b - r) / delta) + 2);
		} else {
			hue = 60 * (((r - g) / delta) + 4);
		}

		if (hue < 0) {
			hue += 360;
		}
		return hue;
	}

	getSaturation(): number {
		const [r, g, b] = [this.rgba.r / 255, this.rgba.g / 255, this.rgba.b / 255];
		const cmax = Math.max(r, g, b);
		const cmin = Math.min(r, g, b);
		if (cmax === 0) {
			return 0;
		}
		return (cmax - cmin) / cmax;
	}

	getValue(): number {
		return Math.max(this.rgba.r / 255, this.rgba.g / 255, this.rgba.b / 255);
	}

	/**
	 *	http://24ways.org/2010/calculating-color-contrast
	 *  Return 'true' if darker color otherwise 'false'
	 */
	isDarker(): boolean {
		const yiq = (this.rgba.r * 299 + this.rgba.g * 587 + this.rgba.b * 114) / 1000;
		return yiq < 128;
	}

	/**
	 *	http://24ways.org/2010/calculating-color-contrast
	 *  Return 'true' if lighter color otherwise 'false'
	 */
	isLighter(): boolean {
		const yiq = (this.rgba.r * 299 + this.rgba.g * 587 + this.rgba.b * 114) / 1000;
		return yiq >= 128;
	}

	isLighterThan(another: Color): boolean {
		const lum1 = this.getLuminosity();
		const lum2 = another.getLuminosity();
		return lum1 > lum2;
	}

	isDarkerThan(another: Color): boolean {
		const lum1 = this.getLuminosity();
		const lum2 = another.getLuminosity();
		return lum1 < lum2;
	}

	lighten(factor: number): Color {
		const result = new HSLA(this.hsla.h, this.hsla.s, this.hsla.l + this.hsla.l * factor, this.hsla.a);
		return new Color(hsla2rgba(result));
	}

	darken(factor: number): Color {
		const result = new HSLA(this.hsla.h, this.hsla.s, this.hsla.l - this.hsla.l * factor, this.hsla.a);
		return new Color(hsla2rgba(result));
	}

	transparent(factor: number): Color {
		const { r, g, b, a } = this.rgba;
		return new Color(new RGBA(r, g, b, Math.round(a * factor)));
	}

	isTransparent(): boolean {
		return this.rgba.a === 0;
	}


	opposite(): Color {
		return new Color(new RGBA(
			255 - this.rgba.r,
			255 - this.rgba.g,
			255 - this.rgba.b,
			this.rgba.a
		));
	}

	blend(c: Color): Color {
		const rgba = c.rgba;

		// Convert to 0..1 opacity
		const thisA = this.rgba.a / 255;
		const colorA = rgba.a / 255;

		let a = thisA + colorA * (1 - thisA);
		if (a < 1.0e-6) {
			return Color.transparent;
		}

		const r = this.rgba.r * thisA / a + rgba.r * colorA * (1 - thisA) / a;
		const g = this.rgba.g * thisA / a + rgba.g * colorA * (1 - thisA) / a;
		const b = this.rgba.b * thisA / a + rgba.b * colorA * (1 - thisA) / a;
		a *= 255;

		return new Color(new RGBA(r, g, b, a));
	}

	toString(): string {
		return Color.Format.CSS.format(this);
	}

	static getLighterColor(of: Color, relative: Color, factor?: number): Color {
		if (of.isLighterThan(relative)) {
			return of;
		}
		factor = factor ? factor : 0.5;
		const lum1 = of.getLuminosity();
		const lum2 = relative.getLuminosity();
		factor = factor * (lum2 - lum1) / lum2;
		return of.lighten(factor);
	}

	static getDarkerColor(of: Color, relative: Color, factor?: number): Color {
		if (of.isDarkerThan(relative)) {
			return of;
		}
		factor = factor ? factor : 0.5;
		const lum1 = of.getLuminosity();
		const lum2 = relative.getLuminosity();
		factor = factor * (lum1 - lum2) / lum1;
		return of.darken(factor);
	}

	static readonly white = new Color(new RGBA(255, 255, 255, 255));
	static readonly black = new Color(new RGBA(0, 0, 0, 255));
	static readonly red = new Color(new RGBA(255, 0, 0, 255));
	static readonly blue = new Color(new RGBA(0, 0, 255, 255));
	static readonly green = new Color(new RGBA(0, 255, 0, 255));
	static readonly cyan = new Color(new RGBA(0, 255, 255, 255));
	static readonly lightgrey = new Color(new RGBA(211, 211, 211, 255));
	static readonly transparent = new Color(new RGBA(0, 0, 0, 0));
}

export namespace Color {
	export namespace Format {
		export namespace CSS {

			export function formatRGB(color: Color): string {
				if (color.rgba.a === 255) {
					return `rgb(${color.rgba.r}, ${color.rgba.g}, ${color.rgba.b})`;
				}

				return Color.Format.CSS.formatRGBA(color);
			}

			export function formatRGBA(color: Color): string {
				return `rgba(${color.rgba.r}, ${color.rgba.g}, ${color.rgba.b}, ${+(color.rgba.a / 255).toFixed(2)})`;
			}

			export function formatHSL(color: Color): string {
				if (color.hsla.a === 1) {
					return `hsl(${color.hsla.h}, ${(color.hsla.s * 100).toFixed(2)}%, ${(color.hsla.l * 100).toFixed(2)}%)`;
				}

				return Color.Format.CSS.formatHSLA(color);
			}

			export function formatHSLA(color: Color): string {
				return `hsla(${color.hsla.h}, ${(color.hsla.s * 100).toFixed(2)}%, ${(color.hsla.l * 100).toFixed(2)}%, ${color.hsla.a.toFixed(2)})`;
			}

			/**
			 * Formats the color as #RRGGBB
			 */
			export function formatHex(color: Color): string {
				return `#${_toTwoDigitHex(color.rgba.r)}${_toTwoDigitHex(color.rgba.g)}${_toTwoDigitHex(color.rgba.b)}`;
			}

			/**
			 * Formats the color as #RRGGBBAA
			 * If 'compact' is set, colors without transparancy will be printed as #RRGGBB
			 */
			export function formatHexA(color: Color, compact = false): string {
				if (compact && color.rgba.a === 0xFF) {
					return Color.Format.CSS.formatHex(color);
				}

				return `#${_toTwoDigitHex(color.rgba.r)}${_toTwoDigitHex(color.rgba.g)}${_toTwoDigitHex(color.rgba.b)}${_toTwoDigitHex(color.rgba.a)}`;
			}

			/**
			 * The default format will use HEX if opaque and RGBA otherwise.
			 */
			export function format(color: Color): string | null {
				if (!color) {
					return null;
				}

				if (color.rgba.a === 255) {
					return Color.Format.CSS.formatHex(color);
				}

				return Color.Format.CSS.formatRGBA(color);
			}

			/**
			 * Converts an Hex color value to RGB.
			 * returns r, g, and b are contained in the set [0, 255]
			 * @param hex string (#RGB, #RGBA, #RRGGBB or #RRGGBBAA).
			 */
			export function parseHexH(hex: string): Color | null {
				if (!hex) {
					// Invalid color
					return null;
				}

				const length = hex.length;

				if (length === 0) {
					// Invalid color
					return null;
				}

				if (hex.charCodeAt(0) !== CharCode.Hash) {
					// Does not begin with a #
					return null;
				}

				if (length === 7) {
					// #RRGGBB format
					const r = 16 * _parseHexDigit(hex.charCodeAt(1)) + _parseHexDigit(hex.charCodeAt(2));
					const g = 16 * _parseHexDigit(hex.charCodeAt(3)) + _parseHexDigit(hex.charCodeAt(4));
					const b = 16 * _parseHexDigit(hex.charCodeAt(5)) + _parseHexDigit(hex.charCodeAt(6));
					return new Color(new RGBA(r, g, b, 255));
				}

				if (length === 9) {
					// #RRGGBBAA format
					const r = 16 * _parseHexDigit(hex.charCodeAt(1)) + _parseHexDigit(hex.charCodeAt(2));
					const g = 16 * _parseHexDigit(hex.charCodeAt(3)) + _parseHexDigit(hex.charCodeAt(4));
					const b = 16 * _parseHexDigit(hex.charCodeAt(5)) + _parseHexDigit(hex.charCodeAt(6));
					const a = 16 * _parseHexDigit(hex.charCodeAt(7)) + _parseHexDigit(hex.charCodeAt(8));
					return new Color(new RGBA(r, g, b, a));
				}

				if (length === 4) {
					// #RGB format
					const r = _parseHexDigit(hex.charCodeAt(1));
					const g = _parseHexDigit(hex.charCodeAt(2));
					const b = _parseHexDigit(hex.charCodeAt(3));
					return new Color(new RGBA(16 * r + r, 16 * g + g, 16 * b + b));
				}

				if (length === 5) {
					// #RGBA format
					const r = _parseHexDigit(hex.charCodeAt(1));
					const g = _parseHexDigit(hex.charCodeAt(2));
					const b = _parseHexDigit(hex.charCodeAt(3));
					const a = _parseHexDigit(hex.charCodeAt(4));
					return new Color(new RGBA(16 * r + r, 16 * g + g, 16 * b + b, 16 * a + a));
				}

				// Invalid color
				return null;
			}
		}
	}
}