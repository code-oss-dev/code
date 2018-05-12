/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/nextEditorGroupView';
import { TPromise } from 'vs/base/common/winjs.base';
import { EditorGroup, IEditorOpenOptions, EditorCloseEvent, ISerializedEditorGroup, isSerializedEditorGroup } from 'vs/workbench/common/editor/editorStacksModel';
import { EditorInput, EditorOptions, GroupIdentifier, ConfirmResult, SideBySideEditorInput, IEditorOpeningEvent, EditorOpeningEvent } from 'vs/workbench/common/editor';
import { Event, Emitter, once } from 'vs/base/common/event';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { addClass, addClasses, Dimension, trackFocus, toggleClass, removeClass, addDisposableListener, EventType, EventHelper, findParentWithClass, clearNode, isAncestor } from 'vs/base/browser/dom';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { attachProgressBarStyler } from 'vs/platform/theme/common/styler';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { editorBackground, contrastBorder, focusBorder } from 'vs/platform/theme/common/colorRegistry';
import { Themable, EDITOR_GROUP_HEADER_TABS_BORDER, EDITOR_GROUP_HEADER_TABS_BACKGROUND, EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND, EDITOR_GROUP_ACTIVE_EMPTY_BACKGROUND, EDITOR_GROUP_EMPTY_BACKGROUND } from 'vs/workbench/common/theme';
import { IMoveEditorOptions, ICopyEditorOptions, ICloseEditorsFilter } from 'vs/workbench/services/group/common/nextEditorGroupsService';
import { NextTabsTitleControl } from 'vs/workbench/browser/parts/editor2/nextTabsTitleControl';
import { NextEditorControl } from 'vs/workbench/browser/parts/editor2/nextEditorControl';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { ProgressService } from 'vs/workbench/services/progress/browser/progressService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { localize } from 'vs/nls';
import { isPromiseCanceledError, isErrorWithActions, IErrorWithActions } from 'vs/base/common/errors';
import { dispose } from 'vs/base/common/lifecycle';
import { Severity, INotificationService, INotificationActions } from 'vs/platform/notification/common/notification';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { RunOnceWorker } from 'vs/base/common/async';
import { EventType as TouchEventType, GestureEvent } from 'vs/base/browser/touch';
import { NextTitleControl } from 'vs/workbench/browser/parts/editor2/nextTitleControl';
import { INextEditorGroupsAccessor, INextEditorGroupView, INextEditorPartOptionsChangeEvent, EDITOR_TITLE_HEIGHT, EDITOR_MIN_DIMENSIONS, EDITOR_MAX_DIMENSIONS, getActiveTextEditorOptions } from 'vs/workbench/browser/parts/editor2/editor2';
import { NextNoTabsTitleControl } from './nextNoTabsTitleControl';
import { IUntitledEditorService } from 'vs/workbench/services/untitled/common/untitledEditorService';
import { join } from 'vs/base/common/paths';
import { Direction } from 'vs/platform/editor/common/editor';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { RemoveActiveEditorGroupAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { ActionRunner, IAction } from 'vs/base/common/actions';

export class NextEditorGroupView extends Themable implements INextEditorGroupView {

	//#region factory

	static createNew(accessor: INextEditorGroupsAccessor, instantiationService: IInstantiationService): INextEditorGroupView {
		return instantiationService.createInstance(NextEditorGroupView, accessor, null);
	}

	static createFromSerialized(serialized: ISerializedEditorGroup, accessor: INextEditorGroupsAccessor, instantiationService: IInstantiationService): INextEditorGroupView {
		return instantiationService.createInstance(NextEditorGroupView, accessor, serialized);
	}

	static createCopy(copyFrom: INextEditorGroupView, accessor: INextEditorGroupsAccessor, instantiationService: IInstantiationService): INextEditorGroupView {
		return instantiationService.createInstance(NextEditorGroupView, accessor, copyFrom);
	}

	//#endregion

	//#region events

	private _onDidFocus: Emitter<void> = this._register(new Emitter<void>());
	get onDidFocus(): Event<void> { return this._onDidFocus.event; }

	private _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	get onWillDispose(): Event<void> { return this._onWillDispose.event; }

	private _onDidActiveEditorChange: Emitter<void> = this._register(new Emitter<void>());
	get onDidActiveEditorChange(): Event<void> { return this._onDidActiveEditorChange.event; }

	private _onWillOpenEditor: Emitter<IEditorOpeningEvent> = this._register(new Emitter<IEditorOpeningEvent>());
	get onWillOpenEditor(): Event<IEditorOpeningEvent> { return this._onWillOpenEditor.event; }

	private _onWillCloseEditor: Emitter<EditorInput> = this._register(new Emitter<EditorInput>());
	get onWillCloseEditor(): Event<EditorInput> { return this._onWillCloseEditor.event; }

	private _onDidCloseEditor: Emitter<EditorInput> = this._register(new Emitter<EditorInput>());
	get onDidCloseEditor(): Event<EditorInput> { return this._onDidCloseEditor.event; }

	private _onDidOpenEditorFail: Emitter<EditorInput> = this._register(new Emitter<EditorInput>());
	get onDidOpenEditorFail(): Event<EditorInput> { return this._onDidOpenEditorFail.event; }

	//#endregion

	private _group: EditorGroup;

	private active: boolean;
	private dimension: Dimension;

	private _whenRestored: Thenable<void>;
	private isRestored: boolean;

	private scopedInstantiationService: IInstantiationService;

	private titleContainer: HTMLElement;
	private titleAreaControl: NextTitleControl;

	private progressBar: ProgressBar;

	private editorContainer: HTMLElement;
	private editorControl: NextEditorControl;

	private ignoreOpenEditorErrors: boolean;
	private disposedEditorsWorker: RunOnceWorker<EditorInput>;

	constructor(
		private accessor: INextEditorGroupsAccessor,
		from: INextEditorGroupView | ISerializedEditorGroup,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@INotificationService private notificationService: INotificationService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@IUntitledEditorService private untitledEditorService: IUntitledEditorService,
		@IKeybindingService private keybindingService: IKeybindingService
	) {
		super(themeService);

		if (from instanceof NextEditorGroupView) {
			this._group = this._register(from.group.clone());
		} else if (isSerializedEditorGroup(from)) {
			this._group = this._register(instantiationService.createInstance(EditorGroup, from));
		} else {
			this._group = this._register(instantiationService.createInstance(EditorGroup, ''));
		}

		this._group.label = `Group <${this._group.id}>`; // TODO@grid find a way to have a proper label

		this.disposedEditorsWorker = this._register(new RunOnceWorker(editors => this.handleDisposedEditors(editors), 0));

		this.create();

		this._whenRestored = this.restoreEditors(from);
		this._whenRestored.then(() => this.isRestored = true);

		this.registerListeners();
	}

	private create(): void {

		// Container
		addClasses(this.element, 'editor-group-container');

		// Container listeners
		this.registerContainerListeners();

		// Container toolbar
		this.createContainerToolbar();

		// Progress bar
		this.progressBar = this._register(new ProgressBar(this.element));
		this._register(attachProgressBarStyler(this.progressBar, this.themeService));
		this.progressBar.hide();

		// Scoped instantiator
		this.scopedInstantiationService = this.instantiationService.createChild(new ServiceCollection(
			[IContextKeyService, this._register(this.contextKeyService.createScoped(this.element))],
			[IProgressService, new ProgressService(this.progressBar)]
		));

		// Title container
		this.titleContainer = document.createElement('div');
		addClass(this.titleContainer, 'title');
		this.element.appendChild(this.titleContainer);

		// Title control
		this.createTitleAreaControl();

		// Editor container
		this.editorContainer = document.createElement('div');
		addClass(this.editorContainer, 'editor-container');
		this.element.appendChild(this.editorContainer);

		// Editor control
		this.editorControl = this._register(this.scopedInstantiationService.createInstance(NextEditorControl, this.editorContainer, this._group.id));

		// Track Focus
		this.doTrackFocus();

		// Update containers
		this.updateTitleContainer();
		this.updateContainer();

		// Update styles
		this.updateStyles();
	}

	private registerContainerListeners(): void {

		// Open new file via doubleclick on container
		this._register(addDisposableListener(this.element, EventType.DBLCLICK, e => {
			if (e.target === this.element) {
				EventHelper.stop(e);

				this.openEditor(this.untitledEditorService.createOrGet(), EditorOptions.create({ pinned: true }));
			}
		}));
	}

	private createContainerToolbar(): void {

		// Toolbar Container
		const toolbarContainer = document.createElement('div');
		addClass(toolbarContainer, 'editor-group-container-toolbar');
		this.element.appendChild(toolbarContainer);

		// Toolbar
		const groupId = this._group.id;
		const containerToolbar = new ActionBar(toolbarContainer, {
			ariaLabel: localize('araLabelGroupActions', "Editor group actions"), actionRunner: this._register(new class extends ActionRunner {
				run(action: IAction) {
					return action.run(groupId);
				}
			})
		});

		// Toolbar actions
		const removeGroupAction = this._register(this.instantiationService.createInstance(RemoveActiveEditorGroupAction, RemoveActiveEditorGroupAction.ID, localize('removeGroupAction', "Remove Editor Group")));
		const keybinding = this.keybindingService.lookupKeybinding(removeGroupAction.id);
		containerToolbar.push(removeGroupAction, { icon: true, label: false, keybinding: keybinding ? keybinding.getLabel() : void 0 });
	}

	private doTrackFocus(): void {

		// Container
		const containerFocusTracker = this._register(trackFocus(this.element));
		this._register(containerFocusTracker.onDidFocus(() => {
			if (this.isEmpty()) {
				this._onDidFocus.fire(); // only when empty to prevent accident focus
			}
		}));

		// Title Container
		const handleTitleClickOrTouch = (e: MouseEvent | GestureEvent): void => {
			let target: HTMLElement;
			if (e instanceof MouseEvent) {
				if (e.button !== 0) {
					return void 0; // only for left mouse click
				}

				target = e.target as HTMLElement;
			} else {
				target = (e as GestureEvent).initialTarget as HTMLElement;
			}

			if (findParentWithClass(target, 'monaco-action-bar', this.titleContainer)) {
				return; // not when clicking on actions
			}

			// timeout to keep focus in editor after mouse up
			setTimeout(() => {
				this.focus();
			});
		};

		this._register(addDisposableListener(this.titleContainer, EventType.MOUSE_DOWN, e => handleTitleClickOrTouch(e)));
		this._register(addDisposableListener(this.titleContainer, TouchEventType.Tap, e => handleTitleClickOrTouch(e)));

		// Editor Container
		const editorFocusTracker = this._register(trackFocus(this.editorContainer));
		this._register(editorFocusTracker.onDidFocus(() => {
			this._onDidFocus.fire();
		}));
	}

	private updateContainer(): void {

		// Empty Container: add some empty container attributes
		if (this.isEmpty()) {
			addClass(this.element, 'empty');
			this.element.tabIndex = 0;
			this.element.setAttribute('aria-label', localize('emptyEditorGroup', "Empty Editor Group"));
		}

		// Non-Empty Container: revert empty container attributes
		else {
			removeClass(this.element, 'empty');
			this.element.removeAttribute('tabIndex');
			this.element.removeAttribute('aria-label');
		}

		// Update styles
		this.updateStyles();
	}

	private updateTitleContainer(): void {
		toggleClass(this.titleContainer, 'tabs', this.accessor.partOptions.showTabs);
		toggleClass(this.titleContainer, 'show-file-icons', this.accessor.partOptions.showIcons);
	}

	private createTitleAreaControl(): void {

		// Clear old if existing
		if (this.titleAreaControl) {
			this.titleAreaControl.dispose();
			clearNode(this.titleContainer);
		}

		// Create new based on options
		if (this.accessor.partOptions.showTabs) {
			this.titleAreaControl = this.scopedInstantiationService.createInstance(NextTabsTitleControl, this.titleContainer, this.accessor, this);
		} else {
			this.titleAreaControl = this.scopedInstantiationService.createInstance(NextNoTabsTitleControl, this.titleContainer, this.accessor, this);
		}
	}

	private restoreEditors(from: INextEditorGroupView | ISerializedEditorGroup): Thenable<void> {
		if (this.group.count === 0) {
			return TPromise.as(void 0); // nothing to show
		}

		// Determine editor options
		let options: EditorOptions;
		if (from instanceof NextEditorGroupView) {
			options = getActiveTextEditorOptions(from); // if we copy from another group, ensure to copy its active editor viewstate
		} else {
			options = new EditorOptions();
		}

		const activeEditor = this.group.activeEditor;
		options.pinned = this.group.isPinned(activeEditor);	// preserve pinned state
		options.preserveFocus = true;						// handle focus after editor is opened

		// Show active editor
		return this.doShowEditor(activeEditor, true, options).then(() => {

			// Set focused now if this is the active group
			if (this.accessor.activeGroup === this) {
				this.focus();
			}
		});
	}

	//#region event handling

	private registerListeners(): void {

		// Model Events
		this._register(this._group.onDidEditorOpen(editor => this.onDidEditorOpen(editor)));
		this._register(this._group.onDidEditorClose(editor => this.onDidEditorClose(editor)));
		this._register(this._group.onDidEditorDispose(editor => this.onDidEditorDispose(editor)));
		this._register(this._group.onDidEditorBecomeDirty(editor => this.onDidEditorBecomeDirty(editor)));
		this._register(this._group.onDidEditorLabelChange(editor => this.onDidEditorLabelChange(editor)));

		// Option Changes
		this._register(this.accessor.onDidEditorPartOptionsChange(e => this.onDidEditorPartOptionsChange(e)));
	}

	private onDidEditorOpen(editor: EditorInput): void {
		/* __GDPR__
			"editorOpened" : {
				"${include}": [
					"${EditorTelemetryDescriptor}"
				]
			}
		*/
		this.telemetryService.publicLog('editorOpened', editor.getTelemetryDescriptor());

		// Update container
		this.updateContainer();
	}

	private onDidEditorClose(event: EditorCloseEvent): void {

		// Before close
		this._onWillCloseEditor.fire(event.editor);

		// Handle event
		const editor = event.editor;
		const editorsToClose = [editor];

		// Include both sides of side by side editors when being closed and not opened multiple times
		if (editor instanceof SideBySideEditorInput && !this.accessor.groups.some(groupView => groupView.group.contains(editor))) {
			editorsToClose.push(editor.master, editor.details);
		}

		// Close the editor when it is no longer open in any group including diff editors
		editorsToClose.forEach(editorToClose => {
			const resource = editorToClose ? editorToClose.getResource() : void 0; // prefer resource to not close right-hand side editors of a diff editor
			if (!this.accessor.groups.some(groupView => groupView.group.contains(resource || editorToClose))) {
				editorToClose.close();
			}
		});

		// After close
		this._onDidCloseEditor.fire(event.editor);

		/* __GDPR__
			"editorClosed" : {
				"${include}": [
					"${EditorTelemetryDescriptor}"
				]
			}
		*/
		this.telemetryService.publicLog('editorClosed', event.editor.getTelemetryDescriptor());

		// Update container
		this.updateContainer();
	}

	private onDidEditorDispose(editor: EditorInput): void {

		// To prevent race conditions, we handle disposed editors in our worker with a timeout
		// because it can happen that an input is being disposed with the intent to replace
		// it with some other input right after.
		this.disposedEditorsWorker.work(editor);
	}

	private handleDisposedEditors(editors: EditorInput[]): void {

		// Split between visible and hidden editors
		let activeEditor: EditorInput;
		const inactiveEditors: EditorInput[] = [];
		editors.forEach(editor => {
			if (this._group.isActive(editor)) {
				activeEditor = editor;
			} else if (this._group.contains(editor)) {
				inactiveEditors.push(editor);
			}
		});

		// Close all inactive editors first to prevent UI flicker
		inactiveEditors.forEach(hidden => this.doCloseEditor(hidden, false));

		// Close active one last
		if (activeEditor) {
			this.doCloseEditor(activeEditor, false);
		}
	}

	private onDidEditorPartOptionsChange(event: INextEditorPartOptionsChangeEvent): void {

		// Title container
		this.updateTitleContainer();

		// Title control Switch between showing tabs <=> not showing tabs
		if (event.oldPartOptions.showTabs !== event.newPartOptions.showTabs) {
			this.createTitleAreaControl();

			if (this.group.activeEditor) {
				this.titleAreaControl.openEditor(this.group.activeEditor);
			}
		}

		// Just update title control
		else {
			this.titleAreaControl.updateOptions(event.oldPartOptions, event.newPartOptions);
		}

		// Styles
		this.updateStyles();

		// Pin preview editor once user disables preview
		if (event.oldPartOptions.enablePreview && !event.newPartOptions.enablePreview) {
			this.pinEditor(this._group.previewEditor);
		}
	}

	private onDidEditorBecomeDirty(editor: EditorInput): void {

		// Always show dirty editors pinned
		this.pinEditor(editor);

		// Forward to title control
		this.titleAreaControl.updateEditorDirty(editor);
	}

	private onDidEditorLabelChange(editor: EditorInput): void {

		// Forward to title control
		this.titleAreaControl.updateEditorLabel(editor);
	}

	//#endregion

	//region INextEditorGroupView

	get group(): EditorGroup {
		return this._group;
	}

	get whenRestored(): Thenable<void> {
		return this._whenRestored;
	}

	setActive(isActive: boolean): void {
		this.active = isActive;

		// Update container
		toggleClass(this.element, 'active', isActive);
		toggleClass(this.element, 'inactive', !isActive);

		// Update title control
		this.titleAreaControl.setActive(isActive);

		// Update styles
		this.updateStyles();
	}

	isEmpty(): boolean {
		return this._group.count === 0;
	}

	//#endregion

	//#region INextEditorGroup

	//#region basics()

	get id(): GroupIdentifier {
		return this._group.id;
	}

	get editors(): EditorInput[] {
		return this._group.getEditors();
	}

	get count(): number {
		return this._group.count;
	}

	get activeControl(): BaseEditor {
		return this.editorControl ? this.editorControl.activeControl : void 0;
	}

	get activeEditor(): EditorInput {
		return this._group.activeEditor;
	}

	get previewEditor(): EditorInput {
		return this._group.previewEditor;
	}

	isPinned(editor: EditorInput): boolean {
		return this._group.isPinned(editor);
	}

	isActive(editor: EditorInput): boolean {
		return this._group.isActive(editor);
	}

	getEditor(index: number): EditorInput {
		return this._group.getEditor(index);
	}

	getIndexOfEditor(editor: EditorInput): number {
		return this._group.indexOf(editor);
	}

	isOpened(editor: EditorInput): boolean {
		return this._group.contains(editor);
	}

	focus(): void {
		if (this.activeControl) {
			this.activeControl.focus();
		} else {
			this.element.focus();
		}
	}

	pinEditor(editor: EditorInput = this.activeEditor): void {
		if (editor && !this._group.isPinned(editor)) {

			// Update model
			this._group.pin(editor);

			// Forward to title control
			this.titleAreaControl.pinEditor(editor);
		}
	}

	invokeWithinContext<T>(fn: (accessor: ServicesAccessor) => T): T {
		return this.scopedInstantiationService.invokeFunction(fn);
	}

	//#endregion

	//#region openEditor()

	openEditor(editor: EditorInput, options?: EditorOptions): Thenable<void> {

		// Editor opening event allows for prevention
		const event = new EditorOpeningEvent(this, editor, options);
		this._onWillOpenEditor.fire(event);
		const prevented = event.isPrevented();
		if (prevented) {
			return prevented();
		}

		// Proceed with opening
		return this.doOpenEditor(editor, options);
	}

	private doOpenEditor(editor: EditorInput, options?: EditorOptions): Thenable<void> {

		// Determine options
		const openEditorOptions: IEditorOpenOptions = {
			index: options ? options.index : void 0,
			pinned: !this.accessor.partOptions.enablePreview || editor.isDirty() || (options && options.pinned) || (options && typeof options.index === 'number'),
			active: this._group.count === 0 || !options || !options.inactive
		};

		if (!openEditorOptions.active && !openEditorOptions.pinned && this._group.isPreview(this._group.activeEditor)) {
			// Special case: we are to open an editor inactive and not pinned, but the current active
			// editor is also not pinned, which means it will get replaced with this one. As such,
			// the editor can only be active.
			openEditorOptions.active = true;
		}

		// Update model
		this._group.openEditor(editor, openEditorOptions);

		// Show editor
		return this.doShowEditor(editor, openEditorOptions.active, options);
	}

	private doShowEditor(editor: EditorInput, active: boolean, options?: EditorOptions): Thenable<void> {

		// Show in editor control if the active editor changed
		let openEditorPromise: Thenable<void>;
		if (active) {
			openEditorPromise = this.editorControl.openEditor(editor, options).then(result => {

				// Editor change event
				if (result.editorChanged) {
					this._onDidActiveEditorChange.fire();
				}
			}, error => {

				// Handle errors but do not bubble them up
				this.doHandleOpenEditorError(error, editor, options);
			});
		} else {
			openEditorPromise = TPromise.as(void 0);
		}

		// Show in title control after editor control because some actions depend on it
		this.titleAreaControl.openEditor(editor);

		return openEditorPromise;
	}

	private doHandleOpenEditorError(error: Error, editor: EditorInput, options?: EditorOptions): void {

		// Report error only if this was not us restoring previous error state or
		// we are told to ignore errors that occur from opening an editor
		if (this.isRestored && !isPromiseCanceledError(error) && !this.ignoreOpenEditorErrors) {
			const actions: INotificationActions = { primary: [] };
			if (isErrorWithActions(error)) {
				actions.primary = (error as IErrorWithActions).actions;
			}

			const handle = this.notificationService.notify({
				severity: Severity.Error,
				message: localize('editorOpenError', "Unable to open '{0}': {1}.", editor.getName(), toErrorMessage(error)),
				actions
			});

			once(handle.onDidClose)(() => dispose(actions.primary));
		}

		// Event
		this._onDidOpenEditorFail.fire(editor);

		// Recover by closing the active editor (if the input is still the active one)
		if (this.activeEditor === editor) {
			const focusNext = !options || !options.preserveFocus;
			this.doCloseActiveEditor(focusNext, true /* from error */);
		}
	}

	//#endregion

	//#region openEditors()

	openEditors(editors: { editor: EditorInput, options?: EditorOptions }[]): Thenable<void> {
		if (!editors.length) {
			return TPromise.as(void 0);
		}

		// Use the first editor as active editor
		const { editor, options } = editors.shift();
		return this.openEditor(editor, options).then(() => {
			const startingIndex = this.getIndexOfEditor(editor) + 1;

			// Open the other ones inactive
			return TPromise.join(editors.map(({ editor, options }, index) => {
				const adjustedEditorOptions = options || new EditorOptions();
				adjustedEditorOptions.inactive = true;
				adjustedEditorOptions.pinned = true;
				adjustedEditorOptions.index = startingIndex + index;

				return this.openEditor(editor, adjustedEditorOptions);
			})).then(() => void 0);
		});
	}

	//#endregion

	//#region moveEditor()

	moveEditor(editor: EditorInput, target: INextEditorGroupView, options?: IMoveEditorOptions): void {

		// Move within same group
		if (this === target) {
			this.doMoveEditorInsideGroup(editor, options);
		}

		// Move across groups
		else {
			this.doMoveOrCopyEditorAcrossGroups(editor, target, options);
		}
	}

	private doMoveEditorInsideGroup(editor: EditorInput, moveOptions?: IMoveEditorOptions): void {
		const moveToIndex = moveOptions ? moveOptions.index : void 0;
		if (typeof moveToIndex !== 'number') {
			return; // do nothing if we move into same group without index
		}

		const currentIndex = this._group.indexOf(editor);
		if (currentIndex === moveToIndex) {
			return; // do nothing if editor is already at the given index
		}

		// Update model
		this._group.moveEditor(editor, moveToIndex);
		this._group.pin(editor);

		// Forward to title area
		this.titleAreaControl.moveEditor(editor, currentIndex, moveToIndex);
		this.titleAreaControl.pinEditor(editor);
	}

	private doMoveOrCopyEditorAcrossGroups(editor: EditorInput, target: INextEditorGroupView, moveOptions: IMoveEditorOptions = Object.create(null), keepCopy?: boolean): void {

		// When moving an editor, try to preserve as much view state as possible by checking
		// for the editor to be a text editor and creating the options accordingly if so
		const options = getActiveTextEditorOptions(this, editor, EditorOptions.create(moveOptions));
		options.pinned = true; // always pin moved editor

		// A move to another group is an open first...
		target.openEditor(editor, options);

		// ...and a close afterwards (unless we copy)
		if (!keepCopy) {
			this.doCloseEditor(editor, false /* do not focus next one behind if any */);
		}
	}

	//#endregion

	//#region copyEditor()

	copyEditor(editor: EditorInput, target: INextEditorGroupView, options?: ICopyEditorOptions): void {

		// Move within same group because we do not support to show the same editor
		// multiple times in the same group
		if (this === target) {
			this.doMoveEditorInsideGroup(editor, options);
		}

		// Copy across groups
		else {
			this.doMoveOrCopyEditorAcrossGroups(editor, target, options, true);
		}
	}

	//#endregion

	//#region closeEditor()

	closeEditor(editor: EditorInput = this.activeEditor): Thenable<void> {
		if (!editor) {
			return TPromise.as(void 0);
		}

		// Check for dirty and veto
		return this.handleDirty([editor], true /* ignore if opened in other group */).then(veto => {
			if (veto) {
				return;
			}

			// Do close
			this.doCloseEditor(editor);
		});
	}

	private doCloseEditor(editor: EditorInput, focusNext = this.accessor.activeGroup === this): void {

		// Closing the active editor of the group is a bit more work
		if (this.group.isActive(editor)) {
			this.doCloseActiveEditor(focusNext);
		}

		// Closing inactive editor is just a model update
		else {
			this.doCloseInactiveEditor(editor);
		}

		// Forward to title control
		this.titleAreaControl.closeEditor(editor);
	}

	private doCloseActiveEditor(focusNext = this.accessor.activeGroup === this, fromError?: boolean): void {
		const editorToClose = this.activeEditor;
		const editorHasFocus = isAncestor(document.activeElement, this.element);

		// Update model
		this._group.closeEditor(editorToClose);

		// Open next active if there are more to show
		const nextActiveEditor = this._group.activeEditor;
		if (nextActiveEditor) {

			// When closing an editor due to an error we can end up in a loop where we continue closing
			// editors that fail to open (e.g. when the file no longer exists). We do not want to show
			// repeated errors in this case to the user. As such, if we open the next editor and we are
			// in a scope of a previous editor failing, we silence the input errors until the editor is
			// opened.
			if (fromError) {
				this.ignoreOpenEditorErrors = true;
			}

			const options = !focusNext ? EditorOptions.create({ preserveFocus: true }) : void 0;
			this.openEditor(nextActiveEditor, options).then(() => {
				this.ignoreOpenEditorErrors = false;
			});
		}

		// Otherwise clear from editor control and send event
		else {

			// Forward to editor control
			this.editorControl.closeEditor(editorToClose);

			// Restore focus to group container as needed
			if (editorHasFocus) {
				this.focus();
			}

			// Editor Change Event
			this._onDidActiveEditorChange.fire();

			// TODO@grid introduce and support a setting to close the group when the last editor closes
		}
	}

	private doCloseInactiveEditor(editor: EditorInput) {

		// Update model
		this._group.closeEditor(editor);
	}

	private handleDirty(editors: EditorInput[], ignoreIfOpenedInOtherGroup?: boolean): Thenable<boolean /* veto */> {
		if (!editors.length) {
			return TPromise.as(false); // no veto
		}

		return this.doHandleDirty(editors.shift(), ignoreIfOpenedInOtherGroup).then(veto => {
			if (veto) {
				return veto;
			}

			return this.handleDirty(editors, ignoreIfOpenedInOtherGroup);
		});
	}

	private doHandleDirty(editor: EditorInput, ignoreIfOpenedInOtherGroup?: boolean): Thenable<boolean /* veto */> {

		// Return quickly if editor is not dirty
		if (!editor.isDirty()) {
			return TPromise.as(false); // no veto
		}

		// Return if editor is opened in other group and we are OK with it
		if (ignoreIfOpenedInOtherGroup) {
			const containedInOtherGroup = this.accessor.groups.some(groupView => groupView !== this && groupView.group.contains(editor, true /* support side by side */));
			if (containedInOtherGroup) {
				return TPromise.as(false); // no veto
			}
		}

		// Switch to editor that we want to handle
		return this.openEditor(editor).then(() => {
			return editor.confirmSave().then(res => {

				// It could be that the editor saved meanwhile, so we check again
				// to see if anything needs to happen before closing for good.
				// This can happen for example if autoSave: onFocusChange is configured
				// so that the save happens when the dialog opens.
				if (!editor.isDirty()) {
					return res === ConfirmResult.CANCEL ? true : false;
				}

				// Otherwise, handle accordingly
				switch (res) {
					case ConfirmResult.SAVE:
						return editor.save().then(ok => !ok);

					case ConfirmResult.DONT_SAVE:

						// first try a normal revert where the contents of the editor are restored
						return editor.revert().then(ok => !ok, error => {

							// if that fails, since we are about to close the editor, we accept that
							// the editor cannot be reverted and instead do a soft revert that just
							// enables us to close the editor. With this, a user can always close a
							// dirty editor even when reverting fails.
							return editor.revert({ soft: true }).then(ok => !ok);
						});

					case ConfirmResult.CANCEL:
						return true; // veto
				}
			});
		});
	}

	//#endregion

	//#region closeEditors()

	closeEditors(args: EditorInput[] | ICloseEditorsFilter): Thenable<void> {
		if (this.isEmpty()) {
			return TPromise.as(void 0);
		}

		const editors = this.getEditorsToClose(args);

		// Check for dirty and veto
		return this.handleDirty(editors, true /* ignore if opened in other group */).then(veto => {
			if (veto) {
				return;
			}

			// Do close
			this.doCloseEditors(editors);
		});
	}

	private getEditorsToClose(editors: EditorInput[] | ICloseEditorsFilter): EditorInput[] {
		if (Array.isArray(editors)) {
			return editors;
		}

		const filter = editors;
		const hasDirection = typeof filter.direction === 'number';

		let editorsToClose = this._group.getEditors(!hasDirection /* in MRU order only if direction is not specified */);

		// Filter: saved only
		if (filter.savedOnly) {
			editorsToClose = editorsToClose.filter(e => !e.isDirty());
		}

		// Filter: direction (left / right)
		else if (hasDirection) {
			editorsToClose = (filter.direction === Direction.LEFT) ?
				editorsToClose.slice(0, this._group.indexOf(filter.except as EditorInput)) :
				editorsToClose.slice(this._group.indexOf(filter.except as EditorInput) + 1);
		}

		// Filter: except
		else if (filter.except) {
			editorsToClose = editorsToClose.filter(e => !e.matches(filter.except));
		}

		return editorsToClose;
	}

	private doCloseEditors(editors: EditorInput[]): void {
		const activeEditor = this.activeEditor;

		// Close all inactive editors first
		let closeActiveEditor = false;
		editors.forEach(editor => {
			if (editor !== activeEditor) {
				this.doCloseInactiveEditor(editor);
			} else {
				closeActiveEditor = true;
			}
		});

		// Close active editor last if contained in editors list to close
		if (closeActiveEditor) {
			this.doCloseActiveEditor();
		}

		// Forward to title control
		this.titleAreaControl.closeEditors(editors);
	}

	//#endregion

	//#region closeAllEditors()

	closeAllEditors(): Thenable<void> {
		if (this.isEmpty()) {
			return TPromise.as(void 0);
		}

		// Check for dirty and veto
		const editors = this._group.getEditors(true);
		return this.handleDirty(editors, true /* ignore if opened in other group */).then(veto => {
			if (veto) {
				return;
			}

			// Do close
			this.doCloseAllEditors();
		});
	}

	private doCloseAllEditors(): void {
		const activeEditor = this.activeEditor;

		// Close all inactive editors first
		this.editors.forEach(editor => {
			if (editor !== activeEditor) {
				this.doCloseInactiveEditor(editor);
			}
		});

		// Close active editor last
		this.doCloseActiveEditor();

		// Forward to title control
		this.titleAreaControl.closeAllEditors();
	}

	//#endregion

	//#region replaceEditors()

	replaceEditors(editors: EditorReplacement[]): Thenable<void> {

		// Extract active vs. inactive replacements
		let activeReplacement: EditorReplacement;
		const inactiveReplacements: EditorReplacement[] = [];
		editors.forEach(({ editor, replacement, options }) => {
			if (editor.isDirty()) {
				return; // we do not handle dirty in this method, so ignore all dirty
			}

			const index = this.getIndexOfEditor(editor);
			if (index >= 0) {
				const isActiveEditor = this.isActive(editor);

				// make sure we respect the index of the editor to replace
				if (options) {
					options.index = index;
				} else {
					options = EditorOptions.create({ index });
				}

				options.inactive = !isActiveEditor;
				options.pinned = true;

				const editorToReplace = { editor, replacement, options };
				if (isActiveEditor) {
					activeReplacement = editorToReplace;
				} else {
					inactiveReplacements.push(editorToReplace);
				}
			}
		});

		// Handle inactive first
		inactiveReplacements.forEach(({ editor, replacement, options }) => {

			// Open inactive editor
			this.doOpenEditor(replacement, options);

			// Close replaced inactive edior
			this.doCloseInactiveEditor(editor);

			// Forward to title control
			this.titleAreaControl.closeEditor(editor);
		});

		// Handle active last
		if (activeReplacement) {

			// Open replacement as active editor
			return this.doOpenEditor(activeReplacement.replacement, activeReplacement.options).then(() => {

				// Close previous active editor
				this.doCloseInactiveEditor(activeReplacement.editor);

				// Forward to title control
				this.titleAreaControl.closeEditor(activeReplacement.editor);
			});
		}

		return TPromise.as(void 0);
	}

	//#endregion

	//#endregion

	//#region Themable

	protected updateStyles(): void {

		// Container
		this.element.style.outlineColor = this.getColor(focusBorder);
		if (this.isEmpty()) {
			this.element.style.backgroundColor = this.getColor(this.active ? EDITOR_GROUP_ACTIVE_EMPTY_BACKGROUND : EDITOR_GROUP_EMPTY_BACKGROUND);
		} else {
			this.element.style.backgroundColor = null;
		}

		// Title control
		const { showTabs } = this.accessor.partOptions;
		const borderColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BORDER) || this.getColor(contrastBorder);
		this.titleContainer.style.backgroundColor = this.getColor(showTabs ? EDITOR_GROUP_HEADER_TABS_BACKGROUND : EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND);
		this.titleContainer.style.borderBottomWidth = (borderColor && showTabs) ? '1px' : null;
		this.titleContainer.style.borderBottomStyle = (borderColor && showTabs) ? 'solid' : null;
		this.titleContainer.style.borderBottomColor = showTabs ? borderColor : null;

		// Editor container
		this.editorContainer.style.backgroundColor = this.getColor(editorBackground);
	}

	//#endregion

	//#region ISerializableView

	readonly element: HTMLElement = document.createElement('div');

	readonly minimumWidth = EDITOR_MIN_DIMENSIONS.width;
	readonly minimumHeight = EDITOR_MIN_DIMENSIONS.height;
	readonly maximumWidth = EDITOR_MAX_DIMENSIONS.width;
	readonly maximumHeight = EDITOR_MAX_DIMENSIONS.height;

	get onDidChange() { return Event.None; } // only needed if minimum sizes ever change

	layout(width: number, height: number): void {
		this.dimension = new Dimension(width, height);

		// Forward to controls
		this.titleAreaControl.layout(new Dimension(this.dimension.width, EDITOR_TITLE_HEIGHT));
		this.editorControl.layout(new Dimension(this.dimension.width, this.dimension.height - EDITOR_TITLE_HEIGHT));
	}

	toJSON(): ISerializedEditorGroup {
		return this._group.serialize();
	}

	//#endregion

	shutdown(): void {
		this.editorControl.shutdown();
	}

	dispose(): void {
		this._onWillDispose.fire();

		this.titleAreaControl.dispose();

		super.dispose();
	}
}

export interface EditorReplacement {
	editor: EditorInput;
	replacement: EditorInput;
	options?: EditorOptions;
}

registerThemingParticipant((theme, collector, environment) => {

	// Letterpress
	const letterpress = `resources/letterpress${theme.type === 'dark' ? '-dark' : theme.type === 'hc' ? '-hc' : ''}.svg`;
	collector.addRule(`
		.monaco-workbench > .part.editor > .content .editor-group-container.empty {
			background-image: url('${join(environment.appRoot, letterpress)}')
		}
	`);
});
