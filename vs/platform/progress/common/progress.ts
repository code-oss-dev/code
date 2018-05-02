/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IProgressService = createDecorator<IProgressService>('progressService');

export interface IProgressService {
	_serviceBrand: any;

	/**
	 * Show progress customized with the provided flags.
	 */
	show(infinite: boolean, delay?: number): IProgressRunner;
	show(total: number, delay?: number): IProgressRunner;

	/**
	 * Indicate progress for the duration of the provided promise. Progress will stop in
	 * any case of promise completion, error or cancellation.
	 */
	showWhile(promise: TPromise<any>, delay?: number): TPromise<void>;
}

export interface IProgressRunner {
	total(value: number): void;
	worked(value: number): void;
	done(): void;
}

export const emptyProgressRunner: IProgressRunner = Object.freeze({
	total() { },
	worked() { },
	done() { }
});

export interface IProgress<T> {
	report(item: T): void;
}

export const emptyProgress: IProgress<any> = Object.freeze({ report() { } });

export class Progress<T> implements IProgress<T> {

	private _callback: (data: T) => void;
	private _value: T;

	constructor(callback: (data: T) => void) {
		this._callback = callback;
	}

	get value() {
		return this._value;
	}

	report(item: T) {
		this._value = item;
		this._callback(this._value);
	}
}

export enum ProgressLocation {
	Explorer = 1,
	Scm = 3,
	Extensions = 5,
	Window = 10,
	Notification = 15
}

export interface IProgressOptions {
	location: ProgressLocation;
	title?: string;
	source?: string;
	total?: number;
	cancellable?: boolean;
}

export interface IProgressStep {
	message?: string;
	increment?: number;
}

export const IProgressService2 = createDecorator<IProgressService2>('progressService2');

export interface IProgressService2 {

	_serviceBrand: any;

	withProgress<P extends Thenable<R>, R=any>(options: IProgressOptions, task: (progress: IProgress<IProgressStep>) => P, onDidCancel?: () => void): P;
}

/**
 * A helper to show progress during a long running operation. If the operation
 * is started multiple times, only the last invocation will drive the progress.
 */
export class LongRunningOperation {
	private currentOperationId = 0;
	private currentProgressRunner: IProgressRunner;
	private currentProgressTimeout: number;

	constructor(
		private progressService: IProgressService
	) {
	}

	start(progressDelay: number): number {

		// Clear previous
		if (this.currentProgressTimeout) {
			clearTimeout(this.currentProgressTimeout);
		}

		// Start new
		const newOperationId = ++this.currentOperationId;
		this.currentProgressTimeout = setTimeout(() => {
			if (newOperationId === this.currentOperationId) {
				this.currentProgressRunner = this.progressService.show(true);
			}
		}, progressDelay);

		return newOperationId;
	}

	stop(operationId: number): void {
		if (this.currentOperationId === operationId) {
			clearTimeout(this.currentProgressTimeout);

			if (this.currentProgressRunner) {
				this.currentProgressRunner.done();
			}
		}
	}

	isCurrent(operationId): boolean {
		return this.currentOperationId === operationId;
	}
}