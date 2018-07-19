/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as platform from 'vs/base/common/platform';
import * as extfs from 'vs/base/node/extfs';
import * as arrays from 'vs/base/common/arrays';
import { IBackupMainService, IBackupWorkspacesFormat } from 'vs/platform/backup/common/backup';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFilesConfiguration, HotExitConfiguration } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';

import { IWorkspaceIdentifier, isWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import URI from 'vs/base/common/uri';
import { isEqual as areResourcesEquals, getComparisonKey, hasToIgnoreCase } from 'vs/base/common/resources';
import { isEqual } from 'vs/base/common/paths';
import { Schemas } from 'vs/base/common/network';

export class BackupMainService implements IBackupMainService {

	public _serviceBrand: any;

	protected backupHome: string;
	protected workspacesJsonPath: string;

	protected rootWorkspaces: IWorkspaceIdentifier[];
	protected folderWorkspaces: URI[];
	protected emptyWorkspaces: string[];

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@IConfigurationService private configurationService: IConfigurationService,
		@ILogService private logService: ILogService
	) {
		this.backupHome = environmentService.backupHome;
		this.workspacesJsonPath = environmentService.backupWorkspacesPath;

		this.loadSync();
	}

	public getWorkspaceBackups(): IWorkspaceIdentifier[] {
		if (this.isHotExitOnExitAndWindowClose()) {
			// Only non-folder windows are restored on main process launch when
			// hot exit is configured as onExitAndWindowClose.
			return [];
		}

		return this.rootWorkspaces.slice(0); // return a copy
	}

	public getFolderBackupPaths(): URI[] {
		if (this.isHotExitOnExitAndWindowClose()) {
			// Only non-folder windows are restored on main process launch when
			// hot exit is configured as onExitAndWindowClose.
			return [];
		}
		return this.folderWorkspaces.slice(0); // return a copy
	}

	public isHotExitEnabled(): boolean {
		return this.getHotExitConfig() !== HotExitConfiguration.OFF;
	}

	private isHotExitOnExitAndWindowClose(): boolean {
		return this.getHotExitConfig() === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE;
	}

	private getHotExitConfig(): string {
		const config = this.configurationService.getValue<IFilesConfiguration>();

		return (config && config.files && config.files.hotExit) || HotExitConfiguration.ON_EXIT;
	}

	public getEmptyWindowBackupPaths(): string[] {
		return this.emptyWorkspaces.slice(0); // return a copy
	}

	public registerWorkspaceBackupSync(workspace: IWorkspaceIdentifier, migrateFrom?: string): string {
		if (!this.rootWorkspaces.some(w => w.id === workspace.id)) {
			this.rootWorkspaces.push(workspace);
			this.saveSync();
		}

		const backupPath = path.join(this.backupHome, workspace.id);

		if (migrateFrom) {
			this.moveBackupFolderSync(backupPath, migrateFrom);
		}

		return backupPath;
	}

	private moveBackupFolderSync(backupPath: string, moveFromPath: string): void {

		// Target exists: make sure to convert existing backups to empty window backups
		if (fs.existsSync(backupPath)) {
			this.convertToEmptyWindowBackup(backupPath);
		}

		// When we have data to migrate from, move it over to the target location
		if (fs.existsSync(moveFromPath)) {
			try {
				fs.renameSync(moveFromPath, backupPath);
			} catch (ex) {
				this.logService.error(`Backup: Could not move backup folder to new location: ${ex.toString()}`);
			}
		}
	}

	public unregisterWorkspaceBackupSync(workspace: IWorkspaceIdentifier): void {
		let index = arrays.firstIndex(this.rootWorkspaces, w => w.id === workspace.id);
		if (index !== -1) {
			this.rootWorkspaces.splice(index, 1);
			this.saveSync();
		}
	}

	public registerFolderBackupSync(folderUri: URI): string {
		if (!this.folderWorkspaces.some(uri => areResourcesEquals(folderUri, uri, hasToIgnoreCase(folderUri)))) {
			this.folderWorkspaces.push(folderUri);
			this.saveSync();
		}
		return path.join(this.backupHome, this.getFolderHash(folderUri));
	}

	public unregisterFolderBackupSync(folderUri: URI): void {
		let index = arrays.firstIndex(this.folderWorkspaces, uri => areResourcesEquals(folderUri, uri, hasToIgnoreCase(folderUri)));
		if (index !== -1) {
			this.folderWorkspaces.splice(index, 1);
			this.saveSync();
		}
	}

	public registerEmptyWindowBackupSync(backupFolder?: string): string {

		// Generate a new folder if this is a new empty workspace
		if (!backupFolder) {
			backupFolder = this.getRandomEmptyWindowId();
		}
		if (!this.emptyWorkspaces.some(w => isEqual(w, backupFolder, !platform.isLinux))) {
			this.emptyWorkspaces.push(backupFolder);
			this.saveSync();
		}
		return path.join(this.backupHome, backupFolder);
	}

	public unregisterEmptyWindowBackupSync(backupFolder: string): void {
		let index = arrays.firstIndex(this.emptyWorkspaces, w => isEqual(w, backupFolder, !platform.isLinux));
		if (index !== -1) {
			this.emptyWorkspaces.splice(index, 1);
			this.saveSync();
		}
	}

	protected loadSync(): void {

		let backups: IBackupWorkspacesFormat;
		try {
			backups = JSON.parse(fs.readFileSync(this.workspacesJsonPath, 'utf8').toString()); // invalid JSON or permission issue can happen here
		} catch (error) {
			backups = Object.create(null);
		}

		// read empty worrkspace backs first
		this.emptyWorkspaces = this.validateEmptyWorkspaces(backups.emptyWorkspaces);

		// read workspace backups
		this.rootWorkspaces = this.validateWorkspaces(backups.rootWorkspaces);

		// read folder backups
		let workspaceFolders;
		try {
			if (Array.isArray(backups.folderURIWorkspaces)) {
				workspaceFolders = backups.folderURIWorkspaces.map(f => URI.parse(f));
			} else if (Array.isArray(backups.folderWorkspaces)) {
				// legacy
				workspaceFolders = backups.folderWorkspaces.map(f => URI.file(f));
			}
		} catch (e) {
			// ignore URI parsing expeptions
		}
		this.folderWorkspaces = this.validateFolders(workspaceFolders);

		// save again in case some workspaces or folders have been removed
		this.saveSync();

	}

	private validateWorkspaces(rootWorkspaces: IWorkspaceIdentifier[]): IWorkspaceIdentifier[] {
		if (!Array.isArray(rootWorkspaces)) {
			return [];
		}

		const seenIds: { [id: string]: boolean } = Object.create(null);
		const result: IWorkspaceIdentifier[] = [];

		// Validate Workspaces
		for (let workspace of rootWorkspaces) {
			if (!isWorkspaceIdentifier(workspace)) {
				return []; // wrong format, skip all entries
			}

			if (!seenIds[workspace.id]) {
				seenIds[workspace.id] = true;

				const backupPath = path.join(this.backupHome, workspace.id);
				const hasBackups = this.hasBackupsSync(backupPath);

				// If the workspace has no backups, ignore it
				if (hasBackups) {
					if (fs.existsSync(workspace.configPath)) {
						result.push(workspace);
					} else {
						// If the workspace has backups, but the target workspace is missing, convert backups to empty ones
						this.convertToEmptyWindowBackup(backupPath);
					}
				} else {
					this.deleteStaleBackup(backupPath);
				}
			}
		}
		return result;
	}

	private validateFolders(folderWorkspaces: URI[]): URI[] {
		if (!Array.isArray(folderWorkspaces)) {
			return [];
		}

		const result: URI[] = [];
		const seen: { [id: string]: boolean } = Object.create(null);

		for (let folderURI of folderWorkspaces) {
			const key = getComparisonKey(folderURI);
			if (!seen[key]) {
				seen[key] = true;

				const backupPath = path.join(this.backupHome, this.getFolderHash(folderURI));
				const hasBackups = this.hasBackupsSync(backupPath);

				// If the folder has no backups, ignore it
				if (hasBackups) {
					if (folderURI.scheme !== Schemas.file || fs.existsSync(folderURI.fsPath)) {
						result.push(folderURI);
					} else {
						// If the folder has backups, but the target workspace is missing, convert backups to empty ones
						this.convertToEmptyWindowBackup(backupPath);
					}
				} else {
					this.deleteStaleBackup(backupPath);
				}
			}
		}

		return result;
	}
	private validateEmptyWorkspaces(emptyWorkspaces: string[]): string[] {
		if (!Array.isArray(emptyWorkspaces)) {
			return [];
		}


		const result: string[] = [];
		const seen: { [id: string]: boolean } = Object.create(null);

		// Validate Empty Windows
		for (let backupFolder of emptyWorkspaces) {
			if (typeof backupFolder !== 'string') {
				return [];
			}

			if (!seen[backupFolder]) {
				seen[backupFolder] = true;

				const backupPath = path.join(this.backupHome, backupFolder);
				if (this.hasBackupsSync(backupPath)) {
					result.push(backupFolder);
				} else {
					this.deleteStaleBackup(backupFolder);
				}
			}
		}

		return result;
	}

	private deleteStaleBackup(backupPath: string) {
		try {
			if (fs.existsSync(backupPath)) {
				extfs.delSync(backupPath);
			}
		} catch (ex) {
			this.logService.error(`Backup: Could not delete stale backup: ${ex.toString()}`);
		}
	}

	private convertToEmptyWindowBackup(backupPath: string): boolean {

		// New empty window backup
		let newBackupFolder = this.getRandomEmptyWindowId();
		while (this.emptyWorkspaces.some(w => isEqual(w, newBackupFolder, platform.isLinux))) {
			newBackupFolder = this.getRandomEmptyWindowId();
		}

		// Rename backupPath to new empty window backup path
		const newEmptyWindowBackupPath = path.join(this.backupHome, newBackupFolder);
		try {
			fs.renameSync(backupPath, newEmptyWindowBackupPath);
		} catch (ex) {
			this.logService.error(`Backup: Could not rename backup folder: ${ex.toString()}`);
			return false;
		}
		this.emptyWorkspaces.push(newBackupFolder);

		return true;
	}

	private hasBackupsSync(backupPath: string): boolean {
		try {
			const backupSchemas = extfs.readdirSync(backupPath);
			if (backupSchemas.length === 0) {
				return false; // empty backups
			}

			return backupSchemas.some(backupSchema => {
				try {
					return extfs.readdirSync(path.join(backupPath, backupSchema)).length > 0;
				} catch (error) {
					return false; // invalid folder
				}
			});
		} catch (error) {
			return false; // backup path does not exist
		}
	}

	private saveSync(): void {
		try {
			// The user data directory must exist so only the Backup directory needs to be checked.
			if (!fs.existsSync(this.backupHome)) {
				fs.mkdirSync(this.backupHome);
			}
			const backups: IBackupWorkspacesFormat = {
				rootWorkspaces: this.rootWorkspaces,
				folderURIWorkspaces: this.folderWorkspaces.map(f => f.toString()),
				emptyWorkspaces: this.emptyWorkspaces
			};

			extfs.writeFileAndFlushSync(this.workspacesJsonPath, JSON.stringify(backups));
		} catch (ex) {
			this.logService.error(`Backup: Could not save workspaces.json: ${ex.toString()}`);
		}
	}

	private getRandomEmptyWindowId(): string {
		return (Date.now() + Math.round(Math.random() * 1000)).toString();
	}

	protected getFolderHash(folderPath: URI): string {
		let key;
		if (folderPath.scheme === Schemas.file) {
			// for backward compatibility, use the path as key
			key = platform.isLinux ? folderPath.fsPath : folderPath.fsPath.toLowerCase();
		} else {
			key = hasToIgnoreCase(folderPath) ? folderPath.toString().toLowerCase() : folderPath.toString();
		}
		return crypto.createHash('md5').update(key).digest('hex');
	}
}