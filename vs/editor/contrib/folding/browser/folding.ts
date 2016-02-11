/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/// <amd-dependency path="vs/css!./folding" />

'use strict';

import {RunOnceScheduler} from 'vs/base/common/async';
import {Range} from 'vs/editor/common/core/range';
import EditorCommon = require('vs/editor/common/editorCommon');
import {IMouseEvent, ICodeEditor} from 'vs/editor/browser/editorBrowser';
import {INullService} from 'vs/platform/instantiation/common/instantiation';
import {IDisposable, disposeAll} from 'vs/base/common/lifecycle';
import Modes = require('vs/editor/common/modes');
import {EditorBrowserRegistry} from 'vs/editor/browser/editorBrowserExtensions';
import {TPromise} from 'vs/base/common/winjs.base';
import foldStrategy = require('vs/editor/contrib/folding/common/indentFoldStrategy');
import {IFoldingRange, toString as rangeToString} from 'vs/editor/contrib/folding/common/foldingRange';
import {CommonEditorRegistry, ContextKey, EditorActionDescriptor} from 'vs/editor/common/editorCommonExtensions';
import {KeyMod, KeyCode} from 'vs/base/common/keyCodes';
import {EditorAction, Behaviour} from 'vs/editor/common/editorAction';
import nls = require('vs/nls');

let log = function(msg: string) {
	console.log(msg);
};

class CollapsableRegion {

	private decorationIds: string[];
	private _isCollapsed:boolean;

	private _lastRange: IFoldingRange;

	public constructor(range:IFoldingRange, model:EditorCommon.IModel, changeAccessor:EditorCommon.IModelDecorationsChangeAccessor, isCollapsed:boolean) {
		this._isCollapsed = isCollapsed;
		this.decorationIds = [];
		this.update(range, model, changeAccessor);
	}

	public get isCollapsed() : boolean {
		return this._isCollapsed;
	}

	public setCollapsed(isCollaped: boolean, changeAccessor:EditorCommon.IModelDecorationsChangeAccessor) : void {
		this._isCollapsed = isCollaped;
		if (this.decorationIds.length > 0) {
			changeAccessor.changeDecorationOptions(this.decorationIds[0], this.getVisualDecorationOptions());
		}
	}

	public getDecorationRange(model:EditorCommon.IModel) : EditorCommon.IEditorRange {
		if (this.decorationIds.length > 0) {
			return model.getDecorationRange(this.decorationIds[1]);
		}
		return null;
	}

	private getVisualDecorationOptions():EditorCommon.IModelDecorationOptions {
		if (this._isCollapsed) {
			return {
				stickiness: EditorCommon.TrackedRangeStickiness.GrowsOnlyWhenTypingBefore,
				inlineClassName: 'inline-folded',
				linesDecorationsClassName: 'folding collapsed'
			};
		} else {
			return {
				stickiness: EditorCommon.TrackedRangeStickiness.GrowsOnlyWhenTypingBefore,
				linesDecorationsClassName: 'folding'
			};
		}
	}

	private getRangeDecorationOptions():EditorCommon.IModelDecorationOptions {
		return {
			stickiness: EditorCommon.TrackedRangeStickiness.GrowsOnlyWhenTypingBefore
		}
	}

	public update(newRange:IFoldingRange, model:EditorCommon.IModel, changeAccessor:EditorCommon.IModelDecorationsChangeAccessor): void {
		this._lastRange = newRange;

		let newDecorations : EditorCommon.IModelDeltaDecoration[] = [];

		var maxColumn = model.getLineMaxColumn(newRange.startLineNumber);
		var visualRng = {
			startLineNumber: newRange.startLineNumber,
			startColumn: maxColumn - 1,
			endLineNumber: newRange.startLineNumber,
			endColumn: maxColumn
		};
		newDecorations.push({ range: visualRng, options: this.getVisualDecorationOptions() });

		var colRng = {
			startLineNumber: newRange.startLineNumber,
			startColumn: 1,
			endLineNumber: newRange.endLineNumber,
			endColumn: model.getLineMaxColumn(newRange.endLineNumber)
		};
		newDecorations.push({ range: colRng, options: this.getRangeDecorationOptions() });

		this.decorationIds = changeAccessor.deltaDecorations(this.decorationIds, newDecorations);
	}


	public dispose(changeAccessor:EditorCommon.IModelDecorationsChangeAccessor): void {
		this._lastRange = null;
		this.decorationIds = changeAccessor.deltaDecorations(this.decorationIds, []);
	}

	public toString(): string {
		var str = this.isCollapsed ? 'collapsed ': 'expanded ';
		if (this._lastRange) {
			str += (this._lastRange.startLineNumber + '/' + this._lastRange.endLineNumber);
		} else {
			str += 'no range';
		}

		return  str;
	}
}

export class FoldingController implements EditorCommon.IEditorContribution {

	static ID = 'editor.contrib.folding';

	static getFoldingController(editor:EditorCommon.ICommonCodeEditor): FoldingController {
		return <FoldingController>editor.getContribution(FoldingController.ID);
	}

