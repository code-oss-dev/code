/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILogService } from 'vs/platform/log/common/log';
import { IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust';
import { SELECT_KERNEL_ID } from 'vs/workbench/contrib/notebook/browser/controller/coreActions';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, INotebookTextModel, NotebookCellExecutionState } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookExecutionService } from 'vs/workbench/contrib/notebook/common/notebookExecutionService';
import { INotebookKernel, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

export class NotebookExecutionService implements INotebookExecutionService {
	declare _serviceBrand: undefined;

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@IWorkspaceTrustRequestService private readonly _workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@ILogService private readonly _logService: ILogService,
	) {
	}

	getSelectedOrSuggestedKernel(notebook: INotebookTextModel): INotebookKernel | undefined {
		// TODO later can be inlined in notebookEditorWidget
		// returns SELECTED or the ONLY available kernel
		const info = this._notebookKernelService.getMatchingKernel(notebook);
		return info.selected ?? (info.all.length === 1 ? info.all[0] : undefined);
	}

	async executeNotebookCells(notebook: INotebookTextModel, cells: Iterable<NotebookCellTextModel>): Promise<void> {
		const cellsArr = Array.from(cells);
		this._logService.debug(`NotebookExecutionService#executeNotebookCells ${JSON.stringify(cellsArr.map(c => c.handle))}`);
		const message = nls.localize('notebookRunTrust', "Executing a notebook cell will run code from this workspace.");
		const trust = await this._workspaceTrustRequestService.requestWorkspaceTrust({ message });
		if (!trust) {
			return;
		}

		let kernel = this.getSelectedOrSuggestedKernel(notebook);
		if (!kernel) {
			await this._commandService.executeCommand(SELECT_KERNEL_ID);
			kernel = this.getSelectedOrSuggestedKernel(notebook);
		}

		if (!kernel) {
			return;
		}

		const cellHandles: number[] = [];
		for (const cell of cellsArr) {
			if (cell.cellKind !== CellKind.Code || cell.internalMetadata.runState === NotebookCellExecutionState.Pending || cell.internalMetadata.runState === NotebookCellExecutionState.Executing) {
				continue;
			}
			if (!kernel.supportedLanguages.includes(cell.language)) {
				continue;
			}
			cellHandles.push(cell.handle);
		}

		if (cellHandles.length > 0) {
			this._notebookKernelService.selectKernelForNotebook(kernel, notebook);
			await kernel.executeNotebookCellsRequest(notebook.uri, cellHandles);
		}
	}

	async cancelNotebookCellHandles(notebook: INotebookTextModel, cells: Iterable<number>): Promise<void> {
		const cellsArr = Array.from(cells);
		this._logService.debug(`NotebookExecutionService#cancelNotebookCellHandles ${JSON.stringify(cellsArr)}`);
		const kernel = this.getSelectedOrSuggestedKernel(notebook);
		if (kernel) {
			await kernel.cancelNotebookCellExecution(notebook.uri, cellsArr);
		}
	}

	async cancelNotebookCells(notebook: INotebookTextModel, cells: Iterable<NotebookCellTextModel>): Promise<void> {
		this.cancelNotebookCellHandles(notebook, Array.from(cells, cell => cell.handle));
	}
}
