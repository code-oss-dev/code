/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {Dimension, Builder, Box} from 'vs/base/browser/builder';
import {Preferences} from 'vs/workbench/common/constants';
import {EditorEvent, EventType} from 'vs/workbench/common/events';
import {Part} from 'vs/workbench/browser/part';
import {QuickOpenController} from 'vs/workbench/browser/parts/quickopen/quickOpenController';
import {Sash, ISashEvent, IVerticalSashLayoutProvider, IHorizontalSashLayoutProvider, Orientation} from 'vs/base/browser/ui/sash/sash';
import {IWorkbenchEditorService} from 'vs/workbench/services/editor/common/editorService';
import {IPartService, Position} from 'vs/workbench/services/part/common/partService';
import {IWorkspaceContextService} from 'vs/workbench/services/workspace/common/contextService';
import {IStorageService, StorageScope, StorageEventType} from 'vs/platform/storage/common/storage';
import {IContextViewService} from 'vs/platform/contextview/browser/contextView';
import {IEventService} from 'vs/platform/event/common/event';

const DEFAULT_MIN_PART_WIDTH = 170;
const DEFAULT_MIN_PANEL_PART_HEIGHT = 170;
const DEFAULT_MIN_EDITOR_PART_HEIGHT = 170;
const HIDE_SIDEBAR_WIDTH_THRESHOLD = 50;
const HIDE_PANEL_HEIGHT_THRESHOLD = 50;

const LAYOUT_RELATED_PREFERENCES = [
	Preferences.THEME
];

export class LayoutOptions {
	public margin: Box;

	constructor() {
		this.margin = new Box(0, 0, 0, 0);
	}

	public setMargin(margin: Box): LayoutOptions {
		this.margin = margin;

		return this;
	}
}

interface ComputedStyles {
	activitybar: { minWidth: number; };
	sidebar: { minWidth: number; };
	panel: { minHeight: number; }
	editor: { minWidth: number; };
	statusbar: { height: number; };
}

/**
 * The workbench layout is responsible to lay out all parts that make the Monaco Workbench.
 */
export class WorkbenchLayout implements IVerticalSashLayoutProvider, IHorizontalSashLayoutProvider {

	private static sashXWidthSettingsKey = 'workbench.sidebar.width';
	private static sashYHeightSettingsKey = 'workbench.panel.height';

	private parent: Builder;
	private workbenchContainer: Builder;
	private activitybar: Part;
	private editor: Part;
	private sidebar: Part;
	private panelPart: Part;
	private statusbar: Part;
	private quickopen: QuickOpenController;
	private options: LayoutOptions;
	private toUnbind: { (): void; }[];
	private computedStyles: ComputedStyles;
	private workbenchSize: Dimension;
	private sashX: Sash;
	private sashY: Sash;
	private startSidebarWidth: number;
	private sidebarWidth: number;
	private sidebarHeight: number;
	private startPanelHeight: number;
	private panelHeight: number;
	private panelWidth: number;

	// Take parts as an object bag since instatation service does not have typings for constructors with 9+ arguments
	constructor(
		parent: Builder,
		workbenchContainer: Builder,
		parts: {
			activitybar: Part,
			editor: Part,
			sidebar: Part,
			panel: Part,
			statusbar: Part
		},
		quickopen: QuickOpenController,
		options: LayoutOptions,
		@IStorageService private storageService: IStorageService,
		@IEventService private eventService: IEventService,
		@IContextViewService private contextViewService: IContextViewService,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IPartService private partService: IPartService
	) {
		this.parent = parent;
		this.workbenchContainer = workbenchContainer;
		this.activitybar = parts.activitybar;
		this.editor = parts.editor;
		this.sidebar = parts.sidebar;
		this.panelPart = parts.panel;
		this.statusbar = parts.statusbar;
		this.quickopen = quickopen;
		this.options = options || new LayoutOptions();
		this.toUnbind = [];
		this.computedStyles = null;
		this.sashX = new Sash(this.workbenchContainer.getHTMLElement(), this, {
			baseSize: 5
		});
		this.sashY = new Sash(this.workbenchContainer.getHTMLElement(), this, {
			baseSize: 5,
			orientation: Orientation.HORIZONTAL
		});

		this.sidebarWidth = this.storageService.getInteger(WorkbenchLayout.sashXWidthSettingsKey, StorageScope.GLOBAL, -1);
		this.panelHeight = this.storageService.getInteger(WorkbenchLayout.sashYHeightSettingsKey, StorageScope.GLOBAL, 0);

		this.registerListeners();
		this.registerSashListeners();
	}

