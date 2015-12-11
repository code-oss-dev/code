/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import nls = require('vs/nls');
import Severity from 'vs/base/common/severity';
import errors = require('vs/base/common/errors');
import dom = require('vs/base/browser/dom');
import lifecycle = require('vs/base/common/lifecycle');
import statusbar = require('vs/workbench/browser/parts/statusbar/statusbar');
import { IPluginService, IPluginStatus } from 'vs/platform/plugins/common/plugins';
import { IMessageService } from 'vs/platform/message/common/message';
import { IQuickOpenService } from 'vs/workbench/services/quickopen/browser/quickOpenService';

var $ = dom.emmet;

export class ExtensionsStatusbarItem implements statusbar.IStatusbarItem {

	private toDispose: lifecycle.IDisposable[];
	private domNode: HTMLElement;
	private status: { [id: string]: IPluginStatus };
	private container: HTMLElement;
	private messageCount: number;

	constructor(
		@IPluginService pluginService: IPluginService,
		@IMessageService private messageService: IMessageService
	) {
		this.toDispose = [];
		this.messageCount = 0;

		pluginService.onReady().then(() => {
			this.status = pluginService.getPluginsStatus();
			Object.keys(this.status).forEach(key => {
				this.messageCount += this.status[key].messages.filter(message => message.type > Severity.Info).length;
			});
			this.render(this.container);
		});
	}

	public render(container: HTMLElement): lifecycle.IDisposable {
		this.container = container;
		if (this.messageCount > 0) {
			this.domNode = dom.append(container, $('a.extensions-statusbar'));
			this.domNode.title = nls.localize('extensions', "Extensions"),
			this.domNode.textContent = `${ this.messageCount }`;

			this.toDispose.push(dom.addDisposableListener(this.domNode, 'click', () => {
				Object.keys(this.status).forEach(key => {
					this.status[key].messages.forEach(m => {
						if (m.type > Severity.Ignore) {
							this.messageService.show(m.type, m.message);
						}
					});
				});
			}));
		}

		return {
			dispose: () => lifecycle.disposeAll(this.toDispose)
		};
	}
}
