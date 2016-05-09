/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import Event, {Emitter} from 'vs/base/common/event';
import {EditorInput} from 'vs/workbench/common/editor';
import {IStorageService, StorageScope} from 'vs/platform/storage/common/storage';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {ILifecycleService} from 'vs/platform/lifecycle/common/lifecycle';
import {dispose, IDisposable} from 'vs/base/common/lifecycle';
import {IEditorRegistry, Extensions} from 'vs/workbench/browser/parts/editor/baseEditor';
import {Registry} from 'vs/platform/platform';

export interface IEditorGroup {

	id: GroupIdentifier;
	label: string;
	count: number;
	activeEditor: EditorInput;
	previewEditor: EditorInput;

	onEditorActivated: Event<EditorInput>;
	onEditorOpened: Event<EditorInput>;
	onEditorClosed: Event<EditorInput>;
	onEditorMoved: Event<EditorInput>;
	onEditorPinned: Event<EditorInput>;
	onEditorUnpinned: Event<EditorInput>;

	getEditors(mru?: boolean): EditorInput[];
	// openEditor(editor: EditorInput, options?: IEditorOpenOptions): void;
	// moveEditor(editor: EditorInput, toIndex: number): void;
	// closeEditor(editor: EditorInput): void;
	// closeEditors(except: EditorInput, direction?: Direction): void;
	// closeAllEditors(): void;
	// setActive(editor: EditorInput): void;
	isActive(editor: EditorInput): boolean;
	isPreview(editor: EditorInput): boolean;
	isPinned(editor: EditorInput): boolean;

	// pin(editor: EditorInput): void;
	// unpin(editor: EditorInput): void;
}

export interface IEditorStacksModel {

	onGroupOpened: Event<IEditorGroup>;
	onGroupClosed: Event<IEditorGroup>;
	onGroupActivated: Event<IEditorGroup>;
	onGroupMoved: Event<IEditorGroup>;

	groups: IEditorGroup[];
	activeGroup: IEditorGroup;

	getGroup(id: GroupIdentifier): IEditorGroup;

	openGroup(label: string): IEditorGroup;

	closeGroup(group: IEditorGroup): void;
	closeGroups(except?: IEditorGroup): void;

	moveGroup(group: IEditorGroup, toIndex: number): void;

	setActive(group: IEditorGroup): void;
}

export type GroupIdentifier = number;

export interface IEditorOpenOptions {
	pinned?: boolean;
	active?: boolean;
	index?: number;
}

export enum Direction {
	LEFT,
	RIGHT
}

let CONFIG_OPEN_EDITOR_DIRECTION = Direction.RIGHT; // open new editors to the right of existing ones
export function setOpenEditorDirection(dir: Direction): void {
	CONFIG_OPEN_EDITOR_DIRECTION = dir;
}

export interface ISerializedEditorInput {
	id: string;
	value: string;
}

export interface ISerializedEditorGroup {
	label: string;
	editors: ISerializedEditorInput[];
	mru: number[];
	preview: number;
}

export class EditorGroup implements IEditorGroup {

	private static IDS = 0;

	private _id: GroupIdentifier;
	private _label: string;

	private editors: EditorInput[];
	private mru: EditorInput[];

	private preview: EditorInput; // editor in preview state
	private active: EditorInput;  // editor in active state

	private toDispose: IDisposable[];

	private _onEditorActivated: Emitter<EditorInput>;
	private _onEditorOpened: Emitter<EditorInput>;
	private _onEditorClosed: Emitter<EditorInput>;
	private _onEditorMoved: Emitter<EditorInput>;
	private _onEditorPinned: Emitter<EditorInput>;
	private _onEditorUnpinned: Emitter<EditorInput>;

