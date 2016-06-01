/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import {Event} from 'vs/base/common/events';
import {IEditorInput} from 'vs/platform/editor/common/editor';

/**
 * All workbench events are listed here.
 */
export class EventType {

	/**
	 * Event type for when an editor is opened. This event is only sent once for a specific editor type until another
	 * editor type gets opened. For example, when the user opens a file, the editorOpened event will be sent. If another
	 * file is opened, this event will not be fired again. If the user opens, e.g. the diff editor, editorOpened will be
	 * fired, since another editor type opened.
	 */
	static EDITOR_OPENED = 'editorOpened';

	/**
	 * Event type for when an editor is closed because another editor type is opened.
	 */
	static EDITOR_CLOSED = 'editorClosed';

	/**
	 * Event type for when a composite is about to open.
	 */
	static COMPOSITE_OPENING = 'compositeOpening';

	/**
	 * Event type for when a composite is opened.
	 */
	static COMPOSITE_OPENED = 'compositeOpened';

	/**
	 * Event type for when a composite is closed.
	 */
	static COMPOSITE_CLOSED = 'compositeClosed';

	/**
	 * Event type for when an untitled file is becoming dirty.
	 */
	static UNTITLED_FILE_DIRTY = 'untitledFileDirty';

	/**
	 * Event type for when an untitled file is deleted.
	 */
	static UNTITLED_FILE_DELETED = 'untitledFileDeleted';

	/**
	 * Event type for when a resources encoding changes.
	 */
	static RESOURCE_ENCODING_CHANGED = 'resourceEncodingChanged';

	/**
	 * Event type for when the workbench options change. Listeners should refresh their
	 * assumption on workbench options after this event is emitted.
	 */
	static WORKBENCH_OPTIONS_CHANGED = 'workbenchOptionsChanged';
}

export class EditorInputEvent extends Event {
	private _editorInput: IEditorInput;
	private prevented: boolean;

	constructor(editorInput: IEditorInput) {
		super(null);

		this._editorInput = editorInput;
	}

	public get editorInput(): IEditorInput {
		return this._editorInput;
	}

	public prevent(): void {
		this.prevented = true;
	}

	public isPrevented(): boolean {
		return this.prevented;
	}
}

/**
 * Option change events are send when the options in the running instance change.
 */
export class OptionsChangeEvent extends Event {
	public key: string;
	public before: any;
	public after: any;

	constructor(key: string, before: any, after: any, originalEvent?: any) {
		super(originalEvent);

		this.key = key;
		this.before = before;
		this.after = after;
	}
}

/**
 * Composite events are emitted when a composite opens or closes in the sidebar or panel.
 */
export class CompositeEvent extends Event {
	public compositeId: string;

	constructor(compositeId: string, originalEvent?: any) {
		super(originalEvent);

		this.compositeId = compositeId;
	}
}

export class ResourceEvent extends Event {
	public resource: URI;

	constructor(resource: URI, originalEvent?: any) {
		super(originalEvent);

		this.resource = resource;
	}
}

export class UntitledEditorEvent extends ResourceEvent {
	// No new methods
}