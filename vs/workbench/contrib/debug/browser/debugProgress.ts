/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IDebugService, VIEWLET_ID } from 'vs/workbench/contrib/debug/common/debug';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';

export class DebugProgressContribution implements IWorkbenchContribution {

	private toDispose: IDisposable[] = [];

	constructor(
		@IDebugService private readonly debugService: IDebugService,
		@IProgressService private readonly progressService: IProgressService
	) {
		let progressListener: IDisposable;
		this.toDispose.push(this.debugService.getViewModel().onDidFocusSession(session => {
			if (progressListener) {
				progressListener.dispose();
			}
			if (session) {
				progressListener = session.onDidProgressStart(async progressStartEvent => {
					const promise = new Promise<void>(r => {
						// Show progress until a progress end event comes or the session ends
						const listener = Event.any(Event.filter(session.onDidProgressEnd, e => e.body.progressId === progressStartEvent.body.progressId),
							session.onDidEndAdapter)(() => {
								listener.dispose();
								r();
							});
					});

					this.progressService.withProgress({ location: VIEWLET_ID }, () => promise);
					this.progressService.withProgress({
						location: ProgressLocation.Notification,
						title: progressStartEvent.body.title,
						cancellable: progressStartEvent.body.cancellable,
						silent: true
					}, () => promise, () => session.cancel(progressStartEvent.body.progressId));
				});
			}
		}));
	}

	dispose(): void {
		dispose(this.toDispose);
	}
}