	constructor(
		arg1: string | ISerializedEditorGroup,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		this._id = EditorGroup.IDS++;

		this.editors = [];
		this.mru = [];
		this.toDispose = [];

		if (typeof arg1 === 'object') {
			this.deserialize(arg1);
		} else {
			this._label = arg1;
		}

		this._onEditorActivated = new Emitter<EditorInput>();
		this._onEditorOpened = new Emitter<EditorInput>();
		this._onEditorClosed = new Emitter<EditorInput>();
		this._onEditorMoved = new Emitter<EditorInput>();
		this._onEditorPinned = new Emitter<EditorInput>();
		this._onEditorUnpinned = new Emitter<EditorInput>();

		this.toDispose.push(this._onEditorActivated, this._onEditorOpened, this._onEditorClosed, this._onEditorMoved, this._onEditorPinned, this._onEditorUnpinned);
	}

	public get id(): GroupIdentifier {
		return this._id;
	}

	public get label(): string {
		return this._label;
	}

	public get count(): number {
		return this.editors.length;
	}

	public get onEditorActivated(): Event<EditorInput> {
		return this._onEditorActivated.event;
	}

	public get onEditorOpened(): Event<EditorInput> {
		return this._onEditorOpened.event;
	}

	public get onEditorClosed(): Event<EditorInput> {
		return this._onEditorClosed.event;
	}

	public get onEditorMoved(): Event<EditorInput> {
		return this._onEditorMoved.event;
	}

	public get onEditorPinned(): Event<EditorInput> {
		return this._onEditorPinned.event;
	}

	public get onEditorUnpinned(): Event<EditorInput> {
		return this._onEditorUnpinned.event;
	}

	public getEditors(mru?: boolean): EditorInput[] {
		return mru ? this.mru.slice(0) : this.editors.slice(0);
	}

	public get activeEditor(): EditorInput {
		return this.active;
	}

	public isActive(editor: EditorInput): boolean {
		return this.matches(this.active, editor);
	}

	public get previewEditor(): EditorInput {
		return this.preview;
	}

	public isPreview(editor: EditorInput): boolean {
		return this.matches(this.preview, editor);
	}

	public openEditor(editor: EditorInput, options?: IEditorOpenOptions): void {
		const index = this.indexOf(editor);

		const makePinned = options && options.pinned;
		const makeActive = (options && options.active) || !this.activeEditor || (!makePinned && this.matches(this.preview, this.activeEditor));

		// New editor
		if (index === -1) {

			// Insert into our list of editors if pinned or we have no preview editor
			if (makePinned || !this.preview) {
				const indexOfActive = this.indexOf(this.active);

				// Insert into specific position
				if (options && typeof options.index === 'number') {
					this.splice(options.index, false, editor);
				}

				// Insert to the RIGHT of active editor
				else if (CONFIG_OPEN_EDITOR_DIRECTION === Direction.RIGHT) {
					this.splice(indexOfActive + 1, false, editor);
				}

				// Insert to the LEFT of active editor
				else {
					if (indexOfActive === 0 || !this.editors.length) {
						this.splice(0, false, editor); // to the left becoming first editor in list
					} else {
						this.splice(indexOfActive - 1, false, editor); // to the left of active editor
					}
				}
			}

			// Handle preview
			if (!makePinned) {

				// Replace existing preview with this editor if we have a preview
				if (this.preview) {
					const indexOfPreview = this.indexOf(this.preview);
					this.closeEditor(this.preview, !makeActive); // optimization to prevent multiple setActive() in one call
					this.splice(indexOfPreview, false, editor);
				}

				this.preview = editor;
			}

			// Event
			this._onEditorOpened.fire(editor);

			// Handle active
			if (makeActive) {
				this.setActive(editor);
			}
		}

		// Existing editor
		else {

			// Pin it
			if (makePinned) {
				this.pin(editor);
			}

			// Activate it
			if (makeActive) {
				this.setActive(editor);
			}

			// Respect index
			if (options && typeof options.index === 'number') {
				this.moveEditor(editor, options.index);
			}
		}
	}

	public closeEditor(editor: EditorInput, openNext = true): void {
		const index = this.indexOf(editor);
		if (index === -1) {
			return; // not found
		}

		// Active Editor closed
		if (openNext && this.matches(this.active, editor)) {

			// More than one editor
			if (this.mru.length > 1) {
				this.setActive(this.mru[1]); // active editor is always first in MRU, so pick second editor after as new active
			}

			// One Editor
			else {
				this.active = null;
			}
		}

		// Preview Editor closed
		if (this.matches(this.preview, editor)) {
			this.preview = null;
		}

		// Remove from arrays
		this.splice(index, true);

		// Event
		this._onEditorClosed.fire(editor);
	}

