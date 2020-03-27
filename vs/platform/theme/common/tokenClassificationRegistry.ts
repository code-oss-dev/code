/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/platform/registry/common/platform';
import { Color } from 'vs/base/common/color';
import { IColorTheme } from 'vs/platform/theme/common/themeService';
import * as nls from 'vs/nls';
import { Extensions as JSONExtensions, IJSONContributionRegistry } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';
import { IJSONSchema, IJSONSchemaMap } from 'vs/base/common/jsonSchema';

export const TOKEN_TYPE_WILDCARD = '*';
export const TOKEN_CLASSIFIER_LANGUAGE_SEPARATOR = ':';
export const CLASSIFIER_MODIFIER_SEPARATOR = '.';

// qualified string [type|*](.modifier)*(/language)!
export type TokenClassificationString = string;

export const idPattern = '\\w+[-_\\w+]*';
export const typeAndModifierIdPattern = `^${idPattern}$`;

export const selectorPattern = `^(${idPattern}|\\*)(\\${CLASSIFIER_MODIFIER_SEPARATOR}${idPattern})*(\\${TOKEN_CLASSIFIER_LANGUAGE_SEPARATOR}${idPattern})?$`;

export const fontStylePattern = '^(\\s*(-?italic|-?bold|-?underline))*\\s*$';

export interface TokenSelector {
	match(type: string, modifiers: string[], language: string): number;
	readonly selectorString: string;
}

export interface TokenTypeOrModifierContribution {
	readonly num: number;
	readonly id: string;
	readonly superType?: string;
	readonly description: string;
	readonly deprecationMessage?: string;
}


export interface TokenStyleData {
	foreground?: Color;
	bold?: boolean;
	underline?: boolean;
	italic?: boolean;
}

export class TokenStyle implements Readonly<TokenStyleData> {
	constructor(
		public readonly foreground?: Color,
		public readonly bold?: boolean,
		public readonly underline?: boolean,
		public readonly italic?: boolean,
	) {
	}
}

export namespace TokenStyle {
	export function toJSONObject(style: TokenStyle): any {
		return {
			_foreground: style.foreground === undefined ? null : Color.Format.CSS.formatHexA(style.foreground, true),
			_bold: style.bold === undefined ? null : style.bold,
			_underline: style.underline === undefined ? null : style.underline,
			_italic: style.italic === undefined ? null : style.italic,
		};
	}
	export function fromJSONObject(obj: any): TokenStyle | undefined {
		if (obj) {
			const boolOrUndef = (b: any) => (typeof b === 'boolean') ? b : undefined;
			const colorOrUndef = (s: any) => (typeof s === 'string') ? Color.fromHex(s) : undefined;
			return new TokenStyle(colorOrUndef(obj._foreground), boolOrUndef(obj._bold), boolOrUndef(obj._underline), boolOrUndef(obj._italic));
		}
		return undefined;
	}
	export function equals(s1: any, s2: any): boolean {
		if (s1 === s2) {
			return true;
		}
		return s1 !== undefined && s2 !== undefined
			&& (s1.foreground instanceof Color ? s1.foreground.equals(s2.foreground) : s2.foreground === undefined)
			&& s1.bold === s2.bold
			&& s1.underline === s2.underline
			&& s1.italic === s2.italic;
	}
	export function is(s: any): s is TokenStyle {
		return s instanceof TokenStyle;
	}
	export function fromData(data: { foreground?: Color, bold?: boolean, underline?: boolean, italic?: boolean }): TokenStyle {
		return new TokenStyle(data.foreground, data.bold, data.underline, data.italic);
	}
	export function fromSettings(foreground: string | undefined, fontStyle: string | undefined): TokenStyle {
		let foregroundColor = undefined;
		if (foreground !== undefined) {
			foregroundColor = Color.fromHex(foreground);
		}
		let bold, underline, italic;
		if (fontStyle !== undefined) {
			fontStyle = fontStyle.trim();
			if (fontStyle.length === 0) {
				bold = italic = underline = false;
			} else {
				const expression = /-?italic|-?bold|-?underline/g;
				let match;
				while ((match = expression.exec(fontStyle))) {
					switch (match[0]) {
						case 'bold': bold = true; break;
						case 'italic': italic = true; break;
						case 'underline': underline = true; break;
					}
				}
			}
		}
		return new TokenStyle(foregroundColor, bold, underline, italic);

	}
}

export type ProbeScope = string[];

