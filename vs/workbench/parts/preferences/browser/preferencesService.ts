/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./media/preferences';
import * as network from 'vs/base/common/network';
import { TPromise } from 'vs/base/common/winjs.base';
import * as nls from 'vs/nls';
import URI from 'vs/base/common/uri';
import { LinkedMap as Map } from 'vs/base/common/map';
import * as labels from 'vs/base/common/labels';
import { Disposable } from 'vs/base/common/lifecycle';
import { SideBySideEditorInput, EditorInput } from 'vs/workbench/common/editor';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkspaceConfigurationService, WORKSPACE_CONFIG_DEFAULT_PATH } from 'vs/workbench/services/configuration/common/configuration';
import { Position, IEditor } from 'vs/platform/editor/common/editor';
import { IEditorGroupService } from 'vs/workbench/services/group/common/groupService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IFileService, IFileOperationResult, FileOperationResult } from 'vs/platform/files/common/files';
import { IMessageService, Severity, IChoiceService } from 'vs/platform/message/common/message';
import { IExtensionService } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationEditingService, ConfigurationTarget } from 'vs/workbench/services/configuration/common/configurationEditing';
import { IPreferencesService, IPreferencesEditorModel } from 'vs/workbench/parts/preferences/common/preferences';
import { SettingsEditorModel, DefaultSettingsEditorModel, DefaultKeybindingsEditorModel } from 'vs/workbench/parts/preferences/common/preferencesModels';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { DefaultPreferencesEditorInput } from 'vs/workbench/parts/preferences/browser/preferencesEditor';
import { ITextModelResolverService } from 'vs/editor/common/services/resolverService';

const SETTINGS_INFO_IGNORE_KEY = 'settings.workspace.info.ignore';

interface IWorkbenchSettingsConfiguration {
	workbench: {
		settings: {
			openDefaultSettings: boolean;
		}
	};
}

export class PreferencesService extends Disposable implements IPreferencesService {

	_serviceBrand: any;

	// TODO:@sandy merge these models into editor inputs by extending resource editor model
	private defaultPreferencesEditorModels: Map<URI, IPreferencesEditorModel>;
	private defaultSettingsEditorInputForUser: DefaultPreferencesEditorInput;
	private defaultSettingsEditorInputForWorkspace: DefaultPreferencesEditorInput;

	constructor(
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService,
		@IEditorGroupService private editorGroupService: IEditorGroupService,
		@IFileService private fileService: IFileService,
		@IWorkspaceConfigurationService private configurationService: IWorkspaceConfigurationService,
		@IMessageService private messageService: IMessageService,
		@IChoiceService private choiceService: IChoiceService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IStorageService private storageService: IStorageService,
		@IEnvironmentService private environmentService: IEnvironmentService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@ITextModelResolverService private textModelResolverService: ITextModelResolverService,
		@IConfigurationEditingService private configurationEditingService: IConfigurationEditingService,
		@IExtensionService private extensionService: IExtensionService
	) {
		super();
		this.defaultPreferencesEditorModels = new Map<URI, IPreferencesEditorModel>();
	}

	readonly defaultSettingsResource = URI.from({ scheme: network.Schemas.vscode, authority: 'defaultsettings', path: '/settings.json' });
	readonly defaultKeybindingsResource = URI.from({ scheme: network.Schemas.vscode, authority: 'defaultsettings', path: '/keybindings.json' });

	createDefaultPreferencesEditorModel(uri: URI): TPromise<IPreferencesEditorModel> {
		const editorModel = this.defaultPreferencesEditorModels.get(uri);
		if (editorModel) {
			return TPromise.as(editorModel);
		}

		if (this.defaultSettingsResource.fsPath === uri.fsPath) {
			return TPromise.join<any>([this.extensionService.onReady(), this.fetchMostCommonlyUsedSettings()])
				.then(result => {
					const mostCommonSettings = result[1];
					const model = this.instantiationService.createInstance(DefaultSettingsEditorModel, uri, mostCommonSettings);
					this.defaultPreferencesEditorModels.set(uri, model);
					return model;
				});
		}

		if (this.defaultKeybindingsResource.fsPath === uri.fsPath) {
			const model = this.instantiationService.createInstance(DefaultKeybindingsEditorModel, uri);
			this.defaultPreferencesEditorModels.set(uri, model);
			return TPromise.wrap(model);
		}

		return null;
	}

