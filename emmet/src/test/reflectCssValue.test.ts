/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Selection, commands } from 'vscode';
import { withRandomFileEditor, closeAllEditors } from './testUtils';

suite('Tests for Emmet: Reflect CSS Value command', () => {
	teardown(closeAllEditors);

	const cssContents = `
	.header {
		margin: 10px;
		padding: 10px;
		transform: rotate(50deg);
		-moz-transform: rotate(20deg);
		-o-transform: rotate(50deg);
		-webkit-transform: rotate(50deg);
		-ms-transform: rotate(50deg);
	}
	`;

	const htmlContents = `
	<html>
		<style>
			.header {
				margin: 10px;
				padding: 10px;
				transform: rotate(50deg);
				-moz-transform: rotate(20deg);
				-o-transform: rotate(50deg);
				-webkit-transform: rotate(50deg);
				-ms-transform: rotate(50deg);
			}
		</style>
	</html>
	`;

	test('Reflect Css Value in css file', function (): any {
		return withRandomFileEditor(cssContents, '.css', (editor, doc) => {
			editor.selections = [new Selection(5, 10, 5, 10)];
			return commands.executeCommand('emmet.reflectCSSValue').then(() => {
				assert.equal(doc.getText(), cssContents.replace(/\(50deg\)/g, '(20deg)'));
				return Promise.resolve();
			});
		});
	});

	test('Reflect Css Value in html file', function (): any {
		return withRandomFileEditor(htmlContents, '.html', (editor, doc) => {
			editor.selections = [new Selection(7, 20, 7, 20)];
			return commands.executeCommand('emmet.reflectCSSValue').then(() => {
				assert.equal(doc.getText(), htmlContents.replace(/\(50deg\)/g, '(20deg)'));
				return Promise.resolve();
			});
		});
	});

});