/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { FileOperationError, FileOperationResult, IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { IProfileResource, IProfileResourceTreeItem, ProfileResourceType } from 'vs/workbench/services/userDataProfile/common/userDataProfile';
import { platform, Platform } from 'vs/base/common/platform';
import { ITreeItemCheckboxState, TreeItemCollapsibleState } from 'vs/workbench/common/views';
import { IUserDataProfile } from 'vs/platform/userDataProfile/common/userDataProfile';
import { API_OPEN_EDITOR_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { localize } from 'vs/nls';

interface IKeybindingsResourceContent {
	platform: Platform;
	keybindings: string | null;
}

export class KeybindingsResource implements IProfileResource {

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
	}

	async getContent(profile: IUserDataProfile): Promise<string> {
		const keybindingsContent = await this.getKeybindingsResourceContent(profile);
		return JSON.stringify(keybindingsContent);
	}

	async getKeybindingsResourceContent(profile: IUserDataProfile): Promise<IKeybindingsResourceContent> {
		const keybindings = await this.getKeybindingsContent(profile);
		return { keybindings, platform };
	}

	async apply(content: string, profile: IUserDataProfile): Promise<void> {
		const keybindingsContent: IKeybindingsResourceContent = JSON.parse(content);
		if (keybindingsContent.keybindings === null) {
			this.logService.info(`Profile: No keybindings to apply...`);
			return;
		}
		await this.fileService.writeFile(profile.keybindingsResource, VSBuffer.fromString(keybindingsContent.keybindings));
	}

	private async getKeybindingsContent(profile: IUserDataProfile): Promise<string | null> {
		try {
			const content = await this.fileService.readFile(profile.keybindingsResource);
			return content.value.toString();
		} catch (error) {
			// File not found
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return null;
			} else {
				throw error;
			}
		}
	}

}

export class KeybindingsResourceTreeItem implements IProfileResourceTreeItem {

	readonly type = ProfileResourceType.Keybindings;
	readonly handle = this.profile.keybindingsResource.toString();
	readonly label = { label: localize('keybindings', "Keyboard Shortcuts") };
	readonly collapsibleState = TreeItemCollapsibleState.None;
	checkbox: ITreeItemCheckboxState = { isChecked: true };
	readonly command = {
		id: API_OPEN_EDITOR_COMMAND_ID,
		title: '',
		arguments: [this.profile.keybindingsResource, undefined, undefined]
	};

	constructor(
		private readonly profile: IUserDataProfile,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	async getChildren(): Promise<undefined> { return undefined; }

	async hasContent(): Promise<boolean> {
		const keybindingsContent = await this.instantiationService.createInstance(KeybindingsResource).getKeybindingsResourceContent(this.profile);
		return keybindingsContent.keybindings !== null;
	}

	async getContent(): Promise<string> {
		return this.instantiationService.createInstance(KeybindingsResource).getContent(this.profile);
	}

}