	public resolvePreferencesEditorModel(uri: URI): TPromise<IPreferencesEditorModel> {
		const model = this.defaultPreferencesEditorModels.get(uri);
		if (model) {
			return TPromise.wrap(model);
		}

		if (this.getEditableSettingsURI(ConfigurationTarget.USER).fsPath === uri.fsPath) {
			return this.resolveSettingsEditorModel(ConfigurationTarget.USER);
		}

		const workspaceSettingsUri = this.getEditableSettingsURI(ConfigurationTarget.WORKSPACE);
		if (workspaceSettingsUri && workspaceSettingsUri.fsPath === uri.fsPath) {
			return this.resolveSettingsEditorModel(ConfigurationTarget.WORKSPACE);
		}

		return TPromise.wrap(null);
	}

	openGlobalSettings(): TPromise<void> {
		if (this.configurationService.hasWorkspaceConfiguration() && !this.storageService.getBoolean(SETTINGS_INFO_IGNORE_KEY, StorageScope.WORKSPACE)) {
			this.promptToOpenWorkspaceSettings();
		}
		// Open settings
		return this.openSettings(ConfigurationTarget.USER);
	}

	openWorkspaceSettings(): TPromise<void> {
		if (!this.contextService.hasWorkspace()) {
			this.messageService.show(Severity.Info, nls.localize('openFolderFirst', "Open a folder first to create workspace settings"));
			return;
		}
		return this.openSettings(ConfigurationTarget.WORKSPACE);
	}

	openGlobalKeybindingSettings(): TPromise<void> {
		const emptyContents = '// ' + nls.localize('emptyKeybindingsHeader', "Place your key bindings in this file to overwrite the defaults") + '\n[\n]';
		return this.openTwoEditors(this.defaultKeybindingsResource, URI.file(this.environmentService.appKeybindingsPath), emptyContents).then(() => null);
	}

	private openEditableSettings(configurationTarget: ConfigurationTarget): TPromise<IEditor> {
		const emptySettingsContents = this.getEmptyEditableSettingsContent(configurationTarget);
		const settingsResource = this.getEditableSettingsURI(configurationTarget);
		return this.createIfNotExists(settingsResource, emptySettingsContents).then(() => this.editorService.openEditor({
			resource: settingsResource,
			options: { pinned: true }
		}));
	}

	private resolveSettingsEditorModel(configurationTarget: ConfigurationTarget): TPromise<SettingsEditorModel> {
		const settingsUri = this.getEditableSettingsURI(configurationTarget);
		if (settingsUri) {
			return this.textModelResolverService.createModelReference(settingsUri)
				.then(reference => this.instantiationService.createInstance(SettingsEditorModel, reference.object.textEditorModel, configurationTarget));
		}
		return TPromise.wrap(null);
	}

	private getEmptyEditableSettingsContent(configurationTarget: ConfigurationTarget): string {
		switch (configurationTarget) {
			case ConfigurationTarget.USER:
				const emptySettingsHeader = nls.localize('emptySettingsHeader', "Place your settings in this file to overwrite the default settings");
				return '// ' + emptySettingsHeader + '\n{\n}';
			case ConfigurationTarget.WORKSPACE:
				return [
					'// ' + nls.localize('emptySettingsHeader1', "Place your settings in this file to overwrite default and user settings."),
					'{',
					'}'
				].join('\n');
		}
	}

	private getEditableSettingsURI(configurationTarget: ConfigurationTarget): URI {
		switch (configurationTarget) {
			case ConfigurationTarget.USER:
				return URI.file(this.environmentService.appSettingsPath);
			case ConfigurationTarget.WORKSPACE:
				if (this.contextService.hasWorkspace()) {
					return this.contextService.toResource('.vscode/settings.json');
				}
		}
		return null;
	}

