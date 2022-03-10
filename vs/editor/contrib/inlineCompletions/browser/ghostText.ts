/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IActiveCodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { applyEdits } from 'vs/editor/contrib/inlineCompletions/browser/utils';

export class GhostText {
	public static equals(a: GhostText | undefined, b: GhostText | undefined): boolean {
		return a === b || (!!a && !!b && a.equals(b));
	}

	constructor(
		public readonly lineNumber: number,
		public readonly parts: GhostTextPart[],
		public readonly additionalReservedLineCount: number = 0
	) {
	}

	equals(other: GhostText): boolean {
		return this.lineNumber === other.lineNumber &&
			this.parts.length === other.parts.length &&
			this.parts.every((part, index) => part.equals(other.parts[index]));
	}

	/**
	 * Only used for testing/debugging.
	*/
	render(documentText: string, debug: boolean = false): string {
		const l = this.lineNumber;
		return applyEdits(documentText,
			[
				...this.parts.map(p => ({
					range: { startLineNumber: l, endLineNumber: l, startColumn: p.column, endColumn: p.column },
					text: debug ? `[${p.lines.join('\n')}]` : p.lines.join('\n')
				})),
			]
		);
	}

	renderForScreenReader(lineText: string): string {
		if (this.parts.length === 0) {
			return '';
		}
		const lastPart = this.parts[this.parts.length - 1];

		const cappedLineText = lineText.substr(0, lastPart.column - 1);
		const text = applyEdits(cappedLineText,
			this.parts.map(p => ({
				range: { startLineNumber: 1, endLineNumber: 1, startColumn: p.column, endColumn: p.column },
				text: p.lines.join('\n')
			}))
		);

		return text.substring(this.parts[0].column - 1);
	}

	isEmpty(): boolean {
		return this.parts.every(p => p.lines.length === 0);
	}
}

export class GhostTextPart {
	constructor(
		readonly column: number,
		readonly lines: readonly string[],
		/**
		 * Indicates if this part is a preview of an inline suggestion when a suggestion is previewed.
		*/
		readonly preview: boolean,
	) {
	}

	equals(other: GhostTextPart): boolean {
		return this.column === other.column &&
			this.lines.length === other.lines.length &&
			this.lines.every((line, index) => line === other.lines[index]);
	}
}

export interface GhostTextWidgetModel {
	readonly onDidChange: Event<void>;
	readonly ghostText: GhostText | undefined;

	setExpanded(expanded: boolean): void;
	readonly expanded: boolean;

	readonly minReservedLineCount: number;
}

export abstract class BaseGhostTextWidgetModel extends Disposable implements GhostTextWidgetModel {
	public abstract readonly ghostText: GhostText | undefined;

	private _expanded: boolean | undefined = undefined;

	protected readonly onDidChangeEmitter = new Emitter<void>();
	public readonly onDidChange = this.onDidChangeEmitter.event;

	public abstract readonly minReservedLineCount: number;

	public get expanded() {
		if (this._expanded === undefined) {
			// TODO this should use a global hidden setting.
			// See https://github.com/microsoft/vscode/issues/125037.
			return true;
		}
		return this._expanded;
	}

	constructor(protected readonly editor: IActiveCodeEditor) {
		super();

		this._register(editor.onDidChangeConfiguration((e) => {
			if (e.hasChanged(EditorOption.suggest) && this._expanded === undefined) {
				this.onDidChangeEmitter.fire();
			}
		}));
	}

	public setExpanded(expanded: boolean): void {
		this._expanded = true;
		this.onDidChangeEmitter.fire();
	}
}
