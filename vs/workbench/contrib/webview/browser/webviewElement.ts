/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { Webview, WebviewContentOptions, WebviewOptions } from 'vs/workbench/contrib/webview/common/webview';
import { IThemeService, ITheme } from 'vs/platform/theme/common/themeService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { Disposable } from 'vs/base/common/lifecycle';
import { areWebviewInputOptionsEqual } from 'vs/workbench/contrib/webview/browser/webviewEditorService';
import { addDisposableListener, addClass } from 'vs/base/browser/dom';
import { getWebviewThemeData } from 'vs/workbench/contrib/webview/common/themeing';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { loadLocalResource } from 'vs/workbench/contrib/webview/common/resourceLoader';
import { WebviewPortMappingManager } from 'vs/workbench/contrib/webview/common/portMapping';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';

interface WebviewContent {
	readonly html: string;
	readonly options: WebviewContentOptions;
	readonly state: string | undefined;
}

export class IFrameWebview extends Disposable implements Webview {
	private element?: HTMLIFrameElement;

	private readonly _ready: Promise<void>;

	private content: WebviewContent;
	private _focused = false;

	private readonly id: string;

	private readonly _portMappingManager: WebviewPortMappingManager;

	constructor(
		private _options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		@IThemeService themeService: IThemeService,
		@ITunnelService tunnelService: ITunnelService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		if (typeof environmentService.webviewEndpoint !== 'string') {
			throw new Error('To use iframe based webviews, you must configure `environmentService.webviewEndpoint`');
		}

		this._portMappingManager = this._register(new WebviewPortMappingManager(
			this._options.extension ? this._options.extension.location : undefined,
			() => this.content.options.portMappings || [],
			tunnelService
		));

		this.content = {
			html: '',
			options: contentOptions,
			state: undefined
		};

		this.id = `webview-${Date.now()}`;

		this.element = document.createElement('iframe');
		this.element.sandbox.add('allow-scripts', 'allow-same-origin');
		this.element.setAttribute('src', `${environmentService.webviewEndpoint}?id=${this.id}`);
		this.element.style.border = 'none';
		this.element.style.width = '100%';
		this.element.style.height = '100%';

		this._register(addDisposableListener(window, 'message', e => {
			if (!e || !e.data || e.data.target !== this.id) {
				return;
			}

			switch (e.data.channel) {
				case 'onmessage':
					if (e.data.data) {
						this._onMessage.fire(e.data.data);
					}
					return;

				case 'did-click-link':
					const [uri] = e.data.data;
					this._onDidClickLink.fire(URI.parse(uri));
					return;

				case 'did-scroll':
					// if (e.args && typeof e.args[0] === 'number') {
					// 	this._onDidScroll.fire({ scrollYPercentage: e.args[0] });
					// }
					return;

				case 'do-reload':
					this.reload();
					return;

				case 'do-update-state':
					const state = e.data.data;
					this.state = state;
					this._onDidUpdateState.fire(state);
					return;

				case 'did-focus':
					this.handleFocusChange(true);
					return;

				case 'did-blur':
					this.handleFocusChange(false);
					return;

				case 'load-resource':
					{
						const uri = URI.file(e.data.data.path);
						this.loadResource(uri);
						return;
					}

				case 'load-localhost':
					{
						this.localLocalhost(e.data.data.origin);
						return;
					}
			}
		}));

		this._ready = new Promise(resolve => {
			const subscription = this._register(addDisposableListener(window, 'message', (e) => {
				if (e.data && e.data.target === this.id && e.data.channel === 'webview-ready') {
					if (this.element) {
						addClass(this.element, 'ready');
					}
					subscription.dispose();
					resolve();
				}
			}));
		});

		this.style(themeService.getTheme());
		this._register(themeService.onThemeChange(this.style, this));
	}

	public mountTo(parent: HTMLElement) {
		if (this.element) {
			parent.appendChild(this.element);
		}
	}

	public set options(options: WebviewContentOptions) {
		if (areWebviewInputOptionsEqual(options, this.content.options)) {
			return;
		}

		this.content = {
			html: this.content.html,
			options: options,
			state: this.content.state,
		};
		this.doUpdateContent();
	}

