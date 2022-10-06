/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorOptions as ICodeEditorOptions } from 'vs/editor/common/config/editorOptions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfiguration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { AbstractTextResourceEditor } from 'vs/workbench/browser/parts/editor/textResourceEditor';
import { OUTPUT_VIEW_ID, IOutputService, CONTEXT_IN_OUTPUT, IOutputChannel, CONTEXT_ACTIVE_LOG_OUTPUT, CONTEXT_OUTPUT_SCROLL_LOCK, IOutputChannelDescriptor, IOutputChannelRegistry, Extensions } from 'vs/workbench/services/output/common/output';
import { IThemeService, registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { CursorChangeReason } from 'vs/editor/common/cursorEvents';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { TextResourceEditorInput } from 'vs/workbench/common/editor/textResourceEditorInput';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { Registry } from 'vs/platform/registry/common/platform';
import { attachSelectBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { ISelectOptionItem } from 'vs/base/browser/ui/selectBox/selectBox';
import { SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { editorBackground, selectBorder } from 'vs/platform/theme/common/colorRegistry';
import { SelectActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { Dimension } from 'vs/base/browser/dom';
import { IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { IFileService } from 'vs/platform/files/common/files';

export class OutputViewPane extends ViewPane {

	private readonly editor: OutputEditor;
	private channelId: string | undefined;
	private editorPromise: CancelablePromise<OutputEditor> | null = null;

	private readonly scrollLockContextKey: IContextKey<boolean>;
	get scrollLock(): boolean { return !!this.scrollLockContextKey.get(); }
	set scrollLock(scrollLock: boolean) { this.scrollLockContextKey.set(scrollLock); }

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOutputService private readonly outputService: IOutputService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.scrollLockContextKey = CONTEXT_OUTPUT_SCROLL_LOCK.bindTo(this.contextKeyService);
		this.editor = instantiationService.createInstance(OutputEditor);
		this._register(this.editor.onTitleAreaUpdate(() => {
			this.updateTitle(this.editor.getTitle());
			this.updateActions();
		}));
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));
	}

	showChannel(channel: IOutputChannel, preserveFocus: boolean): void {
		if (this.channelId !== channel.id) {
			this.setInput(channel);
		}
		if (!preserveFocus) {
			this.focus();
		}
	}

	override focus(): void {
		super.focus();
		this.editorPromise?.then(() => this.editor.focus());
	}

	override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.editor.create(container);
		container.classList.add('output-view');
		const codeEditor = <ICodeEditor>this.editor.getControl();
		codeEditor.setAriaOptions({ role: 'document', activeDescendant: undefined });
		this._register(codeEditor.onDidChangeModelContent(() => {
			const activeChannel = this.outputService.getActiveChannel();
			if (activeChannel && !this.scrollLock) {
				this.editor.revealLastLine();
			}
		}));
		this._register(codeEditor.onDidChangeCursorPosition((e) => {
			if (e.reason !== CursorChangeReason.Explicit) {
				return;
			}

			if (!this.configurationService.getValue('output.smartScroll.enabled')) {
				return;
			}

			const model = codeEditor.getModel();
			if (model) {
				const newPositionLine = e.position.lineNumber;
				const lastLine = model.getLineCount();
				this.scrollLock = lastLine !== newPositionLine;
			}
		}));
	}

	override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.editor.layout(new Dimension(width, height));
	}

	override getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action.id === 'workbench.output.action.switchBetweenOutputs') {
			return this.instantiationService.createInstance(SwitchOutputActionViewItem, action);
		}
		return super.getActionViewItem(action);
	}

	private onDidChangeVisibility(visible: boolean): void {
		this.editor.setVisible(visible);
		let channel: IOutputChannel | undefined = undefined;
		if (visible) {
			channel = this.channelId ? this.outputService.getChannel(this.channelId) : this.outputService.getActiveChannel();
		}
		if (channel) {
			this.setInput(channel);
		} else {
			this.clearInput();
		}
	}

	private setInput(channel: IOutputChannel): void {
		this.channelId = channel.id;
		const descriptor = this.outputService.getChannelDescriptor(channel.id);
		CONTEXT_ACTIVE_LOG_OUTPUT.bindTo(this.contextKeyService).set(!!descriptor?.file && descriptor?.log);

		const input = this.createInput(channel);
		if (!this.editor.input || !input.matches(this.editor.input)) {
			this.editorPromise?.cancel();
			this.editorPromise = createCancelablePromise(token => this.editor.setInput(this.createInput(channel), { preserveFocus: true }, Object.create(null), token)
				.then(() => this.editor));
		}

	}

	private clearInput(): void {
		CONTEXT_ACTIVE_LOG_OUTPUT.bindTo(this.contextKeyService).set(false);
		this.editor.clearInput();
		this.editorPromise = null;
	}

	private createInput(channel: IOutputChannel): TextResourceEditorInput {
		return this.instantiationService.createInstance(TextResourceEditorInput, channel.uri, nls.localize('output model title', "{0} - Output", channel.label), nls.localize('channel', "Output channel for '{0}'", channel.label), undefined, undefined);
	}

}

