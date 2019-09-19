/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/platform/registry/common/platform';
import { IJSONSchema, IJSONSchemaMap } from 'vs/base/common/jsonSchema';
import { Color } from 'vs/base/common/color';
import { ITheme } from 'vs/platform/theme/common/themeService';
import { Event, Emitter } from 'vs/base/common/event';
import * as nls from 'vs/nls';

import { Extensions as JSONExtensions, IJSONContributionRegistry } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { RunOnceScheduler } from 'vs/base/common/async';
import { editorForeground } from 'vs/platform/theme/common/colorRegistry';

//  ------ API types

export type TokenStyleIdentifier = string;

export interface TokenStyleContribution {
	readonly id: TokenStyleIdentifier;
	readonly description: string;
	readonly defaults: TokenStyleDefaults | null;
	readonly deprecationMessage: string | undefined;
}

export const enum TokenStyleBits {
	BOLD = 0x01,
	UNDERLINE = 0x02,
	ITALIC = 0x04
}

export class TokenStyle {
	constructor(
		public readonly foreground?: Color,
		public readonly background?: Color,
		public readonly styles?: number
	) {

	}

	hasStyle(style: number): boolean {
		return !!this.styles && ((this.styles & style) === style);
	}
}

export namespace TokenStyle {
	export function fromString(s: string) {
		const parts = s.split('-');
		let part = parts.shift();
		if (part) {
			const foreground = Color.fromHex(part);
			let background = undefined;
			let style = undefined;
			part = parts.shift();
			if (part && part[0] === '#') {
				background = Color.fromHex(part);
				part = parts.shift();
			}
			if (part) {
				try {
					style = parseInt(part);
				} catch (e) {
					// ignore
				}
			}
			return new TokenStyle(foreground, background, style);
		}
		return new TokenStyle(Color.red);
	}
}

export type ProbeScope = string[];

export interface TokenStyleFunction {
	(theme: ITheme): TokenStyle | undefined;
}

export interface TokenStyleDefaults {
	scopesToProbe?: ProbeScope[];
	light: TokenStyleValue | null;
	dark: TokenStyleValue | null;
	hc: TokenStyleValue | null;
}

/**
 * A TokenStyle Value is either a token style literal, a reference to other token style or a derived token style
 */
export type TokenStyleValue = TokenStyle | string | TokenStyleIdentifier | TokenStyleFunction;

// TokenStyle registry
export const Extensions = {
	TokenStyleContribution: 'base.contributions.tokenStyles'
};

export interface ITokenStyleRegistry {

	readonly onDidChangeSchema: Event<void>;

	/**
	 * Register a TokenStyle to the registry.
	 * @param id The TokenStyle id as used in theme description files
	 * @param defaults The default values
	 * @description the description
	 */
	registerTokenStyle(id: string, defaults: TokenStyleDefaults, description: string): TokenStyleIdentifier;

	/**
	 * Register a TokenStyle to the registry.
	 */
	deregisterTokenStyle(id: string): void;

	/**
	 * Get all TokenStyle contributions
	 */
	getTokenStyles(): TokenStyleContribution[];

	/**
	 * Gets the default TokenStyle of the given id
	 */
	resolveDefaultTokenStyle(id: TokenStyleIdentifier, theme: ITheme, findTokenStyleForScope: (scope: ProbeScope) => TokenStyle | undefined): TokenStyle | undefined;

	/**
	 * JSON schema for an object to assign TokenStyle values to one of the TokenStyle contributions.
	 */
	getTokenStyleSchema(): IJSONSchema;

	/**
	 * JSON schema to for a reference to a TokenStyle contribution.
	 */
	getTokenStyleReferenceSchema(): IJSONSchema;

}



class TokenStyleRegistry implements ITokenStyleRegistry {

	private readonly _onDidChangeSchema = new Emitter<void>();
	readonly onDidChangeSchema: Event<void> = this._onDidChangeSchema.event;

	private tokenStyleById: { [key: string]: TokenStyleContribution };
	private tokenStyleSchema: IJSONSchema & { properties: IJSONSchemaMap } = { type: 'object', properties: {} };
	private tokenStyleReferenceSchema: IJSONSchema & { enum: string[], enumDescriptions: string[] } = { type: 'string', enum: [], enumDescriptions: [] };

	constructor() {
		this.tokenStyleById = {};
	}

	public registerTokenStyle(id: string, defaults: TokenStyleDefaults | null, description: string, deprecationMessage?: string): TokenStyleIdentifier {
		let tokenStyleContribution: TokenStyleContribution = { id, description, defaults, deprecationMessage };
		this.tokenStyleById[id] = tokenStyleContribution;
		let propertySchema: IJSONSchema = {
			type: 'object',
			description,
			properties: {
				'foreground': { type: 'string', format: 'color-hex', default: '#ff0000' },
				'italic': { type: 'boolean' },
				'bold': { type: 'boolean' },
				'underline': { type: 'boolean' }
			}
		};
		if (deprecationMessage) {
			propertySchema.deprecationMessage = deprecationMessage;
		}
		this.tokenStyleSchema.properties[id] = propertySchema;
		this.tokenStyleReferenceSchema.enum.push(id);
		this.tokenStyleReferenceSchema.enumDescriptions.push(description);

		this._onDidChangeSchema.fire();
		return id;
	}