	private editor:ICodeEditor;
	private globalToDispose:IDisposable[];

	private computeToken:number;
	private updateScheduler:RunOnceScheduler;
	private localToDispose:IDisposable[];

	private decorations:CollapsableRegion[];

	constructor(editor:ICodeEditor, @INullService nullService) {
		this.editor = editor;

		this.globalToDispose = [];
		this.localToDispose = [];
		this.decorations = [];
		this.computeToken = 0;

		this.globalToDispose.push(this.editor.addListener2(EditorCommon.EventType.ModelChanged, () => this.onModelChanged()));
		this.globalToDispose.push(this.editor.addListener2(EditorCommon.EventType.ModelModeChanged, () => this.onModelChanged()));
		this.globalToDispose.push(this.editor.addListener2(EditorCommon.EventType.ConfigurationChanged, (e: EditorCommon.IConfigurationChangedEvent) => {
			if (e.folding) {
				this.onModelChanged();
			}
		}));

		this.onModelChanged();
	}

	public getId(): string {
		return FoldingController.ID;
	}

	public dispose(): void {
		this.cleanState();
		this.globalToDispose = disposeAll(this.globalToDispose);
	}

	private cleanState(): void {
		this.localToDispose = disposeAll(this.localToDispose);
	}

	private onModelChanged(): void {
		this.cleanState();

		if (!this.editor.getConfiguration().folding) {
			return;
		}

		var model = this.editor.getModel();
		if (!model) {
			return;
		}

		this.updateScheduler = new RunOnceScheduler(() => {
			var myToken = (++this.computeToken);

			this.computeCollapsableRegions().then(regions => {
				if (myToken !== this.computeToken) {
					// A new request was made in the meantime or the model was changed
					return;
				}
				regions = regions.sort((r1, r2) => r1.startLineNumber - r2.startLineNumber);
				log('compute ranges ' + regions.map(rangeToString).join(', '));

				this.editor.changeDecorations(changeAccessor => {

					let newDecorations : CollapsableRegion[] = [];

					let k = 0, i = 0;
					while (i < this.decorations.length && k < regions.length) {
						let dec = this.decorations[i];
						var decRange = dec.getDecorationRange(model);
						if (!decRange) {
							log('range no longer valid, was ' + dec.toString());
							dec.dispose(changeAccessor);
							i++;
						} else {
							while (k < regions.length && decRange.startLineNumber > regions[k].startLineNumber) {
								log('new range ' + rangeToString(regions[k]));
								newDecorations.push(new CollapsableRegion(regions[k], model, changeAccessor, false));
								k++;
							}
							if (k < regions.length) {
								let currRange = regions[k];
								if (decRange.startLineNumber < currRange.startLineNumber) {
									log('range no longer valid, was ' + dec.toString());
									dec.dispose(changeAccessor);
									i++;
								} else if (decRange.startLineNumber === currRange.startLineNumber) {
									dec.update(currRange, model, changeAccessor);
									newDecorations.push(dec);
									i++;
									k++;
								}
							}
						}
					}
					while (i < this.decorations.length) {
						log('range no longer valid, was ' + this.decorations[i].toString());
						this.decorations[i].dispose(changeAccessor);
						i++;
					}
					while (k < regions.length) {
						log('new range ' + rangeToString(regions[k]));
						newDecorations.push(new CollapsableRegion(regions[k], model, changeAccessor, false));
						k++;
					}
					this.decorations = newDecorations;
				});

				this.updateHiddenAreas();
			});
		}, 200);

		this.localToDispose.push(this.updateScheduler);
		this.localToDispose.push(this.editor.addListener2('change', () => this.updateScheduler.schedule()));
		this.localToDispose.push({ dispose: () => {
			++this.computeToken;
			this.editor.changeDecorations(changeAccessor => {
				this.decorations.forEach(dec => dec.dispose(changeAccessor));
			});
		}});
		this.localToDispose.push(this.editor.addListener2(EditorCommon.EventType.MouseDown, (e) => this._onEditorMouseDown(e)));

		this.updateScheduler.schedule();
	}

	private computeCollapsableRegions() : TPromise<IFoldingRange[]> {
		let tabSize = this.editor.getIndentationOptions().tabSize;
		var model = this.editor.getModel();
		if (!model) {
			return TPromise.as([]);
		}


		let ranges = foldStrategy.computeRanges(model, tabSize);
		return TPromise.as(ranges);
	}

