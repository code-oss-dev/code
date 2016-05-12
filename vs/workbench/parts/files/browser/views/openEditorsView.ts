/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import nls = require('vs/nls');
import errors = require('vs/base/common/errors');
import {RunOnceScheduler} from 'vs/base/common/async';
import {TPromise} from 'vs/base/common/winjs.base';
import {IActionRunner} from 'vs/base/common/actions';
import dom = require('vs/base/browser/dom');
import {CollapsibleState} from 'vs/base/browser/ui/splitview/splitview';
import {Tree} from 'vs/base/parts/tree/browser/treeImpl';
import {IContextMenuService} from 'vs/platform/contextview/browser/contextView';
import {IMessageService} from 'vs/platform/message/common/message';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IEventService} from 'vs/platform/event/common/event';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {EventType as WorkbenchEventType, UntitledEditorEvent} from 'vs/workbench/common/events';
import {AdaptiveCollapsibleViewletView} from 'vs/workbench/browser/viewlet';
import {ITextFileService, TextFileChangeEvent, EventType as FileEventType, AutoSaveMode, IFilesConfiguration} from 'vs/workbench/parts/files/common/files';
import {IWorkbenchEditorService} from 'vs/workbench/services/editor/common/editorService';
import {IEditorStacksModel} from 'vs/workbench/common/editor/editorStacksModel';
import {Renderer, DataSource, Controller, AccessibilityProvider, OpenEditor, ActionProvider} from 'vs/workbench/parts/files/browser/views/openEditorsViewer';

const $ = dom.emmet;

export class OpenEditorsView extends AdaptiveCollapsibleViewletView {

	private static MEMENTO_COLLAPSED = 'openEditors.memento.collapsed';
	private static DEFAULT_MAX_VISIBLE_OPEN_EDITORS = 9;
	private static DEFAULT_DYNAMIC_HEIGHT = true;

	private settings: any;
	private maxVisibleOpenEditors: number;
	private dynamicHeight: boolean;

	private model: IEditorStacksModel;
	private dirtyCountElement: HTMLElement;
	private lastDirtyCount: number;
	// Use a scheduler to update the tree as many update events come at some time so to prevent over-reacting.
	private updateTreeScheduler: RunOnceScheduler;

	constructor(actionRunner: IActionRunner, settings: any,
		@IMessageService messageService: IMessageService,
		@IEventService private eventService: IEventService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@ITextFileService private textFileService: ITextFileService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService
	) {
		super(actionRunner, OpenEditorsView.computeExpandedBodySize(editorService.getStacksModel()), !!settings[OpenEditorsView.MEMENTO_COLLAPSED], nls.localize('openEditosrSection', "Open Editors Section"), messageService, contextMenuService);

		this.settings = settings;
		this.model = editorService.getStacksModel();
		this.lastDirtyCount = 0;
		this.updateTreeScheduler = new RunOnceScheduler(() => this.updateTree(), 0);
	}

	public renderHeader(container: HTMLElement): void {
		const titleDiv = dom.append(container, $('.title'));
		const titleSpan = dom.append(titleDiv, $('span'));
		titleSpan.textContent = nls.localize('openEditors', "Open Editors");

		this.dirtyCountElement = dom.append(titleDiv, $('.monaco-count-badge'));
		this.updateDirtyIndicator();

		super.renderHeader(container);
	}

	public renderBody(container: HTMLElement): void {
		this.treeContainer = super.renderViewTree(container);
		dom.addClass(this.treeContainer, 'explorer-open-editors');

		const dataSource = this.instantiationService.createInstance(DataSource);
		const actionProvider = this.instantiationService.createInstance(ActionProvider);
		const renderer = this.instantiationService.createInstance(Renderer, actionProvider);
		const controller = this.instantiationService.createInstance(Controller, actionProvider, this.model);
		const accessibilityProvider = this.instantiationService.createInstance(AccessibilityProvider);

		this.tree = new Tree(this.treeContainer, {
			dataSource,
			renderer,
			controller,
			accessibilityProvider
		}, {
			indentPixels: 0,
			twistiePixels: 20,
			ariaLabel: nls.localize('treeAriaLabel', "Open Editors")
		});

		this.updateTree();
	}

	public create(): TPromise<void> {

		// Load Config
		const configuration = this.configurationService.getConfiguration<IFilesConfiguration>();
		this.onConfigurationUpdated(configuration);

		// listeners
		this.registerListeners();

		return super.create();
	}

	private registerListeners(): void {

		// update on model changes
		this.toDispose.push(this.model.onModelChanged(e => this.updateTreeScheduler.schedule()));

		// listen to untitled
		this.toDispose.push(this.eventService.addListener2(WorkbenchEventType.UNTITLED_FILE_DIRTY, (e: UntitledEditorEvent) => this.onUntitledFileDirty()));
		this.toDispose.push(this.eventService.addListener2(WorkbenchEventType.UNTITLED_FILE_DELETED, (e: UntitledEditorEvent) => this.onUntitledFileDeleted()));

		// listen to files being changed locally
		this.toDispose.push(this.eventService.addListener2(FileEventType.FILE_DIRTY, (e: TextFileChangeEvent) => this.onTextFileDirty(e)));
		this.toDispose.push(this.eventService.addListener2(FileEventType.FILE_SAVED, (e: TextFileChangeEvent) => this.onTextFileSaved(e)));
		this.toDispose.push(this.eventService.addListener2(FileEventType.FILE_SAVE_ERROR, (e: TextFileChangeEvent) => this.onTextFileSaveError(e)));
		this.toDispose.push(this.eventService.addListener2(FileEventType.FILE_REVERTED, (e: TextFileChangeEvent) => this.onTextFileReverted(e)));

		// Also handle configuration updates
		this.toDispose.push(this.configurationService.onDidUpdateConfiguration(e => this.onConfigurationUpdated(e.config)));
	}

