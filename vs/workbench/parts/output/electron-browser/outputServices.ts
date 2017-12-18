/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as paths from 'vs/base/common/paths';
import { TPromise } from 'vs/base/common/winjs.base';
import Event, { Emitter } from 'vs/base/common/event';
import URI from 'vs/base/common/uri';
import { IDisposable, dispose, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorOptions } from 'vs/workbench/common/editor';
import { IOutputChannelIdentifier, IOutputChannel, IOutputService, Extensions, OUTPUT_PANEL_ID, IOutputChannelRegistry, OUTPUT_SCHEME, OUTPUT_MIME } from 'vs/workbench/parts/output/common/output';
import { OutputPanel } from 'vs/workbench/parts/output/browser/outputPanel';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { OutputLinkProvider } from 'vs/workbench/parts/output/common/outputLinkProvider';
import { ITextModelService, ITextModelContentProvider } from 'vs/editor/common/services/resolverService';
import { IModel } from 'vs/editor/common/editorCommon';
import { IModeService } from 'vs/editor/common/services/modeService';
import { RunOnceScheduler } from 'vs/base/common/async';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { IFileService, FileChangeType } from 'vs/platform/files/common/files';
import { IPanel } from 'vs/workbench/common/panel';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { RotatingLogger } from 'spdlog';
import { toLocalISOString } from 'vs/base/common/date';

const OUTPUT_ACTIVE_CHANNEL_KEY = 'output.activechannel';

class OutputFileHandler extends Disposable {

	private _onDidChange: Emitter<void> = new Emitter<void>();
	readonly onDidContentChange: Event<void> = this._onDidChange.event;

	private disposables: IDisposable[] = [];

	constructor(
		private readonly file: URI,
		private fileService: IFileService
	) {
		super();
	}

	watch(): void {
		this.fileService.watchFileChanges(this.file);
		this.disposables.push(this.fileService.onFileChanges(changes => {
			if (changes.contains(this.file, FileChangeType.UPDATED)) {
				this._onDidChange.fire();
			}
		}));
	}

	loadContent(from: number): TPromise<string> {
		return this.fileService.resolveContent(this.file)
			.then(({ value }) => value.substring(from));
	}

	unwatch(): void {
		this.fileService.unwatchFileChanges(this.file);
		this.disposables = dispose(this.disposables);
	}

	dispose(): void {
		this.unwatch();
		super.dispose();
	}
}

interface OutputChannel extends IOutputChannel {
	readonly onDispose: Event<void>;
	resolve(): TPromise<string>;
}

class FileOutputChannel extends Disposable implements OutputChannel {

	protected _onDispose: Emitter<void> = new Emitter<void>();
	readonly onDispose: Event<void> = this._onDispose.event;

	scrollLock: boolean = false;

	protected readonly file: URI;
	private readonly fileHandler: OutputFileHandler;

	private updateInProgress: boolean = false;
	private modelUpdater: RunOnceScheduler;
	private startOffset: number;
	private endOffset: number;

	constructor(
		private readonly outputChannelIdentifier: IOutputChannelIdentifier,
		@IFileService protected fileService: IFileService,
		@IModelService private modelService: IModelService,
		@IPanelService private panelService: IPanelService
	) {
		super();
		this.file = outputChannelIdentifier.file;
		this.startOffset = 0;
		this.endOffset = 0;

		this.modelUpdater = new RunOnceScheduler(() => this.doUpdate(), 300);
		this._register(toDisposable(() => this.modelUpdater.cancel()));

		this.fileHandler = this._register(new OutputFileHandler(this.file, this.fileService));
		this._register(this.fileHandler.onDidContentChange(() => this.onDidContentChange()));
		this._register(toDisposable(() => this.fileHandler.unwatch()));

		this._register(this.modelService.onModelAdded(this.onModelAdded, this));
		this._register(this.modelService.onModelRemoved(this.onModelRemoved, this));
	}

	get id(): string {
		return this.outputChannelIdentifier.id;
	}

	get label(): string {
		return this.outputChannelIdentifier.label;
	}

	append(message: string): void {
		throw new Error('Not supported');
	}

