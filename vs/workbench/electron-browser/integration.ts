/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import nls = require('vs/nls');
import paths = require('vs/base/common/paths');
import {TPromise} from 'vs/base/common/winjs.base';
import errors = require('vs/base/common/errors');
import arrays = require('vs/base/common/arrays');
import Severity from 'vs/base/common/severity';
import {isMacintosh} from 'vs/base/common/platform';
import {Separator} from 'vs/base/browser/ui/actionbar/actionbar';
import {IAction, Action} from 'vs/base/common/actions';
import {IPartService} from 'vs/workbench/services/part/common/partService';
import {IMessageService} from 'vs/platform/message/common/message';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {ITelemetryService} from 'vs/platform/telemetry/common/telemetry';
import {IContextMenuService} from 'vs/platform/contextview/browser/contextView';
import {ICommandService} from 'vs/platform/commands/common/commands';
import {IKeybindingService} from 'vs/platform/keybinding/common/keybinding';
import {IWorkspaceContextService}from 'vs/platform/workspace/common/workspace';
import {IWindowService} from 'vs/workbench/services/window/electron-browser/windowService';
import {IWindowConfiguration} from 'vs/workbench/electron-browser/window';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {ElectronWindow} from 'vs/workbench/electron-browser/window';
import * as browser from 'vs/base/browser/browser';
import {IQuickOpenService, IPickOpenEntry, ISeparator} from 'vs/workbench/services/quickopen/common/quickOpenService';
import {KeyMod} from 'vs/base/common/keyCodes';

import {ipcRenderer as ipc, webFrame, remote} from 'electron';

const currentWindow = remote.getCurrentWindow();

const TextInputActions: IAction[] = [
	new Action('undo', nls.localize('undo', "Undo"), null, true, () => document.execCommand('undo') && TPromise.as(true)),
	new Action('redo', nls.localize('redo', "Redo"), null, true, () => document.execCommand('redo') && TPromise.as(true)),
	new Separator(),
	new Action('editor.action.clipboardCutAction', nls.localize('cut', "Cut"), null, true, () => document.execCommand('cut') && TPromise.as(true)),
	new Action('editor.action.clipboardCopyAction', nls.localize('copy', "Copy"), null, true, () => document.execCommand('copy') && TPromise.as(true)),
	new Action('editor.action.clipboardPasteAction', nls.localize('paste', "Paste"), null, true, () => document.execCommand('paste') && TPromise.as(true)),
	new Separator(),
	new Action('editor.action.selectAll', nls.localize('selectAll', "Select All"), null, true, () => document.execCommand('selectAll') && TPromise.as(true))
];

