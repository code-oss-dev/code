/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FoldingMarkers } from 'vs/editor/common/languages/languageConfiguration';
import { MAX_FOLDING_REGIONS, FoldRange, FoldingRegions } from 'vs/editor/contrib/folding/browser/foldingRanges';
import { computeRanges } from 'vs/editor/contrib/folding/browser/indentRangeProvider';
import { createTextModel } from 'vs/editor/test/common/testTextModel';

const markers: FoldingMarkers = {
	start: /^\s*#region\b/,
	end: /^\s*#endregion\b/
};

suite('FoldingRanges', () => {

	const foldRange = (from: number, to: number, collapsed: boolean | undefined = undefined, manual: boolean | undefined = undefined, type: string | undefined = undefined) =>
		<FoldRange>{
			startLineNumber: from,
			endLineNumber: to,
			type: type,
			isCollapsed: collapsed || false,
			isManualSelection: manual || false
		};
	const assertEqualRanges = (range1: FoldRange, range2: FoldRange, msg: string) => {
		assert.strictEqual(range1.startLineNumber, range2.startLineNumber, msg + ' start');
		assert.strictEqual(range1.endLineNumber, range2.endLineNumber, msg + ' end');
		assert.strictEqual(range1.type, range2.type, msg + ' type');
		assert.strictEqual(range1.isCollapsed, range2.isCollapsed, msg + ' collapsed');
		assert.strictEqual(range1.isManualSelection, range2.isManualSelection, msg + ' manual');
	};

	test('test max folding regions', () => {
		const lines: string[] = [];
		const nRegions = MAX_FOLDING_REGIONS;
		for (let i = 0; i < nRegions; i++) {
			lines.push('#region');
		}
		for (let i = 0; i < nRegions; i++) {
			lines.push('#endregion');
		}
		const model = createTextModel(lines.join('\n'));
		const actual = computeRanges(model, false, markers, MAX_FOLDING_REGIONS);
		assert.strictEqual(actual.length, nRegions, 'len');
		for (let i = 0; i < nRegions; i++) {
			assert.strictEqual(actual.getStartLineNumber(i), i + 1, 'start' + i);
			assert.strictEqual(actual.getEndLineNumber(i), nRegions * 2 - i, 'end' + i);
			assert.strictEqual(actual.getParentIndex(i), i - 1, 'parent' + i);
		}
		model.dispose();

	});

	test('findRange', () => {
		const lines = [
		/* 1*/	'#region',
		/* 2*/	'#endregion',
		/* 3*/	'class A {',
		/* 4*/	'  void foo() {',
		/* 5*/	'    if (true) {',
		/* 6*/	'        return;',
		/* 7*/	'    }',
		/* 8*/	'',
		/* 9*/	'    if (true) {',
		/* 10*/	'      return;',
		/* 11*/	'    }',
		/* 12*/	'  }',
		/* 13*/	'}'];

		const textModel = createTextModel(lines.join('\n'));
		try {
			const actual = computeRanges(textModel, false, markers);
			// let r0 = r(1, 2);
			// let r1 = r(3, 12);
			// let r2 = r(4, 11);
			// let r3 = r(5, 6);
			// let r4 = r(9, 10);

			assert.strictEqual(actual.findRange(1), 0, '1');
			assert.strictEqual(actual.findRange(2), 0, '2');
			assert.strictEqual(actual.findRange(3), 1, '3');
			assert.strictEqual(actual.findRange(4), 2, '4');
			assert.strictEqual(actual.findRange(5), 3, '5');
			assert.strictEqual(actual.findRange(6), 3, '6');
			assert.strictEqual(actual.findRange(7), 2, '7');
			assert.strictEqual(actual.findRange(8), 2, '8');
			assert.strictEqual(actual.findRange(9), 4, '9');
			assert.strictEqual(actual.findRange(10), 4, '10');
			assert.strictEqual(actual.findRange(11), 2, '11');
			assert.strictEqual(actual.findRange(12), 1, '12');
			assert.strictEqual(actual.findRange(13), -1, '13');
		} finally {
			textModel.dispose();
		}


	});

	test('setCollapsed', () => {
		const lines: string[] = [];
		const nRegions = 500;
		for (let i = 0; i < nRegions; i++) {
			lines.push('#region');
		}
		for (let i = 0; i < nRegions; i++) {
			lines.push('#endregion');
		}
		const model = createTextModel(lines.join('\n'));
		const actual = computeRanges(model, false, markers, MAX_FOLDING_REGIONS);
		assert.strictEqual(actual.length, nRegions, 'len');
		for (let i = 0; i < nRegions; i++) {
			actual.setCollapsed(i, i % 3 === 0);
		}
		for (let i = 0; i < nRegions; i++) {
			assert.strictEqual(actual.isCollapsed(i), i % 3 === 0, 'line' + i);
		}
		model.dispose();
	});

	test('sanitizeAndMerge1', () => {
		const regionSet1: FoldRange[] = [
			foldRange(0, 100),			// invalid, should be removed
			foldRange(1, 100, false, false, 'A'),			// valid
			foldRange(1, 100, false, false, 'Z'),			// invalid, duplicate start
			foldRange(10, 10, false),						// invalid, should be removed
			foldRange(20, 80, false, false, 'C1'),			// valid inside 'B'
			foldRange(22, 80, true, false, 'D1'),			// valid inside 'C1'
			foldRange(90, 101),								// invalid, should be removed
		];
		const regionSet2: FoldRange[] = [
			foldRange(2, 100, false, false, 'B'),			// valid, inside 'A'
			foldRange(20, 80, true),			    		// should merge with C1
			foldRange(18, 80, true),						// invalid, out of order
			foldRange(21, 81, true, false, 'Z'),			// invalid, overlapping
			foldRange(22, 80, false, false, 'D2'),			// should merge with D1
		];
		let result = FoldingRegions.sanitizeAndMerge(regionSet1, regionSet2, 100);
		assert.strictEqual(result.length, 4, 'result length1');
		assertEqualRanges(result[0], foldRange(1, 100, false, false, 'A'), 'A1');
		assertEqualRanges(result[1], foldRange(2, 100, false, false, 'B'), 'B1');
		assertEqualRanges(result[2], foldRange(20, 80, true, false, 'C1'), 'C1');
		assertEqualRanges(result[3], foldRange(22, 80, true, false, 'D2'), 'D1');
		const regionClass1 = FoldingRegions.fromFoldRanges(regionSet1);
		const regionClass2 = FoldingRegions.fromFoldRanges(regionSet2);
		// same tests again with inputs as FoldingRegions instead of FoldRange[]
		result = FoldingRegions.sanitizeAndMerge(regionClass1, regionClass2, 100);
		assert.strictEqual(result.length, 4, 'result length2');
		assertEqualRanges(result[0], foldRange(1, 100, false, false, 'A'), 'A2');
		assertEqualRanges(result[1], foldRange(2, 100, false, false, 'B'), 'B2');
		assertEqualRanges(result[2], foldRange(20, 80, true, false, 'C1'), 'C2');
		assertEqualRanges(result[3], foldRange(22, 80, true, false, 'D2'), 'D2');
	});

	test('sanitizeAndMerge2', () => {
		const regionSet1: FoldRange[] = [
			foldRange(1, 100, false, false, 'a1'),			// valid
			foldRange(2, 100, false, false, 'a2'),			// valid
			foldRange(3, 19, false, false, 'a3'),			// valid
			foldRange(20, 71, false, false, 'a4'),			// overlaps b3
			foldRange(21, 29, false, false, 'a5'),			// valid
			foldRange(81, 91, false, false, 'a6'),			// overlaps b4
		];
		const regionSet2: FoldRange[] = [
			foldRange(30, 39, false, false, 'b1'),			// valid
			foldRange(40, 49, false, false, 'b2'),			// valid
			foldRange(50, 100, false, false, 'b3'),			// overlaps a4
			foldRange(80, 90, false, false, 'b4'),			// overlaps a6
			foldRange(92, 100, false, false, 'b5'),			// valid
		];
		let result = FoldingRegions.sanitizeAndMerge(regionSet1, regionSet2, 100);
		assert.strictEqual(result.length, 9, 'result length1');
		assertEqualRanges(result[0], foldRange(1, 100, false, false, 'a1'), 'P1');
		assertEqualRanges(result[1], foldRange(2, 100, false, false, 'a2'), 'P2');
		assertEqualRanges(result[2], foldRange(3, 19, false, false, 'a3'), 'P3');
		assertEqualRanges(result[3], foldRange(21, 29, false, false, 'a5'), 'P4');
		assertEqualRanges(result[4], foldRange(30, 39, false, false, 'b1'), 'P5');
		assertEqualRanges(result[5], foldRange(40, 49, false, false, 'b2'), 'P6');
		assertEqualRanges(result[6], foldRange(50, 100, false, false, 'b3'), 'P7');
		assertEqualRanges(result[7], foldRange(80, 90, false, false, 'b4'), 'P8');
		assertEqualRanges(result[8], foldRange(92, 100, false, false, 'b5'), 'P9');
		// reverse the two inputs
		result = FoldingRegions.sanitizeAndMerge(regionSet2, regionSet1, 100);
		assert.strictEqual(result.length, 9, 'result length2');
		assertEqualRanges(result[0], foldRange(1, 100, false, false, 'a1'), 'Q1');
		assertEqualRanges(result[1], foldRange(2, 100, false, false, 'a2'), 'Q2');
		assertEqualRanges(result[2], foldRange(3, 19, false, false, 'a3'), 'Q3');
		assertEqualRanges(result[3], foldRange(20, 71, false, false, 'a4'), 'Q4');
		assertEqualRanges(result[4], foldRange(21, 29, false, false, 'a5'), 'Q5');
		assertEqualRanges(result[5], foldRange(30, 39, false, false, 'b1'), 'Q6');
		assertEqualRanges(result[6], foldRange(40, 49, false, false, 'b2'), 'Q7');
		assertEqualRanges(result[7], foldRange(81, 91, false, false, 'a6'), 'Q8');
		assertEqualRanges(result[8], foldRange(92, 100, false, false, 'b5'), 'Q9');
	});

	test('sanitizeAndMerge3', () => {
		const regionSet1: FoldRange[] = [
			foldRange(1, 100, false, false, 'a1'),			// valid
			foldRange(10, 29, false, false, 'a2'),			// matches manual hidden
			foldRange(35, 39, true, true, 'a3'),			// valid
		];
		const regionSet2: FoldRange[] = [
			foldRange(10, 29, true, true, 'b1'),			// matches a
			foldRange(20, 28, true, false, 'b2'),			// should get dropped
			foldRange(30, 39, true, true, 'b3'),			// should remain
		];
		const result = FoldingRegions.sanitizeAndMerge(regionSet1, regionSet2, 100);
		assert.strictEqual(result.length, 4, 'result length3');
		assertEqualRanges(result[0], foldRange(1, 100, false, false, 'a1'), 'R1');
		assertEqualRanges(result[1], foldRange(10, 29, true, false, 'b1'), 'R2');
		assertEqualRanges(result[2], foldRange(30, 39, true, true, 'b3'), 'R3');
		assertEqualRanges(result[3], foldRange(35, 39, true, true, 'a3'), 'R4');
	});

	test('sanitizeAndMerge4', () => {
		const regionSet1: FoldRange[] = [
			foldRange(1, 100, false, false, 'a1'),			// valid
		];
		const regionSet2: FoldRange[] = [
			foldRange(20, 28, true, false, 'b1'),			// hidden
			foldRange(30, 38, true, false, 'b2'),			// hidden
		];
		const result = FoldingRegions.sanitizeAndMerge(regionSet1, regionSet2, 100);
		assert.strictEqual(result.length, 3, 'result length4');
		assertEqualRanges(result[0], foldRange(1, 100, false, false, 'a1'), 'R1');
		assertEqualRanges(result[1], foldRange(20, 28, true, true, 'b1'), 'R2');
		assertEqualRanges(result[2], foldRange(30, 38, true, true, 'b2'), 'R3');
	});

});