	private registerListeners(): void {
		this.toUnbind.push(this.eventService.addListener(StorageEventType.STORAGE, (e: StorageEvent) => this.onPreferenceChange(e)));
		this.toUnbind.push(this.eventService.addListener(EventType.EDITOR_INPUT_CHANGING, (e: EditorEvent) => this.onEditorInputChanging(e)));
	}

	private registerSashListeners(): void {
		let startX: number = 0;
		let startY: number = 0;

		this.sashX.addListener('start', (e: ISashEvent) => {
			this.startSidebarWidth = this.sidebarWidth;
			startX = e.startX;
		});

		this.sashY.addListener('start', (e: ISashEvent) => {
			this.startPanelHeight = this.panelHeight;
			startY = e.startY;
		});

		this.sashX.addListener('change', (e: ISashEvent) => {
			let doLayout = false;
			let sidebarPosition = this.partService.getSideBarPosition();
			let isSidebarHidden = this.partService.isSideBarHidden();
			let newSashWidth = (sidebarPosition === Position.LEFT) ? this.startSidebarWidth + e.currentX - startX : this.startSidebarWidth - e.currentX + startX;

			// Sidebar visible
			if (!isSidebarHidden) {

				// Automatically hide side bar when a certain threshold is met
				if (newSashWidth + HIDE_SIDEBAR_WIDTH_THRESHOLD < this.computedStyles.sidebar.minWidth) {
					let dragCompensation = DEFAULT_MIN_PART_WIDTH - HIDE_SIDEBAR_WIDTH_THRESHOLD;
					this.partService.setSideBarHidden(true);
					startX = (sidebarPosition === Position.LEFT) ? Math.max(this.computedStyles.activitybar.minWidth, e.currentX - dragCompensation) : Math.min(e.currentX + dragCompensation, this.workbenchSize.width - this.computedStyles.activitybar.minWidth);
					this.sidebarWidth = this.startSidebarWidth; // when restoring sidebar, restore to the sidebar width we started from
				}

				// Otherwise size the sidebar accordingly
				else {
					this.sidebarWidth = Math.max(this.computedStyles.sidebar.minWidth, newSashWidth); // Sidebar can not become smaller than MIN_PART_WIDTH
					doLayout = newSashWidth >= this.computedStyles.sidebar.minWidth;
				}
			}

			// Sidebar hidden
			else {
				if ((sidebarPosition === Position.LEFT && e.currentX - startX >= this.computedStyles.sidebar.minWidth) ||
					(sidebarPosition === Position.RIGHT && startX - e.currentX >= this.computedStyles.sidebar.minWidth)) {
					this.startSidebarWidth = this.computedStyles.sidebar.minWidth - (sidebarPosition === Position.LEFT ? e.currentX - startX : startX - e.currentX);
					this.sidebarWidth = this.computedStyles.sidebar.minWidth;
					this.partService.setSideBarHidden(false);
				}
			}

			if (doLayout) {
				this.layout();
			}
		});

		this.sashY.addListener('change', (e: ISashEvent) => {
			let doLayout = false;
			let isPanelHidden = this.partService.isPanelHidden();
			let newSashHeight = this.startPanelHeight - (e.currentY - startY);

			// Panel visible
			if (!isPanelHidden) {
				// Automatically hide panel when a certain threshold is met
				if (newSashHeight + HIDE_PANEL_HEIGHT_THRESHOLD < this.computedStyles.panel.minHeight) {
					let dragCompensation = DEFAULT_MIN_PANEL_PART_HEIGHT - HIDE_PANEL_HEIGHT_THRESHOLD;
					this.partService.setPanelHidden(true);
					startY = Math.min(this.sidebarHeight - this.computedStyles.statusbar.height, e.currentY + dragCompensation);
					this.panelHeight = this.startPanelHeight; // when restoring panel, restore to the panel width we started from
				}

				// Otherwise size the panel accordingly
				else {
					this.panelHeight = Math.max(this.computedStyles.panel.minHeight, newSashHeight); // Panel can not become smaller than MIN_PART_HEIGHT
					doLayout = newSashHeight >= this.computedStyles.panel.minHeight;
				}
			}

			// Panel hidden
			else {
				if (startY - e.currentY >= this.computedStyles.panel.minHeight) {
					this.startPanelHeight = 0;
					this.panelHeight = this.computedStyles.panel.minHeight;
					this.partService.setPanelHidden(false);
				}
			}

			if (doLayout) {
				this.layout();
			}
		});

		this.sashX.addListener('end', () => {
			this.storageService.store(WorkbenchLayout.sashXWidthSettingsKey, this.sidebarWidth, StorageScope.GLOBAL);
		});
		this.sashY.addListener('end', () => {
			this.storageService.store(WorkbenchLayout.sashYHeightSettingsKey, this.panelHeight, StorageScope.GLOBAL);
		});
	}

