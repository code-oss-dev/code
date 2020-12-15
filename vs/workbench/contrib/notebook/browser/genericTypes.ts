/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { ICellOutputViewModel, IDisplayOutputViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export interface IGenericCellViewModel {
	id: string;
	handle: number;
	uri: URI;
	metadata: NotebookCellMetadata;
	outputIsHovered: boolean;
	outputsViewModels: ICellOutputViewModel[];
	getOutputOffset(index: number): number;
	updateOutputHeight(index: number, height: number): void;
}

export interface IDisplayOutputLayoutUpdateRequest {
	output: IDisplayOutputViewModel;
	cellTop: number;
	outputOffset: number;
}

export interface ICommonCellInfo {
	cellId: string;
	cellHandle: number;
	cellUri: URI;
}