export class OutputEditor extends AbstractTextResourceEditor {

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IOutputService private readonly outputService: IOutputService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IFileService fileService: IFileService
	) {
		super(OUTPUT_VIEW_ID, telemetryService, instantiationService, storageService, textResourceConfigurationService, themeService, editorGroupService, editorService, fileService);
	}

	override getId(): string {
		return OUTPUT_VIEW_ID;
	}

	override getTitle(): string {
		return nls.localize('output', "Output");
	}

	protected override getConfigurationOverrides(): ICodeEditorOptions {
		const options = super.getConfigurationOverrides();
		options.wordWrap = 'on';				// all output editors wrap
		options.lineNumbers = 'off';			// all output editors hide line numbers
		options.glyphMargin = false;
		options.lineDecorationsWidth = 20;
		options.rulers = [];
		options.folding = false;
		options.scrollBeyondLastLine = false;
		options.renderLineHighlight = 'none';
		options.minimap = { enabled: false };
		options.renderValidationDecorations = 'editable';
		options.padding = undefined;
		options.readOnly = true;
		options.domReadOnly = true;
		options.unicodeHighlight = {
			nonBasicASCII: false,
			invisibleCharacters: false,
			ambiguousCharacters: false,
		};

		const outputConfig = this.configurationService.getValue<any>('[Log]');
		if (outputConfig) {
			if (outputConfig['editor.minimap.enabled']) {
				options.minimap = { enabled: true };
			}
			if ('editor.wordWrap' in outputConfig) {
				options.wordWrap = outputConfig['editor.wordWrap'];
			}
		}

		return options;
	}

	protected getAriaLabel(): string {
		const channel = this.outputService.getActiveChannel();

		return channel ? nls.localize('outputViewWithInputAriaLabel', "{0}, Output panel", channel.label) : nls.localize('outputViewAriaLabel', "Output panel");
	}

	override async setInput(input: TextResourceEditorInput, options: ITextEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		const focus = !(options && options.preserveFocus);
		if (this.input && input.matches(this.input)) {
			return;
		}

		if (this.input) {
			// Dispose previous input (Output panel is not a workbench editor)
			this.input.dispose();
		}
		await super.setInput(input, options, context, token);
		if (focus) {
			this.focus();
		}
		this.revealLastLine();
	}

	override clearInput(): void {
		if (this.input) {
			// Dispose current input (Output panel is not a workbench editor)
			this.input.dispose();
		}
		super.clearInput();
	}

	protected override createEditor(parent: HTMLElement): void {

		parent.setAttribute('role', 'document');

		super.createEditor(parent);

		const scopedContextKeyService = this.scopedContextKeyService;
		if (scopedContextKeyService) {
			CONTEXT_IN_OUTPUT.bindTo(scopedContextKeyService).set(true);
		}
	}
}

