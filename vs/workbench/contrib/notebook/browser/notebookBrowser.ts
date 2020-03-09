/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookCellViewModel';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { IOutput, CellKind, IRenderOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { NotebookViewModel, IModelDecorationsChangeAccessor } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { FindMatch } from 'vs/editor/common/model';

export const KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED = new RawContextKey<boolean>('notebookFindWidgetFocused', false);

export interface NotebookLayoutInfo {
	width: number;
	height: number;
	fontInfo: BareFontInfo;
}

export interface INotebookEditor {

	/**
	 * Notebook view model attached to the current editor
	 */
	viewModel: NotebookViewModel | undefined;

	/**
	 * Focus the notebook editor cell list
	 */
	focus(): void;

	/**
	 * Layout info for the notebook editor
	 */
	getLayoutInfo(): NotebookLayoutInfo;
	/**
	 * Fetch the output renderers for notebook outputs.
	 */
	getOutputRenderer(): OutputRenderer;

	/**
	 * Insert a new cell around `cell`
	 */
	insertEmptyNotebookCell(cell: CellViewModel, type: CellKind, direction: 'above' | 'below'): Promise<void>;

	/**
	 * Delete a cell from the notebook
	 */
	deleteNotebookCell(cell: CellViewModel): void;

	/**
	 * Switch the cell into editing mode.
	 *
	 * For code cell, the monaco editor will be focused.
	 * For markdown cell, it will switch from preview mode to editing mode, which focuses the monaco editor.
	 */
	editNotebookCell(cell: CellViewModel): void;

	/**
	 * Quit cell editing mode.
	 */
	saveNotebookCell(cell: CellViewModel): void;

	/**
	 * Focus the container of a cell (the monaco editor inside is not focused).
	 */
	focusNotebookCell(cell: CellViewModel, focusEditor: boolean): void;

	/**
	 * Get current active cell
	 */
	getActiveCell(): CellViewModel | undefined;

	/**
	 * Layout the cell with a new height
	 */
	layoutNotebookCell(cell: CellViewModel, height: number): void;

	/**
	 * Render the output in webview layer
	 */
	createInset(cell: CellViewModel, output: IOutput, shadowContent: string, offset: number): void;

	/**
	 * Remove the output from the webview layer
	 */
	removeInset(output: IOutput): void;

	/**
	 * Trigger the editor to scroll from scroll event programmatically
	 */
	triggerScroll(event: IMouseWheelEvent): void;

	/**
	 * Reveal cell into viewport.
	 * If `offset` is provided, `top(cell) + offset` will be scrolled into view.
	 */
	revealInView(cell: CellViewModel, offset?: number): void;

	/**
	 * Reveal cell into viewport center.
	 * If `offset` is provided, `top(cell) + offset` will be scrolled into view.
	 */
	revealInCenter(cell: CellViewModel, offset?: number): void;

	/**
	 * Reveal cell into viewport center if cell is currently out of the viewport.
	 * If `offset` is provided, `top(cell) + offset` will be scrolled into view.
	 */
	revealInCenterIfOutsideViewport(cell: CellViewModel, offset?: number): void;

	/**
	 * Reveal a line in notebook cell into viewport center.
	 * If `offset` is provided, `top(cell) + offset` will be scrolled into view.
	 */
	revealLineInCenter(cell: CellViewModel, line: number): void;

	/**
	 * Reveal a line in notebook cell into viewport center.
	 * If `offset` is provided, `top(cell) + offset` will be scrolled into view.
	 */
	revealLineInCenterIfOutsideViewport(cell: CellViewModel, line: number): void;

	/**
	 * Change the decorations on cells.
	 * The notebook is virtualized and this method should be called to create/delete editor decorations safely.
	 */
	changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any;

	/**
	 * Show Find Widget.
	 *
	 * Currently Find is still part of the NotebookEditor core
	 */
	showFind(): void;

	/**
	 * Hide Find Widget
	 */
	hideFind(): void;
}

export interface CellRenderTemplate {
	container: HTMLElement;
	cellContainer: HTMLElement;
	menuContainer?: HTMLElement;
	editingContainer?: HTMLElement;
	outputContainer?: HTMLElement;
	editor?: CodeEditorWidget;
}

export interface IOutputTransformContribution {
	/**
	 * Dispose this contribution.
	 */
	dispose(): void;

	render(output: IOutput, container: HTMLElement, preferredMimeType: string | undefined): IRenderOutput;
}

export interface CellFindMatch {
	cell: CellViewModel;
	matches: FindMatch[];
}