export interface TokenStyleFunction {
	(theme: IColorTheme): TokenStyle | undefined;
}

export interface TokenStyleDefaults {
	scopesToProbe?: ProbeScope[];
	light?: TokenStyleValue;
	dark?: TokenStyleValue;
	hc?: TokenStyleValue;
}

export interface TokenStylingDefaultRule {
	selector: TokenSelector;
	defaults: TokenStyleDefaults;
}

export interface TokenStylingRule {
	style: TokenStyle;
	selector: TokenSelector;
}

export namespace TokenStylingRule {
	export function fromJSONObject(registry: ITokenClassificationRegistry, o: any): TokenStylingRule | undefined {
		if (o && typeof o._selector === 'string' && o._style) {
			const style = TokenStyle.fromJSONObject(o._style);
			if (style) {
				try {
					return { selector: registry.parseTokenSelector(o._selector), style };
				} catch (_ignore) {
				}
			}
		}
		return undefined;
	}
	export function toJSONObject(rule: TokenStylingRule): any {
		return {
			_selector: rule.selector.selectorString,
			_style: TokenStyle.toJSONObject(rule.style)
		};
	}
	export function equals(r1: TokenStylingRule | undefined, r2: TokenStylingRule | undefined) {
		if (r1 === r2) {
			return true;
		}
		return r1 !== undefined && r2 !== undefined
			&& r1.selector && r2.selector && r1.selector.selectorString === r2.selector.selectorString
			&& TokenStyle.equals(r1.style, r2.style);
	}
	export function is(r: any): r is TokenStylingRule {
		return r && r.selector && typeof r.selector.selectorString === 'string' && TokenStyle.is(r.style);
	}
}

/**
 * A TokenStyle Value is either a token style literal, or a TokenClassificationString
 */
export type TokenStyleValue = TokenStyle | TokenClassificationString;

// TokenStyle registry
export const Extensions = {
	TokenClassificationContribution: 'base.contributions.tokenClassification'
};

export interface ITokenClassificationRegistry {

	readonly onDidChangeSchema: Event<void>;

	/**
	 * Register a token type to the registry.
	 * @param id The TokenType id as used in theme description files
	 * @param description the description
	 */
	registerTokenType(id: string, description: string, superType?: string, deprecationMessage?: string): void;

	/**
	 * Register a token modifier to the registry.
	 * @param id The TokenModifier id as used in theme description files
	 * @param description the description
	 */
	registerTokenModifier(id: string, description: string): void;

	/**
	 * Parses a token selector from a selector string.
	 * @param selectorString selector string in the form (*|type)(.modifier)*
	 * @returns the parsesd selector
	 * @throws an error if the string is not a valid selector
	 */
	parseTokenSelector(selectorString: string): TokenSelector;

	/**
	 * Register a TokenStyle default to the registry.
	 * @param selector The rule selector
	 * @param defaults The default values
	 */
	registerTokenStyleDefault(selector: TokenSelector, defaults: TokenStyleDefaults): void;

	/**
	 * Deregister a TokenStyle default to the registry.
	 * @param selector The rule selector
	 */
	deregisterTokenStyleDefault(selector: TokenSelector): void;

	/**
	 * Deregister a TokenType from the registry.
	 */
	deregisterTokenType(id: string): void;

	/**
	 * Deregister a TokenModifier from the registry.
	 */
	deregisterTokenModifier(id: string): void;

	/**
	 * Get all TokenType contributions
	 */
	getTokenTypes(): TokenTypeOrModifierContribution[];

	/**
	 * Get all TokenModifier contributions
	 */
	getTokenModifiers(): TokenTypeOrModifierContribution[];

	/**
	 * The styling rules to used when a schema does not define any styling rules.
	 */
	getTokenStylingDefaultRules(): TokenStylingDefaultRule[];

	/**
	 * JSON schema for an object to assign styling to token classifications
	 */
	getTokenStylingSchema(): IJSONSchema;
}

class TokenClassificationRegistry implements ITokenClassificationRegistry {

	private readonly _onDidChangeSchema = new Emitter<void>();
	readonly onDidChangeSchema: Event<void> = this._onDidChangeSchema.event;

	private currentTypeNumber = 0;
	private currentModifierBit = 1;

	private tokenTypeById: { [key: string]: TokenTypeOrModifierContribution };
	private tokenModifierById: { [key: string]: TokenTypeOrModifierContribution };

	private tokenStylingDefaultRules: TokenStylingDefaultRule[] = [];

	private typeHierarchy: { [id: string]: string[] };

