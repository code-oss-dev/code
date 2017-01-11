/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import * as path from 'path';
import { WalkThroughInput } from 'vs/workbench/parts/walkThrough/common/walkThroughInput';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Position } from 'vs/platform/editor/common/editor';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IWindowService, IWindowsService } from 'vs/platform/windows/common/windows';
import { TPromise } from 'vs/base/common/winjs.base';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IConfigurationEditingService, ConfigurationTarget } from 'vs/workbench/services/configuration/common/configurationEditing';
import { localize } from 'vs/nls';
import { Action } from 'vs/base/common/actions';

const enabledKey = 'workbench.welcome.enabled';

export class WelcomePageContribution implements IWorkbenchContribution {

	constructor(
		@IPartService partService: IPartService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		const enabled = configurationService.lookup<boolean>(enabledKey).value;
		if (enabled) {
			partService.joinCreation().then(() => {
				instantiationService.createInstance(WelcomePage);
			}).then(null, onUnexpectedError);
		}
	}

	public getId() {
		return 'vs.welcomePage';
	}
}

export class WelcomePageAction extends Action {

	public static ID = 'workbench.action.welcomePage';
	public static LABEL = localize('welcomePage', "Welcome");

	constructor(
		id: string,
		label: string,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super(id, label);
	}

	public run(): TPromise<void> {
		this.instantiationService.createInstance(WelcomePage);
		return null;
	}
}

class WelcomePage {

	constructor(
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IWindowService private windowService: IWindowService,
		@IWindowsService private windowsService: IWindowsService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IConfigurationEditingService private configurationEditingService: IConfigurationEditingService
	) {
		this.create();
	}

	private create() {
		const recentlyOpened = this.windowService.getRecentlyOpen();
		const uri = URI.parse(require.toUrl('./welcomePage.html'));
		const input = this.instantiationService.createInstance(WalkThroughInput, localize('welcome.title', "Welcome"), '', uri, container => this.onReady(container, recentlyOpened));
		this.editorService.openEditor(input, { pinned: true }, Position.ONE)
			.then(null, onUnexpectedError);
	}

	private onReady(container: HTMLElement, recentlyOpened: TPromise<{ files: string[]; folders: string[]; }>): void {
		const enabled = this.configurationService.lookup<boolean>(enabledKey).value;
		const showOnStartup = <HTMLInputElement>container.querySelector('#showOnStartup');
		if (enabled) {
			showOnStartup.setAttribute('checked', 'checked');
		}
		showOnStartup.addEventListener('click', e => {
			this.configurationEditingService.writeConfiguration(ConfigurationTarget.USER, { key: enabledKey, value: showOnStartup.checked })
				.then(null, onUnexpectedError);
		});

		recentlyOpened.then(({folders}) => {
			const ul = container.querySelector('.recent ul');
			if (this.contextService.hasWorkspace()) {
				const current = this.contextService.getWorkspace().resource.fsPath;
				folders = folders.filter(folder => folder !== current);
			}
			folders.slice(0, 5).forEach(folder => {
				const li = document.createElement('li');

				const a = document.createElement('a');
				const name = path.basename(folder);
				a.innerText = name;
				a.title = folder;
				a.href = 'javascript:void(0)';
				a.addEventListener('click', e => {
					this.windowsService.openWindow([folder]);
					e.preventDefault();
				});
				li.appendChild(a);

				const span = document.createElement('span');
				span.classList.add('path');
				const parentFolder = path.dirname(folder);
				span.innerText = parentFolder;
				span.title = folder;
				li.appendChild(span);

				ul.appendChild(li);
			});
		}).then(null, onUnexpectedError);
	}
}
