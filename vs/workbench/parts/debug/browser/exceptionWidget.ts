/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!../browser/media/exceptionWidget';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { ZoneWidget } from 'vs/editor/contrib/zoneWidget/browser/zoneWidget';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IDebugService } from 'vs/workbench/parts/debug/common/debug';
import { RunOnceScheduler } from 'vs/base/common/async';
import { TPromise } from 'vs/base/common/winjs.base';
const $ = dom.$;

export class ExceptionWidget extends ZoneWidget {

	private exceptionInfo: TPromise<DebugProtocol.ExceptionInfoResponse>;

	constructor(editor: ICodeEditor, private lineNumber: number,
		@IContextViewService private contextViewService: IContextViewService,
		@IDebugService private debugService: IDebugService
	) {
		super(editor, { showFrame: true, showArrow: true, frameWidth: 1 });

		this.create();
		const onDidLayoutChangeScheduler = new RunOnceScheduler(() => this._doLayout(undefined, undefined), 50);
		this._disposables.add(this.editor.onDidLayoutChange(() => onDidLayoutChangeScheduler.schedule()));
		this._disposables.add(onDidLayoutChangeScheduler);
	}

	protected _fillContainer(container: HTMLElement): void {
		this.setCssClass('exception-widget');
		// Set the font size and line height to the one from the editor configuration.
		const fontInfo = this.editor.getConfiguration().fontInfo;
		this.container.style.fontSize = `${fontInfo.fontSize}px`;
		this.container.style.lineHeight = `${fontInfo.lineHeight}px`;
		const thread = this.debugService.getViewModel().focusedThread;

		if (thread && thread.stoppedDetails) {
			let title = $('.title');
			let msg = $('.message');

			this.exceptionInfo = thread.exceptionInfo;
			this.exceptionInfo.then((exceptionInfo) => {
				if (exceptionInfo) {
					title.textContent = exceptionInfo.body.description;
					msg.textContent = exceptionInfo.body.details.stackTrace;
				} else {
					title.textContent = nls.localize('exceptionThrown', 'Exception occurred');
					msg.textContent = thread.stoppedDetails.text;
				}
			});

			dom.append(container, title);
			dom.append(container, msg);
		}
	}

	protected _doLayout(heightInPixel: number, widthInPixel: number): void {
		this.exceptionInfo.then(() => {
			// Reload the height with respect to the exception text content and relayout it to match the line count.
			this.container.style.height = 'initial';

			const computedLinesNumber = Math.ceil(this.container.offsetHeight / this.editor.getConfiguration().fontInfo.lineHeight);
			this._relayout(computedLinesNumber);
		});
	}
}
