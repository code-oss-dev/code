/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { Panel } from 'vs/workbench/browser/panel';
import { EditorInput, EditorOptions, IEditor, GroupIdentifier, IEditorMemento } from 'vs/workbench/common/editor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/group/common/editorGroupsService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { LRUCache } from 'vs/base/common/map';
import URI from 'vs/base/common/uri';
import { once } from 'vs/base/common/event';
import { isEmptyObject } from 'vs/base/common/types';

/**
 * The base class of editors in the workbench. Editors register themselves for specific editor inputs.
 * Editors are layed out in the editor part of the workbench in editor groups. Multiple editors can be
 * open at the same time. Each editor has a minimized representation that is good enough to provide some
 * information about the state of the editor data.
 *
 * The workbench will keep an editor alive after it has been created and show/hide it based on
 * user interaction. The lifecycle of a editor goes in the order create(), setVisible(true|false),
 * layout(), setInput(), focus(), dispose(). During use of the workbench, a editor will often receive a
 * clearInput, setVisible, layout and focus call, but only one create and dispose call.
 *
 * This class is only intended to be subclassed and not instantiated.
 */
export abstract class BaseEditor extends Panel implements IEditor {

	private static readonly EDITOR_MEMENTOS: Map<string, EditorMemento<any>> = new Map<string, EditorMemento<any>>();

	protected _input: EditorInput;

	private _options: EditorOptions;
	private _group: IEditorGroup;

	constructor(
		id: string,
		telemetryService: ITelemetryService,
		themeService: IThemeService
	) {
		super(id, telemetryService, themeService);
	}

	get input(): EditorInput {
		return this._input;
	}

	get options(): EditorOptions {
		return this._options;
	}

	get group(): IEditorGroup {
		return this._group;
	}

	/**
	 * Note: Clients should not call this method, the workbench calls this
	 * method. Calling it otherwise may result in unexpected behavior.
	 *
	 * Sets the given input with the options to the editor. The input is guaranteed
	 * to be different from the previous input that was set using the input.matches()
	 * method.
	 *
	 * The provided cancellation token should be used to test if the operation
	 * was cancelled.
	 */
	setInput(input: EditorInput, options: EditorOptions, token: CancellationToken): Thenable<void> {
		this._input = input;
		this._options = options;

		return TPromise.wrap<void>(null);
	}

	/**
	 * Called to indicate to the editor that the input should be cleared and
	 * resources associated with the input should be freed.
	 */
	clearInput(): void {
		this._input = null;
		this._options = null;
	}

	/**
	 * Note: Clients should not call this method, the workbench calls this
	 * method. Calling it otherwise may result in unexpected behavior.
	 *
	 * Sets the given options to the editor. Clients should apply the options
	 * to the current input.
	 */
	setOptions(options: EditorOptions): void {
		this._options = options;
	}

	create(parent: HTMLElement): void; // create is sync for editors
	create(parent: HTMLElement): TPromise<void>;
	create(parent: HTMLElement): TPromise<void> {
		const res = super.create(parent);

		// Create Editor
		this.createEditor(parent);

		return res;
	}

	/**
	 * Called to create the editor in the parent HTMLElement.
	 */
	protected abstract createEditor(parent: HTMLElement): void;

	setVisible(visible: boolean, group?: IEditorGroup): void; // setVisible is sync for editors
	setVisible(visible: boolean, group?: IEditorGroup): TPromise<void>;
	setVisible(visible: boolean, group?: IEditorGroup): TPromise<void> {
		const promise = super.setVisible(visible);

		// Propagate to Editor
		this.setEditorVisible(visible, group);

		return promise;
	}

	/**
	 * Indicates that the editor control got visible or hidden in a specific group. A
	 * editor instance will only ever be visible in one editor group.
	 *
	 * @param visible the state of visibility of this editor
	 * @param group the editor group this editor is in.
	 */
	protected setEditorVisible(visible: boolean, group: IEditorGroup): void {
		this._group = group;
	}

	/**
	 * Subclasses can set this to false if it does not make sense to center editor input.
	 */
	supportsCenteredLayout(): boolean {
		return true;
	}

