/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from 'vs/workbench/common/editor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { Registry } from 'vs/platform/registry/common/platform';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { IConstructorSignature0, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { isArray } from 'vs/base/common/types';

export interface IEditorDescriptor {
	instantiate(instantiationService: IInstantiationService): BaseEditor;

	getId(): string;
	getName(): string;

	describes(obj: unknown): boolean;
}

export interface IEditorRegistry {

	/**
	 * Registers an editor to the platform for the given input type. The second parameter also supports an
	 * array of input classes to be passed in. If the more than one editor is registered for the same editor
	 * input, the input itself will be asked which editor it prefers if this method is provided. Otherwise
	 * the first editor in the list will be returned.
	 *
	 * @param editorInputDescriptor a constructor function that returns an instance of EditorInput for which the
	 * registered editor should be used for.
	 */
	registerEditor(descriptor: IEditorDescriptor, editorInputDescriptor: SyncDescriptor<EditorInput>): void;
	registerEditor(descriptor: IEditorDescriptor, editorInputDescriptor: SyncDescriptor<EditorInput>[]): void;

	/**
	 * Returns the editor descriptor for the given input or `undefined` if none.
	 */
	getEditor(input: EditorInput): IEditorDescriptor | undefined;

	/**
	 * Returns the editor descriptor for the given identifier or null if none.
	 */
	getEditorById(editorId: string): IEditorDescriptor | undefined;

	/**
	 * Returns an array of registered editors known to the platform.
	 */
	getEditors(): IEditorDescriptor[];
}

/**
 * A lightweight descriptor of an editor. The descriptor is deferred so that heavy editors
 * can load lazily in the workbench.
 */
export class EditorDescriptor implements IEditorDescriptor {
	private ctor: IConstructorSignature0<BaseEditor>;
	private id: string;
	private name: string;

	constructor(ctor: IConstructorSignature0<BaseEditor>, id: string, name: string) {
		this.ctor = ctor;
		this.id = id;
		this.name = name;
	}

	instantiate(instantiationService: IInstantiationService): BaseEditor {
		return instantiationService.createInstance(this.ctor);
	}

	getId(): string {
		return this.id;
	}

	getName(): string {
		return this.name;
	}

	describes(obj: unknown): boolean {
		return obj instanceof BaseEditor && obj.getId() === this.id;
	}
}

class EditorRegistry implements IEditorRegistry {

	private editors: EditorDescriptor[] = [];
	private readonly mapEditorToInputs = new Map<EditorDescriptor, SyncDescriptor<EditorInput>[]>();

	registerEditor(descriptor: EditorDescriptor, editorInputDescriptor: SyncDescriptor<EditorInput>): void;
	registerEditor(descriptor: EditorDescriptor, editorInputDescriptor: SyncDescriptor<EditorInput>[]): void;
	registerEditor(descriptor: EditorDescriptor, editorInputDescriptor: SyncDescriptor<EditorInput> | SyncDescriptor<EditorInput>[]): void {

		// Support both non-array and array parameter
		let inputDescriptors: SyncDescriptor<EditorInput>[] = [];
		if (!isArray(editorInputDescriptor)) {
			inputDescriptors.push(editorInputDescriptor);
		} else {
			inputDescriptors = editorInputDescriptor;
		}

		// Register (Support multiple Editors per Input)
		this.mapEditorToInputs.set(descriptor, inputDescriptors);

		this.editors.push(descriptor);
	}

	getEditor(input: EditorInput): EditorDescriptor | undefined {
		const findEditorDescriptors = (input: EditorInput, byInstanceOf?: boolean): EditorDescriptor[] => {
			const matchingDescriptors: EditorDescriptor[] = [];

			for (const editor of this.editors) {
				const inputDescriptors = this.mapEditorToInputs.get(editor);
				if (inputDescriptors) {
					for (const inputDescriptor of inputDescriptors) {
						const inputClass = inputDescriptor.ctor;

						// Direct check on constructor type (ignores prototype chain)
						if (!byInstanceOf && input.constructor === inputClass) {
							matchingDescriptors.push(editor);
							break;
						}

						// Normal instanceof check
						else if (byInstanceOf && input instanceof inputClass) {
							matchingDescriptors.push(editor);
							break;
						}
					}
				}
			}

			// If no descriptors found, continue search using instanceof and prototype chain
			if (!byInstanceOf && matchingDescriptors.length === 0) {
				return findEditorDescriptors(input, true);
			}

			if (byInstanceOf) {
				return matchingDescriptors;
			}

			return matchingDescriptors;
		};

		const descriptors = findEditorDescriptors(input);
		if (descriptors && descriptors.length > 0) {

			// Ask the input for its preferred Editor
			const preferredEditorId = input.getPreferredEditorId(descriptors.map(d => d.getId()));
			if (preferredEditorId) {
				return this.getEditorById(preferredEditorId);
			}

			// Otherwise, first come first serve
			return descriptors[0];
		}

		return undefined;
	}

	getEditorById(editorId: string): EditorDescriptor | undefined {
		for (const editor of this.editors) {
			if (editor.getId() === editorId) {
				return editor;
			}
		}

		return undefined;
	}

	getEditors(): EditorDescriptor[] {
		return this.editors.slice(0);
	}

	setEditors(editorsToSet: EditorDescriptor[]): void {
		this.editors = editorsToSet;
	}

	getEditorInputs(): SyncDescriptor<EditorInput>[] {
		const inputClasses: SyncDescriptor<EditorInput>[] = [];
		for (const editor of this.editors) {
			const editorInputDescriptors: SyncDescriptor<EditorInput>[] | undefined = this.mapEditorToInputs.get(editor);
			if (editorInputDescriptors) {
				inputClasses.push(...editorInputDescriptors.map(descriptor => descriptor.ctor));
			}
		}

		return inputClasses;
	}
}

export const Extensions = {
	Editors: 'workbench.contributions.editors'
};

Registry.add(Extensions.Editors, new EditorRegistry());