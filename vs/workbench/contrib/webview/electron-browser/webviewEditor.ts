/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWindowService } from 'vs/platform/windows/common/windows';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions } from 'vs/workbench/common/editor';
import { WebviewEditorInput } from 'vs/workbench/contrib/webview/electron-browser/webviewEditorInput';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { WebviewElement } from './webviewElement';

/**  A context key that is set when the find widget in a webview is visible. */
export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_VISIBLE = new RawContextKey<boolean>('webviewFindWidgetVisible', false);


export class WebviewEditor extends BaseEditor {

	protected _webview: WebviewElement | undefined;
	protected findWidgetVisible: IContextKey<boolean>;

	public static readonly ID = 'WebviewEditor';

	private _editorFrame: HTMLElement;
	private _content?: HTMLElement;
	private _webviewContent: HTMLElement | undefined;

	private _webviewFocusTrackerDisposables: IDisposable[] = [];
	private _onFocusWindowHandler?: IDisposable;

	private readonly _onDidFocusWebview = this._register(new Emitter<void>());
	public get onDidFocus(): Event<any> { return this._onDidFocusWebview.event; }

	private pendingMessages: any[] = [];

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IContextKeyService private _contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWindowService private readonly _windowService: IWindowService,
		@IStorageService storageService: IStorageService
	) {
		super(WebviewEditor.ID, telemetryService, themeService, storageService);
		if (_contextKeyService) {
			this.findWidgetVisible = KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_VISIBLE.bindTo(_contextKeyService);
		}
	}

	protected createEditor(parent: HTMLElement): void {
		this._editorFrame = parent;
		this._content = document.createElement('div');
		parent.appendChild(this._content);
	}

	private doUpdateContainer() {
		const webviewContainer = this.input && (this.input as WebviewEditorInput).container;
		if (webviewContainer && webviewContainer.parentElement) {
			const frameRect = this._editorFrame.getBoundingClientRect();
			const containerRect = webviewContainer.parentElement.getBoundingClientRect();

			webviewContainer.style.position = 'absolute';
			webviewContainer.style.top = `${frameRect.top - containerRect.top}px`;
			webviewContainer.style.left = `${frameRect.left - containerRect.left}px`;
			webviewContainer.style.width = `${frameRect.width}px`;
			webviewContainer.style.height = `${frameRect.height}px`;
		}
	}

	public dispose(): void {
		this.pendingMessages = [];

		// Let the editor input dispose of the webview.
		this._webview = undefined;
		this._webviewContent = undefined;

		if (this._content && this._content.parentElement) {
			this._content.parentElement.removeChild(this._content);
			this._content = undefined;
		}

		this._webviewFocusTrackerDisposables = dispose(this._webviewFocusTrackerDisposables);

		if (this._onFocusWindowHandler) {
			this._onFocusWindowHandler.dispose();
		}

		super.dispose();
	}

	public sendMessage(data: any): void {
		if (this._webview) {
			this._webview.sendMessage(data);
		} else {
			this.pendingMessages.push(data);
		}
	}
	public showFind() {
		if (this._webview) {
			this._webview.showFind();
			this.findWidgetVisible.set(true);
		}
	}

	public hideFind() {
		this.findWidgetVisible.reset();
		if (this._webview) {
			this._webview.hideFind();
		}
	}

	public get isWebviewEditor() {
		return true;
	}

	public reload() {
		this.withWebviewElement(webview => webview.reload());
	}

	public layout(_dimension: DOM.Dimension): void {
		this.withWebviewElement(webview => {
			this.doUpdateContainer();
			webview.layout();
		});
	}

	public focus(): void {
		super.focus();
		if (!this._onFocusWindowHandler) {

			// Make sure we restore focus when switching back to a VS Code window
			this._onFocusWindowHandler = this._windowService.onDidChangeFocus(focused => {
				if (focused && this._editorService.activeControl === this) {
					this.focus();
				}
			});
		}
		this.withWebviewElement(webview => webview.focus());
	}

	public selectAll(): void {
		this.withWebviewElement(webview => webview.selectAll());
	}

	public copy(): void {
		this.withWebviewElement(webview => webview.copy());
	}

	public paste(): void {
		this.withWebviewElement(webview => webview.paste());
	}

	public cut(): void {
		this.withWebviewElement(webview => webview.cut());
	}

	public undo(): void {
		this.withWebviewElement(webview => webview.undo());
	}

	public redo(): void {
		this.withWebviewElement(webview => webview.redo());
	}

	private withWebviewElement(f: (element: WebviewElement) => void): void {
		if (this._webview) {
			f(this._webview);
		}
	}

	protected setEditorVisible(visible: boolean, group: IEditorGroup): void {
		if (this.input && this.input instanceof WebviewEditorInput) {
			if (visible) {
				this.input.claimWebview(this);
			} else {
				this.input.releaseWebview(this);
			}

			this.updateWebview(this.input as WebviewEditorInput);
		}

		if (this._webviewContent) {
			if (visible) {
				this._webviewContent.style.visibility = 'visible';
				this.doUpdateContainer();
			} else {
				this._webviewContent.style.visibility = 'hidden';
			}
		}

		super.setEditorVisible(visible, group);
	}

	public clearInput() {
		if (this.input && this.input instanceof WebviewEditorInput) {
			this.input.releaseWebview(this);
		}

		this._webview = undefined;
		this._webviewContent = undefined;
		this.pendingMessages = [];

		super.clearInput();
	}

	setInput(input: WebviewEditorInput, options: EditorOptions, token: CancellationToken): Promise<void> {
		if (this.input) {
			(this.input as WebviewEditorInput).releaseWebview(this);
			this._webview = undefined;
			this._webviewContent = undefined;
		}
		this.pendingMessages = [];
		return super.setInput(input, options, token)
			.then(() => input.resolve())
			.then(() => {
				if (token.isCancellationRequested) {
					return;
				}
				if (this.group) {
					input.updateGroup(this.group.id);
				}
				this.updateWebview(input);
			});
	}

	private updateWebview(input: WebviewEditorInput) {
		const webview = this.getWebview(input);
		input.claimWebview(this);
		webview.update(input.html, {
			allowScripts: input.options.enableScripts,
			localResourceRoots: input.options.localResourceRoots || this.getDefaultLocalResourceRoots(),
			portMappings: input.options.portMapping,
		}, !!input.options.retainContextWhenHidden);

		if (this._webviewContent) {
			this._webviewContent.style.visibility = 'visible';
		}

		this.doUpdateContainer();
	}

	private getDefaultLocalResourceRoots(): URI[] {
		const rootPaths = this._contextService.getWorkspace().folders.map(x => x.uri);
		const extension = (this.input as WebviewEditorInput).extension;
		if (extension) {
			rootPaths.push(extension.location);
		}
		return rootPaths;
	}

	private getWebview(input: WebviewEditorInput): WebviewElement {
		if (this._webview) {
			return this._webview;
		}

		this._webviewContent = input.container;

		if (input.webview) {
			this._webview = input.webview;
		} else {
			if (input.options.enableFindWidget) {
				this._contextKeyService = this._register(this._contextKeyService.createScoped(this._webviewContent));
				this.findWidgetVisible = KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_VISIBLE.bindTo(this._contextKeyService);
			}

			this._webview = this._instantiationService.createInstance(WebviewElement,
				this._layoutService.getContainer(Parts.EDITOR_PART),
				{
					allowSvgs: true,
					extension: input.extension,
					enableFindWidget: input.options.enableFindWidget
				},
				{});
			this._webview.mountTo(this._webviewContent);
			input.webview = this._webview;

			if (input.options.tryRestoreScrollPosition) {
				this._webview.initialScrollProgress = input.scrollYPercentage;
			}

			this._webview.state = input.webviewState;

			this._content!.setAttribute('aria-flowto', this._webviewContent.id);

			this.doUpdateContainer();
		}

		for (const message of this.pendingMessages) {
			this._webview.sendMessage(message);
		}
		this.pendingMessages = [];

		this.trackFocus();

		return this._webview;
	}

	private trackFocus() {
		this._webviewFocusTrackerDisposables = dispose(this._webviewFocusTrackerDisposables);

		// Track focus in webview content
		const webviewContentFocusTracker = DOM.trackFocus(this._webviewContent!);
		this._webviewFocusTrackerDisposables.push(webviewContentFocusTracker);
		this._webviewFocusTrackerDisposables.push(webviewContentFocusTracker.onDidFocus(() => this._onDidFocusWebview.fire()));

		// Track focus in webview element
		this._webviewFocusTrackerDisposables.push(this._webview!.onDidFocus(() => this._onDidFocusWebview.fire()));
	}
}