	public closeEditors(except: EditorInput, direction?: Direction): void {
		const index = this.indexOf(except);
		if (index === -1) {
			return; // not found
		}

		// Close to the left
		if (direction === Direction.LEFT) {
			for (let i = index - 1; i >= 0; i--) {
				this.closeEditor(this.editors[i]);
			}
		}

		// Close to the right
		else if (direction === Direction.RIGHT) {
			for (let i = this.editors.length - 1; i > index; i--) {
				this.closeEditor(this.editors[i]);
			}
		}

		// Both directions
		else {
			this.mru.filter(e => e !== except).forEach(e => this.closeEditor(e));
		}
	}

	public closeAllEditors(): void {

		// Optimize: close all non active editors first to produce less upstream work
		this.mru.filter(e => e !== this.active).forEach(e => this.closeEditor(e));
		this.closeEditor(this.active);
	}

	public moveEditor(editor: EditorInput, toIndex: number): void {
		const index = this.indexOf(editor);
		if (index < 0) {
			return;
		}

		// Move
		this.editors.splice(index, 1);
		this.editors.splice(toIndex, 0, editor);

		// Event
		this._onEditorMoved.fire(editor);
	}

	public setActive(editor: EditorInput): void {
		const index = this.indexOf(editor);
		if (index === -1) {
			return; // not found
		}

		if (this.matches(this.active, editor)) {
			return; // already active
		}

		this.active = editor;

		// Bring to front in MRU list
		this.setMostRecentlyUsed(editor);

		// Event
		this._onEditorActivated.fire(editor);
	}

	public pin(editor: EditorInput): void {
		if (!this.isPreview(editor)) {
			return; // can only pin a preview editor
		}

		// Convert the preview editor to be a pinned editor
		this.preview = null;

		// Event
		this._onEditorPinned.fire(editor);
	}

	public unpin(editor: EditorInput): void {
		if (!this.isPinned(editor)) {
			return; // can only unpin a pinned editor
		}

		// Set new
		const oldPreview = this.preview;
		this.preview = editor;

		// Event
		this._onEditorUnpinned.fire(editor);

		// Close old preview editor if any
		this.closeEditor(oldPreview);
	}

	public isPinned(editor: EditorInput): boolean {
		const index = this.indexOf(editor);
		if (index === -1) {
			return false; // editor not found
		}

		if (!this.preview) {
			return true; // no preview editor
		}

		return !this.matches(this.preview, editor);
	}

	private splice(index: number, del: boolean, editor?: EditorInput): void {

		// Perform on editors array
		const args: any[] = [index, del ? 1 : 0];
		if (editor) {
			args.push(editor);
		}

		const editorToDeleteOrReplace = this.editors[index];
		this.editors.splice.apply(this.editors, args);

		// Add: make it LRU editor
		if (!del && editor) {
			this.mru.push(editor);
		}

		// Remove / Replace
		else {
			const indexInMRU = this.indexOf(editorToDeleteOrReplace, this.mru);

			// Remove: remove from MRU
			if (del && !editor) {
				this.mru.splice(indexInMRU, 1);
			}

			// Replace: replace MRU at location
			else {
				this.mru.splice(indexInMRU, 1, editor);
			}
		}
	}

	private indexOf(candidate: EditorInput, editors = this.editors): number {
		if (!candidate) {
			return -1;
		}

		for (let i = 0; i < editors.length; i++) {
			if (this.matches(editors[i], candidate)) {
				return i;
			}
		}

		return -1;
	}

	private setMostRecentlyUsed(editor: EditorInput): void {
		const index = this.indexOf(editor);
		if (index === -1) {
			return; // editor not found
		}

		const mruIndex = this.indexOf(editor, this.mru);

		// Remove old index
		this.mru.splice(mruIndex, 1);

		// Set editor to front
		this.mru.unshift(editor);
	}

