/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Selection } from 'vscode';
import { withRandomFileEditor, closeAllEditors } from './testUtils';
import { expandAbbreviation } from '../abbreviationActions';

const cssContents = `
.boo {
	margin: 20px 10px;
	background-image: url('tryme.png');
	m10
}

.boo .hoo {
	margin: 10px;
	ind
}
`;

const scssContents = `
.boo {
	margin: 20px 10px;
	background-image: url('tryme.png');

	.boo .hoo {
		margin: 10px;
	}
}
`;

const htmlContents = `
<body class="header">
	<ul class="nav main">
		<li class="item1">img</li>
		<li class="item2">hithere</li>
		ul>li
		ul>li*2
		ul>li.item$*2
		ul>li.item$@44*2
		<div
	</ul>
	<style>
		.boo {
			m10
		}
	</style>
</body>
`;

suite('Tests for Expand Abbreviations (HTML)', () => {
	teardown(closeAllEditors);

	test('Expand snippets (HTML)', () => {
		return testHtmlExpandAbbreviation(new Selection(3, 23, 3, 23), 'img', '<img src=\"\" alt=\"\">');
	});

	test('Expand abbreviation (HTML)', () => {
		return testHtmlExpandAbbreviation(new Selection(5, 25, 5, 25), 'ul>li', '<ul>\n\t\t\t<li></li>\n\t\t</ul>');
	});

	test('Expand text that is neither an abbreviation nor a snippet to tags (HTML)', () => {
		return testHtmlExpandAbbreviation(new Selection(4, 20, 4, 27), 'hithere', '<hithere></hithere>');
	});

	test('Expand abbreviation with repeaters (HTML)', () => {
		return testHtmlExpandAbbreviation(new Selection(6, 27, 6, 27), 'ul>li*2', '<ul>\n\t\t\t<li></li>\n\t\t\t<li></li>\n\t\t</ul>');
	});

	test('Expand abbreviation with numbered repeaters (HTML)', () => {
		return testHtmlExpandAbbreviation(new Selection(7, 33, 7, 33), 'ul>li.item$*2', '<ul>\n\t\t\t<li class="item1"></li>\n\t\t\t<li class="item2"></li>\n\t\t</ul>');
	});

	test('Expand abbreviation with numbered repeaters with offset (HTML)', () => {
		return testHtmlExpandAbbreviation(new Selection(8, 36, 8, 36), 'ul>li.item$@44*2', '<ul>\n\t\t\t<li class="item44"></li>\n\t\t\t<li class="item45"></li>\n\t\t</ul>');
	});

	test('Expand tag that is opened, but not closed (HTML)', () => {
		return testHtmlExpandAbbreviation(new Selection(9, 6, 9, 6), '<div', '<div></div>');
	});

	test('No expanding text inside open tag (HTML)', () => {
		return testHtmlExpandAbbreviation(new Selection(2, 4, 2, 4), '', '', true);
	});

	test('Expand css when inside style tag (HTML)', () => {
		return withRandomFileEditor(htmlContents, 'html', (editor, doc) => {
			editor.selection = new Selection(13, 3, 13, 6);
			let expandPromise = expandAbbreviation({ language: 'css' });
			if (!expandPromise) {
				return Promise.resolve();
			}
			return expandPromise.then(() => {
				assert.equal(editor.document.getText(), htmlContents.replace('m10', 'margin: 10px;'));
				return Promise.resolve();
			});
		});
	});
});

suite('Tests for Expand Abbreviations (CSS)', () => {
	teardown(closeAllEditors);

	test('Expand abbreviation (CSS)', () => {
		return withRandomFileEditor(cssContents, 'css', (editor, doc) => {
			editor.selection = new Selection(4, 1, 4, 4);
			return expandAbbreviation(null).then(() => {
				assert.equal(editor.document.getText(), cssContents.replace('m10', 'margin: 10px;'));
				return Promise.resolve();
			});
		});

	});
});

function testHtmlExpandAbbreviation(selection: Selection, abbreviation: string, expandedText: string, shouldFail?: boolean): Thenable<any> {

	return withRandomFileEditor(htmlContents, 'html', (editor, doc) => {
		editor.selection = selection;
		let expandPromise = expandAbbreviation(null);
		if (!expandPromise) {
			if (!shouldFail) {
				assert.equal(1, 2, `Problem with expanding ${abbreviation} to ${expandedText}`);
			}
			return Promise.resolve();
		}
		return expandPromise.then(() => {
			assert.equal(editor.document.getText(), htmlContents.replace(abbreviation, expandedText));
			return Promise.resolve();
		});
	});
}

