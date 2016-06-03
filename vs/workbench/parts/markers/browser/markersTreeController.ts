/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as errors from 'vs/base/common/errors';
import mouse = require('vs/base/browser/mouseEvent');
import keyboard = require('vs/base/browser/keyboardEvent');
import tree = require('vs/base/parts/tree/browser/tree');
import treedefaults = require('vs/base/parts/tree/browser/treeDefaults');
import { Marker } from 'vs/workbench/parts/markers/common/markersModel';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IMarker } from 'vs/platform/markers/common/markers';

export class Controller extends treedefaults.DefaultController {

	constructor(@IWorkbenchEditorService private editorService: IWorkbenchEditorService) {
		super();
	}

	protected onLeftClick(tree: tree.ITree, element: any, event: mouse.IMouseEvent): boolean {
		if (super.onLeftClick(tree, element, event)) {
			return this.openFileAtElement(element);
		}
		return false;
	}

	protected onEnter(tree: tree.ITree, event: keyboard.IKeyboardEvent): boolean {
		if (super.onEnter(tree, event)) {
			return this.openFileAtElement(tree.getFocus());
		}
		return false;
	}

	private openFileAtElement(element: any) {
		if (element instanceof Marker) {
			let marker = <IMarker>element.marker;
			this.editorService.openEditor({
				resource: marker.resource,
				options: {
					selection: {
						startLineNumber: marker.startLineNumber,
						startColumn: marker.startColumn,
						endLineNumber: marker.endLineNumber,
						endColumn: marker.endColumn
					}
				}
			}).done(null, errors.onUnexpectedError);
			return true;
		}
		return false;
	}
}