	clear(): void {
		this.startOffset = this.endOffset;
		const model = this.getModel();
		if (model) {
			model.setValue('');
		}
	}

	resolve(): TPromise<string> {
		return this.fileHandler.loadContent(this.startOffset);
	}

	private onModelAdded(model: IModel): void {
		if (model.uri.fsPath === this.id) {
			this.endOffset = this.startOffset + new Buffer(model.getValueLength()).byteLength;
			this.fileHandler.watch();
		}
	}

	private onModelRemoved(model: IModel): void {
		if (model.uri.fsPath === this.id) {
			this.fileHandler.unwatch();
		}
	}

	private onDidContentChange(): void {
		if (!this.updateInProgress) {
			this.updateInProgress = true;
			this.modelUpdater.schedule();
		}
	}

	private doUpdate(): void {
		let model = this.getModel();
		if (model) {
			this.fileHandler.loadContent(this.endOffset)
				.then(content => {
					this.appendContent(content);
					this.updateInProgress = false;
				}, () => this.updateInProgress = false);
		} else {
			this.updateInProgress = false;
		}
	}

	private appendContent(content: string): void {
		const model = this.getModel();
		if (model && content) {
			const lastLine = model.getLineCount();
			const lastLineMaxColumn = model.getLineMaxColumn(lastLine);
			model.applyEdits([EditOperation.insert(new Position(lastLine, lastLineMaxColumn), content)]);
			this.endOffset = this.endOffset + new Buffer(content).byteLength;
			if (!this.scrollLock) {
				(<OutputPanel>this.panelService.getActivePanel()).revealLastLine();
			}
		}
	}

	protected getModel(): IModel {
		const model = this.modelService.getModel(URI.from({ scheme: OUTPUT_SCHEME, path: this.id }));
		return model && !model.isDisposed() ? model : null;
	}

	dispose(): void {
		this._onDispose.fire();
		super.dispose();
	}
}

class AppendableFileOutoutChannel extends FileOutputChannel implements OutputChannel {

	private outputWriter: RotatingLogger;
	private flushScheduler: RunOnceScheduler;

	constructor(
		outputChannelIdentifier: IOutputChannelIdentifier,
		@IFileService fileService: IFileService,
		@IModelService modelService: IModelService,
		@IPanelService panelService: IPanelService,
	) {
		super(outputChannelIdentifier, fileService, modelService, panelService);
		this.outputWriter = new RotatingLogger(this.id, this.file.fsPath, 1024 * 1024 * 5, 1);
		this.outputWriter.clearFormatters();

		this.flushScheduler = new RunOnceScheduler(() => this.outputWriter.flush(), 300);
		this._register(toDisposable(() => this.flushScheduler.cancel()));

		this._register(modelService.onModelAdded(model => {
			if (model.uri.fsPath === this.id && !this.flushScheduler.isScheduled()) {
				this.flushScheduler.schedule();
			}
		}));
	}

	append(message: string): void {
		this.outputWriter.critical(message);
		if (this.getModel() && !this.flushScheduler.isScheduled()) {
			this.flushScheduler.schedule();
		}
	}
}

export class OutputService implements IOutputService, ITextModelContentProvider {

	public _serviceBrand: any;

	private channels: Map<string, OutputChannel> = new Map<string, OutputChannel>();
	private activeChannelId: string;

	private _onActiveOutputChannel: Emitter<string> = new Emitter<string>();
	readonly onActiveOutputChannel: Event<string> = this._onActiveOutputChannel.event;

	private _outputPanel: OutputPanel;

	constructor(
		@IStorageService private storageService: IStorageService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IPanelService private panelService: IPanelService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IModelService private modelService: IModelService,
		@IModeService private modeService: IModeService,
		@ITextModelService textModelResolverService: ITextModelService,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService,
		@IEnvironmentService private environmentService: IEnvironmentService
	) {
		const channels = this.getChannels();
		this.activeChannelId = this.storageService.get(OUTPUT_ACTIVE_CHANNEL_KEY, StorageScope.WORKSPACE, channels && channels.length > 0 ? channels[0].id : null);

		instantiationService.createInstance(OutputLinkProvider);

		// Register as text model content provider for output
		textModelResolverService.registerTextModelContentProvider(OUTPUT_SCHEME, this);

		this.onDidPanelOpen(this.panelService.getActivePanel());
		panelService.onDidPanelOpen(this.onDidPanelOpen, this);
		panelService.onDidPanelClose(this.onDidPanelClose, this);
	}

