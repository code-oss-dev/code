/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as monaco from './out/vs/editor/editor.main.js';

monaco.editor.create(document.getElementById('container'), {
	value: 'Hello world'
});
