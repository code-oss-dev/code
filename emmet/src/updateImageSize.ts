/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Based on @sergeche's work on the emmet plugin for atom

'use strict';

import { TextEditor, Range, Position, window } from 'vscode';
import * as path from 'path';
import { getImageSize } from './imageSizeHelper';
import { isStyleSheet } from 'vscode-emmet-helper';
import { parse, getNode, iterateCSSToken } from './util';
import { HtmlNode, CssToken, HtmlToken, Attribute, Property } from 'EmmetNode';
import { locateFile } from './locateFile';

/**
 * Updates size of context image in given editor
 */
export function updateImageSize() {
	let editor = window.activeTextEditor;
	if (!editor) {
		window.showInformationMessage('No editor is active.');
		return;
	}

	if (!isStyleSheet(editor.document.languageId)) {
		return updateImageSizeHTML(editor);
	} else {
		return updateImageSizeCSS(editor);
	}
}

/**
 * Updates image size of context tag of HTML model
 */
function updateImageSizeHTML(editor: TextEditor) {
	const src = getImageSrcHTML(getImageHTMLNode(editor));

	if (!src) {
		return Promise.reject(new Error('No valid image source'));
	}

	locateFile(path.dirname(editor.document.fileName), src)
		.then(getImageSize)
		.then((size: any) => {
			// since this action is asynchronous, we have to ensure that editor wasn’t
			// changed and user didn’t moved caret outside <img> node
			const img = getImageHTMLNode(editor);
			if (getImageSrcHTML(img) === src) {
				updateHTMLTag(editor, img, size.width, size.height);
			}
		})
		.catch(err => console.warn('Error while updating image size:', err));
}

/**
 * Updates image size of context rule of stylesheet model
 */
function updateImageSizeCSS(editor: TextEditor) {

	const src = getImageSrcCSS(getImageCSSNode(editor), editor.selection.active);

	if (!src) {
		return Promise.reject(new Error('No valid image source'));
	}

	locateFile(path.dirname(editor.document.fileName), src)
		.then(getImageSize)
		.then((size: any) => {
			// since this action is asynchronous, we have to ensure that editor wasn’t
			// changed and user didn’t moved caret outside <img> node
			const prop = getImageCSSNode(editor);
			if (getImageSrcCSS(prop, editor.selection.active) === src) {
				updateCSSNode(editor, prop, size.width, size.height);
			}
		})
		.catch(err => console.warn('Error while updating image size:', err));
}

/**
 * Returns <img> node under caret in given editor or `null` if such node cannot
 * be found
 * @param  {TextEditor}  editor
 * @return {HtmlNode}
 */
function getImageHTMLNode(editor: TextEditor): HtmlNode {
	const rootNode = parse(editor.document);
	const node = <HtmlNode>getNode(rootNode, editor.selection.active, true);

	return node && node.name.toLowerCase() === 'img' ? node : null;
}

/**
 * Returns css property under caret in given editor or `null` if such node cannot
 * be found
 * @param  {TextEditor}  editor
 * @return {Property}
 */
function getImageCSSNode(editor: TextEditor): Property {
	const rootNode = parse(editor.document);
	const node = getNode(rootNode, editor.selection.active, true);
	return node && node.type === 'property' ? <Property>node : null;
}

/**
 * Returns image source from given <img> node
 * @param  {HtmlNode} node
 * @return {string}
 */
function getImageSrcHTML(node: HtmlNode): string {
	const srcAttr = getAttribute(node, 'src');
	if (!srcAttr) {
		console.warn('No "src" attribute in', node && node.open);
		return;
	}

	return (<HtmlToken>srcAttr.value).value;
}

/**
 * Returns image source from given `url()` token
 * @param  {Property} node
 * @param {Position}
 * @return {string}
 */
function getImageSrcCSS(node: Property, position: Position): string {
	const urlToken = findUrlToken(node, position);
	if (!urlToken) {
		return;
	}

	// A stylesheet token may contain either quoted ('string') or unquoted URL
	let urlValue = urlToken.item(0);
	if (urlValue && urlValue.type === 'string') {
		urlValue = urlValue.item(0);
	}

	return urlValue && urlValue.valueOf();
}

/**
 * Updates size of given HTML node
 * @param  {TextEditor} editor
 * @param  {HtmlNode}   node
 * @param  {number}     width
 * @param  {number}     height
 */
