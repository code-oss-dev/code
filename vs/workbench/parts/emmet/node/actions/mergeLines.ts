/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import nls = require('vs/nls');
import {BasicEmmetEditorAction} from 'vs/workbench/parts/emmet/node/emmetActions';

import {editorAction} from 'vs/editor/common/editorCommonExtensions';

@editorAction
class MergeLinesAction extends BasicEmmetEditorAction {
	constructor() {
		super(
			'editor.emmet.action.mergeLines',
			nls.localize('mergeLines', "Emmet: Merge Lines"),
			'Emmet: Merge Lines',
			'merge_lines'
		);
	}
}