	public set html(value: string) {
		this.content = {
			html: this.preprocessHtml(value),
			options: this.content.options,
			state: this.content.state,
		};
		this.doUpdateContent();
	}

	private preprocessHtml(value: string): string {
		return value.replace(/(["'])vscode-resource:([^\s'"]+?)(["'])/gi, (_, startQuote, path, endQuote) =>
			`${startQuote}${this.environmentService.webviewEndpoint}/vscode-resource${path}${endQuote}`);
	}

	public update(html: string, options: WebviewContentOptions, retainContextWhenHidden: boolean) {
		if (retainContextWhenHidden && html === this.content.html && areWebviewInputOptionsEqual(options, this.content.options)) {
			return;
		}
		this.content = {
			html: this.preprocessHtml(html),
			options: options,
			state: this.content.state,
		};
		this.doUpdateContent();
	}

	private doUpdateContent() {
		this._send('content', {
			contents: this.content.html,
			options: this.content.options,
			state: this.content.state
		});
	}

	private handleFocusChange(isFocused: boolean): void {
		this._focused = isFocused;
		if (this._focused) {
			this._onDidFocus.fire();
		}
	}

	initialScrollProgress: number;

	private readonly _onDidFocus = this._register(new Emitter<void>());
	public readonly onDidFocus = this._onDidFocus.event;

	private readonly _onDidClickLink = this._register(new Emitter<URI>());
	public readonly onDidClickLink = this._onDidClickLink.event;

	private readonly _onDidScroll = this._register(new Emitter<{ scrollYPercentage: number }>());
	public readonly onDidScroll = this._onDidScroll.event;

	private readonly _onDidUpdateState = this._register(new Emitter<string | undefined>());
	public readonly onDidUpdateState = this._onDidUpdateState.event;

	private readonly _onMessage = this._register(new Emitter<any>());
	public readonly onMessage = this._onMessage.event;

	sendMessage(data: any): void {
		this._send('message', data);
	}

	layout(): void {
		// noop
	}

	focus(): void {
		if (this.element) {
			this.element.focus();
		}
	}

	dispose(): void {
		if (this.element) {
			if (this.element.parentElement) {
				this.element.parentElement.removeChild(this.element);
			}
		}

		this.element = undefined!;
		super.dispose();
	}

	reload(): void {
		throw new Error('Method not implemented.');
	}
	selectAll(): void {
		throw new Error('Method not implemented.');
	}
	copy(): void {
		throw new Error('Method not implemented.');
	}
	paste(): void {
		throw new Error('Method not implemented.');
	}
	cut(): void {
		throw new Error('Method not implemented.');
	}
	undo(): void {
		throw new Error('Method not implemented.');
	}
	redo(): void {
		throw new Error('Method not implemented.');
	}
	showFind(): void {
		throw new Error('Method not implemented.');
	}
	hideFind(): void {
		throw new Error('Method not implemented.');
	}

	public set state(state: string | undefined) {
		this.content = {
			html: this.content.html,
			options: this.content.options,
			state,
		};
	}

	private _send(channel: string, data: any): void {
		this._ready
			.then(() => {
				if (!this.element) {
					return;
				}
				this.element.contentWindow!.postMessage({
					channel: channel,
					args: data
				}, '*');
			})
			.catch(err => console.error(err));
	}

	private style(theme: ITheme): void {
		const { styles, activeTheme } = getWebviewThemeData(theme, this._configurationService);
		this._send('styles', { styles, activeTheme });
	}

	private async loadResource(uri: URI) {
		try {
			const result = await loadLocalResource(uri, this.fileService, this._options.extension ? this._options.extension.location : undefined,
				() => (this.content.options.localResourceRoots || []));

			if (result.type === 'success') {
				return this._send('did-load-resource', {
					status: 200,
					path: uri.path,
					mime: result.mimeType,
					data: result.data.buffer
				});
			}
		} catch  {
			// noop
		}

		return this._send('did-load-resource', {
			status: 404,
			path: uri.path
		});
	}

	private async localLocalhost(origin: string) {
		const redirect = await this._portMappingManager.getRedirect(origin);
		return this._send('did-load-localhost', {
			origin,
			location: redirect
		});
	}
}

