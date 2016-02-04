/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./aria';
import {Builder, $} from 'vs/base/browser/builder';

let ariaContainer: Builder;
let alertContainer: Builder;
let statusContainer: Builder;
export function setARIAContainer(parent: HTMLElement) {
	ariaContainer = $('.aria-container').appendTo(parent);

	alertContainer = $('.alert').appendTo(ariaContainer).attr({ 'role': 'alert', 'aria-atomic': 'true' });
	statusContainer = $('.status').appendTo(ariaContainer).attr({ 'role': 'status', 'aria-atomic': 'true' });
}

/**
 * Given the provided message, will make sure that it is read as alert to screen readers.
 */
export function alert(msg: string): void {
	insertMessage(alertContainer, msg);
}

/**
 * Given the provided message, will make sure that it is read as status to screen readers.
 */
export function status(msg: string): void {
	insertMessage(statusContainer, msg);
}

function insertMessage(target: Builder, msg: string): void {
	if (!ariaContainer) {
		console.warn('ARIA support needs a container. Call setARIAContainer() first.');
		return;
	}

	$(target).empty();
	$(target).text(msg);
}