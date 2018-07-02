/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./iconlabel';
import * as dom from 'vs/base/browser/dom';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IMatch } from 'vs/base/common/filters';
import uri from 'vs/base/common/uri';
import * as paths from 'vs/base/common/paths';
import { IWorkspaceFolderProvider, getPathLabel, IUserHomeProvider, getBaseLabel } from 'vs/base/common/labels';
import { IDisposable, combinedDisposable, Disposable } from 'vs/base/common/lifecycle';

export interface IIconLabelCreationOptions {
	supportHighlights?: boolean;
	supportDescriptionHighlights?: boolean;
}

export interface IIconLabelValueOptions {
	title?: string;
	descriptionTitle?: string;
	extraClasses?: string[];
	italic?: boolean;
	matches?: IMatch[];
	descriptionMatches?: IMatch[];
}

class FastLabelNode {
	private disposed: boolean;
	private _textContent: string;
	private _className: string;
	private _title: string;
	private _empty: boolean;

	constructor(private _element: HTMLElement) {
	}

	get element(): HTMLElement {
		return this._element;
	}

	set textContent(content: string) {
		if (this.disposed || content === this._textContent) {
			return;
		}

		this._textContent = content;
		this._element.textContent = content;
	}

	set className(className: string) {
		if (this.disposed || className === this._className) {
			return;
		}

		this._className = className;
		this._element.className = className;
	}

	set title(title: string) {
		if (this.disposed || title === this._title) {
			return;
		}

		this._title = title;
		if (this._title) {
			this._element.title = title;
		} else {
			this._element.removeAttribute('title');
		}
	}

	set empty(empty: boolean) {
		if (this.disposed || empty === this._empty) {
			return;
		}

		this._empty = empty;
		this._element.style.marginLeft = empty ? '0' : null;
	}

	dispose(): void {
		this.disposed = true;
	}
}

export class IconLabel extends Disposable {
	private domNode: FastLabelNode;
	private labelDescriptionContainer: FastLabelNode;
	private labelNode: FastLabelNode | HighlightedLabel;
	private descriptionNode: FastLabelNode | HighlightedLabel;
	private descriptionNodeFactory: () => FastLabelNode | HighlightedLabel;

	constructor(container: HTMLElement, options?: IIconLabelCreationOptions) {
		super();

		this.domNode = this._register(new FastLabelNode(dom.append(container, dom.$('.monaco-icon-label'))));

		this.labelDescriptionContainer = this._register(new FastLabelNode(dom.append(this.domNode.element, dom.$('.monaco-icon-label-description-container'))));

		if (options && options.supportHighlights) {
			this.labelNode = this._register(new HighlightedLabel(dom.append(this.labelDescriptionContainer.element, dom.$('a.label-name'))));
		} else {
			this.labelNode = this._register(new FastLabelNode(dom.append(this.labelDescriptionContainer.element, dom.$('a.label-name'))));
		}

		if (options && options.supportDescriptionHighlights) {
			this.descriptionNodeFactory = () => this._register(new HighlightedLabel(dom.append(this.labelDescriptionContainer.element, dom.$('span.label-description'))));
		} else {
			this.descriptionNodeFactory = () => this._register(new FastLabelNode(dom.append(this.labelDescriptionContainer.element, dom.$('span.label-description'))));
		}
	}

	get element(): HTMLElement {
		return this.domNode.element;
	}

	onClick(callback: (event: MouseEvent) => void): IDisposable {
		return combinedDisposable([
			dom.addDisposableListener(this.labelDescriptionContainer.element, dom.EventType.CLICK, (e: MouseEvent) => callback(e)),
		]);
	}

	setValue(label?: string, description?: string, options?: IIconLabelValueOptions): void {
		const classes = ['monaco-icon-label'];
		if (options) {
			if (options.extraClasses) {
				classes.push(...options.extraClasses);
			}

			if (options.italic) {
				classes.push('italic');
			}
		}

		this.domNode.className = classes.join(' ');
		this.domNode.title = options && options.title ? options.title : '';

		if (this.labelNode instanceof HighlightedLabel) {
			this.labelNode.set(label || '', options ? options.matches : void 0);
		} else {
			this.labelNode.textContent = label || '';
		}

		if (description || this.descriptionNode) {
			if (!this.descriptionNode) {
				this.descriptionNode = this.descriptionNodeFactory(); // description node is created lazily on demand
			}

			if (this.descriptionNode instanceof HighlightedLabel) {
				this.descriptionNode.set(description || '', options ? options.descriptionMatches : void 0);
				if (options && options.descriptionTitle) {
					this.descriptionNode.element.title = options.descriptionTitle;
				} else {
					this.descriptionNode.element.removeAttribute('title');
				}
			} else {
				this.descriptionNode.textContent = description || '';
				this.descriptionNode.title = options && options.descriptionTitle ? options.descriptionTitle : '';
				this.descriptionNode.empty = !description;
			}
		}
	}
}

export class FileLabel extends IconLabel {

	constructor(container: HTMLElement, file: uri, provider: IWorkspaceFolderProvider, userHome?: IUserHomeProvider) {
		super(container);

		this.setFile(file, provider, userHome);
	}

	setFile(file: uri, provider: IWorkspaceFolderProvider, userHome: IUserHomeProvider): void {
		const parent = paths.dirname(file.fsPath);

		this.setValue(getBaseLabel(file), parent && parent !== '.' ? getPathLabel(parent, userHome, provider) : '', { title: file.fsPath });
	}
}
