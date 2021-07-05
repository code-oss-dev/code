/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { TextModel } from 'vs/editor/common/model/textModel';
import { LineInjectedText, ModelRawChange, RawContentChangedType } from 'vs/editor/common/model/textModelEvents';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

suite('Editor Model - Injected Text Events', () => {
	let thisModel: TextModel;

	setup(() => {
		thisModel = createTextModel('First Line\nSecond Line');
	});

	teardown(() => {
		thisModel.dispose();
	});

	test('Basic', () => {
		const recordedChanges = new Array<unknown>();

		thisModel.onDidChangeContentOrInjectedText((e) => {
			for (const change of e.changes) {
				recordedChanges.push(mapChange(change));
			}
		});

		// Initial decoration
		let decorations = thisModel.deltaDecorations([], [{
			options: {
				after: { content: 'injected1' },
				description: 'test1',
			},
			range: new Range(1, 1, 1, 1),
		}]);
		assert.deepStrictEqual(recordedChanges.splice(0), [
			{
				kind: 'lineChanged',
				line: '[injected1]First Line',
				lineNumber: 1,
			}
		]);

		// Decoration change
		decorations = thisModel.deltaDecorations(decorations, [{
			options: {
				after: { content: 'injected1' },
				description: 'test1',
			},
			range: new Range(2, 1, 2, 1),
		}, {
			options: {
				after: { content: 'injected2' },
				description: 'test2',
			},
			range: new Range(2, 2, 2, 2),
		}]);
		assert.deepStrictEqual(recordedChanges.splice(0), [
			{
				kind: 'lineChanged',
				line: 'First Line',
				lineNumber: 1,
			},
			{
				kind: 'lineChanged',
				line: '[injected1]S[injected2]econd Line',
				lineNumber: 2,
			}
		]);

		// Simple Insert
		thisModel.applyEdits([EditOperation.replace(new Range(2, 2, 2, 2), 'Hello')]);
		assert.deepStrictEqual(recordedChanges.splice(0), [
			{
				kind: 'lineChanged',
				line: '[injected1]SHello[injected2]econd Line',
				lineNumber: 2,
			}
		]);

		// Multi-Line Insert
		thisModel.pushEditOperations(null, [EditOperation.replace(new Range(2, 2, 2, 2), '\n\n\n')], null);
		assert.deepStrictEqual(thisModel.getAllDecorations(undefined).map(d => ({ description: d.options.description, range: d.range.toString() })), [{
			'description': 'test1',
			'range': '[2,1 -> 2,1]'
		},
		{
			'description': 'test2',
			'range': '[2,2 -> 5,6]'
		}]);
		assert.deepStrictEqual(recordedChanges.splice(0), [
			{
				kind: 'lineChanged',
				line: '[injected1]S',
				lineNumber: 2,
			},
			{
				fromLineNumber: 3,
				kind: 'linesInserted',
				lines: [
					'',
					'',
					'Hello[injected2]econd Line',
				]
			}
		]);


		// Multi-Line Replace
		thisModel.pushEditOperations(null, [EditOperation.replace(new Range(3, 1, 5, 1), '\n\n\n\n\n\n\n\n\n\n\n\n\n')], null);
		assert.deepStrictEqual(recordedChanges.splice(0), [
			{
				'kind': 'lineChanged',
				'line': '',
				'lineNumber': 5,
			},
			{
				'kind': 'lineChanged',
				'line': '',
				'lineNumber': 4,
			},
			{
				'kind': 'lineChanged',
				'line': '',
				'lineNumber': 3,
			},
			{
				'fromLineNumber': 6,
				'kind': 'linesInserted',
				'lines': [
					'',
					'',
					'',
					'',
					'',
					'',
					'',
					'',
					'',
					'',
					'Hello[injected2]econd Line',
				]
			}
		]);

		// Multi-Line Replace undo
		assert.strictEqual(thisModel.undo(), undefined);
		assert.deepStrictEqual(recordedChanges.splice(0), [
			{
				kind: 'lineChanged',
				line: '[injected1]SHello[injected2]econd Line',
				lineNumber: 2,
			},
			{
				kind: 'linesDeleted',
			}
		]);
	});
});

function mapChange(change: ModelRawChange): unknown {
	if (change.changeType === RawContentChangedType.LineChanged) {
		(change.injectedText || []).every(e => {
			assert.deepStrictEqual(e.lineNumber, change.lineNumber);
		});

		return {
			kind: 'lineChanged',
			line: getDetail(change.detail, change.injectedText),
			lineNumber: change.lineNumber,
		};
	} else if (change.changeType === RawContentChangedType.LinesInserted) {
		return {
			kind: 'linesInserted',
			lines: change.detail.map((e, idx) => getDetail(e, change.injectedTexts[idx])),
			fromLineNumber: change.fromLineNumber
		};
	} else if (change.changeType === RawContentChangedType.LinesDeleted) {
		return {
			kind: 'linesDeleted',
		};
	} else if (change.changeType === RawContentChangedType.EOLChanged) {
		return {
			kind: 'eolChanged'
		};
	} else if (change.changeType === RawContentChangedType.Flush) {
		return {
			kind: 'flush'
		};
	}
	return { kind: 'unknown' };
}

function getDetail(line: string, injectedTexts: LineInjectedText[] | null): string {
	return LineInjectedText.applyInjectedText(line, (injectedTexts || []).map(t => t.withText(`[${t.text}]`)));
}
