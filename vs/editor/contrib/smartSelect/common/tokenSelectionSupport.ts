/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import {TPromise} from 'vs/base/common/winjs.base';
import tokenTree = require('./tokenTree');
import * as EditorCommon from 'vs/editor/common/editorCommon';
import * as Modes from 'vs/editor/common/modes';
import {IModelService} from 'vs/editor/common/services/modelService';
import {Range} from 'vs/editor/common/core/range';

class TokenSelectionSupport implements Modes.ILogicalSelectionSupport {

	private _modelService: IModelService;

	constructor(@IModelService modelService: IModelService) {
		this._modelService = modelService;
	}

	public getRangesToPosition(resource: URI, position: EditorCommon.IPosition): TPromise<Modes.ILogicalSelectionEntry[]> {
		return TPromise.as(this.getRangesToPositionSync(resource, position));
	}

	public getRangesToPositionSync(resource: URI, position: EditorCommon.IPosition): Modes.ILogicalSelectionEntry[] {
		var model = this._modelService.getModel(resource),
			entries: Modes.ILogicalSelectionEntry[] = [];

		if (model) {
			this._doGetRangesToPosition(model, position).forEach(range => {
				entries.push({
					type: void 0,
					range
				});
			});
		}

		return entries;
	}

	private _doGetRangesToPosition(model: EditorCommon.IModel, position: EditorCommon.IPosition): EditorCommon.IRange[] {

		var tree = tokenTree.build(model),
			node: tokenTree.Node,
			lastRange: EditorCommon.IRange;

		node = tokenTree.find(tree, position);
		var ranges: EditorCommon.IRange[] = [];
		while (node) {
			if (!lastRange || !Range.equalsRange(lastRange, node.range)) {
				ranges.push(node.range);
			}
			lastRange = node.range;
			node = node.parent;
		}
		ranges = ranges.reverse();
		return ranges;
	}

}

export = TokenSelectionSupport;