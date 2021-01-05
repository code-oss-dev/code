/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

export class SimpleBrowserView {

	public static readonly viewType = 'simpleBrowser.view';
	private static readonly title = localize('view.title', "Simple Browser");

	private readonly _webviewPanel: vscode.WebviewPanel;

	private readonly _onDidDispose = new vscode.EventEmitter<void>();
	public readonly onDispose = this._onDidDispose.event;

	constructor(
		private readonly extensionUri: vscode.Uri,
		url: string,
	) {
		this._webviewPanel = vscode.window.createWebviewPanel(SimpleBrowserView.viewType, SimpleBrowserView.title, {
			viewColumn: vscode.ViewColumn.Active,
		}, {
			enableScripts: true,
			retainContextWhenHidden: true,
		});

		this._webviewPanel.webview.onDidReceiveMessage(e => {
			switch (e.type) {
				case 'openExternal':
					try {
						const url = vscode.Uri.parse(e.url);
						vscode.env.openExternal(url);
					} catch {
						// Noop
					}
					break;
			}
		});

		this._webviewPanel.onDidDispose(() => {
			this.dispose();
		});

		this.show(url);
	}

	public dispose() {
		this._onDidDispose.fire();
		this._webviewPanel.dispose();
	}

	public show(url: string) {
		this._webviewPanel.webview.html = this.getHtml(url);
		this._webviewPanel.reveal();
	}

	private getHtml(url: string) {
		const nonce = new Date().getTime() + '' + new Date().getMilliseconds();

		const mainJs = this.extensionResourceUrl('media', 'index.js');
		const mainCss = this.extensionResourceUrl('media', 'main.css');
		const codiconsUri = this.extensionResourceUrl('node_modules', 'vscode-codicons', 'dist', 'codicon.css');
		const codiconsFontUri = this.extensionResourceUrl('node_modules', 'vscode-codicons', 'dist', 'codicon.ttf');

		return /* html */ `<!DOCTYPE html>
			<html>
			<head>
				<meta http-equiv="Content-type" content="text/html;charset=UTF-8">

				<meta http-equiv="Content-Security-Policy" content="
					default-src 'none';
					font-src ${codiconsFontUri};
					style-src ${this._webviewPanel.webview.cspSource};
					script-src 'nonce-${nonce}';
					frame-src *;
					">

				<meta id="simple-browser-settings" data-settings="${escapeAttribute(JSON.stringify({
			url: url,
		}))}">

				<link rel="stylesheet" type="text/css" href="${mainCss}">
				<link rel="stylesheet" type="text/css" href="${codiconsUri}">
			</head>
			<body>
				<header class="header">
					<nav class="controls">
						<button
							title="${localize('control.back.title', "Back")}"
							class="back-button icon"><i class="codicon codicon-arrow-left"></i></button>

						<button
							title="${localize('control.forward.title', "Forward")}"
							class="forward-button icon"><i class="codicon codicon-arrow-right"></i></button>

						<button
							title="${localize('control.reload.title', "Reload")}"
							class="reload-button icon"><i class="codicon codicon-refresh"></i></button>
					</nav>

					<input class="url-input" type="text" value=${url}>

					<nav class="controls">
						<button
							title="${localize('control.openExternal.title', "Open in browser")}"
							class="open-external-button icon"><i class="codicon codicon-link-external"></i></button>
					</nav>
				</header>
				<div class="content">
					<div class="iframe-focused-alert">${localize('view.iframe-focused', "Focus Lock")}</div>
					<iframe sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
				</div>

				<script src="${mainJs}" nonce="${nonce}"></script>
			</body>
			</html>`;
	}

	private extensionResourceUrl(...parts: string[]): vscode.Uri {
		return this._webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...parts));
	}
}

function escapeAttribute(value: string | vscode.Uri): string {
	return value.toString().replace(/"/g, '&quot;');
}
