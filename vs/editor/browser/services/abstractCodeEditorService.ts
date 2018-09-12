/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Event, Emitter } from 'vs/base/common/event';
import { IDecorationRenderOptions } from 'vs/editor/common/editorCommon';
import { IModelDecorationOptions, ITextModel } from 'vs/editor/common/model';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { ICodeEditor, IDiffEditor } from 'vs/editor/browser/editorBrowser';
import { IResourceInput } from 'vs/platform/editor/common/editor';
import { TPromise } from 'vs/base/common/winjs.base';
import { Disposable } from 'vs/base/common/lifecycle';

export abstract class AbstractCodeEditorService extends Disposable implements ICodeEditorService {

	_serviceBrand: any;

	private readonly _onCodeEditorAdd: Emitter<ICodeEditor> = this._register(new Emitter<ICodeEditor>());
	public readonly onCodeEditorAdd: Event<ICodeEditor> = this._onCodeEditorAdd.event;

	private readonly _onCodeEditorRemove: Emitter<ICodeEditor> = this._register(new Emitter<ICodeEditor>());
	public readonly onCodeEditorRemove: Event<ICodeEditor> = this._onCodeEditorRemove.event;

	private readonly _onDiffEditorAdd: Emitter<IDiffEditor> = this._register(new Emitter<IDiffEditor>());
	public readonly onDiffEditorAdd: Event<IDiffEditor> = this._onDiffEditorAdd.event;

	private readonly _onDiffEditorRemove: Emitter<IDiffEditor> = this._register(new Emitter<IDiffEditor>());
	public readonly onDiffEditorRemove: Event<IDiffEditor> = this._onDiffEditorRemove.event;


	private _codeEditors: { [editorId: string]: ICodeEditor; };
	private _diffEditors: { [editorId: string]: IDiffEditor; };

	constructor() {
		super();
		this._codeEditors = Object.create(null);
		this._diffEditors = Object.create(null);
	}

	addCodeEditor(editor: ICodeEditor): void {
		this._codeEditors[editor.getId()] = editor;
		this._onCodeEditorAdd.fire(editor);
	}

	removeCodeEditor(editor: ICodeEditor): void {
		if (delete this._codeEditors[editor.getId()]) {
			this._onCodeEditorRemove.fire(editor);
		}
	}

	listCodeEditors(): ICodeEditor[] {
		return Object.keys(this._codeEditors).map(id => this._codeEditors[id]);
	}

	addDiffEditor(editor: IDiffEditor): void {
		this._diffEditors[editor.getId()] = editor;
		this._onDiffEditorAdd.fire(editor);
	}

	removeDiffEditor(editor: IDiffEditor): void {
		if (delete this._diffEditors[editor.getId()]) {
			this._onDiffEditorRemove.fire(editor);
		}
	}

	listDiffEditors(): IDiffEditor[] {
		return Object.keys(this._diffEditors).map(id => this._diffEditors[id]);
	}

	getFocusedCodeEditor(): ICodeEditor {
		let editorWithWidgetFocus: ICodeEditor = null;

		let editors = this.listCodeEditors();
		for (let i = 0; i < editors.length; i++) {
			let editor = editors[i];

			if (editor.hasTextFocus()) {
				// bingo!
				return editor;
			}

			if (editor.hasWidgetFocus()) {
				editorWithWidgetFocus = editor;
			}
		}

		return editorWithWidgetFocus;
	}

	abstract registerDecorationType(key: string, options: IDecorationRenderOptions, parentTypeKey?: string): void;
	abstract removeDecorationType(key: string): void;
	abstract resolveDecorationOptions(decorationTypeKey: string, writable: boolean): IModelDecorationOptions;

	private _transientWatchers: { [uri: string]: ModelTransientSettingWatcher; } = {};

	public setTransientModelProperty(model: ITextModel, key: string, value: any): void {
		const uri = model.uri.toString();

		let w: ModelTransientSettingWatcher;
		if (this._transientWatchers.hasOwnProperty(uri)) {
			w = this._transientWatchers[uri];
		} else {
			w = new ModelTransientSettingWatcher(uri, model, this);
			this._transientWatchers[uri] = w;
		}

		w.set(key, value);
	}

	public getTransientModelProperty(model: ITextModel, key: string): any {
		const uri = model.uri.toString();

		if (!this._transientWatchers.hasOwnProperty(uri)) {
			return undefined;
		}

		return this._transientWatchers[uri].get(key);
	}

	_removeWatcher(w: ModelTransientSettingWatcher): void {
		delete this._transientWatchers[w.uri];
	}

	abstract getActiveCodeEditor(): ICodeEditor;
	abstract openCodeEditor(input: IResourceInput, source: ICodeEditor, sideBySide?: boolean): TPromise<ICodeEditor>;
}

export class ModelTransientSettingWatcher {
	public readonly uri: string;
	private readonly _values: { [key: string]: any; };

	constructor(uri: string, model: ITextModel, owner: AbstractCodeEditorService) {
		this.uri = uri;
		this._values = {};
		model.onWillDispose(() => owner._removeWatcher(this));
	}

	public set(key: string, value: any): void {
		this._values[key] = value;
	}

	public get(key: string): any {
		return this._values[key];
	}
}
