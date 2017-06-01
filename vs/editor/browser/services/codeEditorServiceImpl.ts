/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as strings from 'vs/base/common/strings';
import URI from 'vs/base/common/uri';
import * as dom from 'vs/base/browser/dom';
import {
	IDecorationRenderOptions, IModelDecorationOptions, IModelDecorationOverviewRulerOptions, IThemeDecorationRenderOptions,
	IContentDecorationRenderOptions, OverviewRulerLane, TrackedRangeStickiness, ThemeColor, isThemeColor
} from 'vs/editor/common/editorCommon';
import { AbstractCodeEditorService } from 'vs/editor/common/services/abstractCodeEditorService';
import { IDisposable, dispose as disposeAll } from 'vs/base/common/lifecycle';
import { IThemeService, ITheme } from 'vs/platform/theme/common/themeService';

export class CodeEditorServiceImpl extends AbstractCodeEditorService {

	private _styleSheet: HTMLStyleElement;
	private _decorationOptionProviders: { [key: string]: IModelDecorationOptionsProvider };
	private _themeService: IThemeService;

	constructor( @IThemeService themeService: IThemeService, styleSheet = dom.createStyleSheet()) {
		super();
		this._styleSheet = styleSheet;
		this._decorationOptionProviders = Object.create(null);
		this._themeService = themeService;
	}

	public registerDecorationType(key: string, options: IDecorationRenderOptions, parentTypeKey?: string): void {
		let provider = this._decorationOptionProviders[key];
		if (!provider) {
			let providerArgs: ProviderArguments = {
				styleSheet: this._styleSheet,
				key: key,
				parentTypeKey: parentTypeKey,
				options: options
			};
			if (!parentTypeKey) {
				provider = new DecorationTypeOptionsProvider(this._themeService, providerArgs);
			} else {
				provider = new DecorationSubTypeOptionsProvider(this._themeService, providerArgs);
			}
			this._decorationOptionProviders[key] = provider;
		}
		provider.refCount++;
	}

	public removeDecorationType(key: string): void {
		let provider = this._decorationOptionProviders[key];
		if (provider) {
			provider.refCount--;
			if (provider.refCount <= 0) {
				delete this._decorationOptionProviders[key];
				provider.dispose();
				this.listCodeEditors().forEach((ed) => ed.removeDecorations(key));
			}
		}
	}

	public resolveDecorationOptions(decorationTypeKey: string, writable: boolean): IModelDecorationOptions {
		let provider = this._decorationOptionProviders[decorationTypeKey];
		if (!provider) {
			throw new Error('Unknown decoration type key: ' + decorationTypeKey);
		}
		return provider.getOptions(this, writable);
	}

}

interface IModelDecorationOptionsProvider extends IDisposable {
	refCount: number;
	getOptions(codeEditorService: AbstractCodeEditorService, writable: boolean): IModelDecorationOptions;
}

class DecorationSubTypeOptionsProvider implements IModelDecorationOptionsProvider {

	public refCount: number;

	private _parentTypeKey: string;
	private _beforeContentRules: DecorationCSSRules;
	private _afterContentRules: DecorationCSSRules;

	constructor(themeService: IThemeService, providerArgs: ProviderArguments) {
		this._parentTypeKey = providerArgs.parentTypeKey;
		this.refCount = 0;

		this._beforeContentRules = new DecorationCSSRules(ModelDecorationCSSRuleType.BeforeContentClassName, providerArgs, themeService);
		this._afterContentRules = new DecorationCSSRules(ModelDecorationCSSRuleType.AfterContentClassName, providerArgs, themeService);
	}

	public getOptions(codeEditorService: AbstractCodeEditorService, writable: boolean): IModelDecorationOptions {
		let options = codeEditorService.resolveDecorationOptions(this._parentTypeKey, true);
		if (this._beforeContentRules) {
			options.beforeContentClassName = this._beforeContentRules.className;
		}
		if (this._afterContentRules) {
			options.afterContentClassName = this._afterContentRules.className;
		}
		return options;
	}

	public dispose(): void {
		if (this._beforeContentRules) {
			this._beforeContentRules.dispose();
			this._beforeContentRules = null;
		}
		if (this._afterContentRules) {
			this._afterContentRules.dispose();
			this._afterContentRules = null;
		}
	}
}

interface ProviderArguments {
	styleSheet: HTMLStyleElement;
	key: string;
	parentTypeKey?: string;
	options: IDecorationRenderOptions;
}


class DecorationTypeOptionsProvider implements IModelDecorationOptionsProvider {

