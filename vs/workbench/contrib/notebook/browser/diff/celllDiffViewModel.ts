/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookDiffEditorEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { CellDiffViewModelLayoutChangeEvent, DIFF_CELL_MARGIN } from 'vs/workbench/contrib/notebook/browser/diff/common';
import { NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { DiffEditorWidget } from 'vs/editor/browser/widget/diffEditorWidget';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { hash } from 'vs/base/common/hash';
import { format } from 'vs/base/common/jsonFormatter';
import { applyEdits } from 'vs/base/common/jsonEdit';
import { NotebookCellMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';

export enum PropertyFoldingState {
	Expanded,
	Collapsed
}

export abstract class CellDiffViewModelBase extends Disposable {
	public metadataFoldingState: PropertyFoldingState;
	public outputFoldingState: PropertyFoldingState;
	protected _layoutInfoEmitter = new Emitter<CellDiffViewModelLayoutChangeEvent>();
	onDidLayoutChange = this._layoutInfoEmitter.event;

	protected _layoutInfo!: {
		editorHeight: number;
		editorMargin: number;
		metadataStatusHeight: number;
		metadataHeight: number;
		outputStatusHeight: number;
		outputHeight: number;
		bodyMargin: number;
	};

	protected _outputCollection: number[] = [];
	protected _outputsTop: PrefixSumComputer | null = null;

	set outputHeight(height: number) {
		this._layoutInfo.outputHeight = height;
		this._fireLayoutChangeEvent({ outputEditor: true, outputView: true });
	}

	get outputHeight() {
		return this._layoutInfo.outputHeight;
	}

	set outputStatusHeight(height: number) {
		this._layoutInfo.outputStatusHeight = height;
		this._fireLayoutChangeEvent({});
	}

	get outputStatusHeight() {
		return this._layoutInfo.outputStatusHeight;
	}

	set editorHeight(height: number) {
		this._layoutInfo.editorHeight = height;
		this._fireLayoutChangeEvent({ editorHeight: true });
	}

	get editorHeight() {
		return this._layoutInfo.editorHeight;
	}

	set editorMargin(height: number) {
		this._layoutInfo.editorMargin = height;
		this._fireLayoutChangeEvent({});
	}

	get editorMargin() {
		return this._layoutInfo.editorMargin;
	}

	get metadataStatusHeight() {
		return this._layoutInfo.metadataStatusHeight;
	}

	set metadataHeight(height: number) {
		this._layoutInfo.metadataHeight = height;
		this._fireLayoutChangeEvent({ metadataEditor: true });
	}

	get metadataHeight() {
		return this._layoutInfo.metadataHeight;
	}

	get totalHeight() {
		return this._layoutInfo.editorHeight
			+ this._layoutInfo.editorMargin
			+ this._layoutInfo.metadataHeight
			+ this._layoutInfo.metadataStatusHeight
			+ this._layoutInfo.outputHeight
			+ this._layoutInfo.outputStatusHeight
			+ this._layoutInfo.bodyMargin;
	}

	constructor(
		readonly documentTextModel: NotebookTextModel,
		readonly original: NotebookCellTextModel | undefined,
		readonly modified: NotebookCellTextModel | undefined,
		readonly type: 'unchanged' | 'insert' | 'delete' | 'modified',
		readonly editorEventDispatcher: NotebookDiffEditorEventDispatcher
	) {
		super();
		this._layoutInfo = {
			editorHeight: 0,
			editorMargin: 0,
			metadataHeight: 0,
			metadataStatusHeight: 25,
			outputHeight: 0,
			outputStatusHeight: 25,
			bodyMargin: 32
		};


		this.metadataFoldingState = PropertyFoldingState.Collapsed;
		this.outputFoldingState = PropertyFoldingState.Collapsed;

		this._register(this.editorEventDispatcher.onDidChangeLayout(e => {
			this._layoutInfoEmitter.fire({ outerWidth: true });
		}));
	}

	private _fireLayoutChangeEvent(state: { outerWidth?: boolean, editorHeight?: boolean, metadataEditor?: boolean, outputEditor?: boolean, outputView?: boolean }) {
		this._layoutInfoEmitter.fire(state);
	}

	abstract checkIfOutputsModified(): boolean;
	abstract checkMetadataIfModified(): boolean;


	getComputedCellContainerWidth(layoutInfo: NotebookLayoutInfo, diffEditor: boolean, fullWidth: boolean) {
		if (fullWidth) {
			return layoutInfo.width - 2 * DIFF_CELL_MARGIN + (diffEditor ? DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH : 0) - 2;
		}

		return (layoutInfo.width - 2 * DIFF_CELL_MARGIN + (diffEditor ? DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH : 0)) / 2 - 18 - 2;
	}
}

export class SideBySideCellDiffViewModel extends CellDiffViewModelBase {
	constructor(
		readonly documentTextModel: NotebookTextModel,
		readonly original: NotebookCellTextModel | undefined,
		readonly modified: NotebookCellTextModel | undefined,
		readonly type: 'unchanged' | 'modified',
		readonly editorEventDispatcher: NotebookDiffEditorEventDispatcher
	) {
		super(
			documentTextModel,
			original,
			modified,
			type,
			editorEventDispatcher);

		this.metadataFoldingState = PropertyFoldingState.Collapsed;
		this.outputFoldingState = PropertyFoldingState.Collapsed;

		if (this.checkMetadataIfModified()) {
			this.metadataFoldingState = PropertyFoldingState.Expanded;
		}

		if (this.checkIfOutputsModified()) {
			this.outputFoldingState = PropertyFoldingState.Expanded;
		}
	}

	checkIfOutputsModified() {
		return !this.documentTextModel.transientOptions.transientOutputs && this.type === 'modified' && hash(this.original?.outputs ?? []) !== hash(this.modified?.outputs ?? []);
	}

	checkMetadataIfModified(): boolean {
		return hash(getFormatedMetadataJSON(this.documentTextModel, this.original?.metadata || {}, this.original?.language)) !== hash(getFormatedMetadataJSON(this.documentTextModel, this.modified?.metadata ?? {}, this.modified?.language));
	}
}

export class SingleSideCellDiffViewModel extends CellDiffViewModelBase {
	constructor(
		readonly documentTextModel: NotebookTextModel,
		readonly original: NotebookCellTextModel | undefined,
		readonly modified: NotebookCellTextModel | undefined,
		readonly type: 'insert' | 'delete',
		readonly editorEventDispatcher: NotebookDiffEditorEventDispatcher
	) {
		super(documentTextModel, original, modified, type, editorEventDispatcher);
	}

	checkIfOutputsModified(): boolean {
		return false;
	}

	checkMetadataIfModified(): boolean {
		return false;
	}
}

export function getFormatedMetadataJSON(documentTextModel: NotebookTextModel, metadata: NotebookCellMetadata, language?: string) {
	let filteredMetadata: { [key: string]: any } = {};

	if (documentTextModel) {
		const transientMetadata = documentTextModel.transientOptions.transientMetadata;

		const keys = new Set([...Object.keys(metadata)]);
		for (let key of keys) {
			if (!(transientMetadata[key as keyof NotebookCellMetadata])
			) {
				filteredMetadata[key] = metadata[key as keyof NotebookCellMetadata];
			}
		}
	} else {
		filteredMetadata = metadata;
	}

	const content = JSON.stringify({
		language,
		...filteredMetadata
	});

	const edits = format(content, undefined, {});
	const metadataSource = applyEdits(content, edits);

	return metadataSource;
}
