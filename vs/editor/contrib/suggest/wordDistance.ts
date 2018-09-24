/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { binarySearch, isFalsyOrEmpty } from 'vs/base/common/arrays';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { IPosition } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';


export abstract class WordDistance {

	static readonly None = new class extends WordDistance {
		distance() { return 0; }
	};

	static create(service: IEditorWorkerService, editor: ICodeEditor): Thenable<WordDistance> {

		const model = editor.getModel();
		const position = editor.getPosition();
		const range = new Range(Math.max(1, position.lineNumber - 100), 1, Math.min(model.getLineCount() - 1, position.lineNumber + 100), 1);

		return service.computeWordLines(model.uri, range).then(lineNumbers => {

			return new class extends WordDistance {
				distance(anchor: IPosition, word: string) {
					if (!lineNumbers || !position.equals(editor.getPosition())) {
						return 0;
					}
					let wordLines = lineNumbers[word];
					if (isFalsyOrEmpty(wordLines)) {
						return 101;
					}
					let idx = binarySearch(wordLines, anchor.lineNumber, (a, b) => a - b);
					if (idx >= 0) {
						return 0;
					} else {
						idx = Math.max(0, ~idx - 1);
						return Math.abs(wordLines[idx] - anchor.lineNumber);
					}
				}
			};
		});
	}

	abstract distance(anchor: IPosition, word: string): number;
}