	private _disposables: IDisposable[];
	public refCount: number;

	public className: string;
	public inlineClassName: string;
	public beforeContentClassName: string;
	public afterContentClassName: string;
	public glyphMarginClassName: string;
	public isWholeLine: boolean;
	public overviewRuler: IModelDecorationOverviewRulerOptions;
	public stickiness: TrackedRangeStickiness;

	constructor(themeService: IThemeService, providerArgs: ProviderArguments) {
		this.refCount = 0;
		this._disposables = [];

		let createCSSRules = (type: ModelDecorationCSSRuleType) => {
			let rules = new DecorationCSSRules(type, providerArgs, themeService);
			if (rules.hasContent) {
				this._disposables.push(rules);
				return rules.className;
			}
			return void 0;
		};

		this.className = createCSSRules(ModelDecorationCSSRuleType.ClassName);
		this.inlineClassName = createCSSRules(ModelDecorationCSSRuleType.InlineClassName);
		this.beforeContentClassName = createCSSRules(ModelDecorationCSSRuleType.BeforeContentClassName);
		this.afterContentClassName = createCSSRules(ModelDecorationCSSRuleType.AfterContentClassName);
		this.glyphMarginClassName = createCSSRules(ModelDecorationCSSRuleType.GlyphMarginClassName);

		let options = providerArgs.options;
		this.isWholeLine = Boolean(options.isWholeLine);
		this.stickiness = options.rangeBehavior;

		let lightOverviewRulerColor = options.light && options.light.overviewRulerColor || options.overviewRulerColor;
		let darkOverviewRulerColor = options.dark && options.dark.overviewRulerColor || options.overviewRulerColor;
		if (
			typeof lightOverviewRulerColor !== 'undefined'
			|| typeof darkOverviewRulerColor !== 'undefined'
		) {
			this.overviewRuler = {
				color: lightOverviewRulerColor || darkOverviewRulerColor,
				darkColor: darkOverviewRulerColor || lightOverviewRulerColor,
				position: options.overviewRulerLane || OverviewRulerLane.Center
			};
		}
	}

	public getOptions(codeEditorService: AbstractCodeEditorService, writable: boolean): IModelDecorationOptions {
		if (!writable) {
			return this;
		}
		return {
			inlineClassName: this.inlineClassName,
			beforeContentClassName: this.beforeContentClassName,
			afterContentClassName: this.afterContentClassName,
			className: this.className,
			glyphMarginClassName: this.glyphMarginClassName,
			isWholeLine: this.isWholeLine,
			overviewRuler: this.overviewRuler,
			stickiness: this.stickiness
		};
	}

	public dispose(): void {
		this._disposables = disposeAll(this._disposables);
	}
}


const _CSS_MAP = {
	color: 'color:{0} !important;',
	backgroundColor: 'background-color:{0};',

	outline: 'outline:{0};',
	outlineColor: 'outline-color:{0};',
	outlineStyle: 'outline-style:{0};',
	outlineWidth: 'outline-width:{0};',

	border: 'border:{0};',
	borderColor: 'border-color:{0};',
	borderRadius: 'border-radius:{0};',
	borderSpacing: 'border-spacing:{0};',
	borderStyle: 'border-style:{0};',
	borderWidth: 'border-width:{0};',

	textDecoration: 'text-decoration:{0};',
	cursor: 'cursor:{0};',
	letterSpacing: 'letter-spacing:{0};',

	gutterIconPath: 'background:url(\'{0}\') center center no-repeat;',
	gutterIconSize: 'background-size:{0};',

	contentText: 'content:\'{0}\';',
	contentIconPath: 'content:url(\'{0}\');',
	margin: 'margin:{0};',
	width: 'width:{0};',
	height: 'height:{0};'
};


class DecorationCSSRules {

	private _theme: ITheme;
	private _className: string;
	private _unThemedSelector: string;
	private _hasContent: boolean;
	private _ruleType: ModelDecorationCSSRuleType;
	private _themeListener: IDisposable;
	private _providerArgs: ProviderArguments;
	private _usesThemeColors: boolean;