	provideTextContent(resource: URI): TPromise<IModel> {
		const channel = <OutputChannel>this.getChannel(resource.fsPath);
		return channel.resolve()
			.then(content => this.modelService.createModel(content, this.modeService.getOrCreateMode(OUTPUT_MIME), resource));
	}

	showChannel(id: string, preserveFocus?: boolean): TPromise<void> {
		if (this.isChannelShown(id)) {
			return TPromise.as(null);
		}

		this.activeChannelId = id;
		let promise = TPromise.as(null);
		if (this._outputPanel) {
			this.doShowChannel(id, preserveFocus);
		} else {
			promise = this.panelService.openPanel(OUTPUT_PANEL_ID) as TPromise;
		}
		return promise.then(() => this._onActiveOutputChannel.fire(id));
	}

	showChannelInEditor(channelId: string): TPromise<void> {
		return this.editorService.openEditor(this.createInput(channelId)) as TPromise;
	}

	getChannel(id: string): IOutputChannel {
		if (!this.channels.has(id)) {
			this.channels.set(id, this.createChannel(id));
		}
		return this.channels.get(id);
	}

	getChannels(): IOutputChannelIdentifier[] {
		return Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).getChannels();
	}

	getActiveChannel(): IOutputChannel {
		return this.getChannel(this.activeChannelId);
	}

	private createChannel(id: string): OutputChannel {
		const channelDisposables = [];
		const channel = this.instantiateChannel(id);
		channel.onDispose(() => {
			Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).removeChannel(id);
			if (this.activeChannelId === id) {
				const channels = this.getChannels();
				if (this._outputPanel && channels.length) {
					this.showChannel(channels[0].id);
				} else {
					this._onActiveOutputChannel.fire(void 0);
				}
			}
			dispose(channelDisposables);
		}, channelDisposables);

		return channel;
	}

	private instantiateChannel(id: string): OutputChannel {
		const channelData = Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).getChannel(id);
		if (channelData && channelData.file) {
			return this.instantiationService.createInstance(FileOutputChannel, channelData);
		}
		const sessionId = toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '');
		const file = URI.file(paths.join(this.environmentService.logsPath, 'outputs', `${id}.${sessionId}.log`));
		return this.instantiationService.createInstance(AppendableFileOutoutChannel, { id, label: channelData ? channelData.label : '', file });
	}


	private isChannelShown(channelId: string): boolean {
		const panel = this.panelService.getActivePanel();
		return panel && panel.getId() === OUTPUT_PANEL_ID && this.activeChannelId === channelId;
	}

	private onDidPanelClose(panel: IPanel): void {
		if (this._outputPanel && panel.getId() === OUTPUT_PANEL_ID) {
			this._outputPanel.clearInput();
		}
	}

	private onDidPanelOpen(panel: IPanel): void {
		if (panel && panel.getId() === OUTPUT_PANEL_ID) {
			this._outputPanel = <OutputPanel>this.panelService.getActivePanel();
			if (this.activeChannelId) {
				this.doShowChannel(this.activeChannelId, true);
			}
		}
	}

	private doShowChannel(channelId: string, preserveFocus: boolean): void {
		if (this._outputPanel) {
			this.storageService.store(OUTPUT_ACTIVE_CHANNEL_KEY, channelId, StorageScope.WORKSPACE);
			this._outputPanel.setInput(this.createInput(channelId), EditorOptions.create({ preserveFocus: preserveFocus }));
			if (!preserveFocus) {
				this._outputPanel.focus();
			}
		}
	}

	private createInput(channelId: string): ResourceEditorInput {
		const resource = URI.from({ scheme: OUTPUT_SCHEME, path: channelId });
		const channelData = Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).getChannel(channelId);
		const label = channelData ? channelData.label : channelId;
		return this.instantiationService.createInstance(ResourceEditorInput, nls.localize('output', "{0} - Output", label), nls.localize('channel', "Output channel for '{0}'", label), resource);
	}
}