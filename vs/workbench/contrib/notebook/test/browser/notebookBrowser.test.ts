/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';

/**
 * Return a set of ranges for the cells matching the given predicate
 */
function getRanges(cells: ICellViewModel[], included: (cell: ICellViewModel) => boolean): ICellRange[] {
	const ranges: ICellRange[] = [];
	let currentRange: ICellRange | undefined;

	cells.forEach((cell, idx) => {
		if (included(cell)) {
			if (!currentRange) {
				currentRange = { start: idx, end: idx + 1 };
				ranges.push(currentRange);
			} else {
				currentRange.end = idx + 1;
			}
		} else {
			currentRange = undefined;
		}
	});

	return ranges;
}


suite('notebookBrowser', () => {
	suite('getRanges', function () {
		const predicate = (cell: ICellViewModel) => cell.cellKind === CellKind.Code;

		test('all code', function () {
			const cells = [
				{ cellKind: CellKind.Code },
				{ cellKind: CellKind.Code },
			];
			assert.deepStrictEqual(getRanges(cells as ICellViewModel[], predicate), [{ start: 0, end: 2 }]);
		});

		test('none code', function () {
			const cells = [
				{ cellKind: CellKind.Markup },
				{ cellKind: CellKind.Markup },
			];
			assert.deepStrictEqual(getRanges(cells as ICellViewModel[], predicate), []);
		});

		test('start code', function () {
			const cells = [
				{ cellKind: CellKind.Code },
				{ cellKind: CellKind.Markup },
			];
			assert.deepStrictEqual(getRanges(cells as ICellViewModel[], predicate), [{ start: 0, end: 1 }]);
		});

		test('random', function () {
			const cells = [
				{ cellKind: CellKind.Code },
				{ cellKind: CellKind.Code },
				{ cellKind: CellKind.Markup },
				{ cellKind: CellKind.Code },
				{ cellKind: CellKind.Markup },
				{ cellKind: CellKind.Markup },
				{ cellKind: CellKind.Code },
			];
			assert.deepStrictEqual(getRanges(cells as ICellViewModel[], predicate), [{ start: 0, end: 2 }, { start: 3, end: 4 }, { start: 6, end: 7 }]);
		});
	});
});