type OutputChannelSelectionOptionItem = ISelectOptionItem & { readonly channel?: IOutputChannelDescriptor };

class SwitchOutputActionViewItem extends SelectActionViewItem {

	private static readonly SEPARATOR = '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500';

	private selectionOptionItems: OutputChannelSelectionOptionItem[] = [];

	constructor(
		action: IAction,
		@IOutputService private readonly outputService: IOutputService,
		@IThemeService private readonly themeService: IThemeService,
		@IContextViewService contextViewService: IContextViewService
	) {
		super(null, action, [], 0, contextViewService, { ariaLabel: nls.localize('outputChannels', "Output Channels"), optionsAsChildren: true });

		const outputChannelRegistry = Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels);
		this._register(outputChannelRegistry.onDidRegisterChannel(() => this.updateOptions()));
		this._register(outputChannelRegistry.onDidRemoveChannel(() => this.updateOptions()));
		this._register(this.outputService.onActiveOutputChannel(() => this.updateOptions()));
		this._register(attachSelectBoxStyler(this.selectBox, themeService));

		this.updateOptions();
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('switch-output');
		this._register(attachStylerCallback(this.themeService, { selectBorder }, colors => {
			container.style.borderColor = colors.selectBorder ? `${colors.selectBorder}` : '';
		}));
	}

	protected override getActionContext(option: string, index: number): string {
		return this.selectionOptionItems[index]?.channel?.id ?? option;
	}

	private updateOptions(): void {
		const outputChannels = [];
		const logChannels = [];
		const extensionLogChannels = [];
		this.selectionOptionItems = [];
		for (const descriptor of this.outputService.getChannelDescriptors()) {
			if (descriptor.log) {
				if (descriptor.extensionId) {
					extensionLogChannels.push(descriptor);
				} else {
					logChannels.push(descriptor);
				}
			} else {
				outputChannels.push(descriptor);
			}
		}

		for (const descriptor of outputChannels) {
			this.selectionOptionItems.push({ text: descriptor.label, isDisabled: false, channel: descriptor });
		}
		if (outputChannels.length && logChannels.length) {
			this.selectionOptionItems.push({ text: SwitchOutputActionViewItem.SEPARATOR, isDisabled: true });
		}
		for (const descriptor of logChannels) {
			this.selectionOptionItems.push({ text: nls.localize('logChannel', "Log ({0})", descriptor.label), isDisabled: false, channel: descriptor });
		}
		if (logChannels.length && extensionLogChannels.length) {
			this.selectionOptionItems.push({ text: SwitchOutputActionViewItem.SEPARATOR, isDisabled: true });
		}
		for (const descriptor of extensionLogChannels) {
			this.selectionOptionItems.push({ text: nls.localize('logChannel', "Log ({0})", descriptor.label), isDisabled: false, channel: descriptor });
		}

		let selected = 0;
		const activeChannel = this.outputService.getActiveChannel();
		if (activeChannel) {
			selected = this.selectionOptionItems.findIndex(item => item.channel?.id === activeChannel.id);
		}
		this.setOptions(this.selectionOptionItems, Math.max(0, selected));
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	// Sidebar background for the output view
	const sidebarBackground = theme.getColor(SIDE_BAR_BACKGROUND);
	if (sidebarBackground && sidebarBackground !== theme.getColor(editorBackground)) {
		collector.addRule(`
			.monaco-workbench .part.sidebar .output-view .monaco-editor,
			.monaco-workbench .part.sidebar .output-view .monaco-editor .margin,
			.monaco-workbench .part.sidebar .output-view .monaco-editor .monaco-editor-background {
				background-color: ${sidebarBackground};
			}
		`);
	}
});
