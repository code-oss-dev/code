/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/extensionEditor';
import { TPromise } from 'vs/base/common/winjs.base';
import { marked } from 'vs/base/common/marked/marked';
import { IDisposable, empty, dispose, toDisposable } from 'vs/base/common/lifecycle';
import { Builder } from 'vs/base/browser/builder';
import { append, emmet as $, addClass, removeClass, finalHandler } from 'vs/base/browser/dom';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { IViewletService } from 'vs/workbench/services/viewlet/common/viewletService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IRequestService } from 'vs/platform/request/common/request';
import { IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionsInput } from '../common/extensionsInput';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITemplateData } from './extensionsList';
import { RatingsWidget } from './extensionsWidgets';
import { EditorOptions } from 'vs/workbench/common/editor';
import { shell } from 'electron';
import product from 'vs/platform/product';
import { IExtensionsViewlet } from './extensions';

export class ExtensionEditor extends BaseEditor {

	static ID: string = 'workbench.editor.extension';

	private icon: HTMLElement;
	private name: HTMLAnchorElement;
	private publisher: HTMLAnchorElement;
	private installCount: HTMLElement;
	private rating: HTMLAnchorElement;
	private description: HTMLElement;
	private body: HTMLElement;

	private _highlight: ITemplateData;
	private highlightDisposable: IDisposable;

	private transientDisposables: IDisposable[];
	private disposables: IDisposable[];

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IExtensionGalleryService private galleryService: IExtensionGalleryService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IRequestService private requestService: IRequestService,
		@IViewletService private viewletService: IViewletService
	) {
		super(ExtensionEditor.ID, telemetryService);
		this._highlight = null;
		this.highlightDisposable = empty;
		this.disposables = [];
	}

	createEditor(parent: Builder): void {
		const container = parent.getHTMLElement();

		const root = append(container, $('.extension-editor'));
		const header = append(root, $('.header'));

		this.icon = append(header, $('.icon'));

		const details = append(header, $('.details'));
		this.name = append(details, $<HTMLAnchorElement>('a.name'));
		this.name.href = '#';

		const subtitle = append(details, $('.subtitle'));
		this.publisher = append(subtitle, $<HTMLAnchorElement>('a.publisher'));
		this.publisher.href = '#';
		this.installCount = append(subtitle, $('span.install'));
		this.rating = append(subtitle, $<HTMLAnchorElement>('a.rating'));
		this.rating.href = '#';

		this.description = append(details, $('p.description'));

		this.body = append(root, $('.body'));
	}

	setInput(input: ExtensionsInput, options: EditorOptions): TPromise<void> {
		this.transientDisposables = dispose(this.transientDisposables);

		this.body.innerHTML = '';

		let promise = TPromise.as(null);
		const extension = input.extension;

		this.icon.style.backgroundImage = `url("${ extension.iconUrl }")`;
		this.name.textContent = extension.displayName;
		this.publisher.textContent = extension.publisherDisplayName;
		this.description.textContent = extension.description;

		if (product.extensionsGallery) {
			const extensionUrl = `${ product.extensionsGallery.itemUrl }?itemName=${ extension.publisher }.${ extension.name }`;

			this.name.onclick = finalHandler(() => shell.openExternal(extensionUrl));
			this.rating.onclick = finalHandler(() => shell.openExternal(`${ extensionUrl }#review-details`));
			this.publisher.onclick = finalHandler(() => {
				this.viewletService.openViewlet('workbench.viewlet.extensions', true)
					.then(viewlet => viewlet as IExtensionsViewlet)
					.done(viewlet => viewlet.search(`publisher:"${ extension.publisherDisplayName }"`, true));
			});
		}

		const ratings = new RatingsWidget(this.rating, input.model, extension);
		this.transientDisposables.push(ratings);

		addClass(this.body, 'loading');

		if (extension.readmeUrl) {
			promise = super.setInput(input, options)
				.then(() => this.requestService.makeRequest({ url: extension.readmeUrl }))
				.then(response => response.responseText)
				.then(marked.parse)
				.then<void>(html => this.body.innerHTML = html)
				.then(null, err => console.error(err))
				.then(() => removeClass(this.body, 'loading'));
		}

		this.transientDisposables.push(toDisposable(() => promise.cancel()));

		return TPromise.as(null);
	}

	layout(): void {
		return;
	}

	dispose(): void {
		this._highlight = null;
		this.transientDisposables = dispose(this.transientDisposables);
		this.disposables = dispose(this.disposables);
		super.dispose();
	}
}
