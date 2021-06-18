/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { ITerminalEditorService, ITerminalInstance } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalEditor } from 'vs/workbench/contrib/terminal/browser/terminalEditor';
import { TerminalEditorInput } from 'vs/workbench/contrib/terminal/browser/terminalEditorInput';
import { TerminalLocation } from 'vs/workbench/contrib/terminal/common/terminal';
import { terminalStrings } from 'vs/workbench/contrib/terminal/common/terminalStrings';
import { IEditorOverrideService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorOverrideService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export class TerminalEditorService extends Disposable implements ITerminalEditorService {
	declare _serviceBrand: undefined;

	terminalEditorInstances: ITerminalInstance[] = [];

	private _editorInputs: Map</*instanceId*/number, TerminalEditorInput> = new Map();

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorOverrideService editorOverrideService: IEditorOverrideService
	) {
		super();

		// TODO: Multiplex instance events
	}

	async createEditor(instance: ITerminalInstance): Promise<void> {
		instance.target = TerminalLocation.Editor;
		const input = new TerminalEditorInput(instance);
		this._editorInputs.set(instance.instanceId, input);
		await this._editorService.openEditor(input, {
			pinned: true,
			forceReload: true
		});
		this.terminalEditorInstances.push(instance);
	}

	detachActiveEditorInstance(): ITerminalInstance {
		const activeEditor = this._editorService.activeEditor;
		if (!(activeEditor instanceof TerminalEditorInput)) {
			throw new Error('Active editor is not a terminal');
		}
		const instance = activeEditor.terminalInstance;
		if (!instance) {
			throw new Error('Terminal is already detached');
		}
		this.detachInstance(instance);
		return instance;
	}

	detachInstance(instance: ITerminalInstance) {
		console.log('detach instance', instance);
		const editorInput = this._editorInputs.get(instance.instanceId);
		editorInput?.detachInstance();
		this._editorInputs.delete(instance.instanceId);
		const instanceIndex = this.terminalEditorInstances.findIndex(e => e === instance);
		if (instanceIndex !== -1) {
			this.terminalEditorInstances.splice(instanceIndex, 1);
		}
		console.log('dispose input', editorInput);
		editorInput?.dispose();
	}
}