export class ElectronIntegration {

	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
		@IWindowService private windowService: IWindowService,
		@IPartService private partService: IPartService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@IConfigurationService private configurationService: IConfigurationService,
		@ICommandService private commandService: ICommandService,
		@IKeybindingService private keybindingService: IKeybindingService,
		@IMessageService private messageService: IMessageService,
		@IQuickOpenService private quickOpenService: IQuickOpenService,
		@IContextMenuService private contextMenuService: IContextMenuService
	) {
	}

	public integrate(shellContainer: HTMLElement): void {

		// Register the active window
		const activeWindow = this.instantiationService.createInstance(ElectronWindow, currentWindow, shellContainer);
		this.windowService.registerWindow(activeWindow);

		// Support runAction event
		ipc.on('vscode:runAction', (event, actionId: string) => {
			this.commandService.executeCommand(actionId, { from: 'menu' }).done(undefined, err => this.messageService.show(Severity.Error, err));
		});

		// Support resolve keybindings event
		ipc.on('vscode:resolveKeybindings', (event, rawActionIds: string) => {
			let actionIds: string[] = [];
			try {
				actionIds = JSON.parse(rawActionIds);
			} catch (error) {
				// should not happen
			}

			// Resolve keys using the keybinding service and send back to browser process
			this.resolveKeybindings(actionIds).done((keybindings) => {
				if (keybindings.length) {
					ipc.send('vscode:keybindingsResolved', JSON.stringify(keybindings));
				}
			}, () => errors.onUnexpectedError);
		});

		ipc.on('vscode:telemetry', (event, { eventName, data }) => {
			this.telemetryService.publicLog(eventName, data);
		});

		ipc.on('vscode:reportError', (event, error) => {
			if (error) {
				const errorParsed = JSON.parse(error);
				errorParsed.mainProcess = true;
				errors.onUnexpectedError(errorParsed);
			}
		});

		// Emit event when vscode has loaded
		this.partService.joinCreation().then(() => {
			ipc.send('vscode:workbenchLoaded', this.windowService.getWindowId());
		});

		// Message support
		ipc.on('vscode:showInfoMessage', (event, message: string) => {
			this.messageService.show(Severity.Info, message);
		});

		// Recent files / folders
		ipc.on('vscode:openRecent', (event, files: string[], folders: string[]) => {
			this.openRecent(files, folders);
		});

		// Ensure others can listen to zoom level changes
		browser.setZoomLevel(webFrame.getZoomLevel());

		// Configuration changes
		let previousConfiguredZoomLevel: number;
		this.configurationService.onDidUpdateConfiguration(e => {
			const windowConfig: IWindowConfiguration = e.config;

			let newZoomLevel = 0;
			if (windowConfig.window && typeof windowConfig.window.zoomLevel === 'number') {
				newZoomLevel = windowConfig.window.zoomLevel;

				// Leave early if the configured zoom level did not change (https://github.com/Microsoft/vscode/issues/1536)
				if (previousConfiguredZoomLevel === newZoomLevel) {
					return;
				}

				previousConfiguredZoomLevel = newZoomLevel;
			}

			if (webFrame.getZoomLevel() !== newZoomLevel) {
				webFrame.setZoomLevel(newZoomLevel);
				browser.setZoomLevel(webFrame.getZoomLevel()); // Ensure others can listen to zoom level changes
			}
		});

		// Context menu support in input/textarea
		window.document.addEventListener('contextmenu', (e) => {
			if (e.target instanceof HTMLElement) {
				const target = <HTMLElement>e.target;
				if (target.nodeName && (target.nodeName.toLowerCase() === 'input' || target.nodeName.toLowerCase() === 'textarea')) {
					e.preventDefault();
					e.stopPropagation();

					this.contextMenuService.showContextMenu({
						getAnchor: () => target,
						getActions: () => TPromise.as(TextInputActions),
						getKeyBinding: (action) => {
							const opts = this.keybindingService.lookupKeybindings(action.id);
							if (opts.length > 0) {
								return opts[0]; // only take the first one
							}

							return null;
						}
					});
				}
			}
		});
	}

	private openRecent(recentFiles: string[], recentFolders: string[]): void {
		function toPick(path: string, separator: ISeparator): IPickOpenEntry {
			return {
				label: paths.basename(path),
				description: paths.dirname(path),
				separator,
				run: (context) => runPick(path, context)
			};
		}

		function runPick(path: string, context): void {
			const newWindow = context.keymods.indexOf(KeyMod.CtrlCmd) >= 0;

			ipc.send('vscode:windowOpen', [path], newWindow);
		}

		const folderPicks: IPickOpenEntry[] = recentFolders.map((p, index) => toPick(p, index === 0 ? { label: nls.localize('folders', "folders") } : void 0));
		const filePicks: IPickOpenEntry[] = recentFiles.map((p, index) => toPick(p, index === 0 ? { label: nls.localize('files', "files"), border: true } : void 0));

		const hasWorkspace = !!this.contextService.getWorkspace();

		this.quickOpenService.pick(folderPicks.concat(...filePicks), {
			autoFocus: { autoFocusFirstEntry: !hasWorkspace, autoFocusSecondEntry: hasWorkspace },
			placeHolder: isMacintosh ? nls.localize('openRecentPlaceHolderMac', "Select a path (hold Cmd-key to open in new window)") : nls.localize('openRecentPlaceHolder', "Select a path to open (hold Ctrl-key to open in new window)"),
			matchOnDescription: true
		}).done(null, errors.onUnexpectedError);
	}

	private resolveKeybindings(actionIds: string[]): TPromise<{ id: string; binding: number; }[]> {
		return this.partService.joinCreation().then(() => {
			return arrays.coalesce(actionIds.map((id) => {
				const bindings = this.keybindingService.lookupKeybindings(id);

				// return the first binding that can be represented by electron
				for (let i = 0; i < bindings.length; i++) {
					const binding = bindings[i];
					const electronAccelerator = this.keybindingService.getElectronAcceleratorFor(binding);
					if (electronAccelerator) {
						return {
							id: id,
							binding: binding.value
						};
					}
				}

				return null;
			}));
		});
	}
}