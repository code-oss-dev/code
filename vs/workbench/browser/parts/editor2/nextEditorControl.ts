/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Disposable } from 'vs/base/common/lifecycle';
import { EditorInput, EditorOptions, GroupIdentifier } from 'vs/workbench/common/editor';
import { Dimension, show, hide } from 'vs/base/browser/dom';
import { Registry } from 'vs/platform/registry/common/platform';
import { IEditorRegistry, Extensions as EditorExtensions, IEditorDescriptor } from 'vs/workbench/browser/editor';
import { TPromise } from 'vs/base/common/winjs.base';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IProgressService, LongRunningOperation } from 'vs/platform/progress/common/progress';

export interface IOpenEditorResult {
	readonly control: BaseEditor;
	readonly editorChanged: boolean;
}

export class NextEditorControl extends Disposable {
	private dimension: Dimension;
	private editorOperation: LongRunningOperation;

	private _activeControl: BaseEditor;
	private controls: BaseEditor[] = [];

	constructor(
		private parent: HTMLElement,
		private groupId: GroupIdentifier,
		@IPartService private partService: IPartService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IProgressService progressService: IProgressService
	) {
		super();

		this.editorOperation = new LongRunningOperation(progressService);
	}

	get activeControl(): BaseEditor {
		return this._activeControl;
	}

	openEditor(editor: EditorInput, options?: EditorOptions): Thenable<IOpenEditorResult> {

		// Editor control
		const descriptor = Registry.as<IEditorRegistry>(EditorExtensions.Editors).getEditor(editor);
		const control = this.doShowEditorControl(descriptor, options);

		// Set input
		return this.doSetInput(control, editor, options).then((editorChanged => (({ control, editorChanged } as IOpenEditorResult))));
	}

	private doShowEditorControl(descriptor: IEditorDescriptor, options: EditorOptions): BaseEditor {

		// Return early if the currently active editor control can handle the input
		if (this._activeControl && descriptor.describes(this._activeControl)) {
			return this._activeControl;
		}

		// Hide active one first
		this.doHideActiveEditorControl();

		// Create editor
		const control = this.doCreateEditorControl(descriptor);

		// Remember editor as active
		this._activeControl = control;

		// Show editor
		this.parent.appendChild(control.getContainer());
		show(control.getContainer());

		// Indicate to editor that it is now visible
		control.setVisible(true, this.groupId /* TODO@grid use group id instead of position */);

		// Layout
		control.layout(this.dimension);

		return control;
	}

	private doCreateEditorControl(descriptor: IEditorDescriptor): BaseEditor {

		// Instantiate editor
		const control = this.doInstantiateEditorControl(descriptor);

		// Create editor container as needed
		if (!control.getContainer()) {
			const controlInstanceContainer = document.createElement('div');
			controlInstanceContainer.id = descriptor.getId();

			control.create(controlInstanceContainer);
		}

		return control;
	}

	private doInstantiateEditorControl(descriptor: IEditorDescriptor): BaseEditor {

		// Return early if already instantiated
		const existingControl = this.controls.filter(control => descriptor.describes(control))[0];
		if (existingControl) {
			return existingControl;
		}

		// Otherwise instantiate new
		const control = this._register(descriptor.instantiate(this.instantiationService));
		this.controls.push(control);

		return control;
	}

	private doSetInput(control: BaseEditor, editor: EditorInput, options: EditorOptions): Thenable<boolean> {

		// Show progress while setting input after a certain timeout. If the workbench is opening
		// be more relaxed about progress showing by increasing the delay a little bit to reduce flicker.
		const operation = this.editorOperation.start(this.partService.isCreated() ? 800 : 3200);

		// Call into editor control
		const editorWillChange = (!control.input || !control.input.matches(editor) || (options && options.forceOpen));
		return control.setInput(editor, options).then(() => {

			// Operation done
			operation.stop();

			// Focus (unless prevented or another operation is running)
			if (operation.isCurrent()) {
				const focus = !options || !options.preserveFocus;
				if (focus) {
					control.focus();
				}
			}

			return editorWillChange;
		}, e => {

			// Operation done
			operation.stop();

			return TPromise.wrapError(e);
		});
	}

	private doHideActiveEditorControl(): void {
		if (!this._activeControl) {
			return;
		}

		// Remove control from parent and hide
		const controlInstanceContainer = this._activeControl.getContainer();
		this.parent.removeChild(controlInstanceContainer);
		hide(controlInstanceContainer);

		// Indicate to editor control
		this._activeControl.clearInput();
		this._activeControl.setVisible(false);

		// Clear active control
		this._activeControl = null;
	}

	layout(dimension: Dimension): void {
		this.dimension = dimension;

		if (this._activeControl) {
			this._activeControl.layout(this.dimension);
		}
	}

	shutdown(): void {

		// Forward to all editor controls
		this.controls.forEach(editor => editor.shutdown());
	}
}