	private onEditorInputChanging(e: EditorEvent): void {

		// Make sure that we layout properly in case we detect that the sidebar is large enought to cause
		// multiple opened editors to go below minimal size. The fix is to trigger a layout for any editor
		// input change that falls into this category.
		if (this.workbenchSize && this.sidebarWidth) {
			let visibleEditors = this.editorService.getVisibleEditors().length;
			if (visibleEditors > 1 && this.workbenchSize.width - this.sidebarWidth < visibleEditors * DEFAULT_MIN_PART_WIDTH) {
				this.layout();
			}
		}
	}

	private onPreferenceChange(e: StorageEvent): void {
		if (e.key && LAYOUT_RELATED_PREFERENCES.indexOf(e.key) >= 0) {

			// Recompute Styles
			this.computeStyle();
			this.editor.getLayout().computeStyle();
			this.sidebar.getLayout().computeStyle();
			this.panelPart.getLayout().computeStyle();

			// Trigger Layout
			this.layout();
		}
	}

	private computeStyle(): void {
		const sidebarStyle = this.sidebar.getContainer().getComputedStyle();
		const panelPartStyle = this.panelPart.getContainer().getComputedStyle();
		const editorStyle = this.editor.getContainer().getComputedStyle();
		const activitybarStyle = this.activitybar.getContainer().getComputedStyle();

		this.computedStyles = {
			activitybar: {
				minWidth: parseInt(activitybarStyle.getPropertyValue('min-width'), 10) || 0
			},

			sidebar: {
				minWidth: parseInt(sidebarStyle.getPropertyValue('min-width'), 10) || DEFAULT_MIN_PART_WIDTH
			},

			panel: {
				minHeight: parseInt(panelPartStyle.getPropertyValue('min-height'), 10) || DEFAULT_MIN_PANEL_PART_HEIGHT
			},

			editor: {
				minWidth: parseInt(editorStyle.getPropertyValue('min-width'), 10) || DEFAULT_MIN_PART_WIDTH
			},

			statusbar: {
				height: 0
			}
		};

		if (this.statusbar) {
			const statusbarStyle = this.statusbar.getContainer().getComputedStyle();
			this.computedStyles.statusbar.height = parseInt(statusbarStyle.getPropertyValue('height'), 10) || 18;
		}
	}

