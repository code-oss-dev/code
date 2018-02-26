/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

'use strict';


(function () {
	const unloadedStyles = [];

	const onStyleLoadError = (event) => {
		const source = event.target.dataset.source;
		unloadedStyles.push(source);
	};

	window.addEventListener('DOMContentLoaded', () => {
		for (const link of document.getElementsByClassName('code-user-style')) {
			if (link.dataset.source) {
				link.onerror = onStyleLoadError;
			}
		}
	})

	window.addEventListener('load', () => {
		if (!unloadedStyles.length) {
			return;
		}
		window.parent.postMessage({
			command: '_markdown.onPreviewStyleLoadError',
			args: [unloadedStyles]
		}, '*');
	});
}());