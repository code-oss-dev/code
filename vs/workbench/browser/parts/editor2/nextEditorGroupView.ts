/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/nextEditorGroupView';
import { TPromise } from 'vs/base/common/winjs.base';
import { EditorGroup, IEditorOpenOptions } from 'vs/workbench/common/editor/editorStacksModel';
import { EditorInput, EditorOptions, GroupIdentifier, ConfirmResult, SideBySideEditorInput, IEditorOpeningEvent, EditorOpeningEvent } from 'vs/workbench/common/editor';
import { Event, Emitter, once } from 'vs/base/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { addClass, addClasses, Dimension, trackFocus, toggleClass, removeClass } from 'vs/base/browser/dom';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { attachProgressBarStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { editorBackground, contrastBorder, focusBorder } from 'vs/platform/theme/common/colorRegistry';
import { Themable, EDITOR_GROUP_HEADER_TABS_BORDER, EDITOR_GROUP_HEADER_TABS_BACKGROUND, EDITOR_GROUP_BACKGROUND } from 'vs/workbench/common/theme';
import { INextEditorGroup } from 'vs/workbench/services/editor/common/nextEditorGroupsService';
import { INextTitleAreaControl } from 'vs/workbench/browser/parts/editor2/nextTitleControl';
import { NextTabsTitleControl } from 'vs/workbench/browser/parts/editor2/nextTabsTitleControl';
import { NextEditorControl } from 'vs/workbench/browser/parts/editor2/nextEditorControl';
import { IView } from 'vs/base/browser/ui/grid/gridview';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { ProgressService } from 'vs/workbench/services/progress/browser/progressService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { localize } from 'vs/nls';
import { onUnexpectedError, isPromiseCanceledError, isErrorWithActions, IErrorWithActions } from 'vs/base/common/errors';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import { dispose } from 'vs/base/common/lifecycle';
import { Severity, INotificationService, INotificationActions } from 'vs/platform/notification/common/notification';
import { toErrorMessage } from 'vs/base/common/errorMessage';

export interface IGroupsAccessor {
	isOpenedInOtherGroup(editor: EditorInput): boolean;
}

export class NextEditorGroupView extends Themable implements IView, INextEditorGroup {

	private static readonly EDITOR_TITLE_HEIGHT = 35;

	//#region events

	private _onDidFocus: Emitter<void> = this._register(new Emitter<void>());
	get onDidFocus(): Event<void> { return this._onDidFocus.event; }

	private _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	get onWillDispose(): Event<void> { return this._onWillDispose.event; }

	private _onDidActiveEditorChange: Emitter<EditorInput> = this._register(new Emitter<EditorInput>());
	get onDidActiveEditorChange(): Event<EditorInput> { return this._onDidActiveEditorChange.event; }

	private _onWillOpenEditor: Emitter<IEditorOpeningEvent> = this._register(new Emitter<IEditorOpeningEvent>());
	get onWillOpenEditor(): Event<IEditorOpeningEvent> { return this._onWillOpenEditor.event; }

	private _onDidOpenEditorFail: Emitter<EditorInput> = this._register(new Emitter<EditorInput>());
	get onDidOpenEditorFail(): Event<EditorInput> { return this._onDidOpenEditorFail.event; }

	//#endregion

	private group: EditorGroup;
	private isActive: boolean;

	private dimension: Dimension;
	private scopedInstantiationService: IInstantiationService;

	private titleContainer: HTMLElement;
	private titleAreaControl: INextTitleAreaControl;

	private editorContainer: HTMLElement;
	private editorControl: NextEditorControl;

	private ignoreOpenEditorErrors: boolean;

	private progressBar: ProgressBar;

