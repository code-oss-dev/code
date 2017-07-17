/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { IWorkspacesMainService, IWorkspaceIdentifier, IStoredWorkspace, WORKSPACE_EXTENSION, IWorkspaceSavedEvent } from "vs/platform/workspaces/common/workspaces";
import { TPromise } from "vs/base/common/winjs.base";
import { isParent } from "vs/platform/files/common/files";
import { IEnvironmentService } from "vs/platform/environment/common/environment";
import { extname, join, dirname } from "path";
import { mkdirp, writeFile, exists, del } from "vs/base/node/pfs";
import { readFileSync } from "fs";
import { isLinux } from "vs/base/common/platform";
import { copy } from "vs/base/node/extfs";
import { nfcall } from "vs/base/common/async";
import { localize } from "vs/nls";
import Event, { Emitter } from "vs/base/common/event";
import { ILogService } from "vs/platform/log/common/log";

export class WorkspacesMainService implements IWorkspacesMainService {

	public _serviceBrand: any;

	protected workspacesHome: string;

	private _onWorkspaceSaved: Emitter<IWorkspaceSavedEvent>;

	constructor(
		@IEnvironmentService private environmentService: IEnvironmentService,
		@ILogService private logService: ILogService
	) {
		this.workspacesHome = environmentService.workspacesHome;
		this._onWorkspaceSaved = new Emitter<IWorkspaceSavedEvent>();
	}

	public get onWorkspaceSaved(): Event<IWorkspaceSavedEvent> {
		return this._onWorkspaceSaved.event;
	}

	public resolveWorkspaceSync(path: string): IWorkspaceIdentifier {
		const isWorkspace = this.isInsideWorkspacesHome(path) || extname(path) === `.${WORKSPACE_EXTENSION}`;
		if (!isWorkspace) {
			return null; // does not look like a valid workspace config file
		}

		try {
			const workspace = JSON.parse(readFileSync(path, 'utf8')) as IStoredWorkspace;
			if (typeof workspace.id !== 'string' || !Array.isArray(workspace.folders) || workspace.folders.length === 0) {
				this.logService.log(`${path} looks like an invalid workspace file.`);

				return null; // looks like an invalid workspace file
			}

			return {
				id: workspace.id,
				configPath: path
			};
		} catch (error) {
			this.logService.log(`${path} cannot be parsed as JSON file (${error}).`);

			return null; // unable to read or parse as workspace file
		}
	}

	private isInsideWorkspacesHome(path: string): boolean {
		return isParent(path, this.environmentService.workspacesHome, !isLinux /* ignore case */);
	}

	public createWorkspace(folders: string[]): TPromise<IWorkspaceIdentifier> {
		if (!folders.length) {
			return TPromise.wrapError(new Error('Creating a workspace requires at least one folder.'));
		}

		const workspaceId = this.nextWorkspaceId();
		const workspaceConfigFolder = join(this.workspacesHome, workspaceId);
		const workspaceConfigPath = join(workspaceConfigFolder, 'workspace.json');

		return mkdirp(workspaceConfigFolder).then(() => {
			const storedWorkspace: IStoredWorkspace = {
				id: workspaceId,
				folders
			};

			return writeFile(workspaceConfigPath, JSON.stringify(storedWorkspace, null, '\t')).then(() => ({
				id: workspaceId,
				configPath: workspaceConfigPath
			}));
		});
	}

	private nextWorkspaceId(): string {
		return (Date.now() + Math.round(Math.random() * 1000)).toString();
	}

	public isUntitledWorkspace(workspace: IWorkspaceIdentifier): boolean {
		return this.isInsideWorkspacesHome(workspace.configPath);
	}

	public saveWorkspace(workspace: IWorkspaceIdentifier, target: string): TPromise<IWorkspaceIdentifier> {
		return exists(target).then(exists => {
			if (exists) {
				return TPromise.wrapError(new Error(localize('targetExists', "A workspace with the same name already exists at the provided location.")));
			}

			return nfcall(copy, workspace.configPath, target).then(() => {
				const savedWorkspace = this.resolveWorkspaceSync(target);

				// Event
				this._onWorkspaceSaved.fire({ workspace: savedWorkspace, oldConfigPath: workspace.configPath });

				// Delete untitled workspace
				this.deleteWorkspace(workspace).done(null, error => this.logService.log(`Unable to delete untitled workspace (${error})`));

				return savedWorkspace;
			});
		});
	}

	protected deleteWorkspace(workspace: IWorkspaceIdentifier): TPromise<boolean> {
		if (!this.isUntitledWorkspace(workspace)) {
			return TPromise.as(false); // only supported for untitled workspaces
		}

		return del(dirname(workspace.configPath)).then(() => true);
	}
}