	private tokenStylingSchema: IJSONSchema & { properties: IJSONSchemaMap } = {
		type: 'object',
		properties: {},
		additionalProperties: getStylingSchemeEntry(),
		definitions: {
			style: {
				type: 'object',
				description: nls.localize('schema.token.settings', 'Colors and styles for the token.'),
				properties: {
					foreground: {
						type: 'string',
						description: nls.localize('schema.token.foreground', 'Foreground color for the token.'),
						format: 'color-hex',
						default: '#ff0000'
					},
					background: {
						type: 'string',
						deprecationMessage: nls.localize('schema.token.background.warning', 'Token background colors are currently not supported.')
					},
					fontStyle: {
						type: 'string',
						description: nls.localize('schema.token.fontStyle', 'Font style of the rule: \'italic\', \'bold\' or \'underline\' or a combination. The empty string unsets inherited settings.'),
						pattern: fontStylePattern,
						patternErrorMessage: nls.localize('schema.fontStyle.error', 'Font style must be \'italic\', \'bold\' or \'underline\' or a combination. The empty string unsets all styles.'),
						defaultSnippets: [{ label: nls.localize('schema.token.fontStyle.none', 'None (clear inherited style)'), bodyText: '""' }, { body: 'italic' }, { body: 'bold' }, { body: 'underline' }, { body: 'italic underline' }, { body: 'bold underline' }, { body: 'italic bold underline' }]
					}
				},
				additionalProperties: false,
				defaultSnippets: [{ body: { foreground: '${1:#FF0000}', fontStyle: '${2:bold}' } }]
			}
		}
	};

	constructor() {
		this.tokenTypeById = {};
		this.tokenModifierById = {};
		this.typeHierarchy = {};
	}

	public registerTokenType(id: string, description: string, superType?: string, deprecationMessage?: string): void {
		if (!id.match(typeAndModifierIdPattern)) {
			throw new Error('Invalid token type id.');
		}
		if (superType && !superType.match(typeAndModifierIdPattern)) {
			throw new Error('Invalid token super type id.');
		}

		const num = this.currentTypeNumber++;
		let tokenStyleContribution: TokenTypeOrModifierContribution = { num, id, superType, description, deprecationMessage };
		this.tokenTypeById[id] = tokenStyleContribution;

		this.tokenStylingSchema.properties[id] = getStylingSchemeEntry(description, deprecationMessage);
		this.typeHierarchy = {};
	}

	public registerTokenModifier(id: string, description: string, deprecationMessage?: string): void {
		if (!id.match(typeAndModifierIdPattern)) {
			throw new Error('Invalid token modifier id.');
		}

		const num = this.currentModifierBit;
		this.currentModifierBit = this.currentModifierBit * 2;
		let tokenStyleContribution: TokenTypeOrModifierContribution = { num, id, description, deprecationMessage };
		this.tokenModifierById[id] = tokenStyleContribution;

		this.tokenStylingSchema.properties[`*.${id}`] = getStylingSchemeEntry(description, deprecationMessage);
	}

	public parseTokenSelector(selectorString: string): TokenSelector {
		const selector = parseClassifierString(selectorString);

		if (!selector.type) {
			return {
				match: () => -1,
				selectorString
			};
		}

		return {
			match: (type: string, modifiers: string[], language: string) => {
				let score = 0;
				if (selector.language !== undefined) {
					if (selector.language !== language) {
						return -1;
					}
					score += 100;
				}
				if (selector.type !== TOKEN_TYPE_WILDCARD) {
					const hierarchy = this.getTypeHierarchy(type);
					const level = hierarchy.indexOf(selector.type);
					if (level === -1) {
						return -1;
					}
					score += (100 - level);
				}
				// all selector modifiers must be present
				for (const selectorModifier of selector.modifiers) {
					if (modifiers.indexOf(selectorModifier) === -1) {
						return -1;
					}
				}
				return score + selector.modifiers.length * 100;
			},
			selectorString
		};
	}

	public registerTokenStyleDefault(selector: TokenSelector, defaults: TokenStyleDefaults): void {
		this.tokenStylingDefaultRules.push({ selector, defaults });
	}

	public deregisterTokenStyleDefault(selector: TokenSelector): void {
		const selectorString = selector.selectorString;
		this.tokenStylingDefaultRules = this.tokenStylingDefaultRules.filter(r => r.selector.selectorString !== selectorString);
	}

