/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import * as htmlLanguageService from '../htmlLanguageService';

import {CompletionList, TextDocument, TextEdit, Position, CompletionItemKind} from 'vscode-languageserver-types';
import {applyEdits} from './textEditSupport';

export interface ItemDescription {
	label: string;
	documentation?: string;
	kind?: CompletionItemKind;
	insertText?: string;
	overwriteBefore?: number;
	resultText?: string;
}

function asPromise<T>(result: T): Promise<T> {
	return Promise.resolve(result);
}

export let assertCompletion = function (completions: CompletionList, expected: ItemDescription, document: TextDocument, offset: number) {
	let matches = completions.items.filter(completion => {
		return completion.label === expected.label;
	});
	assert.equal(matches.length, 1, expected.label + " should only existing once: Actual: " + completions.items.map(c => c.label).join(', '));
	if (expected.documentation) {
		assert.equal(matches[0].documentation, expected.documentation);
	}
	if (expected.kind) {
		assert.equal(matches[0].kind, expected.kind);
	}
	if (expected.insertText) {
		assert.equal(matches[0].insertText || matches[0].textEdit.newText, expected.insertText);
	}
	if (expected.resultText) {
		assert.equal(applyEdits(document, [matches[0].textEdit]), expected.resultText);
	}
	if (expected.insertText && typeof expected.overwriteBefore === 'number' && matches[0].textEdit) {
		let text = document.getText();
		let expectedText = text.substr(0, offset - expected.overwriteBefore) + expected.insertText + text.substr(offset);
		let actualText = applyEdits(document, [matches[0].textEdit]);
		if (actualText !== expectedText) {
			assert.equal(actualText, expectedText);
		}


	}
};

let testCompletionFor = function (value: string, expected: { count?: number, items?: ItemDescription[] }): Thenable<void> {
	let offset = value.indexOf('|');
	value = value.substr(0, offset) + value.substr(offset + 1);

	let ls = htmlLanguageService.getLanguageService();

	let document = TextDocument.create('test://test/test.html', 'html', 0, value);
	let position = document.positionAt(offset);
	let htmlDoc = ls.parseHTMLDocument(document);
	return asPromise(ls.doComplete(document, position, htmlDoc)).then(list => {
		try {
			if (expected.count) {
				assert.equal(list.items, expected.count);
			}
			if (expected.items) {
				for (let item of expected.items) {
					assertCompletion(list, item, document, offset);
				}
			}
		} catch (e) {
			return Promise.reject(e);
		}

	});
};
function run(tests: Thenable<void>[], testDone) {
	Promise.all(tests).then(() => {
		testDone();
	}, (error) => {
		testDone(error);
	});
}

