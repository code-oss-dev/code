/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import 'vs/css!vs/workbench/services/progress/browser/media/progressService2';
import * as dom from 'vs/base/browser/dom';
import { IActivityBarService, ProgressBadge } from 'vs/workbench/services/activity/common/activityBarService';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IProgressService2, IProgress, Progress, emptyProgress } from 'vs/platform/progress/common/progress';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { OcticonLabel } from 'vs/base/browser/ui/octiconLabel/octiconLabel';
import { Registry } from 'vs/platform/platform';
import { StatusbarAlignment, IStatusbarRegistry, StatusbarItemDescriptor, Extensions, IStatusbarItem } from 'vs/workbench/browser/parts/statusbar/statusbar';
import { TPromise } from 'vs/base/common/winjs.base';
import { always } from 'vs/base/common/async';

class WindowProgressItem implements IStatusbarItem {

	static Instance: WindowProgressItem;

	private _element: HTMLElement;
	private _label: OcticonLabel;

	constructor() {
		WindowProgressItem.Instance = this;
	}

	render(element: HTMLElement): IDisposable {
		this._element = element;
		this._label = new OcticonLabel(this._element);
		this._element.classList.add('progress');
		this.hide();
		return null;
	}

	set text(value: string) {
		this._label.text = value;
	}

	hide() {
		dom.hide(this._element);
	}

	show() {
		dom.show(this._element);
	}
}


export class ProgressService2 implements IProgressService2 {

	_serviceBrand: any;

	private _stack: Progress<string>[] = [];

	constructor(
		@IActivityBarService private _activityBar: IActivityBarService,
		@IViewletService private _viewletService: IViewletService
	) {
		//
	}

	withWindowProgress(task: (progress: IProgress<string>) => TPromise<any>): void {

		const progress = new Progress<string>(() => this._updateProgress());
		this._stack.unshift(progress);

		const promise = task(progress);

		always(promise, () => {
			const idx = this._stack.indexOf(progress);
			this._stack.splice(idx, 1);
			this._updateProgress();
		});
	}

	private _updateProgress() {
		if (this._stack.length === 0) {
			WindowProgressItem.Instance.hide();
		} else {
			WindowProgressItem.Instance.show();
			WindowProgressItem.Instance.text = this._stack[0].value;
		}
	}

	withViewletProgress(viewletId: string, task: (progress: IProgress<number>) => TPromise<any>): void {

		const promise = task(emptyProgress);

		// show in viewlet
		const viewletProgress = this._viewletService.getProgressIndicator(viewletId);
		viewletProgress.showWhile(promise);

		// show activity bar
		let activityProgress: IDisposable;
		let delayHandle = setTimeout(() => {
			delayHandle = undefined;
			activityProgress = this._activityBar.showActivity(
				viewletId,
				new ProgressBadge(() => '...'),
				'progress-badge'
			);
		}, 200);

		always(promise, () => {
			clearTimeout(delayHandle);
			dispose(activityProgress);
		});
	}
}


Registry.as<IStatusbarRegistry>(Extensions.Statusbar).registerStatusbarItem(
	new StatusbarItemDescriptor(WindowProgressItem, StatusbarAlignment.LEFT)
);
