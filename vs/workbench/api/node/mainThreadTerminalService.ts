/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {ITerminalService, TERMINAL_PANEL_ID} from 'vs/workbench/parts/terminal/electron-browser/terminal';
import {IPanelService} from 'vs/workbench/services/panel/common/panelService';
import {IPartService} from 'vs/workbench/services/part/common/partService';
import {MainThreadTerminalServiceShape} from './extHost.protocol';

export class MainThreadTerminalService extends MainThreadTerminalServiceShape {

	constructor(
		@IPanelService private panelService: IPanelService,
		@IPartService private partService: IPartService,
		@ITerminalService private terminalService: ITerminalService
	) {
		super();
	}

	public $createTerminal(name?: string, shellPath?: string): number {
		return this.terminalService.createInstance(name, shellPath).id;
	}

	public $show(terminalId: number, preserveFocus: boolean): void {
		let terminalInstance = this.terminalService.getInstanceFromId(terminalId);
		if (terminalInstance) {
			this.terminalService.setActiveInstance(terminalInstance);
			this.terminalService.showPanel(!preserveFocus);
		}
	}

	public $hide(terminalId: number): void {
		if (this.terminalService.getActiveInstance().id === terminalId) {
			const panel = this.panelService.getActivePanel();
			if (panel && panel.getId() === TERMINAL_PANEL_ID) {
				this.partService.setPanelHidden(true);
			}
		}
	}

	public $dispose(terminalId: number): void {
		let terminalInstance = this.terminalService.getInstanceFromId(terminalId);
		if (terminalInstance) {
			terminalInstance.dispose();
		}
	}

	public $sendText(terminalId: number, text: string, addNewLine: boolean): void {
		let terminalInstance = this.terminalService.getInstanceFromId(terminalId);
		if (terminalInstance) {
			terminalInstance.sendText(text, addNewLine);
		}
	}
}