suite('HTML Completion', () => {

	test('Intellisense', function (testDone): any {
		run([
			testCompletionFor('<|', {
				items: [
					{ label: 'iframe', resultText: '<iframe' },
					{ label: 'h1', resultText: '<h1' },
					{ label: 'div', resultText: '<div' },
				]
			}),

			testCompletionFor('< |', {
				items: [
					{ label: 'iframe', resultText: '<iframe' },
					{ label: 'h1', resultText: '<h1' },
					{ label: 'div', resultText: '<div' },
				]
			}),

			testCompletionFor('<h|', {
				items: [
					{ label: 'html', resultText: '<html' },
					{ label: 'h1', resultText: '<h1' },
					{ label: 'header', resultText: '<header' },
				]
			}),

			testCompletionFor('<input|', {
				items: [
					{ label: 'input', resultText: '<input' },
				]
			}),

			testCompletionFor('<input |', {
				items: [
					{ label: 'type', resultText: '<input type="{{}}"' },
					{ label: 'style', resultText: '<input style="{{}}"' },
					{ label: 'onmousemove', resultText: '<input onmousemove="{{}}"' },
				]
			}),

			testCompletionFor('<input t|', {
				items: [
					{ label: 'type', resultText: '<input type="{{}}"' },
					{ label: 'tabindex', resultText: '<input tabindex="{{}}"' },
				]
			}),

			testCompletionFor('<input type="text" |', {
				items: [
					{ label: 'style', resultText: '<input type="text" style="{{}}"' },
					{ label: 'type', resultText: '<input type="text" type="{{}}"' },
					{ label: 'size', resultText: '<input type="text" size="{{}}"' },
				]
			}),

			testCompletionFor('<input type="text" s|', {
				items: [
					{ label: 'style', resultText: '<input type="text" style="{{}}"' },
					{ label: 'src', resultText: '<input type="text" src="{{}}"' },
					{ label: 'size', resultText: '<input type="text" size="{{}}"' },
				]
			}),

			testCompletionFor('<input di| type="text"', {
				items: [

					{ label: 'disabled', resultText: '<input disabled type="text"' },
					{ label: 'dir', resultText: '<input dir="{{}}" type="text"' },
				]
			}),

			testCompletionFor('<input disabled | type="text"', {
				items: [
					{ label: 'dir', resultText: '<input disabled dir="{{}}" type="text"' },
					{ label: 'style', resultText: '<input disabled style="{{}}" type="text"' },
				]
			}),

			testCompletionFor('<input type=|', {
				items: [
					{ label: 'text', resultText: '<input type="text"' },
					{ label: 'checkbox', resultText: '<input type="checkbox"' },
				]
			}),

			testCompletionFor('<input type="c|', {
				items: [
					{ label: 'color', resultText: '<input type="color"' },
					{ label: 'checkbox', resultText: '<input type="checkbox"' },
				]
			}),

			testCompletionFor('<input type= |', {
				items: [
					{ label: 'color', resultText: '<input type= "color"' },
					{ label: 'checkbox', resultText: '<input type= "checkbox"' },
				]
			}),
			testCompletionFor('<input src="c" type="color|" ', {
				items: [
					{ label: 'color', resultText: '<input src="c" type="color"" ' },
				]
			}),
			testCompletionFor('<input src="c" type=color| ', {
				items: [
					{ label: 'color', resultText: '<input src="c" type="color" ' },
				]
			}),
			testCompletionFor('<div dir=|></div>', {
				items: [
					{ label: 'ltr', resultText: '<div dir="ltr"></div>' },
					{ label: 'rtl', resultText: '<div dir="rtl"></div>' },
				]
			}),
			testCompletionFor('<ul><|>', {
				items: [
					{ label: '/ul', resultText: '<ul></ul>' },
					{ label: 'li', resultText: '<ul><li>' },
				]
			}),
			testCompletionFor('<ul><li><|', {
				items: [
					{ label: '/li', resultText: '<ul><li></li>' },
					{ label: 'a', resultText: '<ul><li><a' },
				]
			}),
			testCompletionFor('<goo></|>', {
				items: [
					{ label: '/goo', resultText: '<goo></goo>' },
				]
			}),
			testCompletionFor('<foo></f|', {
				items: [
					{ label: '/foo', resultText: '<foo></foo>' },
				]
			}),
			testCompletionFor('<foo></ |>', {
				items: [
					{ label: '/foo', resultText: '<foo></foo>' },
				]
			}),
			testCompletionFor('<span></ s|', {
				items: [
					{ label: '/span', resultText: '<span></span>' },
				]
			}),
			testCompletionFor('<li><br></ |>', {
				items: [
					{ label: '/li', resultText: '<li><br></li>' },
				]
			}),
			testCompletionFor('<foo><br/></ f|>', {
				items: [
					{ label: '/foo', resultText: '<foo><br/></foo>' },
				]
			}),
			testCompletionFor('<li><div/></|', {
				items: [
					{ label: '/li', resultText: '<li><div/></li>' },
				]
			}),
			testCompletionFor('<li><br/|>', { count: 0 }),
			testCompletionFor('<li><br>a/|', { count: 0 }),

			testCompletionFor('<foo><bar></bar></|   ', {
				items: [
					{ label: '/foo', resultText: '<foo><bar></bar></foo>   ' },
				]
			}),
			testCompletionFor('<body><div><div></div></div></|  >', {
				items: [
					{ label: '/body', resultText: '<body><div><div></div></div></body  >' },
				]
			}),
			testCompletionFor(['<body>', '  <div>', '    </|'].join('\n'), {
				items: [
					{ label: '/div', resultText: ['<body>', '  <div>', '    </div>'].join('\n') },
				]
			})
		], testDone);
	});

	test('Intellisense aria', function (testDone): any {
		let expectedAriaAttributes = [
			{ label: 'aria-activedescendant' },
			{ label: 'aria-atomic' },
			{ label: 'aria-autocomplete' },
			{ label: 'aria-busy' },
			{ label: 'aria-checked' },
			{ label: 'aria-colcount' },
			{ label: 'aria-colindex' },
			{ label: 'aria-colspan' },
			{ label: 'aria-controls' },
			{ label: 'aria-current' },
			{ label: 'aria-describedat' },
			{ label: 'aria-describedby' },
			{ label: 'aria-disabled' },
			{ label: 'aria-dropeffect' },
			{ label: 'aria-errormessage' },
			{ label: 'aria-expanded' },
			{ label: 'aria-flowto' },
			{ label: 'aria-grabbed' },
			{ label: 'aria-haspopup' },
			{ label: 'aria-hidden' },
			{ label: 'aria-invalid' },
			{ label: 'aria-kbdshortcuts' },
			{ label: 'aria-label' },
			{ label: 'aria-labelledby' },
			{ label: 'aria-level' },
			{ label: 'aria-live' },
			{ label: 'aria-modal' },
			{ label: 'aria-multiline' },
			{ label: 'aria-multiselectable' },
			{ label: 'aria-orientation' },
			{ label: 'aria-owns' },
			{ label: 'aria-placeholder' },
			{ label: 'aria-posinset' },
			{ label: 'aria-pressed' },
			{ label: 'aria-readonly' },
			{ label: 'aria-relevant' },
			{ label: 'aria-required' },
			{ label: 'aria-roledescription' },
			{ label: 'aria-rowcount' },
			{ label: 'aria-rowindex' },
			{ label: 'aria-rowspan' },
			{ label: 'aria-selected' },
			{ label: 'aria-setsize' },
			{ label: 'aria-sort' },
			{ label: 'aria-valuemax' },
			{ label: 'aria-valuemin' },
			{ label: 'aria-valuenow' },
			{ label: 'aria-valuetext' }
		];
		run([
			testCompletionFor('<div  |> </div >', { items: expectedAriaAttributes }),
			testCompletionFor('<span  |> </span >', { items: expectedAriaAttributes }),
			testCompletionFor('<input  |> </input >', { items: expectedAriaAttributes })
		], testDone);
	});

	test('Intellisense Angular', function (testDone): any {
		run([
			testCompletionFor('<body  |> </body >', {
				items: [
					{ label: 'ng-controller', resultText: '<body  ng-controller="{{}}"> </body >' },
					{ label: 'data-ng-controller', resultText: '<body  data-ng-controller="{{}}"> </body >' },
				]
			}),
			testCompletionFor('<li  |> </li >', {
				items: [
					{ label: 'ng-repeat', resultText: '<li  ng-repeat="{{}}"> </li >' },
					{ label: 'data-ng-repeat', resultText: '<li  data-ng-repeat="{{}}"> </li >' },
				]
			}),
			testCompletionFor('<input  |> </input >', {
				items: [
					{ label: 'ng-model', resultText: '<input  ng-model="{{}}"> </input >' },
					{ label: 'data-ng-model', resultText: '<input  data-ng-model="{{}}"> </input >' },
				]
			})
		], testDone);
	});

	test('Intellisense Ionic', function (testDone): any {
		run([
			// Try some Ionic tags
			testCompletionFor('<|', {
				items: [
					{ label: 'ion-checkbox', resultText: '<ion-checkbox' },
					{ label: 'ion-content', resultText: '<ion-content' },
					{ label: 'ion-nav-title', resultText: '<ion-nav-title' },
				]
			}),
			testCompletionFor('<ion-re|', {
				items: [
					{ label: 'ion-refresher', resultText: '<ion-refresher' },
					{ label: 'ion-reorder-button', resultText: '<ion-reorder-button' },
				]
			}),
			// Try some global attributes (1 with value suggestions, 1 without value suggestions, 1 void)
			testCompletionFor('<ion-checkbox |', {
				items: [
					{ label: 'force-refresh-images', resultText: '<ion-checkbox force-refresh-images="{{}}"' },
					{ label: 'collection-repeat', resultText: '<ion-checkbox collection-repeat="{{}}"' },
					{ label: 'menu-close', resultText: '<ion-checkbox menu-close' },
				]
			}),
			// Try some tag-specific attributes (1 with value suggestions, 1 void)
			testCompletionFor('<ion-footer-bar |', {
				items: [
					{ label: 'align-title', resultText: '<ion-footer-bar align-title="{{}}"' },
					{ label: 'keyboard-attach', resultText: '<ion-footer-bar keyboard-attach' },
				]
			}),
			// Try the extended attributes of an existing HTML 5 tag
			testCompletionFor('<a |', {
				items: [
					{ label: 'nav-direction', resultText: '<a nav-direction="{{}}"' },
					{ label: 'nav-transition', resultText: '<a nav-transition="{{}}"' },
					{ label: 'href', resultText: '<a href="{{}}"' },
					{ label: 'hreflang', resultText: '<a hreflang="{{}}"' },
				]
			}),
			// Try value suggestion for a tag-specific attribute
			testCompletionFor('<ion-side-menu side="|', {
				items: [
					{ label: 'left', resultText: '<ion-side-menu side="left"' },
					{ label: 'primary', resultText: '<ion-side-menu side="primary"' },
					{ label: 'right', resultText: '<ion-side-menu side="right"' },
					{ label: 'secondary', resultText: '<ion-side-menu side="secondary"' },
				]
			}),
			// Try a value suggestion for a global attribute
			testCompletionFor('<img force-refresh-images="|', {
				items: [
					{ label: 'false', resultText: '<img force-refresh-images="false"' },
					{ label: 'true', resultText: '<img force-refresh-images="true"' },
				]
			}),
			// Try a value suggestion for an extended attribute of an existing HTML 5 tag
			testCompletionFor('<a nav-transition="|', {
				items: [
					{ label: 'android', resultText: '<a nav-transition="android"' },
					{ label: 'ios', resultText: '<a nav-transition="ios"' },
					{ label: 'none', resultText: '<a nav-transition="none"' },
				]
			})
		], testDone);
	});
})