	private matches(editorA: EditorInput, editorB: EditorInput): boolean {
		return !!editorA && !!editorB && editorA.matches(editorB);
	}

	public serialize(): ISerializedEditorGroup {
		let registry = (<IEditorRegistry>Registry.as(Extensions.Editors));

		// Serialize all editor inputs so that we can store them.
		// Editors that cannot be serialized need to be ignored
		// from mru, active and preview if any.
		let serializableEditors: EditorInput[] = [];
		let serializedEditors: ISerializedEditorInput[] = [];
		this.editors.forEach(e => {
			let factory = registry.getEditorInputFactory(e.getId());
			if (factory) {
				let value = factory.serialize(e);
				if (typeof value === 'string') {
					serializedEditors.push({ id: e.getId(), value });
					serializableEditors.push(e);
				}
			}
		});

		const serializableMru = this.mru.filter(e => serializableEditors.indexOf(e) >= 0).map(e => serializableEditors.indexOf(e));

		return {
			label: this.label,
			editors: serializedEditors,
			mru: serializableMru,
			preview: serializableEditors.indexOf(this.preview),
		};
	}

	private deserialize(data: ISerializedEditorGroup): void {
		let registry = (<IEditorRegistry>Registry.as(Extensions.Editors));

		this._label = data.label;
		this.editors = data.editors.map(e => registry.getEditorInputFactory(e.id).deserialize(this.instantiationService, e.value));
		this.mru = data.mru.map(i => this.editors[i]);
		this.active = this.mru[0];
		this.preview = this.editors[data.preview];
	}

	public dispose(): void {
		dispose(this.toDispose);
	}
}

interface ISerializedEditorStacksModel {
	groups: ISerializedEditorGroup[];
	active: number;
}

export class EditorStacksModel implements IEditorStacksModel {

	private static STORAGE_KEY = 'editorStacks.model';

	private toDispose: IDisposable[];

	private _groups: EditorGroup[];
	private groupToIdentifier: { [id: number]: EditorGroup };
	private active: EditorGroup;

	private _onGroupOpened: Emitter<EditorGroup>;
	private _onGroupClosed: Emitter<EditorGroup>;
	private _onGroupMoved: Emitter<EditorGroup>;
	private _onGroupActivated: Emitter<EditorGroup>;

	constructor(
		@IStorageService private storageService: IStorageService,
		@ILifecycleService private lifecycleService: ILifecycleService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		this.toDispose = [];

		this._groups = [];
		this.groupToIdentifier = Object.create(null);

		this._onGroupOpened = new Emitter<EditorGroup>();
		this._onGroupClosed = new Emitter<EditorGroup>();
		this._onGroupActivated = new Emitter<EditorGroup>();
		this._onGroupMoved = new Emitter<EditorGroup>();

		this.toDispose.push(this._onGroupOpened, this._onGroupClosed, this._onGroupActivated, this._onGroupMoved);

		this.load();
		this.registerListeners();
	}

	private registerListeners(): void {
		this.toDispose.push(this.lifecycleService.onShutdown(() => this.onShutdown()));
	}

	public get onGroupOpened(): Event<EditorGroup> {
		return this._onGroupOpened.event;
	}

	public get onGroupClosed(): Event<EditorGroup> {
		return this._onGroupClosed.event;
	}

	public get onGroupActivated(): Event<EditorGroup> {
		return this._onGroupActivated.event;
	}

	public get onGroupMoved(): Event<EditorGroup> {
		return this._onGroupMoved.event;
	}

	public get groups(): EditorGroup[] {
		return this._groups.slice(0);
	}

	public get activeGroup(): EditorGroup {
		return this.active;
	}

	public getGroup(id: GroupIdentifier): EditorGroup {
		return this.groupToIdentifier[id];
	}

