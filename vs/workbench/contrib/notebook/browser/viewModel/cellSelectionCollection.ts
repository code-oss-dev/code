/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookCommon';

function rangesEqual(a: ICellRange[], b: ICellRange[]) {
	if (a.length !== b.length) {
		return false;
	}

	for (let i = 0; i < a.length; i++) {
		if (a[i].start !== b[i].start || a[i].end !== b[i].end) {
			return false;
		}
	}

	return true;
}

// Handle first, then we migrate to ICellRange competely
// Challenge is List View talks about `element`, which needs extra work to convert to ICellRange as we support Folding and Cell Move
export class NotebookCellSelectionCollection extends Disposable {
	private readonly _onDidChangeSelection = this._register(new Emitter<string>());
	get onDidChangeSelection(): Event<string> { return this._onDidChangeSelection.event; }
	constructor() {
		super();
	}

	private _primary: ICellRange | null = null;

	private _selections: ICellRange[] = [{ start: 0, end: 0 }];

	get selections(): ICellRange[] {
		return this._selections;
	}

	get selection(): ICellRange {
		return this._selections[0];
	}

	setState(primary: ICellRange | null, selections: ICellRange[], forceEventEmit: boolean, source: 'view' | 'edit') {
		if (primary !== null) {
			const primaryRange = primary;
			// TODO@rebornix deal with overlap
			const newSelections = [primaryRange, ...selections.filter(selection => !(selection.start === primaryRange.start && selection.end === primaryRange.end)).sort((a, b) => a.start - b.start)];

			const changed = primary !== this._primary || !rangesEqual(this._selections, newSelections);
			this._primary = primary;
			this._selections = newSelections;

			if (!this._selections.length) {
				this._selections.push({ start: 0, end: 0 });
			}

			if (changed || forceEventEmit) {
				this._onDidChangeSelection.fire(source);
			}
		} else {
			const changed = primary !== this._primary || !rangesEqual(this._selections, selections);

			this._primary = primary;
			this._selections = selections;

			if (!this._selections.length) {
				this._selections.push({ start: 0, end: 0 });
			}

			if (changed || forceEventEmit) {
				this._onDidChangeSelection.fire(source);
			}
		}
	}

	setFocus(selection: ICellRange | null, forceEventEmit: boolean, source: 'view' | 'edit') {
		this.setState(selection, this._selections, forceEventEmit, source);
	}

	setSelections(selections: ICellRange[], forceEventEmit: boolean, source: 'view' | 'edit') {
		this.setState(this._primary, selections, forceEventEmit, source);
	}
}
