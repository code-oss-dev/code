/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from 'vs/base/common/async';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import * as dom from 'vs/base/browser/dom';
import { ThemeColor } from 'vs/platform/theme/common/themeService';

/**
 * A helper to create dynamic css rules, bound to a class name.
 * Rules are reused.
 * Reference counting and delayed garbage collection ensure that no rules leak.
*/
export class DynamicCssRules {
	private counter = 0;
	private readonly rules = new Map<string, RefCountedCssRule>();

	// We delay garbage collection so that hanging rules can be reused.
	private readonly garbageCollectionScheduler = new RunOnceScheduler(() => this.garbageCollect(), 1000);

	constructor(private readonly editor: ICodeEditor) {
	}

	public createClassNameRef(options: CssProperties): ClassNameReference {
		const rule = this.getOrCreateRule(options);
		rule.increaseRefCount();

		return {
			className: rule.className,
			dispose: () => {
				rule.decreaseRefCount();
				this.garbageCollectionScheduler.schedule();
			}
		};
	}

	private getOrCreateRule(properties: CssProperties): RefCountedCssRule {
		const key = this.computeUniqueKey(properties);
		let existingRule = this.rules.get(key);
		if (!existingRule) {
			const counter = this.counter++;
			existingRule = new RefCountedCssRule(key, `dyn-rule-${counter}`,
				dom.isInShadowDOM(this.editor.getContainerDomNode())
					? this.editor.getContainerDomNode()
					: undefined,
				properties
			);
			this.rules.set(key, existingRule);
		}
		return existingRule;
	}

	private computeUniqueKey(properties: CssProperties): string {
		return JSON.stringify(properties);
	}

	private garbageCollect() {
		for (const rule of this.rules.values()) {
			if (!rule.hasReferences()) {
				this.rules.delete(rule.key);
				rule.dispose();
			}
		}
	}
}

export interface ClassNameReference extends IDisposable {
	className: string;
}

export interface CssProperties {
	border?: string;
	borderColor?: string | ThemeColor;
	borderRadius?: string;
	fontStyle?: string;
	fontWeight?: string;
	fontSize?: string;
	fontFamily?: string;
	textDecoration?: string;
	color?: string | ThemeColor;
	backgroundColor?: string | ThemeColor;
	opacity?: string;
	verticalAlign?: string;

	margin?: string;
	padding?: string;
	width?: string;
	height?: string;
}

class RefCountedCssRule {
	private referenceCount: number = 0;
	private styleElement: HTMLStyleElement;

	constructor(
		public readonly key: string,
		public readonly className: string,
		containerElement: HTMLElement | undefined,
		public readonly properties: CssProperties,
	) {
		this.styleElement = dom.createStyleSheet(
			containerElement
		);

		this.styleElement.textContent = this.getCssText(this.className, this.properties);
	}

	private getCssText(className: string, properties: CssProperties): string {
		let str = `.${className} {`;
		for (const prop in properties) {
			const value = (properties as any)[prop] as string | ThemeColor;
			let cssValue;
			if (typeof value === 'object') {
				cssValue = `var(${themeColorToCssVar(value)})`;
			} else {
				cssValue = value;
			}

			const cssPropName = camelToDashes(prop);
			str += `\n\t${cssPropName}: ${cssValue};`;
		}
		str += `\n}`;
		return str;
	}

	public dispose(): void {
		this.styleElement.remove();
	}

	public increaseRefCount(): void {
		this.referenceCount++;
	}

	public decreaseRefCount(): void {
		this.referenceCount--;
	}

	public hasReferences(): boolean {
		return this.referenceCount > 0;
	}
}

function camelToDashes(str: string): string {
	return str.replace(/(^[A-Z])/, ([first]) => first.toLowerCase())
		.replace(/([A-Z])/g, ([letter]) => `-${letter.toLowerCase()}`);
}

function themeColorToCssVar(themeColor: ThemeColor): string {
	return `--vscode-${themeColor.id.replace('.', '-')}`;
}