	public constructor(ruleType: ModelDecorationCSSRuleType, providerArgs: ProviderArguments, themeService: IThemeService) {
		this._theme = themeService.getTheme();
		this._ruleType = ruleType;
		this._providerArgs = providerArgs;
		this._usesThemeColors = false;
		this._hasContent = false;

		let className = CSSNameHelper.getClassName(this._providerArgs.key, ruleType);
		if (this._providerArgs.parentTypeKey) {
			className = className + ' ' + CSSNameHelper.getClassName(this._providerArgs.parentTypeKey, ruleType);
		}
		this._className = className;

		this._unThemedSelector = CSSNameHelper.getSelector(this._providerArgs.key, this._providerArgs.parentTypeKey, ruleType);

		this._buildCSS();

		if (this._usesThemeColors) {
			this._themeListener = themeService.onThemeChange(theme => {
				this._theme = themeService.getTheme();
				this._removeCSS();
				this._buildCSS();
			});
		}
	}

	public dispose() {
		if (this._hasContent) {
			this._removeCSS();
			this._hasContent = false;
		}
		if (this._themeListener) {
			this._themeListener.dispose();
			this._themeListener = null;
		}
	}

	public get hasContent(): boolean {
		return this._hasContent;
	}

	public get className(): string {
		return this._className;
	}

	private _buildCSS(): void {
		let options = this._providerArgs.options;
		let unthemedCSS, lightCSS, darkCSS: string;
		switch (this._ruleType) {
			case ModelDecorationCSSRuleType.ClassName:
				unthemedCSS = this.getCSSTextForModelDecorationClassName(options);
				lightCSS = this.getCSSTextForModelDecorationClassName(options.light);
				darkCSS = this.getCSSTextForModelDecorationClassName(options.dark);
				break;
			case ModelDecorationCSSRuleType.InlineClassName:
				unthemedCSS = this.getCSSTextForModelDecorationInlineClassName(options);
				lightCSS = this.getCSSTextForModelDecorationInlineClassName(options.light);
				darkCSS = this.getCSSTextForModelDecorationInlineClassName(options.dark);
				break;
			case ModelDecorationCSSRuleType.GlyphMarginClassName:
				unthemedCSS = this.getCSSTextForModelDecorationGlyphMarginClassName(options);
				lightCSS = this.getCSSTextForModelDecorationGlyphMarginClassName(options.light);
				darkCSS = this.getCSSTextForModelDecorationGlyphMarginClassName(options.dark);
				break;
			case ModelDecorationCSSRuleType.BeforeContentClassName:
				unthemedCSS = this.getCSSTextForModelDecorationContentClassName(options.before);
				lightCSS = this.getCSSTextForModelDecorationContentClassName(options.light && options.light.before);
				darkCSS = this.getCSSTextForModelDecorationContentClassName(options.dark && options.dark.before);
				break;
			case ModelDecorationCSSRuleType.AfterContentClassName:
				unthemedCSS = this.getCSSTextForModelDecorationContentClassName(options.after);
				lightCSS = this.getCSSTextForModelDecorationContentClassName(options.light && options.light.after);
				darkCSS = this.getCSSTextForModelDecorationContentClassName(options.dark && options.dark.after);
				break;
			default:
				throw new Error('Unknown rule type: ' + this._ruleType);
		}
		let sheet = <CSSStyleSheet>this._providerArgs.styleSheet.sheet;

		let hasContent = false;
		if (unthemedCSS.length > 0) {
			sheet.insertRule(`${this._unThemedSelector} {${unthemedCSS}}`, 0);
			hasContent = true;
		}
		if (lightCSS.length > 0) {
			sheet.insertRule(`.vs${this._unThemedSelector} {${lightCSS}}`, 0);
			hasContent = true;
		}
		if (darkCSS.length > 0) {
			sheet.insertRule(`.vs-dark${this._unThemedSelector}, .hc-black${this._unThemedSelector} {${darkCSS}}`, 0);
			hasContent = true;
		}
		this._hasContent = hasContent;
	}

	private _removeCSS(): void {
		dom.removeCSSRulesContainingSelector(this._unThemedSelector, this._providerArgs.styleSheet);
	}

	/**
	 * Build the CSS for decorations styled via `className`.
	 */
	private getCSSTextForModelDecorationClassName(opts: IThemeDecorationRenderOptions): string {
		if (!opts) {
			return '';
		}
		let cssTextArr: string[] = [];
		this.collectCSSText(opts, ['backgroundColor'], cssTextArr);
		if (this.collectCSSText(opts, ['outline', 'outlineColor'], cssTextArr)) {
			this.collectCSSText(opts, ['outlineStyle', 'outlineWidth'], cssTextArr);
		}
		return cssTextArr.join('');
	}

	/**
	 * Build the CSS for decorations styled via `inlineClassName`.
	 */
	private getCSSTextForModelDecorationInlineClassName(opts: IThemeDecorationRenderOptions): string {
		if (!opts) {
			return '';
		}
		let cssTextArr: string[] = [];
		this.collectCSSText(opts, ['textDecoration', 'cursor', 'color', 'letterSpacing'], cssTextArr);
		return cssTextArr.join('');
	}