	public layout(forceStyleReCompute?: boolean): void {
		if (forceStyleReCompute) {
			this.computeStyle();
			this.editor.getLayout().computeStyle();
			this.sidebar.getLayout().computeStyle();
			this.panelPart.getLayout().computeStyle();
		}

		if (!this.computedStyles) {
			this.computeStyle();
		}

		this.workbenchSize = this.getWorkbenchArea();

		const isSidebarHidden = this.partService.isSideBarHidden();
		const isPanelHidden = this.partService.isPanelHidden();
		const sidebarPosition = this.partService.getSideBarPosition();

		// Sidebar
		let sidebarWidth: number;
		if (isSidebarHidden) {
			sidebarWidth = 0;
		} else if (this.sidebarWidth !== -1) {
			sidebarWidth = Math.max(this.computedStyles.sidebar.minWidth, this.sidebarWidth);
		} else {
			sidebarWidth = this.workbenchSize.width / 5;
			this.sidebarWidth = sidebarWidth;
		}

		this.sidebarHeight = this.workbenchSize.height - this.computedStyles.statusbar.height;
		let sidebarSize = new Dimension(sidebarWidth, this.sidebarHeight);

		// Activity Bar
		let activityBarMinWidth = this.computedStyles.activitybar.minWidth;
		let activityBarSize = new Dimension(activityBarMinWidth, sidebarSize.height);

		// Panel part
		let panelHeight: number;
		if (isPanelHidden) {
			panelHeight = 0;
		} else if (this.panelHeight > 0) {
			panelHeight = Math.min(sidebarSize.height - DEFAULT_MIN_EDITOR_PART_HEIGHT, Math.max(this.computedStyles.panel.minHeight, this.panelHeight));
		} else {
			panelHeight = sidebarSize.height * 0.4;
		}
		const panelDimension = new Dimension(this.workbenchSize.width - sidebarSize.width - activityBarSize.width, panelHeight);
		this.panelWidth = panelDimension.width;

		// Editor
		let editorSize = {
			width: 0,
			height: 0,
			remainderLeft: 0,
			remainderRight: 0
		};

		let editorDimension = new Dimension(panelDimension.width, sidebarSize.height - panelDimension.height);
		editorSize.width = editorDimension.width;
		editorSize.height = editorDimension.height;

		// Sidebar hidden
		if (isSidebarHidden) {
			editorSize.width = Math.min(this.workbenchSize.width - activityBarSize.width, this.workbenchSize.width - activityBarMinWidth);

			if (sidebarPosition === Position.LEFT) {
				editorSize.remainderLeft = Math.round((this.workbenchSize.width - editorSize.width + activityBarSize.width) / 2);
				editorSize.remainderRight = this.workbenchSize.width - editorSize.width - editorSize.remainderLeft;
			} else {
				editorSize.remainderRight = Math.round((this.workbenchSize.width - editorSize.width + activityBarSize.width) / 2);
				editorSize.remainderLeft = this.workbenchSize.width - editorSize.width - editorSize.remainderRight;
			}
		}

		// Assert Sidebar and Editor Size to not overflow
		let editorMinWidth = this.computedStyles.editor.minWidth;
		let visibleEditorCount = this.editorService.getVisibleEditors().length;
		if (visibleEditorCount > 1) {
			editorMinWidth *= visibleEditorCount;
		}
		if (editorSize.width < editorMinWidth) {
			let diff = editorMinWidth - editorSize.width;
			editorSize.width = editorMinWidth;
			panelDimension.width = editorMinWidth;
			sidebarSize.width -= diff;
			sidebarSize.width = Math.max(DEFAULT_MIN_PART_WIDTH, sidebarSize.width);
		}

		if (!isSidebarHidden) {
			this.sidebarWidth = sidebarSize.width;
			this.storageService.store(WorkbenchLayout.sashXWidthSettingsKey, this.sidebarWidth, StorageScope.GLOBAL);
		}

		if (!isPanelHidden) {
			this.panelHeight = panelDimension.height;
			this.storageService.store(WorkbenchLayout.sashYHeightSettingsKey, this.panelHeight, StorageScope.GLOBAL);
		}

		// Workbench
		this.workbenchContainer
			.position(this.options.margin.top, this.options.margin.right, this.options.margin.bottom, this.options.margin.left, 'relative')
			.size(this.workbenchSize.width, this.workbenchSize.height);

		// Bug on Chrome: Sometimes Chrome wants to scroll the workbench container on layout changes. The fix is to reset scrollTop in this case.
		if (this.workbenchContainer.getHTMLElement().scrollTop > 0) {
			this.workbenchContainer.getHTMLElement().scrollTop = 0;
		}

		// Editor Part and Panel part
		this.editor.getContainer().size(editorSize.width, editorSize.height);
		this.panelPart.getContainer().size(panelDimension.width, panelDimension.height);

		const editorBottom = this.computedStyles.statusbar.height + panelDimension.height;
		if (isSidebarHidden) {
			this.editor.getContainer().position(0, editorSize.remainderRight, editorBottom, editorSize.remainderLeft);
			this.panelPart.getContainer().position(editorDimension.height, editorSize.remainderRight, this.computedStyles.statusbar.height, editorSize.remainderLeft);
		} else if (sidebarPosition === Position.LEFT) {
			this.editor.getContainer().position(0, 0, editorBottom, sidebarSize.width + activityBarSize.width);
			this.panelPart.getContainer().position(editorDimension.height, 0, this.computedStyles.statusbar.height, sidebarSize.width + activityBarSize.width);
		} else {
			this.editor.getContainer().position(0, sidebarSize.width, editorBottom, 0);
			this.panelPart.getContainer().position(editorDimension.height, sidebarSize.width, this.computedStyles.statusbar.height, 0);
		}

		// Activity Bar Part
		this.activitybar.getContainer().size(null, activityBarSize.height);
		if (sidebarPosition === Position.LEFT) {
			this.activitybar.getContainer().getHTMLElement().style.right = '';
			this.activitybar.getContainer().position(0, null, 0, 0);
		} else {
			this.activitybar.getContainer().getHTMLElement().style.left = '';
			this.activitybar.getContainer().position(0, 0, 0, null);
		}

		// Sidebar Part
		this.sidebar.getContainer().size(sidebarSize.width, sidebarSize.height);

		if (sidebarPosition === Position.LEFT) {
			this.sidebar.getContainer().position(0, editorSize.width, 0, activityBarSize.width);
		} else {
			this.sidebar.getContainer().position(0, null, 0, editorSize.width);
		}

		// Statusbar Part
		if (this.statusbar) {
			this.statusbar.getContainer().position(this.workbenchSize.height - this.computedStyles.statusbar.height);
		}

		// Quick open
		this.quickopen.layout(this.workbenchSize);

		// Sashes
		this.sashX.layout();
		this.sashY.layout();

		// Propagate to Part Layouts
		this.editor.layout(new Dimension(editorSize.width, editorSize.height));
		this.sidebar.layout(sidebarSize);
		this.panelPart.layout(panelDimension);

		// Propagate to Context View
		if (this.contextViewService) {
			this.contextViewService.layout();
		}
	}

