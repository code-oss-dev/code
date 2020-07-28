/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/notebook';
import 'vs/css!./media/notebookDiff';
import * as DOM from 'vs/base/browser/dom';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions } from 'vs/workbench/common/editor';
import { NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { NotebookDiffEditorInput } from './notebookDiffEditorInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IDiffResult, LcsDiff } from 'vs/base/common/diff/diff';
import { CellSequence } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookDeltaDecoration } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';


export class NotebookDiffEditor extends BaseEditor {
	static readonly ID: string = 'workbench.editor.notebookDiffEditor';

	private _rootElement!: HTMLElement;
	private _originalElement!: HTMLElement;
	private _modifiedElement!: HTMLElement;
	private _dimension?: DOM.Dimension;
	private _widget: NotebookEditorWidget | null = null;
	private _originalWidget: NotebookEditorWidget | null = null;
	private _cellDecorations: string[] = [];
	private _originalCellDecorations: string[] = [];


	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
	) {
		super(NotebookDiffEditor.ID, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._rootElement = DOM.append(parent, DOM.$('.notebook-diff-editor'));
		this._originalElement = DOM.append(this._rootElement, DOM.$('.notebook-diff-editor-original'));
		this._modifiedElement = DOM.append(this._rootElement, DOM.$('.notebook-diff-editor-modified'));
	}

	async setInput(input: NotebookDiffEditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {
		// const group = this.group!;

		await super.setInput(input, options, token);
		this._widget = this.instantiationService.createInstance(NotebookEditorWidget, { isEmbeded: true });
		this._widget.createEditor();

		this._originalWidget = this.instantiationService.createInstance(NotebookEditorWidget, { isEmbeded: true });
		this._originalWidget.createEditor();

		if (this._dimension) {
			this._widget.layout({
				width: this._dimension.width / 2,
				height: this._dimension.height
			}, this._modifiedElement);

			this._originalWidget.layout({
				width: this._dimension.width / 2,
				height: this._dimension.height
			}, this._originalElement);
		}

		const model = await input.resolve(this._widget.getId());

		if (model === null) {
			return;
		}

		await this._widget.setModel(model.modified.notebook, undefined);
		await this._originalWidget.setModel(model.original.notebook, undefined);

		this._register(this._widget.onWillScroll(e => {
			if (this._originalWidget) {
				this._originalWidget.scrollTop = e.scrollTop;
			}
		}));

		this._register(this._originalWidget.onWillScroll(e => {
			if (this._widget) {
				this._widget.scrollTop = e.scrollTop;
			}
		}));

		const diff = new LcsDiff(new CellSequence(model.original.notebook), new CellSequence(model.modified.notebook));
		const diffResult = diff.ComputeDiff(false);

		this._adjustHeight(diffResult);
	}

	private _adjustHeight(diffResult: IDiffResult) {
		if (!this._widget || !this._originalWidget) {
			return;
		}

		const originalDecorations: INotebookDeltaDecoration[] = [];
		const modifiedDecorations: INotebookDeltaDecoration[] = [];
		diffResult.changes.forEach(change => {
			const original = this._originalWidget?.textModel?.cells.slice(change.originalStart, change.originalStart + change.originalLength)
				.map(cell => cell.handle).map(handle => ({
					handle: handle,
					options: { className: 'nb-cell-deleted' }
				})) || [];

			const modified = this._widget?.textModel?.cells.slice(change.modifiedStart, change.modifiedStart + change.modifiedLength)
				.map(cell => cell.handle).map(handle => ({
					handle: handle,
					options: { className: 'nb-cell-added' }
				})) || [];

			originalDecorations.push(...original);
			modifiedDecorations.push(...modified);
		});

		this._originalCellDecorations = this._originalWidget.deltaCellDecorations(this._originalCellDecorations, originalDecorations);
		this._cellDecorations = this._widget.deltaCellDecorations(this._cellDecorations, modifiedDecorations);
	}

	getDomNode() {
		return this._rootElement;
	}

	getControl(): NotebookEditorWidget | undefined {
		return this._widget || undefined;
	}

	setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		super.setEditorVisible(visible, group);
		if (!visible) {
			if (this.input && this._widget) {
				// the widget is not transfered to other editor inputs
				this._widget.onWillHide();
			}
		}

	}

	focus() {
		super.focus();
		this._widget?.focus();
	}


	clearInput(): void {
		if (this._widget) {
			this._widget.onWillHide();
		}
		super.clearInput();
	}

	layout(dimension: DOM.Dimension): void {
		this._rootElement.classList.toggle('mid-width', dimension.width < 1000 && dimension.width >= 600);
		this._rootElement.classList.toggle('narrow-width', dimension.width < 600);
		this._dimension = dimension;

		this._widget?.layout({
			width: this._dimension.width / 2,
			height: this._dimension.height
		}, this._modifiedElement);

		this._originalWidget?.layout({
			width: this._dimension.width / 2,
			height: this._dimension.height
		}, this._originalElement);
	}

}