	private promptToOpenWorkspaceSettings() {
		this.choiceService.choose(Severity.Info, nls.localize('workspaceHasSettings', "The currently opened folder contains workspace settings that may override user settings"),
			[nls.localize('openWorkspaceSettings', "Open Workspace Settings"), nls.localize('neverShowAgain', "Don't show again"), nls.localize('close', "Close")]
		).then(choice => {
			switch (choice) {
				case 0:
					const editorCount = this.editorService.getVisibleEditors().length;
					return this.editorService.openEditor({ resource: this.contextService.toResource(WORKSPACE_CONFIG_DEFAULT_PATH), options: { pinned: true } }, editorCount === 2 ? Position.THREE : editorCount === 1 ? Position.TWO : void 0);
				case 1:
					this.storageService.store(SETTINGS_INFO_IGNORE_KEY, true, StorageScope.WORKSPACE);
				default:
					return TPromise.as(true);
			}
		});
	}

	private openSettings(configurationTarget: ConfigurationTarget): TPromise<void> {
		const openDefaultSettings = !!this.configurationService.getConfiguration<IWorkbenchSettingsConfiguration>().workbench.settings.openDefaultSettings;
		if (openDefaultSettings) {
			const emptySettingsContents = this.getEmptyEditableSettingsContent(configurationTarget);
			const settingsResource = this.getEditableSettingsURI(configurationTarget);
			return this.openSideBySideEditor(this.getDefaultSettingsEditorInput(configurationTarget), settingsResource, emptySettingsContents);
		}
		return this.openEditableSettings(configurationTarget).then(() => null);
	}

	private getDefaultSettingsEditorInput(configurationTarget: ConfigurationTarget): DefaultPreferencesEditorInput {
		switch (configurationTarget) {
			case ConfigurationTarget.USER:
				if (!this.defaultSettingsEditorInputForUser) {
					this.defaultSettingsEditorInputForUser = this._register(this.instantiationService.createInstance(DefaultPreferencesEditorInput, this.defaultSettingsResource));
				}
				return this.defaultSettingsEditorInputForUser;
			case ConfigurationTarget.WORKSPACE:
				if (!this.defaultSettingsEditorInputForWorkspace) {
					this.defaultSettingsEditorInputForWorkspace = this._register(this.instantiationService.createInstance(DefaultPreferencesEditorInput, this.defaultSettingsResource));
				}
				return this.defaultSettingsEditorInputForWorkspace;
		}
	}

	private openSideBySideEditor(leftHandDefaultInput: EditorInput, editableResource: URI, defaultEditableContents: string): TPromise<void> {
		// Create as needed and open in editor
		return this.createIfNotExists(editableResource, defaultEditableContents).then(() => {
			return this.editorService.createInput({ resource: editableResource }).then(typedRightHandEditableInput => {
				const sideBySideInput = new SideBySideEditorInput(typedRightHandEditableInput.getName(), typedRightHandEditableInput.getDescription(), leftHandDefaultInput, <EditorInput>typedRightHandEditableInput);
				this.editorService.openEditor(sideBySideInput, { pinned: true });
				return;
			});
		});
	}

	private openTwoEditors(leftHandDefault: URI, editableResource: URI, defaultEditableContents: string): TPromise<void> {
		// Create as needed and open in editor
		return this.createIfNotExists(editableResource, defaultEditableContents).then(() => {
			return this.editorService.openEditors([
				{ input: { resource: leftHandDefault, options: { pinned: true } }, position: Position.ONE },
				{ input: { resource: editableResource, options: { pinned: true } }, position: Position.TWO },
			]).then(() => {
				this.editorGroupService.focusGroup(Position.TWO);
			});
		});
	}

	private createIfNotExists(resource: URI, contents: string): TPromise<boolean> {
		return this.fileService.resolveContent(resource, { acceptTextOnly: true }).then(null, error => {
			if ((<IFileOperationResult>error).fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return this.fileService.updateContent(resource, contents).then(null, error => {
					return TPromise.wrapError(new Error(nls.localize('fail.createSettings', "Unable to create '{0}' ({1}).", labels.getPathLabel(resource, this.contextService), error)));
				});
			}

			return TPromise.wrapError(error);
		});
	}

	private fetchMostCommonlyUsedSettings(): TPromise<string[]> {
		return TPromise.wrap([
			'editor.fontSize',
			'files.autoSave',
			'editor.fontFamily',
			'editor.tabSize',
			'editor.renderWhitespace',
			'files.exclude',
			'editor.cursorStyle',
			'editor.insertSpaces',
			'editor.wrappingColumn',
			'files.associations'
		]);
	}

	public dispose(): void {
		this.defaultPreferencesEditorModels.clear();
		super.dispose();
	}
}