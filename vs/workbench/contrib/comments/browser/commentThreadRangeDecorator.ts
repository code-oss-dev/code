/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IRange } from 'vs/editor/common/core/range';
import { CommentThread, CommentThreadCollapsibleState } from 'vs/editor/common/languages';
import { IModelDecorationOptions, IModelDeltaDecoration } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { ICommentInfo, ICommentService } from 'vs/workbench/contrib/comments/browser/commentService';

class CommentThreadRangeDecoration implements IModelDeltaDecoration {
	private _decorationId: string | undefined;

	public get id(): string | undefined {
		return this._decorationId;
	}

	public set id(id: string | undefined) {
		this._decorationId = id;
	}

	constructor(
		public readonly range: IRange,
		public readonly options: ModelDecorationOptions) {
	}
}

export class CommentThreadRangeDecorator extends Disposable {
	private static description = 'comment-thread-range-decorator';
	private decorationOptions: ModelDecorationOptions;
	private activeDecorationOptions: ModelDecorationOptions;
	private decorationIds: string[] = [];
	private activeDecorationIds: string[] = [];
	private editor: ICodeEditor | undefined;
	private threadCollapseStateListeners: IDisposable[] = [];
	private currentThreadCollapseStateListener: IDisposable | undefined;

	constructor(commentService: ICommentService) {
		super();
		const decorationOptions: IModelDecorationOptions = {
			description: CommentThreadRangeDecorator.description,
			isWholeLine: false,
			zIndex: 20,
			className: 'comment-thread-range'
		};

		this.decorationOptions = ModelDecorationOptions.createDynamic(decorationOptions);

		const activeDecorationOptions: IModelDecorationOptions = {
			description: CommentThreadRangeDecorator.description,
			isWholeLine: false,
			zIndex: 20,
			className: 'comment-thread-range-current'
		};

		this.activeDecorationOptions = ModelDecorationOptions.createDynamic(activeDecorationOptions);
		this._register(commentService.onDidChangeCurrentCommentThread(thread => {
			this.updateCurrent(thread);
		}));
		this._register(commentService.onDidUpdateCommentThreads(() => {
			this.updateCurrent(undefined);
		}));
	}

	private updateCurrent(thread: CommentThread<IRange> | undefined) {
		if (!this.editor) {
			return;
		}
		this.currentThreadCollapseStateListener?.dispose();
		const newDecoration: CommentThreadRangeDecoration[] = [];
		if (thread) {
			const range = thread.range;
			if (!((range.startLineNumber === range.endLineNumber) && (range.startColumn === range.endColumn))) {
				if (thread.collapsibleState === CommentThreadCollapsibleState.Expanded) {
					this.currentThreadCollapseStateListener = thread.onDidChangeCollapsibleState(state => {
						if (state === CommentThreadCollapsibleState.Collapsed) {
							this.updateCurrent(undefined);
						}
					});
					newDecoration.push(new CommentThreadRangeDecoration(range, this.activeDecorationOptions));
				}
			}
		}
		this.activeDecorationIds = this.editor.deltaDecorations(this.activeDecorationIds, newDecoration);
		newDecoration.forEach((decoration, index) => decoration.id = this.decorationIds[index]);
	}

	public update(editor: ICodeEditor, commentInfos: ICommentInfo[]) {
		const model = editor.getModel();
		if (!model) {
			return;
		}
		this.threadCollapseStateListeners.forEach(disposable => disposable.dispose());
		this.editor = editor;

		const commentThreadRangeDecorations: CommentThreadRangeDecoration[] = [];
		for (const info of commentInfos) {
			info.threads.forEach(thread => {
				if (thread.isDisposed) {
					return;
				}

				const range = thread.range;
				// We only want to show a range decoration when there's the range spans either multiple lines
				// or, when is spans multiple characters on the sample line
				if ((range.startLineNumber === range.endLineNumber) && (range.startColumn === range.endColumn)) {
					return;
				}

				this.threadCollapseStateListeners.push(thread.onDidChangeCollapsibleState(() => {
					this.update(editor, commentInfos);
				}));

				if (thread.collapsibleState === CommentThreadCollapsibleState.Collapsed) {
					return;
				}

				commentThreadRangeDecorations.push(new CommentThreadRangeDecoration(range, this.decorationOptions));
			});
		}

		this.decorationIds = editor.deltaDecorations(this.decorationIds, commentThreadRangeDecorations);
		commentThreadRangeDecorations.forEach((decoration, index) => decoration.id = this.decorationIds[index]);
	}

	override dispose() {
		this.threadCollapseStateListeners.forEach(disposable => disposable.dispose());
		this.currentThreadCollapseStateListener?.dispose();
		super.dispose();
	}
}