function updateHTMLTag(editor: TextEditor, node: HtmlNode, width: number, height: number) {
	const srcAttr = getAttribute(node, 'src');
	const widthAttr = getAttribute(node, 'width');
	const heightAttr = getAttribute(node, 'height');

	let edits: [Range, string][] = [];

	// apply changes from right to left, first for height, then for width
	let point: Position;
	const quote = getAttributeQuote(editor, widthAttr || heightAttr || srcAttr);

	if (!heightAttr) {
		// no `height` attribute, add it right after `width` or `src`
		point = widthAttr ? widthAttr.end : srcAttr.end;
		edits.push([new Range(point, point), ` height=${quote}${height}${quote}`]);
	} else {
		edits.push([new Range(heightAttr.value.start, heightAttr.value.end), String(height)]);
	}

	if (!widthAttr) {
		// no `width` attribute, add it right before `height` or after `src`
		point = heightAttr ? heightAttr.start : srcAttr.end;
		edits.push([new Range(point, point), ` width=${quote}${width}${quote}`]);
	} else {
		edits.push([new Range(widthAttr.value.start, widthAttr.value.end), String(width)]);
	}

	return editor.edit(builder => {
		edits.forEach(([rangeToReplace, textToReplace]) => {
			builder.replace(rangeToReplace, textToReplace);
		});
	});
}

/**
 * Updates size of given CSS rule
 * @param  {TextEditor} editor
 * @param  {Property}   srcProp
 * @param  {number}     width
 * @param  {number}     height
 */
function updateCSSNode(editor: TextEditor, srcProp: Property, width: number, height: number) {
	const rule = srcProp.parent;
	const widthProp = getProperty(rule, 'width');
	const heightProp = getProperty(rule, 'height');

	// Detect formatting
	const separator = srcProp.separator || ': ';
	const before = getBefore(editor, srcProp);

	let edits: [Range, string][] = [];
	if (!srcProp.terminatorToken) {
		edits.push([new Range(srcProp.end, srcProp.end), ';']);
	}

	let point: Position;
	if (!heightProp) {
		// no `height` property, add it right after `width` or source property
		point = widthProp ? widthProp.start : srcProp.end;
		edits.push([new Range(point, point), `${before}height${separator}${height}px;`]);
	} else {
		edits.push([new Range(heightProp.valueToken.start, heightProp.valueTokenend), `${height}px`]);
	}

	if (!widthProp) {
		// no `width` attribute, add it right after `height` or source property
		if (heightProp) {
			point = heightProp.previousSibling
				? heightProp.previousSibling.end
				: rule.contentStartToken.end;
		} else {
			point = srcProp.end;
		}
		edits.push([new Range(point, point), `${before}width${separator}${width}px;`]);
	} else {
		edits.push([new Range(widthProp.valueToken.start, widthProp.valueTokenend), `${width}px`]);
	}

	return editor.edit(builder => {
		edits.forEach(([rangeToReplace, textToReplace]) => {
			builder.replace(rangeToReplace, textToReplace);
		});
	});
}

/**
 * Returns attribute object with `attrName` name from given HTML node
 * @param  {Node} node
 * @param  {String} attrName
 * @return {Object}
 */
function getAttribute(node, attrName): Attribute {
	attrName = attrName.toLowerCase();
	return node && node.open.attributes.find(attr => attr.name.value.toLowerCase() === attrName);
}

/**
 * Returns quote character, used for value of given attribute. May return empty
 * string if attribute wasn’t quoted
 * @param  {TextEditor} editor
 * @param  {Object} attr
 * @return {String}
 */
function getAttributeQuote(editor, attr) {
	const range = new Range(attr.value ? attr.value.end : attr.end, attr.end);
	return range.isEmpty ? '' : editor.document.getText(range);
}

/**
 * Finds 'url' token for given `pos` point in given CSS property `node`
 * @param  {Node}  node
 * @param  {Position} pos
 * @return {Token}
 */
function findUrlToken(node, pos: Position) {
	for (let i = 0, il = node.parsedValue.length, url; i < il; i++) {
		iterateCSSToken(node.parsedValue[i], (token: CssToken) => {
			if (token.type === 'url' && token.start.isBeforeOrEqual(pos) && token.end.isAfterOrEqual(pos)) {
				url = token;
				return false;
			}
		});

		if (url) {
			return url;
		}
	}
}

/**
 * Returns `name` CSS property from given `rule`
 * @param  {Node} rule
 * @param  {String} name
 * @return {Node}
 */
function getProperty(rule, name) {
	return rule.children.find(node => node.type === 'property' && node.name === name);
}

/**
 * Returns a string that is used to delimit properties in current node’s rule
 * @param  {TextEditor} editor
 * @param  {Node}       node
 * @return {String}
 */
function getBefore(editor: TextEditor, node: Property) {
	let anchor;
	if (anchor = (node.previousSibling || node.parent.contentStartToken)) {
		return editor.document.getText(new Range(anchor.end, node.start));
	} else if (anchor = (node.nextSibling || node.parent.contentEndToken)) {
		return editor.document.getText(new Range(node.end, anchor.start));
	}

	return '';
}