	/**
	 * Build the CSS for decorations styled before or after content.
	 */
	private getCSSTextForModelDecorationContentClassName(opts: IContentDecorationRenderOptions): string {
		if (!opts) {
			return '';
		}
		let cssTextArr: string[] = [];

		if (typeof opts !== 'undefined') {
			this.collectBorderSettingsCSSText(opts, cssTextArr);
			if (typeof opts.contentIconPath === 'string') {
				cssTextArr.push(strings.format(_CSS_MAP.contentIconPath, URI.file(opts.contentIconPath).toString().replace(/'/g, '%27')));
			} else if (opts.contentIconPath instanceof URI) {
				cssTextArr.push(strings.format(_CSS_MAP.contentIconPath, opts.contentIconPath.toString(true).replace(/'/g, '%27')));
			}
			if (typeof opts.contentText === 'string') {
				const truncated = opts.contentText.match(/^.*$/m)[0]; // only take first line
				const escaped = truncated.replace(/['\\]/g, '\\$&');

				cssTextArr.push(strings.format(_CSS_MAP.contentText, escaped));
			}
			this.collectCSSText(opts, ['textDecoration', 'color', 'backgroundColor', 'margin'], cssTextArr);
			if (this.collectCSSText(opts, ['width', 'height'], cssTextArr)) {
				cssTextArr.push('display:inline-block;');
			}
		}

		return cssTextArr.join('');
	}

	/**
	 * Build the CSS for decorations styled via `glpyhMarginClassName`.
	 */
	private getCSSTextForModelDecorationGlyphMarginClassName(opts: IThemeDecorationRenderOptions): string {
		if (!opts) {
			return '';
		}
		let cssTextArr = [];

		if (typeof opts.gutterIconPath !== 'undefined') {
			if (typeof opts.gutterIconPath === 'string') {
				cssTextArr.push(strings.format(_CSS_MAP.gutterIconPath, URI.file(opts.gutterIconPath).toString()));
			} else {
				cssTextArr.push(strings.format(_CSS_MAP.gutterIconPath, opts.gutterIconPath.toString(true).replace(/'/g, '%27')));
			}
			if (typeof opts.gutterIconSize !== 'undefined') {
				cssTextArr.push(strings.format(_CSS_MAP.gutterIconSize, opts.gutterIconSize));
			}
		}

		return cssTextArr.join('');
	}

	private collectBorderSettingsCSSText(opts: any, cssTextArr: string[]): boolean {
		if (this.collectCSSText(opts, ['border', 'borderColor'], cssTextArr)) {
			this.collectCSSText(opts, ['borderRadius', 'borderSpacing', 'borderStyle', 'borderWidth'], cssTextArr);
			cssTextArr.push(strings.format('box-sizing: border-box;'));
			return true;
		}
		return false;
	}

	private collectCSSText(opts: any, properties: string[], cssTextArr: string[]): boolean {
		let lenBefore = cssTextArr.length;
		for (let property of properties) {
			let value = this.resolveValue(opts[property]);
			if (typeof value === 'string') {
				cssTextArr.push(strings.format(_CSS_MAP[property], value));
			}
		}
		return cssTextArr.length !== lenBefore;
	}

	private resolveValue(value: string | ThemeColor): string {
		if (isThemeColor(value)) {
			this._usesThemeColors = true;
			let color = this._theme.getColor(value.id);
			if (color) {
				return color.toString();
			}
			return void 0;
		}
		return value;
	}
}

const enum ModelDecorationCSSRuleType {
	ClassName = 0,
	InlineClassName = 1,
	GlyphMarginClassName = 2,
	BeforeContentClassName = 3,
	AfterContentClassName = 4
}

class CSSNameHelper {

	public static getClassName(key: string, type: ModelDecorationCSSRuleType): string {
		return 'ced-' + key + '-' + type;
	}

	public static getSelector(key: string, parentKey: string, ruleType: ModelDecorationCSSRuleType): string {
		let selector = '.monaco-editor .' + this.getClassName(key, ruleType);
		if (parentKey) {
			selector = selector + '.' + this.getClassName(parentKey, ruleType);
		}
		if (ruleType === ModelDecorationCSSRuleType.BeforeContentClassName) {
			selector += '::before';
		} else if (ruleType === ModelDecorationCSSRuleType.AfterContentClassName) {
			selector += '::after';
		}
		return selector;
	}
}
