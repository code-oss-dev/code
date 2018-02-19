/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import Severity from 'vs/base/common/severity';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export interface IConfirmation {
	title?: string;
	type?: 'none' | 'info' | 'error' | 'question' | 'warning';
	message: string;
	detail?: string;
	primaryButton?: string;
	secondaryButton?: string;
	checkbox?: {
		label: string;
		checked?: boolean;
	};
}

export interface IConfirmationResult {
	confirmed: boolean;
	checkboxChecked?: boolean;
}

export const IConfirmationService = createDecorator<IConfirmationService>('confirmationService');

export interface IConfirmationService {

	_serviceBrand: any;

	/**
	 * Ask the user for confirmation.
	 */
	confirm(confirmation: IConfirmation): TPromise<boolean>;

	/**
	 * Ask the user for confirmation with a checkbox.
	 */
	confirmWithCheckbox(confirmation: IConfirmation): TPromise<IConfirmationResult>;
}

export const IChoiceService = createDecorator<IChoiceService>('choiceService');

export interface IChoiceService {

	_serviceBrand: any;

	/**
	 * Prompt the user for a choice between multiple options.
	 *
	 * @param when `modal` is true, this will block the user until chooses.
	 *
	 * @returns A promise with the selected choice index. The promise is cancellable
	 * which hides the message. The promise can return an error, meaning that
	 * the user refused to choose.
	 *
	 * When `modal` is true and user refused to choose, then promise with index of
	 * `Cancel` option is returned. If there is no such option then promise with
	 * `0` index is returned.
	 */
	choose(severity: Severity, message: string, options: string[], cancelId: number, modal?: boolean): TPromise<number>;
}