	protected getEditorMemento<T>(storageService: IStorageService, editorGroupService: IEditorGroupsService, key: string, limit: number = 10): IEditorMemento<T> {
		const mementoKey = `${this.getId()}${key}`;

		let editorMemento = BaseEditor.EDITOR_MEMENTOS.get(mementoKey);
		if (!editorMemento) {
			editorMemento = new EditorMemento(editorGroupService, this.getMemento(storageService), key, limit);
			BaseEditor.EDITOR_MEMENTOS.set(mementoKey, editorMemento);
		}

		return editorMemento;
	}

	shutdown(): void {

		// Save all editor mementos
		BaseEditor.EDITOR_MEMENTOS.forEach(editorMemento => editorMemento.shutdown());

		super.shutdown();
	}

	dispose(): void {
		this._input = null;
		this._options = null;

		// Super Dispose
		super.dispose();
	}
}

interface MapGroupToMemento<T> {
	[group: number]: T;
}

export class EditorMemento<T> implements IEditorMemento<T> {
	private cache: LRUCache<string, MapGroupToMemento<T>>;
	private isShutdown: boolean;

	constructor(
		private editorGroupService: IEditorGroupsService,
		private memento: object,
		private key: string,
		private limit: number
	) { }

	saveState(group: IEditorGroup, resource: URI, state: T): void;
	saveState(group: IEditorGroup, editor: EditorInput, state: T): void;
	saveState(group: IEditorGroup, resourceOrEditor: URI | EditorInput, state: T): void {
		const resource = this.doGetResource(resourceOrEditor);
		if (!resource || !group) {
			return; // we are not in a good state to save any state for a resource
		}

		const cache = this.doLoad();

		let mementoForResource = cache.get(resource.toString());
		if (!mementoForResource) {
			mementoForResource = Object.create(null) as MapGroupToMemento<T>;
			cache.set(resource.toString(), mementoForResource);
		}

		mementoForResource[group.id] = state;

		// Automatically clear when editor input gets disposed if any
		if (resourceOrEditor instanceof EditorInput) {
			once(resourceOrEditor.onDispose)(() => {
				this.clearState(resource);
			});
		}
	}

	loadState(group: IEditorGroup, resource: URI): T;
	loadState(group: IEditorGroup, editor: EditorInput): T;
	loadState(group: IEditorGroup, resourceOrEditor: URI | EditorInput): T {
		const resource = this.doGetResource(resourceOrEditor);
		if (!resource || !group) {
			return void 0; // we are not in a good state to load any state for a resource
		}

		const cache = this.doLoad();

		const mementoForResource = cache.get(resource.toString());
		if (mementoForResource) {
			return mementoForResource[group.id];
		}

		return void 0;
	}

	clearState(resource: URI): void;
	clearState(editor: EditorInput): void;
	clearState(resourceOrEditor: URI | EditorInput): void {
		const resource = this.doGetResource(resourceOrEditor);
		if (resource) {
			const cache = this.doLoad();
			cache.delete(resource.toString());
		}
	}

	private doGetResource(resourceOrEditor: URI | EditorInput): URI {
		if (resourceOrEditor instanceof EditorInput) {
			return resourceOrEditor.getResource();
		}

		return resourceOrEditor;
	}

	private doLoad(): LRUCache<string, MapGroupToMemento<T>> {
		if (!this.cache) {
			this.cache = new LRUCache<string, MapGroupToMemento<T>>(this.limit);

			// Restore from serialized map state
			const rawEditorMemento = this.memento[this.key];
			if (Array.isArray(rawEditorMemento)) {
				this.cache.fromJSON(rawEditorMemento);
			}
		}

		return this.cache;
	}

	shutdown(): void {
		if (this.isShutdown) {
			return; // only shutdown once
		}

		const cache = this.doLoad();

		// Remove groups from states that no longer exist
		cache.forEach((mapGroupToMemento, resource) => {
			Object.keys(mapGroupToMemento).forEach(group => {
				const groupId: GroupIdentifier = Number(group);
				if (!this.editorGroupService.getGroup(groupId)) {
					delete mapGroupToMemento[groupId];

					if (isEmptyObject(mapGroupToMemento)) {
						cache.delete(resource);
					}
				}
			});
		});

		this.memento[this.key] = cache.toJSON();
		this.isShutdown = true;
	}
}