	private _onEditorMouseDown(e: IMouseEvent): void {
		if (this.decorations.length === 0) {
			return;
		}
		var range = e.target.range;
		if (!range || !range.isEmpty) {
			return;
		}
		if (!e.event.leftButton) {
			return;
		}

		var model = this.editor.getModel();

		var toggleClicked = false;
		switch (e.target.type) {
			case EditorCommon.MouseTargetType.GUTTER_LINE_DECORATIONS:
				toggleClicked = true;
				break;
			case EditorCommon.MouseTargetType.CONTENT_TEXT:
				if (range.isEmpty && range.startColumn === model.getLineMaxColumn(range.startLineNumber)) {
					break;
				}
				return;
			default:
				return;
		}

		var hasChanges = false;

		this.editor.changeDecorations(changeAccessor => {
			for (var i = 0; i < this.decorations.length; i++) {
				var dec = this.decorations[i];
				var decRange = dec.getDecorationRange(model);
				if (decRange.startLineNumber === range.startLineNumber) {
					if (toggleClicked || dec.isCollapsed) {
						dec.setCollapsed(!dec.isCollapsed, changeAccessor);
						hasChanges = true;
					}
					break;
				}
			}
		});

		if (hasChanges) {
			this.updateHiddenAreas();
		}

	}

	private updateHiddenAreas(): void {
		var model = this.editor.getModel();
		var hiddenAreas:EditorCommon.IRange[] = [];
		this.decorations.filter(dec => dec.isCollapsed).forEach(dec => {
			var decRange = dec.getDecorationRange(model);
			hiddenAreas.push({
				startLineNumber: decRange.startLineNumber + 1,
				startColumn: 1,
				endLineNumber: decRange.endLineNumber,
				endColumn: 1
			});
		});
		this.editor.setHiddenAreas(hiddenAreas);
	}

	private findRegions(lineNumber: number, collapsed: boolean) : CollapsableRegion[] {
		var model = this.editor.getModel();
		return this.decorations.filter(dec => {
			if (dec.isCollapsed !== collapsed) {
				return false;
			}
			var decRange = dec.getDecorationRange(model);
			return decRange && decRange.startLineNumber <= lineNumber && lineNumber < decRange.endLineNumber;
		});
	}


	public unfold(lineNumber: number, all: boolean): void {
		let surrounding = this.findRegions(lineNumber, true);
		if (surrounding.length > 0) {
			this.editor.changeDecorations(changeAccessor => {
				for (let i = 0; i < surrounding.length; i++) {
					surrounding[i].setCollapsed(false, changeAccessor);
					if (!all) {
						return;
					}
				}
			});
			this.updateHiddenAreas();
		}
	}

	public fold(lineNumber: number, all: boolean): void {
		let surrounding = this.findRegions(lineNumber, false);
		if (surrounding.length > 0) {
			this.editor.changeDecorations(changeAccessor => {
				for (let i = surrounding.length - 1; i >= 0; i--) {
					surrounding[i].setCollapsed(true, changeAccessor);
					if (!all) {
						return;
					}
				}
			});
			this.updateHiddenAreas();
		}
	}
}

abstract class FoldingAction extends EditorAction {
	constructor(descriptor:EditorCommon.IEditorActionDescriptorData, editor:EditorCommon.ICommonCodeEditor, @INullService ns) {
		super(descriptor, editor);
	}

	abstract invoke(foldingController: FoldingController, lineNumber: number) : void;

	public run(): TPromise<boolean> {
		var foldingController = FoldingController.getFoldingController(this.editor);
		var selection = this.editor.getSelection();
		if (selection && selection.isEmpty) {
			this.invoke(foldingController, selection.startLineNumber);
		}
		return TPromise.as(true);
	}

}

class UnfoldAction extends FoldingAction {
	public static ID = 'editor.fold';

	public invoke(foldingController: FoldingController, lineNumber: number) : void {
		foldingController.unfold(lineNumber, false);
	}
}

class FoldAction extends FoldingAction {
	public static ID = 'editor.unfold';

	public invoke(foldingController: FoldingController, lineNumber: number) : void {
		foldingController.fold(lineNumber, false);
	}
}

class FoldAllAction extends FoldingAction {
	public static ID = 'editor.foldAll';

	public invoke(foldingController: FoldingController, lineNumber: number) : void {
		foldingController.unfold(lineNumber, true);
	}
}

class UnfoldAllAction extends FoldingAction {
	public static ID = 'editor.unfoldAll';

	public invoke(foldingController: FoldingController, lineNumber: number) : void {
		foldingController.fold(lineNumber, true);
	}
}

EditorBrowserRegistry.registerEditorContribution(FoldingController);

CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(UnfoldAction, UnfoldAction.ID, nls.localize('unfoldAction.label', "Unfold"), {
	context: ContextKey.EditorFocus,
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.US_CLOSE_SQUARE_BRACKET
}));
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(FoldAction, FoldAction.ID, nls.localize('foldAction.label', "Fold"), {
	context: ContextKey.EditorFocus,
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.US_OPEN_SQUARE_BRACKET
}));
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(UnfoldAllAction, UnfoldAllAction.ID, nls.localize('foldAllAction.label', "Fold All"), {
	context: ContextKey.EditorFocus,
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.US_OPEN_SQUARE_BRACKET
}));
CommonEditorRegistry.registerEditorAction(new EditorActionDescriptor(FoldAllAction, FoldAllAction.ID, nls.localize('unfoldAllAction.label', "Unfold All"), {
	context: ContextKey.EditorFocus,
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET
}));