	public openGroup(label: string): EditorGroup {
		const group = this.instantiationService.createInstance(EditorGroup, label);

		// First group
		if (!this.active) {
			this._groups.push(group);
		}

		// Subsequent group (add to the right of active)
		else {
			this._groups.splice(this.indexOf(this.active) + 1, 0, group);
		}

		this.groupToIdentifier[group.id] = group;

		// Event
		this._onGroupOpened.fire(group);

		// Make active
		this.setActive(group);

		return group;
	}

	public closeGroup(group: EditorGroup): void {
		const index = this.indexOf(group);
		if (index < 0) {
			return; // group does not exist
		}

		// Active group closed: Find a new active one to the right
		if (group === this.active) {

			// More than one group
			if (this._groups.length > 1) {
				let newActiveGroup: EditorGroup;
				if (this._groups.length > index + 1) {
					newActiveGroup = this._groups[index + 1]; // make next group to the right active
				} else {
					newActiveGroup = this._groups[index - 1]; // make next group to the left active
				}

				this.setActive(newActiveGroup);
			}

			// One group
			else {
				this.active = null;
			}
		}

		// Close Editors in Group first and dispose then
		group.closeAllEditors();
		group.dispose();

		// Splice from groups
		this._groups.splice(index, 1);
		this.groupToIdentifier[group.id] = void 0;

		// Event
		this._onGroupClosed.fire(group);
	}

	public closeGroups(except?: EditorGroup): void {

		// Optimize: close all non active groups first to produce less upstream work
		this.groups.filter(g => g !== this.active && g !== except).forEach(g => this.closeGroup(g));

		// Close active unless configured to skip
		if (this.active !== except) {
			this.closeGroup(this.active);
		}
	}

	public setActive(group: EditorGroup): void {
		this.active = group;

		this._onGroupActivated.fire(this.active);
	}

	public moveGroup(group: EditorGroup, toIndex: number): void {
		const index = this.indexOf(group);
		if (index < 0) {
			return;
		}

		// Move
		this._groups.splice(index, 1);
		this._groups.splice(toIndex, 0, group);

		// Event
		this._onGroupMoved.fire(group);
	}

	private indexOf(group: EditorGroup): number {
		return this._groups.indexOf(group);
	}

	private save(): void {
		let activeIndex = this.indexOf(this.active);
		let activeIsEmptyGroup = false;

		let serializedGroups = this._groups.map(g => g.serialize());
		let serializableActiveIndex = activeIndex;

		// Exclude now empty groups (can happen if an editor cannot be serialized)
		let serializedNonEmptyGroups: ISerializedEditorGroup[] = [];
		serializedGroups.forEach((g, index) => {

			// non empty group
			if (g.editors.length > 0) {
				serializedNonEmptyGroups.push(g);
			}

			// empty group that is active
			else if (activeIndex === index) {
				activeIsEmptyGroup = true; // our active group is empty after serialization!
			}
		});

		serializedGroups = serializedNonEmptyGroups;

		// Determine serializable active index
		if (activeIsEmptyGroup && serializedGroups.length > 0) {
			serializableActiveIndex = 0; // just make first group active if active is empty and we have other groups to pick from
		} else if (activeIsEmptyGroup) {
			serializableActiveIndex = void 0; // there are no groups to make active
		} else {
			serializableActiveIndex = activeIndex; // active group is not empty and can be serialized
		}

		const serialized: ISerializedEditorStacksModel = {
			groups: serializedGroups,
			active: serializableActiveIndex
		};

		this.storageService.store(EditorStacksModel.STORAGE_KEY, JSON.stringify(serialized), StorageScope.WORKSPACE);
	}

	private load(): void {
		const modelRaw = this.storageService.get(EditorStacksModel.STORAGE_KEY, StorageScope.WORKSPACE);
		if (modelRaw) {
			const serialized: ISerializedEditorStacksModel = JSON.parse(modelRaw);

			this._groups = serialized.groups.map(s => this.instantiationService.createInstance(EditorGroup, s));
			this.active = this._groups[serialized.active];
			this._groups.forEach(g => this.groupToIdentifier[g.id] = g);
		}
	}

	private onShutdown(): void {
		this.save();

		dispose(this.toDispose);
	}
}