	public deregisterTokenType(id: string): void {
		delete this.tokenTypeById[id];
		delete this.tokenStylingSchema.properties[id];
		this.typeHierarchy = {};
	}

	public deregisterTokenModifier(id: string): void {
		delete this.tokenModifierById[id];
		delete this.tokenStylingSchema.properties[`*.${id}`];
	}

	public getTokenTypes(): TokenTypeOrModifierContribution[] {
		return Object.keys(this.tokenTypeById).map(id => this.tokenTypeById[id]);
	}

	public getTokenModifiers(): TokenTypeOrModifierContribution[] {
		return Object.keys(this.tokenModifierById).map(id => this.tokenModifierById[id]);
	}

	public getTokenStylingSchema(): IJSONSchema {
		return this.tokenStylingSchema;
	}

	public getTokenStylingDefaultRules(): TokenStylingDefaultRule[] {
		return this.tokenStylingDefaultRules;
	}

	private getTypeHierarchy(typeId: string): string[] {
		let hierarchy = this.typeHierarchy[typeId];
		if (!hierarchy) {
			this.typeHierarchy[typeId] = hierarchy = [typeId];
			let type = this.tokenTypeById[typeId];
			while (type && type.superType) {
				hierarchy.push(type.superType);
				type = this.tokenTypeById[type.superType];
			}
		}
		return hierarchy;
	}


	public toString() {
		let sorter = (a: string, b: string) => {
			let cat1 = a.indexOf('.') === -1 ? 0 : 1;
			let cat2 = b.indexOf('.') === -1 ? 0 : 1;
			if (cat1 !== cat2) {
				return cat1 - cat2;
			}
			return a.localeCompare(b);
		};

		return Object.keys(this.tokenTypeById).sort(sorter).map(k => `- \`${k}\`: ${this.tokenTypeById[k].description}`).join('\n');
	}

}

const CHAR_LANGUAGE = TOKEN_CLASSIFIER_LANGUAGE_SEPARATOR.charCodeAt(0);
const CHAR_MODIFIER = CLASSIFIER_MODIFIER_SEPARATOR.charCodeAt(0);

export function parseClassifierString(s: string): { type: string, modifiers: string[], language: string | undefined; } {
	let k = s.length;
	let language: string | undefined = undefined;
	const modifiers = [];

	for (let i = k - 1; i >= 0; i--) {
		const ch = s.charCodeAt(i);
		if (ch === CHAR_LANGUAGE || ch === CHAR_MODIFIER) {
			const segment = s.substring(i + 1, k);
			k = i;
			if (ch === CHAR_LANGUAGE) {
				language = segment;
			} else {
				modifiers.push(segment);
			}
		}
	}
	const type = s.substring(0, k);
	return { type, modifiers, language };
}


let tokenClassificationRegistry = createDefaultTokenClassificationRegistry();
platform.Registry.add(Extensions.TokenClassificationContribution, tokenClassificationRegistry);