	private getWorkbenchArea(): Dimension {

		// Client Area: Parent
		let clientArea = this.parent.getClientArea();

		// Workbench: Client Area - Margins
		return clientArea.substract(this.options.margin);
	}

	public getVerticalSashTop(sash: Sash): number {
		return 0;
	}

	public getVerticalSashLeft(sash: Sash): number {
		let isSidebarHidden = this.partService.isSideBarHidden();
		let sidebarPosition = this.partService.getSideBarPosition();
		let activitybarWidth = this.computedStyles.activitybar.minWidth;

		if (sidebarPosition === Position.LEFT) {
			return !isSidebarHidden ? this.sidebarWidth + activitybarWidth : activitybarWidth;
		}

		return !isSidebarHidden ? this.workbenchSize.width - this.sidebarWidth - activitybarWidth : this.workbenchSize.width - activitybarWidth;
	}

	public getVerticalSashHeight(sash: Sash): number {
		return this.sidebarHeight;
	}

	public getHorizontalSashTop(sash: Sash): number {
		return this.partService.isPanelHidden() ? this.sidebarHeight : this.sidebarHeight - this.panelHeight;
	}

	public getHorizontalSashLeft(sash: Sash): number {
		return this.getVerticalSashLeft(sash);
	}

	public getHorizontalSashWidth(sash: Sash): number {
		return this.panelWidth;
	}

	public dispose(): void {
		while (this.toUnbind.length) {
			this.toUnbind.pop()();
		}
	}
}
