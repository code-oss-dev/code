/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInsetRenderOutput, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { DiffElementViewModelBase } from 'vs/workbench/contrib/notebook/browser/diff/diffElementViewModel';
import { Event } from 'vs/base/common/event';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { DiffEditorWidget } from 'vs/editor/browser/widget/diffEditorWidget';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';

export interface INotebookTextDiffEditor {
	readonly textModel?: NotebookTextModel;
	onMouseUp: Event<{ readonly event: MouseEvent; readonly target: DiffElementViewModelBase; }>;
	getOverflowContainerDomNode(): HTMLElement;
	getLayoutInfo(): NotebookLayoutInfo;
	layoutNotebookCell(cell: DiffElementViewModelBase, height: number): void;
	getOutputRenderer(): OutputRenderer;
	createInset(cellDiffViewModel: DiffElementViewModelBase, cellViewModel: IDiffNestedCellViewModel, output: IInsetRenderOutput, offset: number, rightEditor: boolean): void;
}

export interface IDiffNestedCellViewModel {

}

export interface CellDiffSingleSideRenderTemplate {
	readonly container: HTMLElement;
	readonly body: HTMLElement;
	readonly diffEditorContainer: HTMLElement;
	readonly diagonalFill: HTMLElement;
	readonly elementDisposables: DisposableStore;
	readonly sourceEditor: CodeEditorWidget;
	readonly metadataHeaderContainer: HTMLElement;
	readonly metadataInfoContainer: HTMLElement;
	readonly outputHeaderContainer: HTMLElement;
	readonly outputInfoContainer: HTMLElement;
}


export interface CellDiffSideBySideRenderTemplate {
	readonly container: HTMLElement;
	readonly body: HTMLElement;
	readonly diffEditorContainer: HTMLElement;
	readonly elementDisposables: DisposableStore;
	readonly sourceEditor: DiffEditorWidget;
	readonly editorContainer: HTMLElement;
	readonly inputToolbarContainer: HTMLElement;
	readonly toolbar: ToolBar;
	readonly metadataHeaderContainer: HTMLElement;
	readonly metadataInfoContainer: HTMLElement;
	readonly outputHeaderContainer: HTMLElement;
	readonly outputInfoContainer: HTMLElement;
}

export interface CellDiffViewModelLayoutChangeEvent {
	font?: BareFontInfo;
	outerWidth?: boolean;
	editorHeight?: boolean;
	metadataEditor?: boolean;
	outputEditor?: boolean;
	outputView?: boolean;
}

export const DIFF_CELL_MARGIN = 16;