function createDefaultTokenClassificationRegistry(): TokenClassificationRegistry {

	const registry = new TokenClassificationRegistry();

	function registerTokenType(id: string, description: string, scopesToProbe: ProbeScope[] = [], superType?: string, deprecationMessage?: string): string {
		registry.registerTokenType(id, description, superType, deprecationMessage);
		if (scopesToProbe) {
			registerTokenStyleDefault(id, scopesToProbe);
		}
		return id;
	}

	function registerTokenStyleDefault(selectorString: string, scopesToProbe: ProbeScope[]) {
		try {
			const selector = registry.parseTokenSelector(selectorString);
			registry.registerTokenStyleDefault(selector, { scopesToProbe });
		} catch (e) {
			console.log(e);
		}
	}

	// default token types

	registerTokenType('comment', nls.localize('comment', "Style for comments."), [['comment']]);
	registerTokenType('string', nls.localize('string', "Style for strings."), [['string']]);
	registerTokenType('keyword', nls.localize('keyword', "Style for keywords."), [['keyword.control']]);
	registerTokenType('number', nls.localize('number', "Style for numbers."), [['constant.numeric']]);
	registerTokenType('regexp', nls.localize('regexp', "Style for expressions."), [['constant.regexp']]);
	registerTokenType('operator', nls.localize('operator', "Style for operators."), [['keyword.operator']]);

	registerTokenType('namespace', nls.localize('namespace', "Style for namespaces."), [['entity.name.namespace']]);

	registerTokenType('type', nls.localize('type', "Style for types."), [['entity.name.type'], ['support.type']]);
	registerTokenType('struct', nls.localize('struct', "Style for structs."), [['storage.type.struct']]);
	registerTokenType('class', nls.localize('class', "Style for classes."), [['entity.name.type.class'], ['support.class']]);
	registerTokenType('interface', nls.localize('interface', "Style for interfaces."), [['entity.name.type.interface']]);
	registerTokenType('enum', nls.localize('enum', "Style for enums."), [['entity.name.type.enum']]);
	registerTokenType('typeParameter', nls.localize('typeParameter', "Style for type parameters."), [['entity.name.type.parameter']]);

	registerTokenType('function', nls.localize('function', "Style for functions"), [['entity.name.function'], ['support.function']]);
	registerTokenType('member', nls.localize('member', "Style for member"), [['entity.name.function.member'], ['support.function']]);
	registerTokenType('macro', nls.localize('macro', "Style for macros."), [['entity.name.other.preprocessor.macro']]);

	registerTokenType('variable', nls.localize('variable', "Style for variables."), [['variable.other.readwrite'], ['entity.name.variable']]);
	registerTokenType('parameter', nls.localize('parameter', "Style for parameters."), [['variable.parameter']]);
	registerTokenType('property', nls.localize('property', "Style for properties."), [['variable.other.property']]);
	registerTokenType('enumMember', nls.localize('enumMember', "Style for enum members."), [['variable.other.enummember']]);
	registerTokenType('event', nls.localize('event', "Style for events."), [['variable.other.event']]);

	registerTokenType('label', nls.localize('labels', "Style for labels. "), undefined);

	// default token modifiers

	registry.registerTokenModifier('declaration', nls.localize('declaration', "Style for all symbol declarations."), undefined);
	registry.registerTokenModifier('documentation', nls.localize('documentation', "Style to use for references in documentation."), undefined);
	registry.registerTokenModifier('static', nls.localize('static', "Style to use for symbols that are static."), undefined);
	registry.registerTokenModifier('abstract', nls.localize('abstract', "Style to use for symbols that are abstract."), undefined);
	registry.registerTokenModifier('deprecated', nls.localize('deprecated', "Style to use for symbols that are deprecated."), undefined);
	registry.registerTokenModifier('modification', nls.localize('modification', "Style to use for write accesses."), undefined);
	registry.registerTokenModifier('async', nls.localize('async', "Style to use for symbols that are async."), undefined);
	registry.registerTokenModifier('readonly', nls.localize('readonly', "Style to use for symbols that are readonly."), undefined);


	registerTokenStyleDefault('variable.readonly', [['variable.other.constant']]);
	registerTokenStyleDefault('property.readonly', [['variable.other.constant.property']]);
	registerTokenStyleDefault('type.defaultLibrary', [['support.type']]);
	registerTokenStyleDefault('class.defaultLibrary', [['support.class']]);
	registerTokenStyleDefault('interface.defaultLibrary', [['support.class']]);
	registerTokenStyleDefault('variable.defaultLibrary', [['support.variable'], ['support.other.variable']]);
	registerTokenStyleDefault('variable.defaultLibrary.readonly', [['support.constant']]);
	registerTokenStyleDefault('property.defaultLibrary', [['support.variable.property']]);
	registerTokenStyleDefault('property.defaultLibrary.readonly', [['support.constant.property']]);
	registerTokenStyleDefault('function.defaultLibrary', [['support.function']]);
	registerTokenStyleDefault('member.defaultLibrary', [['support.function']]);
	return registry;
}

export function getTokenClassificationRegistry(): ITokenClassificationRegistry {
	return tokenClassificationRegistry;
}

function getStylingSchemeEntry(description?: string, deprecationMessage?: string): IJSONSchema {
	return {
		description,
		deprecationMessage,
		defaultSnippets: [{ body: '${1:#ff0000}' }],
		anyOf: [
			{
				type: 'string',
				format: 'color-hex'
			},
			{
				$ref: '#definitions/style'
			}
		]
	};
}

export const tokenStylingSchemaId = 'vscode://schemas/token-styling';

let schemaRegistry = platform.Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
schemaRegistry.registerSchema(tokenStylingSchemaId, tokenClassificationRegistry.getTokenStylingSchema());

const delayer = new RunOnceScheduler(() => schemaRegistry.notifySchemaChanged(tokenStylingSchemaId), 200);
tokenClassificationRegistry.onDidChangeSchema(() => {
	if (!delayer.isScheduled()) {
		delayer.schedule();
	}
});
