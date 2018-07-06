/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { localize } from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import { EditorInput } from 'vs/workbench/common/editor';
import { IExtension } from 'vs/workbench/parts/extensions/common/extensions';
import URI from 'vs/base/common/uri';
import { IExtensionManagementServerService, IExtensionManagementServer } from 'vs/platform/extensionManagement/common/extensionManagement';

export class ExtensionsInput extends EditorInput {

	static readonly ID = 'workbench.extensions.input2';
	get extension(): IExtension { return this._extension; }
	get servers(): IExtensionManagementServer[] { return this.extensionManagementServerService.extensionManagementServers; }

	constructor(
		private _extension: IExtension,
		@IExtensionManagementServerService private extensionManagementServerService: IExtensionManagementServerService
	) {
		super();
	}

	getTypeId(): string {
		return ExtensionsInput.ID;
	}

	getName(): string {
		return localize('extensionsInputName', "Extension: {0}", this.extension.displayName);
	}

	matches(other: any): boolean {
		if (!(other instanceof ExtensionsInput)) {
			return false;
		}

		const otherExtensionInput = other as ExtensionsInput;

		// TODO@joao is this correct?
		return this.extension === otherExtensionInput.extension;
	}

	resolve(): TPromise<any> {
		return TPromise.as(null);
	}

	supportsSplitEditor(): boolean {
		return false;
	}

	getResource(): URI {
		return URI.from({
			scheme: 'extension',
			path: this.extension.id
		});
	}
}