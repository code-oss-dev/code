/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import DOM = require('vs/base/browser/dom');
import lifecycle = require('vs/base/common/lifecycle');
import nls = require('vs/nls');
import os = require('os');
import platform = require('vs/base/common/platform');
import xterm = require('xterm');
import {TPromise} from 'vs/base/common/winjs.base';
import {Dimension} from 'vs/base/browser/builder';
import {IAction} from 'vs/base/common/actions';
import {Separator} from 'vs/base/browser/ui/actionbar/actionbar';
import {IContextMenuService} from 'vs/platform/contextview/browser/contextView';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IKeybindingService, IKeybindingContextKey} from 'vs/platform/keybinding/common/keybinding';
import {IMessageService, Severity} from 'vs/platform/message/common/message';
import {ITerminalFont} from 'vs/workbench/parts/terminal/electron-browser/terminalConfigHelper';
import {ITerminalProcess, ITerminalService} from 'vs/workbench/parts/terminal/electron-browser/terminal';
import {CopyTerminalSelectionAction, TerminalPasteAction, CreateNewTerminalAction} from 'vs/workbench/parts/terminal/electron-browser/terminalActions';
import {IWorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import {StandardMouseEvent} from 'vs/base/browser/mouseEvent';

export class TerminalInstance {

	private static eolRegex = /\r?\n/g;

	private isExiting: boolean = false;

	private toDispose: lifecycle.IDisposable[];
	private xterm;
	private terminalDomElement: HTMLDivElement;
	private wrapperElement: HTMLDivElement;
	private font: ITerminalFont;

	public constructor(
		private terminalProcess: ITerminalProcess,
		private parentDomElement: HTMLElement,
		private contextMenuService: IContextMenuService,
		private contextService: IWorkspaceContextService,
		private instantiationService: IInstantiationService,
		private keybindingService: IKeybindingService,
		private terminalService: ITerminalService,
		private messageService: IMessageService,
		private terminalFocusContextKey: IKeybindingContextKey<boolean>,
		private onExitCallback: (TerminalInstance) => void
	) {
		this.toDispose = [];
		this.wrapperElement = document.createElement('div');
		DOM.addClass(this.wrapperElement, 'terminal-wrapper');
		this.terminalDomElement = document.createElement('div');
		this.xterm = xterm();

		this.terminalProcess.process.on('message', (message) => {
			if (message.type === 'data') {
				this.xterm.write(message.content);
			}
		});
		this.xterm.on('data', (data) => {
			this.terminalProcess.process.send({
				event: 'input',
				data: this.sanitizeInput(data)
			});
			return false;
		});
		this.terminalProcess.process.on('exit', (exitCode) => {
			// Prevent dispose functions being triggered multiple times
			if (!this.isExiting) {
				this.isExiting = true;
				this.dispose();
				if (exitCode) {
					this.messageService.show(Severity.Error, nls.localize('terminal.integrated.exitedWithCode', 'The terminal process terminated with exit code: {0}', exitCode));
				}
				this.onExitCallback(this);
			}
		});
		this.toDispose.push(DOM.addDisposableListener(this.parentDomElement, 'mousedown', (event: MouseEvent) => {
			if (event.which === 2 && platform.isLinux) {
				// Drop selection and focus terminal on Linux to enable middle button paste when click
				// occurs on the selection itself.
				this.focus(true);
			} else if (event.which === 3) {
				// Trigger the context menu on right click
				let anchor: HTMLElement | { x: number, y: number } = this.parentDomElement;
				if (event instanceof MouseEvent) {
					const standardEvent = new StandardMouseEvent(event);
					anchor = { x: standardEvent.posx, y: standardEvent.posy };
				}

				// TODO: Move these into panel and pass them in so they're shared between instances
				let newTerminalAction = this.instantiationService.createInstance(CreateNewTerminalAction, CreateNewTerminalAction.ID, nls.localize('createNewTerminal', "New terminal"));
				let copyAction = this.instantiationService.createInstance(CopyTerminalSelectionAction, CopyTerminalSelectionAction.ID, nls.localize('copy', "Copy"));
				let pasteAction = this.instantiationService.createInstance(TerminalPasteAction, TerminalPasteAction.ID, nls.localize('paste', "Paste"));

				const actions: IAction[] = [
					newTerminalAction,
					new Separator(),
					copyAction,
					pasteAction
				];

				contextMenuService.showContextMenu({
					getAnchor: () => anchor,
					getActions: () => TPromise.as(actions),
					getActionsContext: () => this.parentDomElement,
					getKeyBinding: (action) => {
						const opts = this.keybindingService.lookupKeybindings(action.id);
						if (opts.length > 0) {
							return opts[0]; // only take the first one
						}
						return null;
					}
				});
			}
			// TODO: This  and all parentDomElement handlers should be handled in the panel!
			// Currently this line is stopping the other terminal instances from reacting to the
			// event.
			event.stopImmediatePropagation();
		}));
		this.toDispose.push(DOM.addDisposableListener(this.parentDomElement, 'mouseup', (event) => {
			if (event.which !== 3) {
				this.focus();
			}
		}));
		this.toDispose.push(DOM.addDisposableListener(this.parentDomElement, 'keyup', (event: KeyboardEvent) => {
			// Keep terminal open on escape
			if (event.keyCode === 27) {
				event.stopPropagation();
			}
		}));

		this.xterm.open(this.terminalDomElement);

		let self = this;
		this.toDispose.push(DOM.addDisposableListener(this.xterm.element, 'focus', (event: KeyboardEvent) => {
			self.terminalFocusContextKey.set(true);
		}));
		this.toDispose.push(DOM.addDisposableListener(this.xterm.element, 'blur', (event: KeyboardEvent) => {
			self.terminalFocusContextKey.reset();
		}));

		this.wrapperElement.appendChild(this.terminalDomElement);
		this.parentDomElement.appendChild(this.wrapperElement);
	}

	private sanitizeInput(data: any) {
		return typeof data === 'string' ? data.replace(TerminalInstance.eolRegex, os.EOL) : data;
	}

	public layout(dimension: Dimension): void {
		if (!this.font || !this.font.charWidth || !this.font.charHeight) {
			return;
		}
		if (!dimension.height) { // Minimized
			return;
		}
		let cols = Math.floor(dimension.width / this.font.charWidth);
		let rows = Math.floor(dimension.height / this.font.charHeight);
		if (this.xterm) {
			this.xterm.resize(cols, rows);
		}
		if (this.terminalProcess.process.connected) {
			this.terminalProcess.process.send({
				event: 'resize',
				cols: cols,
				rows: rows
			});
		}
	}

	public toggleVisibility(visible: boolean) {
		DOM.toggleClass(this.wrapperElement, 'active', visible);
	}

	public setFont(font: ITerminalFont): void {
		this.font = font;
	}

	public setCursorBlink(blink: boolean): void {
		if (this.xterm && this.xterm.cursorBlink !== blink) {
			this.xterm.cursorBlink = blink;
			this.xterm.refresh(0, this.xterm.rows - 1);
		}
	}

	public focus(force?: boolean): void {
		if (!this.xterm) {
			return;
		}
		let text = window.getSelection().toString();
		if (!text || force) {
			this.xterm.focus();
		}
	}

	public dispose(): void {
		if (this.wrapperElement) {
			this.parentDomElement.removeChild(this.wrapperElement);
			this.wrapperElement = null;
		}
		if (this.xterm) {
			this.xterm.destroy();
			this.xterm = null;
		}
		if (this.terminalProcess) {
			this.terminalService.killTerminalProcess(this.terminalProcess);
			this.terminalProcess = null;
		}
		this.toDispose = lifecycle.dispose(this.toDispose);
	}
}