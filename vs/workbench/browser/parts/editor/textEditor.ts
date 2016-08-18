/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import {Dimension, Builder} from 'vs/base/browser/builder';
import objects = require('vs/base/common/objects');
import {CodeEditorWidget} from 'vs/editor/browser/widget/codeEditorWidget';
import {EditorInput, EditorOptions} from 'vs/workbench/common/editor';
import {BaseEditor} from 'vs/workbench/browser/parts/editor/baseEditor';
import {EditorConfiguration} from 'vs/editor/common/config/commonEditorConfig';
import {IEditor, IEditorOptions} from 'vs/editor/common/editorCommon';
import {IWorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import {IFilesConfiguration} from 'vs/platform/files/common/files';
import {Position} from 'vs/platform/editor/common/editor';
import {IStorageService} from 'vs/platform/storage/common/storage';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {IEventService} from 'vs/platform/event/common/event';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IMessageService} from 'vs/platform/message/common/message';
import {ITelemetryService} from 'vs/platform/telemetry/common/telemetry';
import {IWorkbenchEditorService} from 'vs/workbench/services/editor/common/editorService';
import {IModeService} from 'vs/editor/common/services/modeService';
import {IThemeService} from 'vs/workbench/services/themes/common/themeService';
import {Selection} from 'vs/editor/common/core/selection';

/**
 * The base class of editors that leverage the text editor for the editing experience. This class is only intended to
 * be subclassed and not instantiated.
 */
export abstract class BaseTextEditor extends BaseEditor {
	private editorControl: IEditor;
	private _editorContainer: Builder;
	private _hasPendingConfigurationChange = false;

	constructor(
		id: string,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@IWorkspaceContextService private _contextService: IWorkspaceContextService,
		@IStorageService private _storageService: IStorageService,
		@IMessageService private _messageService: IMessageService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IEventService private _eventService: IEventService,
		@IWorkbenchEditorService private _editorService: IWorkbenchEditorService,
		@IModeService private _modeService: IModeService,
		@IThemeService private _themeService: IThemeService
	) {
		super(id, telemetryService);

		this.toUnbind.push(this.configurationService.onDidUpdateConfiguration(e => this.handleConfigurationChangeEvent(e.config)));
		this.toUnbind.push(_themeService.onDidColorThemeChange(_ => this.handleConfigurationChangeEvent()));
	}

	public get instantiationService(): IInstantiationService {
		return this._instantiationService;
	}

	public get contextService(): IWorkspaceContextService {
		return this._contextService;
	}

	public get storageService(): IStorageService {
		return this._storageService;
	}

	public get messageService() {
		return this._messageService;
	}

	private handleConfigurationChangeEvent(configuration?: any): void {
		if (this.isVisible()) {
			this.applyConfiguration(configuration);
		} else {
			this._hasPendingConfigurationChange = true;
		}
	}

	private consumePendingConfigurationChangeEvent(): void {
		if (this._hasPendingConfigurationChange) {
			this.applyConfiguration(this.configurationService.getConfiguration());
			this._hasPendingConfigurationChange = false;
		}
	}

	protected applyConfiguration(configuration?: any): void {
		if (!this.editorControl) {
			return;
		}
		if (configuration) {
			// Update Editor with configuration and editor settings
			let specificEditorSettings = this.getCodeEditorOptions();
			configuration = objects.clone(configuration); // dont modify original config
			objects.assign(configuration[EditorConfiguration.EDITOR_SECTION], specificEditorSettings);
			EditorConfiguration.apply(configuration, this.editorControl);

		} else {
			this.editorControl.updateOptions(this.getCodeEditorOptions());
		}
	}

	protected getCodeEditorOptions(): IEditorOptions {
		return {
			overviewRulerLanes: 3,
			glyphMargin: true,
			lineNumbersMinChars: 3,
			theme: this._themeService.getColorTheme()
		};
	}

	public get eventService(): IEventService {
		return this._eventService;
	}

	public get editorService() {
		return this._editorService;
	}

	public get editorContainer(): Builder {
		return this._editorContainer;
	}

	public createEditor(parent: Builder): void {

		// Editor for Text
		this._editorContainer = parent;
		this.editorControl = this.createEditorControl(parent);

		// Configuration
		this.applyConfiguration(this.configurationService.getConfiguration<IFilesConfiguration>());
	}

	/**
	 * This method creates and returns the text editor control to be used. Subclasses can override to
	 * provide their own editor control that should be used (e.g. a DiffEditor).
	 */
	public createEditorControl(parent: Builder): IEditor {
		return this._instantiationService.createInstance(CodeEditorWidget, parent.getHTMLElement(), this.getCodeEditorOptions());
	}

	public setInput(input: EditorInput, options: EditorOptions): TPromise<void> {
		return super.setInput(input, options).then(() => {
			this.editorControl.updateOptions(this.getCodeEditorOptions()); // support input specific editor options
		});
	}

	public setEditorVisible(visible: boolean, position: Position = null): void {

		// Pass on to Editor
		if (visible) {
			this.consumePendingConfigurationChangeEvent();
			this.editorControl.onVisible();
		} else {
			this.editorControl.onHide();
		}

		super.setEditorVisible(visible, position);
	}

	public focus(): void {
		this.editorControl.focus();
	}

	public layout(dimension: Dimension): void {

		// Pass on to Editor
		this.editorControl.layout(dimension);
	}

	public getControl(): IEditor {
		return this.editorControl;
	}

	public getSelection(): Selection {
		return this.editorControl.getSelection();
	}

	public dispose(): void {

		// Destroy Editor Control
		this.editorControl.destroy();

		super.dispose();
	}
}