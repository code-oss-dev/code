/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/nextEditorDragAndDrop';
import { LocalSelectionTransfer, DraggedEditorIdentifier, DragCounter, ResourcesDropHandler } from 'vs/workbench/browser/dnd';
import { addDisposableListener, EventType, EventHelper, isAncestor, toggleClass, addClass } from 'vs/base/browser/dom';
import { INextEditorGroupsAccessor, EDITOR_TITLE_HEIGHT, INextEditorGroupView, getActiveTextEditorOptions } from 'vs/workbench/browser/parts/editor2/editor2';
import { EDITOR_DRAG_AND_DROP_BACKGROUND, Themable } from 'vs/workbench/common/theme';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { activeContrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { IEditorIdentifier, EditorInput, EditorOptions } from 'vs/workbench/common/editor';
import { isMacintosh } from 'vs/base/common/platform';
import { GroupDirection, INextEditorGroup } from 'vs/workbench/services/group/common/nextEditorGroupsService';
import { toDisposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

class DropOverlay extends Themable {

	private static OVERLAY_ID = 'monaco-workbench-editor-drop-overlay';
	private static EDGE_DISTANCE_THRESHOLD = 0.2;

	private container: HTMLElement;
	private overlay: HTMLElement;

	private splitDirection: GroupDirection;
	private _disposed: boolean;

	constructor(
		private accessor: INextEditorGroupsAccessor,
		private groupView: INextEditorGroupView,
		private transfer: LocalSelectionTransfer<DraggedEditorIdentifier>,
		themeService: IThemeService,
		private instantiationService: IInstantiationService
	) {
		super(themeService);

		this.create();
	}

	get disposed(): boolean {
		return this._disposed;
	}

	private create(): void {
		const overlayOffsetHeight = this.getOverlayOffsetHeight();

		// Container
		this.container = document.createElement('div');
		this.container.id = DropOverlay.OVERLAY_ID;
		this.container.style.top = `${overlayOffsetHeight}px`;
		this.groupView.element.appendChild(this.container);
		this._register(toDisposable(() => this.groupView.element.removeChild(this.container)));

		// Overlay
		this.overlay = document.createElement('div');
		addClass(this.overlay, 'editor-group-overlay-indicator');
		this.container.appendChild(this.overlay);

		// Overlay Event Handling
		this.registerListeners();

		// Styles
		this.updateStyles();
	}

	protected updateStyles(): void {

		// Overlay drop background
		this.overlay.style.backgroundColor = this.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND);

		// Overlay contrast border (if any)
		const activeContrastBorderColor = this.getColor(activeContrastBorder);
		this.overlay.style.outlineColor = activeContrastBorderColor;
		this.overlay.style.outlineOffset = activeContrastBorderColor ? '-2px' : null;
		this.overlay.style.outlineStyle = activeContrastBorderColor ? 'dashed' : null;
		this.overlay.style.outlineWidth = activeContrastBorderColor ? '2px' : null;
	}

	private registerListeners(): void {

		// Update position and drop effect on drag over
		this._register(addDisposableListener(this.container, EventType.DRAG_OVER, (e: DragEvent) => {

			// Update the dropEffect, otherwise it would look like a "move" operation. but only if we are
			// not dragging a tab actually because there we support both moving as well as copying
			if (!this.transfer.hasData(DraggedEditorIdentifier.prototype)) {
				e.dataTransfer.dropEffect = 'copy';
			}

			// Position overlay
			this.positionOverlay(e.offsetX, e.offsetY);
		}));

		// Handle drop
		this._register(addDisposableListener(this.container, EventType.DROP, (e: DragEvent) => {
			EventHelper.stop(e, true);

			// Dispose overlay
			this.dispose();

			// Handle drop
			this.handleDrop(e);
		}));

		// Dispose on drag end
		this._register(addDisposableListener(this.container, EventType.DRAG_END, () => this.dispose()));
		this._register(addDisposableListener(this.container, EventType.DRAG_LEAVE, (e: DragEvent) => this.dispose()));
		this._register(addDisposableListener(this.container, EventType.MOUSE_OVER, () => {

			// Under some circumstances we have seen reports where the drop overlay is not being
			// cleaned up and as such the editor area remains under the overlay so that you cannot
			// type into the editor anymore. This seems related to using VMs and DND via host and
			// guest OS, though some users also saw it without VMs.
			// To protect against this issue we always destroy the overlay as soon as we detect a
			// mouse event over it. The delay is used to guarantee we are not interfering with the
			// actual DROP event that can also trigger a mouse over event.
			setTimeout(() => {
				this.dispose();
			}, 300);
		}));
	}

	private handleDrop(event: DragEvent): void {

		// Determine target group
		const ensureTargetGroup = () => {
			let targetGroup: INextEditorGroup;
			if (typeof this.splitDirection === 'number') {
				targetGroup = this.accessor.addGroup(this.groupView, this.splitDirection, { activate: true });
			} else {
				targetGroup = this.groupView;
			}

			return targetGroup;
		};

		// Check for transfer from title control
		if (this.transfer.hasData(DraggedEditorIdentifier.prototype)) {
			const draggedEditor = this.transfer.getData(DraggedEditorIdentifier.prototype)[0].identifier;
			const targetGroup = ensureTargetGroup();

			// Return if the drop is a no-op
			const sourceGroup = this.accessor.getGroup(draggedEditor.group.id);
			if (sourceGroup === targetGroup) {
				return;
			}

			// Open in target group
			const options = getActiveTextEditorOptions(sourceGroup, draggedEditor.editor, EditorOptions.create({ pinned: true }));
			targetGroup.openEditor(draggedEditor.editor, options);

			// Close in source group unless we copy
			const copyEditor = this.shouldCopyEditor(draggedEditor, event);
			if (!copyEditor) {
				sourceGroup.closeEditor(draggedEditor.editor);
			}
		}

		// Check for URI transfer
		else {
			const dropHandler = this.instantiationService.createInstance(ResourcesDropHandler, { allowWorkspaceOpen: true /* open workspace instead of file if dropped */ });
			dropHandler.handleDrop(event, targetGroupIdentifier => {
				this.accessor.getGroup(targetGroupIdentifier).focus();
			}, () => ensureTargetGroup().id);
		}
	}

	private shouldCopyEditor(draggedEditor: IEditorIdentifier, e: DragEvent) {
		if (draggedEditor.editor instanceof EditorInput && !draggedEditor.editor.supportsSplitEditor()) {
			return false;
		}

		return (e.ctrlKey && !isMacintosh) || (e.altKey && isMacintosh);
	}

	private positionOverlay(mousePosX: number, mousePosY: number): void {
		const groupViewWidth = this.groupView.element.clientWidth;
		const groupViewHeight = this.groupView.element.clientHeight;

		const topEdgeDistance = mousePosY;
		const leftEdgeDistance = mousePosX;
		const rightEdgeDistance = groupViewWidth - mousePosX;
		const bottomEdgeDistance = groupViewHeight - mousePosY;

		const edgeWidthThreshold = groupViewWidth * DropOverlay.EDGE_DISTANCE_THRESHOLD;
		const edgeHeightThreshold = groupViewHeight * DropOverlay.EDGE_DISTANCE_THRESHOLD;

		// Find new split location given edge distance and thresholds
		let splitDirection: GroupDirection;
		switch (Math.min(topEdgeDistance, leftEdgeDistance, rightEdgeDistance, bottomEdgeDistance)) {
			case topEdgeDistance:
				if (topEdgeDistance < edgeHeightThreshold) {
					splitDirection = GroupDirection.UP;
				}
				break;
			case bottomEdgeDistance:
				if (bottomEdgeDistance < edgeHeightThreshold) {
					splitDirection = GroupDirection.DOWN;
				}
				break;
			case leftEdgeDistance:
				if (leftEdgeDistance < edgeWidthThreshold) {
					splitDirection = GroupDirection.LEFT;
				}
				break;
			case rightEdgeDistance:
				if (rightEdgeDistance < edgeWidthThreshold) {
					splitDirection = GroupDirection.RIGHT;
				}
				break;
		}

		// Position overlay according to location
		switch (splitDirection) {
			case GroupDirection.UP:
				this.overlay.style.top = '0';
				this.overlay.style.left = '0';
				this.overlay.style.width = '100%';
				this.overlay.style.height = '50%';
				break;
			case GroupDirection.DOWN:
				this.overlay.style.top = '50%';
				this.overlay.style.left = '0';
				this.overlay.style.width = '100%';
				this.overlay.style.height = '50%';
				break;
			case GroupDirection.LEFT:
				this.overlay.style.top = '0';
				this.overlay.style.left = '0';
				this.overlay.style.width = '50%';
				this.overlay.style.height = '100%';
				break;
			case GroupDirection.RIGHT:
				this.overlay.style.top = '0';
				this.overlay.style.left = '50%';
				this.overlay.style.width = '50%';
				this.overlay.style.height = '100%';
				break;
			default:
				this.overlay.style.top = '0';
				this.overlay.style.left = '0';
				this.overlay.style.width = '100%';
				this.overlay.style.height = '100%';
				break;
		}

		// Make sure the overlay is visible now
		this.overlay.style.opacity = '1';

		// Enable transition after a timeout to prevent initial animation
		setTimeout(() => addClass(this.overlay, 'overlay-transition'), 0);

		// Remember as current split direction
		this.splitDirection = splitDirection;
	}

	private getOverlayOffsetHeight(): number {
		if (!this.groupView.isEmpty() && this.accessor.partOptions.showTabs) {
			return EDITOR_TITLE_HEIGHT; // show overlay below title if group shows tabs
		}

		return 0;
	}

	contains(element: HTMLElement): boolean {
		return element === this.container || element === this.overlay;
	}

	dispose(): void {
		super.dispose();

		this._disposed = true;
	}
}

export class NextEditorDragAndDrop extends Themable {

	private _overlay: DropOverlay;

	private transfer = LocalSelectionTransfer.getInstance<DraggedEditorIdentifier>();
	private counter = new DragCounter(); // see https://github.com/Microsoft/vscode/issues/14470

	constructor(
		private accessor: INextEditorGroupsAccessor,
		private container: HTMLElement,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super(themeService);

		this.registerListeners();
	}

	private get overlay(): DropOverlay {
		if (this._overlay && !this._overlay.disposed) {
			return this._overlay;
		}

		return void 0;
	}

	private registerListeners(): void {
		this._register(addDisposableListener(this.container, EventType.DRAG_ENTER, e => this.onDragEnter(e)));
		this._register(addDisposableListener(this.container, EventType.DRAG_LEAVE, e => this.onDragLeave()));
		[this.container, window].forEach(node => this._register(addDisposableListener(node as HTMLElement, EventType.DRAG_END, () => this.onDragEnd())));
	}

	private onDragEnter(event: DragEvent): void {
		if (!this.transfer.hasData(DraggedEditorIdentifier.prototype) && !event.dataTransfer.types.length) {
			return; // invalid DND (see https://github.com/Microsoft/vscode/issues/25789)
		}

		// Signal DND start
		this.counter.increment();
		this.updateContainer(true);

		const target = event.target as HTMLElement;
		if (target) {

			// Somehow we managed to move the mouse quickly out of the current overlay, so destroy it
			if (this.overlay && !this.overlay.contains(target)) {
				this.disposeOverlay();
			}

			// Create overlay over target
			if (!this.overlay) {
				const groupView = this.findGroupView(target);
				if (groupView) {
					this._overlay = new DropOverlay(this.accessor, groupView, this.transfer, this.themeService, this.instantiationService);
				}
			}

			// If we show an overlay, we can remove the drop feedback from the container
			if (this.overlay) {
				this.updateContainer(false);
			}
		}
	}

	private onDragLeave(): void {
		this.counter.decrement();

		if (!this.counter.value) {
			this.updateContainer(false);
		}
	}

	private onDragEnd(): void {
		this.counter.reset();

		this.updateContainer(false);
		this.disposeOverlay();
	}

	private findGroupView(child: HTMLElement): INextEditorGroupView {
		const groups = this.accessor.groups;
		for (let i = 0; i < groups.length; i++) {
			const groupView = groups[i];

			if (isAncestor(child, groupView.element)) {
				return groupView;
			}
		}

		return void 0;
	}

	private updateContainer(isDraggedOver: boolean): void {
		const activeContrastBorderColor = this.getColor(activeContrastBorder);
		this.container.style.outlineColor = isDraggedOver ? activeContrastBorderColor : null;
		this.container.style.outlineStyle = isDraggedOver && activeContrastBorderColor ? 'dashed' : null;
		this.container.style.outlineWidth = isDraggedOver && activeContrastBorderColor ? '2px' : null;
		this.container.style.outlineOffset = isDraggedOver && activeContrastBorderColor ? '-2px' : null;

		toggleClass(this.container, 'dragged-over', isDraggedOver);
	}

	dispose(): void {
		super.dispose();

		this.disposeOverlay();
	}

	private disposeOverlay(): void {
		if (this.overlay) {
			this.overlay.dispose();
			this._overlay = void 0;
		}
	}
}