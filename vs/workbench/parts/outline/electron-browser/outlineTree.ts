/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import 'vs/css!./media/outline';
import { TPromise } from 'vs/base/common/winjs.base';
import * as dom from 'vs/base/browser/dom';
import { symbolKindToCssClass } from 'vs/editor/common/modes';
import { Range } from 'vs/editor/common/core/range';
import { IDataSource, IRenderer, ITree, ISorter, IFilter } from 'vs/base/parts/tree/browser/tree';
import { OneOutline, OutlineItem } from './outlineModel';
import { HighlightedLabel } from '../../../../base/browser/ui/highlightedlabel/highlightedLabel';
import { createMatches } from '../../../../base/common/filters';

export class OutlineItemComparator implements ISorter {
	compare(tree: ITree, a: OutlineItem, b: OutlineItem): number {
		return Range.compareRangesUsingStarts(a.symbol.location.range, b.symbol.location.range);
	}
}

export class OutlineItemFilter implements IFilter {

	isVisible(tree: ITree, element: OutlineItem): boolean {
		return Boolean(element.matches);
	}
}

export class OutlineDataSource implements IDataSource {

	getId(tree: ITree, element: OutlineItem | any): string {
		if (element instanceof OutlineItem) {
			return element.id;
		} else {
			return 'root';
		}
	}

	hasChildren(tree: ITree, element: OneOutline | OutlineItem): boolean {
		if (element instanceof OneOutline) {
			return element.children.length > 0;
		} else {
			return element.children.length > 0 && element.children.some(child => Boolean(child.matches));
		}
	}

	async getChildren(tree: ITree, element: OneOutline | OutlineItem): TPromise<any, any> {
		return element.children;
	}

	async getParent(tree: ITree, element: OneOutline | OutlineItem): TPromise<any, any> {
		return element instanceof OutlineItem ? element.parent : undefined;
	}
}

export interface OutlineItemTemplate {
	icon: HTMLSpanElement;
	label: HighlightedLabel;
}

export class OutlineRenderer implements IRenderer {
	getHeight(tree: ITree, element: OutlineItem): number {
		return 22;
	}
	getTemplateId(tree: ITree, element: OutlineItem): string {
		return 'outline.element';
	}
	renderTemplate(tree: ITree, templateId: string, container: HTMLElement): OutlineItemTemplate {
		const icon = dom.$('.icon');
		container.appendChild(icon);
		const label = new HighlightedLabel(container);
		return { icon, label };
	}
	renderElement(tree: ITree, element: OutlineItem, templateId: string, template: OutlineItemTemplate): void {
		template.icon.classList.add(symbolKindToCssClass((<OutlineItem>element).symbol.kind));
		template.label.set(element.symbol.name, element.matches ? createMatches(element.matches[1]) : []);
	}
	disposeTemplate(tree: ITree, templateId: string, template: OutlineItemTemplate): void {
		template.label.dispose();
	}
}