	public deregisterTokenStyle(id: string): void {
		delete this.tokenStyleById[id];
		delete this.tokenStyleSchema.properties[id];
		const index = this.tokenStyleReferenceSchema.enum.indexOf(id);
		if (index !== -1) {
			this.tokenStyleReferenceSchema.enum.splice(index, 1);
			this.tokenStyleReferenceSchema.enumDescriptions.splice(index, 1);
		}
		this._onDidChangeSchema.fire();
	}

	public getTokenStyles(): TokenStyleContribution[] {
		return Object.keys(this.tokenStyleById).map(id => this.tokenStyleById[id]);
	}

	public resolveDefaultTokenStyle(id: TokenStyleIdentifier, theme: ITheme, findTokenStyleForScope: (scope: ProbeScope) => TokenStyle | undefined): TokenStyle | undefined {
		const tokenStyleDesc = this.tokenStyleById[id];
		if (tokenStyleDesc && tokenStyleDesc.defaults) {
			const scopesToProbe = tokenStyleDesc.defaults.scopesToProbe;
			if (scopesToProbe) {
				for (let scope of scopesToProbe) {
					const style = findTokenStyleForScope(scope);
					if (style) {
						return style;
					}
				}
			}
			const tokenStyleValue = tokenStyleDesc.defaults[theme.type];
			if (tokenStyleValue === null) {
				return new TokenStyle(theme.getColor(editorForeground));
			}
			return resolveTokenStyleValue(tokenStyleValue, theme);
		}
		return undefined;
	}

	public getTokenStyleSchema(): IJSONSchema {
		return this.tokenStyleSchema;
	}

	public getTokenStyleReferenceSchema(): IJSONSchema {
		return this.tokenStyleReferenceSchema;
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

		return Object.keys(this.tokenStyleById).sort(sorter).map(k => `- \`${k}\`: ${this.tokenStyleById[k].description}`).join('\n');
	}

}

const tokenStyleRegistry = new TokenStyleRegistry();
platform.Registry.add(Extensions.TokenStyleContribution, tokenStyleRegistry);

export function registerTokenStyle(id: string, defaults: TokenStyleDefaults | null, description: string, deprecationMessage?: string): TokenStyleIdentifier {
	return tokenStyleRegistry.registerTokenStyle(id, defaults, description, deprecationMessage);
}

export function getTokenStyleRegistry(): ITokenStyleRegistry {
	return tokenStyleRegistry;
}

// colors


export const comments = registerTokenStyle('comments', { scopesToProbe: [['comment']], dark: null, light: null, hc: null }, nls.localize('comments', "Token style for comments."));
export const strings = registerTokenStyle('strings', { scopesToProbe: [['string']], dark: null, light: null, hc: null }, nls.localize('strings', "Token style for strings."));
export const keywords = registerTokenStyle('keywords', { scopesToProbe: [['keyword.control'], ['storage'], ['storage.type']], dark: null, light: null, hc: null }, nls.localize('keywords', "Token style for keywords."));
export const numbers = registerTokenStyle('numbers', { scopesToProbe: [['constant.numeric']], dark: null, light: null, hc: null }, nls.localize('numbers', "Token style for numbers."));
export const types = registerTokenStyle('types', { scopesToProbe: [['entity.name.type'], ['entity.name.class'], ['support.type'], ['support.class']], dark: null, light: null, hc: null }, nls.localize('types', "Token style for types."));
export const functions = registerTokenStyle('functions', { scopesToProbe: [['entity.name.function'], ['support.function']], dark: null, light: null, hc: null }, nls.localize('functions', "Token style for functions."));
export const variables = registerTokenStyle('variables', { scopesToProbe: [['variable'], ['entity.name.variable']], dark: null, light: null, hc: null }, nls.localize('variables', "Token style for variables."));

/**
 * @param colorValue Resolve a color value in the context of a theme
 */
function resolveTokenStyleValue(tokenStyleValue: TokenStyleValue | null, theme: ITheme): TokenStyle | undefined {
	if (tokenStyleValue === null) {
		return undefined;
	} else if (typeof tokenStyleValue === 'string') {
		if (tokenStyleValue[0] === '#') {
			return TokenStyle.fromString(tokenStyleValue);
		}
		return theme.getTokenStyle(tokenStyleValue);
	} else if (typeof tokenStyleValue === 'object') {
		return tokenStyleValue;
	} else if (typeof tokenStyleValue === 'function') {
		return tokenStyleValue(theme);
	}
	return undefined;
}

export const tokenStyleColorsSchemaId = 'vscode://schemas/workbench-tokenstyles';

let schemaRegistry = platform.Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
schemaRegistry.registerSchema(tokenStyleColorsSchemaId, tokenStyleRegistry.getTokenStyleSchema());

const delayer = new RunOnceScheduler(() => schemaRegistry.notifySchemaChanged(tokenStyleColorsSchemaId), 200);
tokenStyleRegistry.onDidChangeSchema(() => {
	if (!delayer.isScheduled()) {
		delayer.schedule();
	}
});

// setTimeout(_ => console.log(colorRegistry.toString()), 5000);



