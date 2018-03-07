/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import Severity from 'vs/base/common/severity';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IAction } from 'vs/base/common/actions';
import Event, { Emitter } from 'vs/base/common/event';
import { TPromise } from 'vs/base/common/winjs.base';

export import Severity = Severity;

export const INotificationService = createDecorator<INotificationService>('notificationService');

export type NotificationMessage = string | Error;

export interface INotification {

	/**
	 * The severity of the notification. Either `Info`, `Warning` or `Error`.
	 */
	severity: Severity;

	/**
	 * The message of the notification. This can either be a `string` or `Error`. Messages
	 * can optionally include links in the format: `[text](link)`
	 */
	message: NotificationMessage;

	/**
	 * The source of the notification appears as additional information.
	 */
	source?: string;

	/**
	 * Actions to show as part of the notification. Primary actions show up as
	 * buttons as part of the message and will close the notification once clicked.
	 *
	 * Secondary actions are meant to provide additional configuration or context
	 * for the notification and will show up less prominent. A notification does not
	 * close automatically when invoking a secondary action.
	 *
	 * **Note:** If your intent is to show a message with actions to the user, consider
	 * the `INotificationService.prompt()` method instead which are optimized for
	 * this usecase and much easier to use!
	 */
	actions?: INotificationActions;
}

export interface INotificationActions {

	/**
	 * Primary actions show up as buttons as part of the message and will close
	 * the notification once clicked.
	 */
	primary?: IAction[];

	/**
	 * Secondary actions are meant to provide additional configuration or context
	 * for the notification and will show up less prominent. A notification does not
	 * close automatically when invoking a secondary action.
	 */
	secondary?: IAction[];
}

export interface INotificationProgress {

	/**
	 * Causes the progress bar to spin infinitley.
	 */
	infinite(): void;

	/**
	 * Indicate the total amount of work.
	 */
	total(value: number): void;

	/**
	 * Indicate that a specific chunk of work is done.
	 */
	worked(value: number): void;

	/**
	 * Indicate that the long running operation is done.
	 */
	done(): void;
}

export interface INotificationHandle extends IDisposable {

	/**
	 * Will be fired once the notification is disposed.
	 */
	readonly onDidDispose: Event<void>;

	/**
	 * Allows to indicate progress on the notification even after the
	 * notification is already visible.
	 */
	readonly progress: INotificationProgress;

	/**
	 * Allows to update the severity of the notification.
	 */
	updateSeverity(severity: Severity): void;

	/**
	 * Allows to update the message of the notification even after the
	 * notification is already visible.
	 */
	updateMessage(message: NotificationMessage): void;

	/**
	 * Allows to update the actions of the notification even after the
	 * notification is already visible.
	 */
	updateActions(actions?: INotificationActions): void;
}


/**
 * Primary choices show up as buttons in the notification below the message.
 */
export type PrimaryPromptChoice = string;

/**
 * Secondary choices show up under the gear icon in the header of the notification.
 */
export interface SecondaryPromptChoice {
	label: string;

	/**
	 * Wether to keep the notification open after the secondary choice was selected
	 * by the user. By default, will close the notification upon click.
	 */
	keepOpen?: boolean;
}

export type PromptOption = PrimaryPromptChoice | SecondaryPromptChoice;

/**
 * A service to bring up notifications and non-modal prompts.
 *
 * Note: use the `IDialogService` for a modal way to ask the user for input.
 */
export interface INotificationService {

	_serviceBrand: any;

	/**
	 * Show the provided notification to the user. The returned `INotificationHandle`
	 * can be used to control the notification afterwards.
	 *
	 * **Note:** If your intent is to show a message with actions to the user, consider
	 * the `INotificationService.prompt()` method instead which are optimized for
	 * this usecase and much easier to use!
	 *
	 * @returns a handle on the notification to e.g. hide it or update message, buttons, etc.
	 */
	notify(notification: INotification): INotificationHandle;

	/**
	 * A convinient way of reporting infos. Use the `INotificationService.notify`
	 * method if you need more control over the notification.
	 */
	info(message: NotificationMessage | NotificationMessage[]): void;

	/**
	 * A convinient way of reporting warnings. Use the `INotificationService.notify`
	 * method if you need more control over the notification.
	 */
	warn(message: NotificationMessage | NotificationMessage[]): void;

	/**
	 * A convinient way of reporting errors. Use the `INotificationService.notify`
	 * method if you need more control over the notification.
	 */
	error(message: NotificationMessage | NotificationMessage[]): void;

	/**
	 * Shows a prompt in the notification area with the provided choices. The prompt
	 * is non-modal. If you want to show a modal dialog instead, use `IDialogService`.
	 *
	 * @returns a promise that will resolve to the index of the choice that was picked.
	 * The promise can be cancelled to hide the notification prompt.
	 */
	prompt(severity: Severity, message: string, choices: PromptOption[]): TPromise<number>;
}

export class NoOpNotification implements INotificationHandle {
	readonly progress = new NoOpProgress();

	private _onDidDispose: Emitter<void> = new Emitter();

	public get onDidDispose(): Event<void> {
		return this._onDidDispose.event;
	}

	updateSeverity(severity: Severity): void { }
	updateMessage(message: NotificationMessage): void { }
	updateActions(actions?: INotificationActions): void { }

	dispose(): void {
		this._onDidDispose.dispose();
	}
}

export class NoOpProgress implements INotificationProgress {
	infinite(): void { }
	done(): void { }
	total(value: number): void { }
	worked(value: number): void { }
}