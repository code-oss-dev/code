/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { ICellViewModel, INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellViewModelStateChangeEvent } from 'vs/workbench/contrib/notebook/browser/notebookViewEvents';
import { CellPart } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellPart';
import { BaseCellRenderTemplate } from 'vs/workbench/contrib/notebook/browser/view/notebookRenderingCommon';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';

export class CellFocusPart extends CellPart {
	private currentCell: ICellViewModel | undefined;

	constructor(
		containerElement: HTMLElement,
		focusSinkElement: HTMLElement | undefined,
		notebookEditor: INotebookEditor
	) {
		super();

		this._register(DOM.addDisposableListener(containerElement, DOM.EventType.FOCUS, () => {
			if (this.currentCell) {
				notebookEditor.focusElement(this.currentCell);
			}
		}, true));

		if (focusSinkElement) {
			this._register(DOM.addDisposableListener(focusSinkElement, DOM.EventType.FOCUS, () => {
				if (this.currentCell && (this.currentCell as CodeCellViewModel).outputsViewModels.length) {
					notebookEditor.focusNotebookCell(this.currentCell, 'output');
				}
			}));
		}
	}

	renderCell(element: ICellViewModel, templateData: BaseCellRenderTemplate): void {
		this.currentCell = element;
	}

	override unrenderCell(element: ICellViewModel, templateData: BaseCellRenderTemplate): void {
		this.currentCell = undefined;
	}

	prepareLayout(): void {
	}

	updateInternalLayoutNow(element: ICellViewModel): void {
	}

	updateState(element: ICellViewModel, e: CellViewModelStateChangeEvent): void {
	}
}