	constructor(
		private groupsAccessor: IGroupsAccessor,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IPartService private partService: IPartService,
		@INotificationService private notificationService: INotificationService
	) {
		super(themeService);

		this.group = this._register(instantiationService.createInstance(EditorGroup, ''));
		this.group.label = `Group <${this.group.id}>`;

		this.doCreate();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.group.onEditorsStructureChanged(() => this.updateContainer()));
	}

	private doCreate(): void {

		// Container
		addClasses(this.element, 'editor-group-container');

		const focusTracker = this._register(trackFocus(this.element));
		this._register(focusTracker.onDidFocus(() => {
			this._onDidFocus.fire();
		}));

		// Title container
		this.titleContainer = document.createElement('div');
		addClasses(this.titleContainer, 'title', 'tabs', 'show-file-icons');
		this.element.appendChild(this.titleContainer);

		// Progress bar
		this.progressBar = this._register(new ProgressBar(this.element));
		this._register(attachProgressBarStyler(this.progressBar, this.themeService));
		this.progressBar.hide();

		// Editor container
		this.editorContainer = document.createElement('div');
		addClass(this.editorContainer, 'editor-container');
		this.element.appendChild(this.editorContainer);

		// Update styles
		this.updateStyles();

		// Update container
		this.updateContainer();
	}

	private updateContainer(): void {

		// Empty Container: allow to focus
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
	}

	setActive(isActive: boolean): void {
		this.isActive = isActive;

		// Update container
		toggleClass(this.element, 'active', isActive);
		toggleClass(this.element, 'inactive', !isActive);

		// Update title control
		if (this.titleAreaControl) {
			this.titleAreaControl.setActive(isActive);
		}
	}

	contains(editor: EditorInput): boolean {
		return this.group.contains(editor);
	}

	isEmpty(): boolean {
		return this.group.count === 0;
	}

	//#region INextEditorGroup

	get id(): GroupIdentifier {
		return this.group.id;
	}

	get activeControl(): BaseEditor {
		return this.editorControl ? this.editorControl.activeControl : void 0;
	}

	get activeEditor(): EditorInput {
		return this.activeControl ? this.activeControl.input : void 0;
	}

	//#region openEditor()

	openEditor(editor: EditorInput, options?: EditorOptions): Thenable<void> {

		// Editor opening event allows for prevention
		const event = new EditorOpeningEvent(editor, options, this.group.id);
		this._onWillOpenEditor.fire(event);
		if (event.isPrevented()) {
			return TPromise.as(void 0);
		}

		// Proceed with opening
		return this.doOpenEditor(editor, options);
	}

	private doOpenEditor(editor: EditorInput, options?: EditorOptions): Thenable<void> {

		// Update model
		const openEditorOptions: IEditorOpenOptions = {
			index: options ? options.index : void 0,
			pinned: editor.isDirty() || (options && options.pinned) || (options && typeof options.index === 'number'),
			active: this.group.count === 0 || !options || !options.inactive
		};
		this.group.openEditor(editor, openEditorOptions);

		// Forward to title control
		this.doCreateOrGetTitleControl().openEditor(editor, options);

		// Forward to editor control if the editor should become active
		let openEditorPromise: Thenable<void>;
		if (openEditorOptions.active) {
			openEditorPromise = this.doCreateOrGetEditorControl().openEditor(editor, options).then(result => {

				// Editor change event
				if (result.editorChanged) {
					this._onDidActiveEditorChange.fire(editor);
				}
			}, error => {

				// Handle errors but do not bubble them up
				this.doHandleOpenEditorError(error, editor, options);
			});
		} else {
			openEditorPromise = TPromise.as(void 0);
		}

		return openEditorPromise;
	}

	private doHandleOpenEditorError(error: Error, editor: EditorInput, options?: EditorOptions): void {

		// Report error only if this was not us restoring previous error state or
		// we are told to ignore errors that occur from opening an editor
		if (this.partService.isCreated() && !isPromiseCanceledError(error) && !this.ignoreOpenEditorErrors) {
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
			this.doCloseActiveEditor(!(options && options.preserveFocus) /* still preserve focus as needed */, true /* from error */);
		}
	}

	private doCreateOrGetScopedInstantiationService(): IInstantiationService {
		if (!this.scopedInstantiationService) {
			this.scopedInstantiationService = this.instantiationService.createChild(new ServiceCollection(
				[IContextKeyService, this._register(this.contextKeyService.createScoped(this.element))],
				[IProgressService, new ProgressService(this.progressBar)]
			));
		}

		return this.scopedInstantiationService;
	}

	private doCreateOrGetTitleControl(): INextTitleAreaControl {
		if (!this.titleAreaControl) {
			this.titleAreaControl = this._register(this.doCreateOrGetScopedInstantiationService().createInstance(NextTabsTitleControl, this.titleContainer, this.group));
			this.doLayoutTitleControl();
		}

		return this.titleAreaControl;
	}

	private doCreateOrGetEditorControl(): NextEditorControl {
		if (!this.editorControl) {
			this.editorControl = this._register(this.doCreateOrGetScopedInstantiationService().createInstance(NextEditorControl, this.editorContainer, this.group));
			this.doLayoutEditorControl();
		}

		return this.editorControl;
	}

	//#endregion

	//#region closeEditor()

	closeEditor(editor: EditorInput = this.activeEditor): Thenable<void> {

		// Check for dirty and veto
		return this.handleDirty([editor], true /* ignore if opened in other group */).then(veto => {
			if (veto) {
				return;
			}

			// Do close
			this.doCloseEditor(editor);
		});
	}

	private doCloseEditor(editor: EditorInput, focusNext = this.isActive): void {

		// Closing the active editor of the group is a bit more work
		if (this.activeEditor && this.activeEditor.matches(editor)) {
			this.doCloseActiveEditor(focusNext);
		}

		// Closing inactive editor is just a model update
		else {
			this.doCloseInactiveEditor(editor);
		}
	}

	private doCloseActiveEditor(focusNext = this.isActive, fromError?: boolean): void {

		// Update model
		this.group.closeEditor(this.activeEditor);

		// Open next active if possible
		const nextActiveEditor = this.group.activeEditor;
		if (nextActiveEditor) {

			// When closing an editor due to an error we can end up in a loop where we continue closing
			// editors that fail to open (e.g. when the file no longer exists). We do not want to show
			// repeated errors in this case to the user. As such, if we open the next editor and we are
			// in a scope of a previous editor failing, we silence the input errors until the editor is
			// opened.
			if (fromError) {
				this.ignoreOpenEditorErrors = true;
			}

			this.openEditor(nextActiveEditor, !focusNext ? EditorOptions.create({ preserveFocus: true }) : null).then(() => {
				this.ignoreOpenEditorErrors = false;
			}, error => {
				onUnexpectedError(error);

				this.ignoreOpenEditorErrors = false;
			});
		}
	}

	private doCloseInactiveEditor(editor: EditorInput): void {
		this.group.closeEditor(editor); // Closing inactive editor is just a model update
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
		if (!editor || !editor.isDirty() || (ignoreIfOpenedInOtherGroup && this.isOpenedInOtherGroup(editor))) {
			return TPromise.as(false); // no veto
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

	private isOpenedInOtherGroup(editor: EditorInput): boolean {
		if (this.groupsAccessor.isOpenedInOtherGroup(editor)) {
			return true;
		}

		if (editor instanceof SideBySideEditorInput && this.groupsAccessor.isOpenedInOtherGroup(editor.master)) {
			return true; // consider right-hand-side diff editors too
		}

		return false;
	}

	//#endregion

	//#region other INextEditorGroup methods

	focusActiveEditor(): void {
		if (this.activeControl) {
			this.activeControl.focus();
		}
	}

	pinEditor(editor: EditorInput = this.activeEditor): void {
		if (editor && !this.group.isPinned(editor)) {

			// Update model
			this.group.pin(editor);

			// Forward to title control
			if (this.titleAreaControl) {
				this.titleAreaControl.pinEditor(editor);
			}
		}
	}

	//#endregion

	//#endregion

	//#region Themable

	protected updateStyles(): void {

		// Container
		this.element.style.backgroundColor = this.getColor(EDITOR_GROUP_BACKGROUND);
		this.element.style.outlineColor = this.getColor(focusBorder);

		// Title control
		const borderColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BORDER) || this.getColor(contrastBorder);
		this.titleContainer.style.backgroundColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BACKGROUND);
		this.titleContainer.style.borderBottomWidth = borderColor ? '1px' : null;
		this.titleContainer.style.borderBottomStyle = borderColor ? 'solid' : null;
		this.titleContainer.style.borderBottomColor = borderColor;

		// Editor container
		this.editorContainer.style.backgroundColor = this.getColor(editorBackground);
	}

	//#endregion

	//#region IView

	readonly element: HTMLElement = document.createElement('div');

	readonly minimumWidth = 170;
	readonly minimumHeight = 70;
	readonly maximumWidth = Number.POSITIVE_INFINITY;
	readonly maximumHeight = Number.POSITIVE_INFINITY;

	get onDidChange() { return Event.None; }

	layout(width: number, height: number): void {
		this.dimension = new Dimension(width, height);

		// Forward to controls
		this.doLayoutTitleControl();
		this.doLayoutEditorControl();
	}

	private doLayoutTitleControl(): void {
		if (this.titleAreaControl) {
			this.titleAreaControl.layout(new Dimension(this.dimension.width, NextEditorGroupView.EDITOR_TITLE_HEIGHT));
		}
	}

	private doLayoutEditorControl(): void {
		if (this.editorControl) {
			this.editorControl.layout(new Dimension(this.dimension.width, this.dimension.height - NextEditorGroupView.EDITOR_TITLE_HEIGHT));
		}
	}

	//#endregion

	shutdown(): void {
		if (this.editorControl) {
			this.editorControl.shutdown();
		}
	}

	dispose(): void {
		this._onWillDispose.fire();

		super.dispose();
	}
}