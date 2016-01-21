/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import lifecycle = require('vs/base/common/lifecycle');
import {TPromise} from 'vs/base/common/winjs.base';
import {Action, IAction} from 'vs/base/common/actions';
import builder = require('vs/base/browser/builder');
import {IActionItem} from 'vs/base/browser/ui/actionbar/actionbar';
import {IEditorOptions} from 'vs/editor/common/editorCommon';
import {IModeService} from 'vs/editor/common/services/modeService';
import {ITelemetryService} from 'vs/platform/telemetry/common/telemetry';
import {IStorageService} from 'vs/platform/storage/common/storage';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {IEventService} from 'vs/platform/event/common/event';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IMessageService} from 'vs/platform/message/common/message';
import {EditorInput, EditorOptions} from 'vs/workbench/common/editor';
import {StringEditor} from 'vs/workbench/browser/parts/editor/stringEditor';
import {OUTPUT_PANEL_ID} from 'vs/workbench/parts/output/common/output';
import {SwitchOutputAction, SwitchOutputActionItem, ClearOutputAction} from 'vs/workbench/parts/output/browser/outputActions';
import {IWorkspaceContextService} from 'vs/workbench/services/workspace/common/contextService';
import {ClosePanelAction} from 'vs/workbench/browser/parts/panel/panelPart';
import {IWorkbenchEditorService} from 'vs/workbench/services/editor/common/editorService';

export class OutputPanel extends StringEditor {

	private toDispose: lifecycle.IDisposable[];
	private actions: IAction[];

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IMessageService messageService: IMessageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEventService eventService: IEventService,
		@IWorkbenchEditorService editorService: IWorkbenchEditorService,
		@IModeService modeService: IModeService
	) {
		super(OUTPUT_PANEL_ID, telemetryService, instantiationService, contextService, storageService,
			messageService, configurationService, eventService, editorService, modeService);
		this.toDispose = [];
	}

	public getActions(): IAction[] {
		if (!this.actions) {
			this.actions = [
				this.instantiationService.createInstance(SwitchOutputAction),
				this.instantiationService.createInstance(ClearOutputAction),
				this.instantiationService.createInstance(ClosePanelAction, ClosePanelAction.ID, ClosePanelAction.LABEL)
			];

			this.actions.forEach(a => {
				this.toDispose.push(a);
			});
		}

		return this.actions;
	}

	public getActionItem(action: Action): IActionItem {
		if (action.id === SwitchOutputAction.ID) {
			return this.instantiationService.createInstance(SwitchOutputActionItem, action);
		}

		return super.getActionItem(action);
	}

	protected getCodeEditorOptions(): IEditorOptions {
		const options = super.getCodeEditorOptions();
		options.wrappingColumn = 0;				// all log editors wrap
		options.lineNumbers = false;				// all log editors hide line numbers

		return options;
	}

	public setInput(input: EditorInput, options: EditorOptions): TPromise<void> {
		return super.setInput(input, options).then(() => this.revealLastLine());
	}

	public focus(): void {
		super.focus();
		this.revealLastLine();
	}

	public dispose(): void {
		this.toDispose = lifecycle.disposeAll(this.toDispose);
		super.dispose();
	}
}