	private updateTree(): void {
		if (this.isDisposed) {
			return;
		}

		// View size
		this.expandedBodySize = this.getExpandedBodySize(this.model);

		if (this.tree) {
			// Show groups only if there is more than 1 group
			const treeInput = this.model.groups.length === 1 ? this.model.groups[0] : this.model;
			(treeInput !== this.tree.getInput() ? this.tree.setInput(treeInput) : this.tree.refresh())
			// Always expand all the groups as they are unclickable
				.done(() => this.tree.expandAll(this.model.groups), errors.onUnexpectedError);

			// Make sure to keep active open editor highlighted
			if (this.model.activeGroup) {
				this.highlightEntry(new OpenEditor(this.model.activeGroup.activeEditor, this.model.activeGroup));
			}
		}
	}

	private highlightEntry(entry: OpenEditor): void {
		this.tree.clearFocus();
		this.tree.clearSelection();

		if (entry) {
			this.tree.setFocus(entry);
			this.tree.setSelection([entry]);
			this.tree.reveal(entry).done(null, errors.onUnexpectedError);
		}
	}

	private onConfigurationUpdated(configuration: IFilesConfiguration): void {
		let visibleOpenEditors = configuration && configuration.explorer && configuration.explorer.openEditors && configuration.explorer.openEditors.maxVisible;
		if (typeof visibleOpenEditors === 'number') {
			this.maxVisibleOpenEditors = visibleOpenEditors;
		} else {
			this.maxVisibleOpenEditors = OpenEditorsView.DEFAULT_MAX_VISIBLE_OPEN_EDITORS;
		}

		let dynamicHeight = configuration && configuration.explorer && configuration.explorer.openEditors && configuration.explorer.openEditors.dynamicHeight;
		if (typeof dynamicHeight === 'boolean') {
			this.dynamicHeight = dynamicHeight;
		} else {
			this.dynamicHeight = OpenEditorsView.DEFAULT_DYNAMIC_HEIGHT;
		}

		// Adjust expanded body size
		this.expandedBodySize = this.getExpandedBodySize(this.model);
	}

	private onTextFileDirty(e: TextFileChangeEvent): void {
		if (this.textFileService.getAutoSaveMode() !== AutoSaveMode.AFTER_SHORT_DELAY) {
			this.updateDirtyIndicator(); // no indication needed when auto save is enabled for short delay
		}
	}

	private onTextFileSaved(e: TextFileChangeEvent): void {
		if (this.lastDirtyCount > 0) {
			this.updateDirtyIndicator();
		}
	}

	private onTextFileSaveError(e: TextFileChangeEvent): void {
		this.updateDirtyIndicator();
	}

	private onTextFileReverted(e: TextFileChangeEvent): void {
		if (this.lastDirtyCount > 0) {
			this.updateDirtyIndicator();
		}
	}

	private onUntitledFileDirty(): void {
		this.updateDirtyIndicator();
	}

	private onUntitledFileDeleted(): void {
		if (this.lastDirtyCount > 0) {
			this.updateDirtyIndicator();
		}
	}

	private updateDirtyIndicator(): void {
		let dirty = this.textFileService.getDirty().length;
		this.lastDirtyCount = dirty;
		if (dirty === 0) {
			dom.addClass(this.dirtyCountElement, 'hidden');
		} else {
			this.dirtyCountElement.textContent = nls.localize('dirtyCounter', "{0} unsaved", dirty);
			dom.removeClass(this.dirtyCountElement, 'hidden');
		}
		this.updateTreeScheduler.schedule();
	}

	private getExpandedBodySize(model: IEditorStacksModel): number {
		return OpenEditorsView.computeExpandedBodySize(model, this.maxVisibleOpenEditors, this.dynamicHeight);
	}

	private static computeExpandedBodySize(model: IEditorStacksModel, maxVisibleOpenEditors = OpenEditorsView.DEFAULT_MAX_VISIBLE_OPEN_EDITORS, dynamicHeight = OpenEditorsView.DEFAULT_DYNAMIC_HEIGHT): number {
		const entryCount = model.groups.reduce((sum, group) => sum + group.count, 0);

		let itemsToShow: number;
		if (dynamicHeight) {
			itemsToShow = Math.min(Math.max(maxVisibleOpenEditors, 1), entryCount);
		} else {
			itemsToShow = Math.max(maxVisibleOpenEditors, 1);
		}
		// We only show the group labels if there is more than 1 group
		if (model.groups.length > 1) {
			itemsToShow += model.groups.length;
		}

		return itemsToShow * Renderer.ITEM_HEIGHT;
	}

	public getOptimalWidth():number {
		let parentNode = this.tree.getHTMLElement();
		let childNodes = [].slice.call(parentNode.querySelectorAll('.monaco-file-label > .file-name'));
		return dom.getLargestChildWidth(parentNode, childNodes);
	}

	public shutdown(): void {
		this.settings[OpenEditorsView.MEMENTO_COLLAPSED] = (this.state === CollapsibleState.COLLAPSED);

		super.shutdown();
	}
}
