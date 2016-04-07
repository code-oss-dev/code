/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { Dimension, Builder } from 'vs/base/browser/builder';
import { append, emmet as $ } from 'vs/base/browser/dom';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { Position } from 'vs/platform/editor/common/editor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IRenderer, IDelegate } from 'vs/base/browser/ui/list/list';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { IExtension, IGalleryService } from '../common/extensions';

interface ITemplateData {
	container: HTMLElement;
	extension: HTMLElement;
	name: HTMLElement;
}

enum ExtensionState {
	Uninstalled,
	Installed,
	Outdated
}

interface IExtensionEntry {
	extension: IExtension;
	state: ExtensionState;
}

function extensionEntryCompare(one: IExtensionEntry, other: IExtensionEntry): number {
	const oneInstallCount = one.extension.galleryInformation ? one.extension.galleryInformation.installCount : 0;
	const otherInstallCount = other.extension.galleryInformation ? other.extension.galleryInformation.installCount : 0;
	const diff = otherInstallCount - oneInstallCount;

	if (diff !== 0) {
		return diff;
	}

	return one.extension.displayName.localeCompare(other.extension.displayName);
}

class Delegate implements IDelegate<IExtension> {
	getHeight() { return 84; }
	getTemplateId() { return 'extension'; }
}

class Renderer implements IRenderer<IExtensionEntry, ITemplateData> {

	constructor(
		@IInstantiationService private instantiationService: IInstantiationService
	) {}

	get templateId() { return 'extension'; }

	renderTemplate(container: HTMLElement): ITemplateData {
		const root = append(container, $('.extension-container'));
		const extension = append(root, $('.extension'));
		const name = append(extension, $('.span.name'));

		return {
			container: root,
			extension,
			name
		};
	}

	renderElement(entry: IExtensionEntry, index: number, data: ITemplateData): void {
		const extension = entry.extension;
		data.name.textContent = extension.displayName;
	}

	disposeTemplate(data: ITemplateData): void {
		// TODO
	}
}

export class ExtensionsPart extends BaseEditor {

	static ID: string = 'workbench.editor.extensionsPart';

	private list: List<IExtensionEntry>;
	private domNode: HTMLElement;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IGalleryService private galleryService: IGalleryService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super(ExtensionsPart.ID, telemetryService);
	}

	createEditor(parent: Builder): void {
		const container = parent.getHTMLElement();
		this.domNode = append(container, $('.extension-manager'));
		const extensions = append(this.domNode, $('.extensions'));
		this.list = new List(extensions, new Delegate(), [this.instantiationService.createInstance(Renderer)]);

		this.galleryService.query().then(({ firstPage }) => {
			const entries = firstPage
				.map(extension => ({
					extension,
					state: ExtensionState.Installed
				}))
				.sort(extensionEntryCompare);

			this.list.splice(0, this.list.length, ...entries);
		});
	}

	setVisible(visible: boolean, position?: Position): TPromise<void> {
		return super.setVisible(visible, position);
	}

	layout(dimension: Dimension): void {
		this.list.layout(dimension.height);
	}

	focus(): void {
		// TODO
	}

	dispose(): void {
		super.dispose();
	}
}
