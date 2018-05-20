/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { createDecorator, ServiceIdentifier, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IResourceInput, IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { IEditorInput, IEditor, GroupIdentifier, IEditorInputWithOptions, IEditorIdentifier, IUntitledResourceInput, IResourceDiffInput, IResourceSideBySideInput, IEditorCloseEvent, ITextEditor, ITextDiffEditor, ITextSideBySideEditor } from 'vs/workbench/common/editor';
import { Event } from 'vs/base/common/event';
import { IEditor as ICodeEditor } from 'vs/editor/common/editorCommon';
import { IEditorGroup, IEditorReplacement } from 'vs/workbench/services/group/common/nextEditorGroupsService';
import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable } from 'vs/base/common/lifecycle';

export const INextEditorService = createDecorator<INextEditorService>('nextEditorService');

export type IResourceEditor = IResourceInput | IUntitledResourceInput | IResourceDiffInput | IResourceSideBySideInput;

export interface IResourceEditorReplacement {
	editor: IResourceEditor;
	replacement: IResourceEditor;
}

export const ACTIVE_GROUP = -1;
export type ACTIVE_GROUP_TYPE = typeof ACTIVE_GROUP;

export const SIDE_GROUP = -2;
export type SIDE_GROUP_TYPE = typeof SIDE_GROUP;

export interface IOpenEditorOverrideHandler {
	(editor: IEditorInput, options: IEditorOptions | ITextEditorOptions, group: IEditorGroup): IOpenEditorOverride;
}

export interface IOpenEditorOverride {

	/**
	 * If defined, will prevent the opening of an editor and replace the resulting
	 * promise with the provided promise for the openEditor() call.
	 */
	override?: TPromise<any>;
}

export interface INextEditorService {
	_serviceBrand: ServiceIdentifier<any>;

	/**
	 * Emitted when the current active editor changes.
	 */
	readonly onDidActiveEditorChange: Event<void>;

	/**
	 * Emitted when any of the current visible editors changes.
	 */
	readonly onDidVisibleEditorsChange: Event<void>;

	/**
	 * Emitted when an editor is closed.
	 */
	readonly onDidCloseEditor: Event<IEditorCloseEvent>;

	/**
	 * Emitted when an editor failed to open.
	 */
	readonly onDidOpenEditorFail: Event<IEditorIdentifier>;

	/**
	 * The currently active editor control if any.
	 */
	readonly activeControl: IEditor;

	/**
	 * The currently active text editor widget if there is a control active
	 * and it is an instance of the code text editor (either normal or diff
	 * editor).
	 */
	readonly activeTextEditorWidget: ICodeEditor;

	/**
	 * All editors that are opened.
	 */
	readonly editors: ReadonlyArray<IEditorInput>;

	/**
	 * The currently active editor if any.
	 */
	readonly activeEditor: IEditorInput;

	/**
	 * All controls that are currently visible.
	 */
	readonly visibleControls: ReadonlyArray<IEditor>;

	/**
	 * All text editor widgets (either normal or diff editor) that are currently
	 * visible.
	 */
	readonly visibleTextEditorWidgets: ReadonlyArray<ICodeEditor>;

	/**
	 * All editors that are currently visible.
	 */
	readonly visibleEditors: ReadonlyArray<IEditorInput>;

	/**
	 * Open an editor in an editor group.
	 *
	 * @param editor the editor to open
	 * @param options the options to use for the editor
	 * @param group the target group. If unspecified, the editor will open in the currently
	 * active group. Use `SIDE_GROUP_TYPE` to open the editor in a new editor group to the side
	 * of the currently active group.
	 */
	openEditor(editor: IEditorInput, options?: IEditorOptions | ITextEditorOptions, group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): TPromise<IEditor>;
	openEditor(editor: IResourceInput | IUntitledResourceInput, group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): TPromise<ITextEditor>;
	openEditor(editor: IResourceDiffInput, group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): TPromise<ITextDiffEditor>;
	openEditor(editor: IResourceSideBySideInput, group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): TPromise<ITextSideBySideEditor>;

	/**
	 * Open editors in an editor group.
	 *
	 * @param editors the editors to open with associated options
	 * @param group the target group. If unspecified, the editor will open in the currently
	 * active group. Use `SIDE_GROUP_TYPE` to open the editor in a new editor group to the side
	 * of the currently active group.
	 */
	openEditors(editors: IEditorInputWithOptions[], group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): TPromise<ReadonlyArray<IEditor>>;
	openEditors(editors: IResourceEditor[], group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): TPromise<ReadonlyArray<IEditor>>;

	/**
	 * Replaces editors in an editor group with the provided replacement.
	 *
	 * @param editors the editors to replace
	 *
	 * @returns a promise that is resolved when the replaced active
	 * editor (if any) has finished loading.
	 */
	replaceEditors(editors: IResourceEditorReplacement[], group: IEditorGroup | GroupIdentifier): TPromise<void>;
	replaceEditors(editors: IEditorReplacement[], group: IEditorGroup | GroupIdentifier): TPromise<void>;

	/**
	 * Find out if the provided editor (or resource of an editor) is opened in any or
	 * a specific editor group.
	 *
	 * Note: An editor can be opened but not actively visible.
	 *
	 * @param group optional to specify a group to check for the editor being opened
	 */
	isOpen(editor: IEditorInput | IResourceInput | IUntitledResourceInput, group?: IEditorGroup | GroupIdentifier): boolean;

	/**
	 * Allows to override the opening of editors by installing a handler that will
	 * be called each time an editor is about to open allowing to override the
	 * operation to open a different editor.
	 */
	overrideOpenEditor(handler: IOpenEditorOverrideHandler): IDisposable;

	/**
	 * Invoke a function in the context of the services of the active editor.
	 */
	invokeWithinEditorContext<T>(fn: (accessor: ServicesAccessor) => T): T;

	/**
	 * Converts a lightweight input to a workbench editor input.
	 */
	createInput(input: IResourceEditor): IEditorInput;
}