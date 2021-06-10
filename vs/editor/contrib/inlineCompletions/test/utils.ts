/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { Position } from 'vs/editor/common/core/position';
import { ITextModel } from 'vs/editor/common/model';
import { InlineCompletionsProvider, InlineCompletion, InlineCompletionContext } from 'vs/editor/common/modes';
import { GhostText, GhostTextWidgetModel } from 'vs/editor/contrib/inlineCompletions/ghostText';
import { ITestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

export function renderGhostTextToText(ghostText: GhostText, text: string): string {
	const l = ghostText.lineNumber;
	const tempModel = createTextModel(text);
	tempModel.applyEdits(
		[
			...ghostText.parts.map(p => ({ range: { startLineNumber: l, endLineNumber: l, startColumn: p.column, endColumn: p.column }, text: `[${p.text}]` })),
			...(ghostText.additionalLines.length > 0 ? [{
				range: { startLineNumber: l, endLineNumber: l, startColumn: tempModel.getLineMaxColumn(l), endColumn: tempModel.getLineMaxColumn(l) },
				text: `{${ghostText.additionalLines.map(s => '\n' + s).join('')}}`
			}] : [])
		]
	);
	return tempModel.getValue();
}

export class MockInlineCompletionsProvider implements InlineCompletionsProvider {
	private returnValue: InlineCompletion[] = [];
	private delayMs: number = 0;

	private callHistory = new Array<unknown>();

	public setReturnValue(value: InlineCompletion | undefined, delayMs: number = 0): void {
		this.returnValue = value ? [value] : [];
		this.delayMs = delayMs;
	}

	public setReturnValues(values: InlineCompletion[], delayMs: number = 0): void {
		this.returnValue = values;
		this.delayMs = delayMs;
	}

	public getAndClearCallHistory() {
		const history = [...this.callHistory];
		this.callHistory = [];
		return history;
	}

	async provideInlineCompletions(model: ITextModel, position: Position, context: InlineCompletionContext, token: CancellationToken) {
		this.callHistory.push({
			position: position.toString(),
			triggerKind: context.triggerKind,
			text: model.getValue()
		});
		const result = new Array<InlineCompletion>();
		result.push(...this.returnValue);

		if (this.delayMs > 0) {
			await timeout(this.delayMs);
		}

		return { items: result };
	}
	freeInlineCompletions() { }
	handleItemDidShow() { }
}

export class GhostTextContext extends Disposable {
	public readonly prettyViewStates = new Array<string | undefined>();
	private _currentPrettyViewState: string | undefined;
	public get currentPrettyViewState() {
		return this._currentPrettyViewState;
	}

	constructor(private readonly model: GhostTextWidgetModel, private readonly editor: ITestCodeEditor) {
		super();

		this._register(
			model.onDidChange(() => {
				this.update();
			})
		);
		this.update();
	}

	private update(): void {
		const ghostText = this.model?.ghostText;
		let view: string | undefined;
		if (ghostText) {
			view = renderGhostTextToText(ghostText, this.editor.getValue());
		} else {
			view = this.editor.getValue();
		}

		if (this._currentPrettyViewState !== view) {
			this.prettyViewStates.push(view);
		}
		this._currentPrettyViewState = view;
	}

	public getAndClearViewStates(): (string | undefined)[] {
		const arr = [...this.prettyViewStates];
		this.prettyViewStates.length = 0;
		return arr;
	}

	public keyboardType(text: string): void {
		this.editor.trigger('keyboard', 'type', { text });
	}
}
