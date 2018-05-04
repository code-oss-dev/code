/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import 'vs/css!./media/editor';
import 'vs/css!./media/tokens';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { TPromise } from 'vs/base/common/winjs.base';
import { ServicesAccessor, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Configuration } from 'vs/editor/browser/config/configuration';
import { Cursor, CursorStateChangedEvent } from 'vs/editor/common/controller/cursor';
import { CursorColumns, ICursors, CursorConfiguration } from 'vs/editor/common/controller/cursorCommon';
import { Position, IPosition } from 'vs/editor/common/core/position';
import { Range, IRange } from 'vs/editor/common/core/range';
import { Selection, ISelection } from 'vs/editor/common/core/selection';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { ViewModel } from 'vs/editor/common/viewModel/viewModelImpl';
import { hash } from 'vs/base/common/hash';
import { IModelContentChangedEvent, IModelDecorationsChangedEvent, IModelLanguageChangedEvent, IModelOptionsChangedEvent, IModelLanguageConfigurationChangedEvent } from 'vs/editor/common/model/textModelEvents';
import * as editorOptions from 'vs/editor/common/config/editorOptions';
import { ICursorPositionChangedEvent, ICursorSelectionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { VerticalRevealType } from 'vs/editor/common/view/viewEvents';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { IEditorWhitespace } from 'vs/editor/common/viewLayout/whitespaceComputer';
import * as modes from 'vs/editor/common/modes';
import { Schemas } from 'vs/base/common/network';
import { ITextModel, EndOfLinePreference, IIdentifiedSingleEditOperation, IModelDecorationsChangeAccessor, IModelDecoration, IModelDeltaDecoration, IModelDecorationOptions } from 'vs/editor/common/model';
import { INotificationService } from 'vs/platform/notification/common/notification';
import * as editorBrowser from 'vs/editor/browser/editorBrowser';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { IContentWidgetData, IOverlayWidgetData, View } from 'vs/editor/browser/view/viewImpl';
import { IEditorContributionCtor, EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { IMouseEvent } from 'vs/base/browser/mouseEvent';
import { InternalEditorAction } from 'vs/editor/common/editorAction';
import { ICommandDelegate } from 'vs/editor/browser/view/viewController';
import { CoreEditorCommand } from 'vs/editor/browser/controller/coreCommands';
import { editorErrorForeground, editorErrorBorder, editorWarningForeground, editorWarningBorder, editorInfoBorder, editorInfoForeground, editorHintForeground, editorHintBorder } from 'vs/editor/common/view/editorColorRegistry';
import { Color } from 'vs/base/common/color';
import { ClassName } from 'vs/editor/common/model/intervalTree';

let EDITOR_ID = 0;

export interface ICodeEditorWidgetOptions {
	/**
	 * Is this a simple widget (not a real code editor) ?
	 * Defaults to false.
	 */
	isSimpleWidget?: boolean;

	/**
	 * Contributions to instantiate.
	 * Defaults to EditorExtensionsRegistry.getEditorContributions().
	 */
	contributions?: IEditorContributionCtor[];

	/**
	 * Telemetry data associated with this CodeEditorWidget.
	 * Defaults to null.
	 */
	telemetryData?: object;
}

export class CodeEditorWidget extends Disposable implements editorBrowser.ICodeEditor {

	//#region Eventing
	private readonly _onDidDispose: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidDispose: Event<void> = this._onDidDispose.event;

	private readonly _onDidChangeModelContent: Emitter<IModelContentChangedEvent> = this._register(new Emitter<IModelContentChangedEvent>());
	public readonly onDidChangeModelContent: Event<IModelContentChangedEvent> = this._onDidChangeModelContent.event;

	private readonly _onDidChangeModelLanguage: Emitter<IModelLanguageChangedEvent> = this._register(new Emitter<IModelLanguageChangedEvent>());
	public readonly onDidChangeModelLanguage: Event<IModelLanguageChangedEvent> = this._onDidChangeModelLanguage.event;

	private readonly _onDidChangeModelLanguageConfiguration: Emitter<IModelLanguageConfigurationChangedEvent> = this._register(new Emitter<IModelLanguageConfigurationChangedEvent>());
	public readonly onDidChangeModelLanguageConfiguration: Event<IModelLanguageConfigurationChangedEvent> = this._onDidChangeModelLanguageConfiguration.event;

	private readonly _onDidChangeModelOptions: Emitter<IModelOptionsChangedEvent> = this._register(new Emitter<IModelOptionsChangedEvent>());
	public readonly onDidChangeModelOptions: Event<IModelOptionsChangedEvent> = this._onDidChangeModelOptions.event;

	private readonly _onDidChangeModelDecorations: Emitter<IModelDecorationsChangedEvent> = this._register(new Emitter<IModelDecorationsChangedEvent>());
	public readonly onDidChangeModelDecorations: Event<IModelDecorationsChangedEvent> = this._onDidChangeModelDecorations.event;

	private readonly _onDidChangeConfiguration: Emitter<editorOptions.IConfigurationChangedEvent> = this._register(new Emitter<editorOptions.IConfigurationChangedEvent>());
	public readonly onDidChangeConfiguration: Event<editorOptions.IConfigurationChangedEvent> = this._onDidChangeConfiguration.event;

	protected readonly _onDidChangeModel: Emitter<editorCommon.IModelChangedEvent> = this._register(new Emitter<editorCommon.IModelChangedEvent>());
	public readonly onDidChangeModel: Event<editorCommon.IModelChangedEvent> = this._onDidChangeModel.event;

	private readonly _onDidChangeCursorPosition: Emitter<ICursorPositionChangedEvent> = this._register(new Emitter<ICursorPositionChangedEvent>());
	public readonly onDidChangeCursorPosition: Event<ICursorPositionChangedEvent> = this._onDidChangeCursorPosition.event;

	private readonly _onDidChangeCursorSelection: Emitter<ICursorSelectionChangedEvent> = this._register(new Emitter<ICursorSelectionChangedEvent>());
	public readonly onDidChangeCursorSelection: Event<ICursorSelectionChangedEvent> = this._onDidChangeCursorSelection.event;

	private readonly _onDidAttemptReadOnlyEdit: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidAttemptReadOnlyEdit: Event<void> = this._onDidAttemptReadOnlyEdit.event;

	private readonly _onDidLayoutChange: Emitter<editorOptions.EditorLayoutInfo> = this._register(new Emitter<editorOptions.EditorLayoutInfo>());
	public readonly onDidLayoutChange: Event<editorOptions.EditorLayoutInfo> = this._onDidLayoutChange.event;

	private _editorTextFocus: BooleanEventEmitter = this._register(new BooleanEventEmitter());
	public readonly onDidFocusEditorText: Event<void> = this._editorTextFocus.onDidChangeToTrue;
	public readonly onDidBlurEditorText: Event<void> = this._editorTextFocus.onDidChangeToFalse;

	private _editorFocus: BooleanEventEmitter = this._register(new BooleanEventEmitter());
	public readonly onDidFocusEditor: Event<void> = this._editorFocus.onDidChangeToTrue;
	public readonly onDidBlurEditor: Event<void> = this._editorFocus.onDidChangeToFalse;

	private readonly _onWillType: Emitter<string> = this._register(new Emitter<string>());
	public readonly onWillType = this._onWillType.event;

	private readonly _onDidType: Emitter<string> = this._register(new Emitter<string>());
	public readonly onDidType = this._onDidType.event;

	private readonly _onDidPaste: Emitter<Range> = this._register(new Emitter<Range>());
	public readonly onDidPaste = this._onDidPaste.event;

	private readonly _onMouseUp: Emitter<editorBrowser.IEditorMouseEvent> = this._register(new Emitter<editorBrowser.IEditorMouseEvent>());
	public readonly onMouseUp: Event<editorBrowser.IEditorMouseEvent> = this._onMouseUp.event;

	private readonly _onMouseDown: Emitter<editorBrowser.IEditorMouseEvent> = this._register(new Emitter<editorBrowser.IEditorMouseEvent>());
	public readonly onMouseDown: Event<editorBrowser.IEditorMouseEvent> = this._onMouseDown.event;

	private readonly _onMouseDrag: Emitter<editorBrowser.IEditorMouseEvent> = this._register(new Emitter<editorBrowser.IEditorMouseEvent>());
	public readonly onMouseDrag: Event<editorBrowser.IEditorMouseEvent> = this._onMouseDrag.event;

	private readonly _onMouseDrop: Emitter<editorBrowser.IEditorMouseEvent> = this._register(new Emitter<editorBrowser.IEditorMouseEvent>());
	public readonly onMouseDrop: Event<editorBrowser.IEditorMouseEvent> = this._onMouseDrop.event;

	private readonly _onContextMenu: Emitter<editorBrowser.IEditorMouseEvent> = this._register(new Emitter<editorBrowser.IEditorMouseEvent>());
	public readonly onContextMenu: Event<editorBrowser.IEditorMouseEvent> = this._onContextMenu.event;

	private readonly _onMouseMove: Emitter<editorBrowser.IEditorMouseEvent> = this._register(new Emitter<editorBrowser.IEditorMouseEvent>());
	public readonly onMouseMove: Event<editorBrowser.IEditorMouseEvent> = this._onMouseMove.event;

	private readonly _onMouseLeave: Emitter<editorBrowser.IEditorMouseEvent> = this._register(new Emitter<editorBrowser.IEditorMouseEvent>());
	public readonly onMouseLeave: Event<editorBrowser.IEditorMouseEvent> = this._onMouseLeave.event;

	private readonly _onKeyUp: Emitter<IKeyboardEvent> = this._register(new Emitter<IKeyboardEvent>());
	public readonly onKeyUp: Event<IKeyboardEvent> = this._onKeyUp.event;

	private readonly _onKeyDown: Emitter<IKeyboardEvent> = this._register(new Emitter<IKeyboardEvent>());
	public readonly onKeyDown: Event<IKeyboardEvent> = this._onKeyDown.event;

	private readonly _onDidScrollChange: Emitter<editorCommon.IScrollEvent> = this._register(new Emitter<editorCommon.IScrollEvent>());
	public readonly onDidScrollChange: Event<editorCommon.IScrollEvent> = this._onDidScrollChange.event;

	private readonly _onDidChangeViewZones: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeViewZones: Event<void> = this._onDidChangeViewZones.event;
	//#endregion

	public readonly isSimpleWidget: boolean;
	private readonly _telemetryData: object;

	private readonly domElement: HTMLElement;
	private readonly id: number;
	private readonly _configuration: editorCommon.IConfiguration;

	protected _contributions: { [key: string]: editorCommon.IEditorContribution; };
	protected _actions: { [key: string]: editorCommon.IEditorAction; };

	// --- Members logically associated to a model
	protected model: ITextModel;
	private listenersToRemove: IDisposable[];
	private hasView: boolean;

	private viewModel: ViewModel;
	protected cursor: Cursor;

	protected readonly _instantiationService: IInstantiationService;
	protected readonly _contextKeyService: IContextKeyService;
	private readonly _notificationService: INotificationService;
	private readonly _codeEditorService: ICodeEditorService;
	private readonly _commandService: ICommandService;
	private readonly _themeService: IThemeService;

	private _focusTracker: CodeEditorWidgetFocusTracker;

	private contentWidgets: { [key: string]: IContentWidgetData; };
	private overlayWidgets: { [key: string]: IOverlayWidgetData; };

	protected _view: View;

	/**
	 * map from "parent" decoration type to live decoration ids.
	 */
	private _decorationTypeKeysToIds: { [decorationTypeKey: string]: string[] };
	private _decorationTypeSubtypes: { [decorationTypeKey: string]: { [subtype: string]: boolean } };

	constructor(
		domElement: HTMLElement,
		options: editorOptions.IEditorOptions,
		codeEditorWidgetOptions: ICodeEditorWidgetOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@INotificationService notificationService: INotificationService
	) {
		super();
		this.domElement = domElement;
		this.id = (++EDITOR_ID);
		this._decorationTypeKeysToIds = {};
		this._decorationTypeSubtypes = {};
		this.isSimpleWidget = codeEditorWidgetOptions.isSimpleWidget || false;
		this._telemetryData = codeEditorWidgetOptions.telemetryData || null;

		options = options || {};
		this._configuration = this._register(this._createConfiguration(options));
		this._register(this._configuration.onDidChange((e) => {
			this._onDidChangeConfiguration.fire(e);

			if (e.layoutInfo) {
				this._onDidLayoutChange.fire(this._configuration.editor.layoutInfo);
			}
		}));

		this._contextKeyService = this._register(contextKeyService.createScoped(this.domElement));
		this._notificationService = notificationService;
		this._codeEditorService = codeEditorService;
		this._commandService = commandService;
		this._themeService = themeService;
		this._register(new EditorContextKeysManager(this, this._contextKeyService));
		this._register(new EditorModeContext(this, this._contextKeyService));

		this._instantiationService = instantiationService.createChild(new ServiceCollection([IContextKeyService, this._contextKeyService]));

		this._attachModel(null);

		this._contributions = {};
		this._actions = {};

		this._focusTracker = new CodeEditorWidgetFocusTracker(domElement);
		this._focusTracker.onChange(() => {
			this._editorFocus.setValue(this._focusTracker.hasFocus());
		});

		this.contentWidgets = {};
		this.overlayWidgets = {};

		let contributions: IEditorContributionCtor[] = codeEditorWidgetOptions.contributions;
		if (!Array.isArray(contributions)) {
			contributions = EditorExtensionsRegistry.getEditorContributions();
		}
		for (let i = 0, len = contributions.length; i < len; i++) {
			let ctor = contributions[i];
			try {
				let contribution = this._instantiationService.createInstance(ctor, this);
				this._contributions[contribution.getId()] = contribution;
			} catch (err) {
				onUnexpectedError(err);
			}
		}

		EditorExtensionsRegistry.getEditorActions().forEach((action) => {
			const internalAction = new InternalEditorAction(
				action.id,
				action.label,
				action.alias,
				action.precondition,
				(): void | TPromise<void> => {
					return this._instantiationService.invokeFunction((accessor) => {
						return action.runEditorCommand(accessor, this, null);
					});
				},
				this._contextKeyService
			);
			this._actions[internalAction.id] = internalAction;
		});

		this._codeEditorService.addCodeEditor(this);
	}

	protected _createConfiguration(options: editorOptions.IEditorOptions): editorCommon.IConfiguration {
		return new Configuration(options, this.domElement);
	}

	public getId(): string {
		return this.getEditorType() + ':' + this.id;
	}

	public getEditorType(): string {
		return editorCommon.EditorType.ICodeEditor;
	}

	public dispose(): void {
		this._codeEditorService.removeCodeEditor(this);

		this.contentWidgets = {};
		this.overlayWidgets = {};

		this._focusTracker.dispose();

		let keys = Object.keys(this._contributions);
		for (let i = 0, len = keys.length; i < len; i++) {
			let contributionId = keys[i];
			this._contributions[contributionId].dispose();
		}
		this._contributions = {};

		// editor actions don't need to be disposed
		this._actions = {};
		this._removeDecorationTypes();
		this._postDetachModelCleanup(this._detachModel());

		this._onDidDispose.fire();

		super.dispose();
	}

	public invokeWithinContext<T>(fn: (accessor: ServicesAccessor) => T): T {
		return this._instantiationService.invokeFunction(fn);
	}

	public updateOptions(newOptions: editorOptions.IEditorOptions): void {
		this._configuration.updateOptions(newOptions);
	}

	public getConfiguration(): editorOptions.InternalEditorOptions {
		return this._configuration.editor;
	}

	public getRawConfiguration(): editorOptions.IEditorOptions {
		return this._configuration.getRawOptions();
	}

	public getValue(options: { preserveBOM: boolean; lineEnding: string; } = null): string {
		if (this.model) {
			let preserveBOM: boolean = (options && options.preserveBOM) ? true : false;
			let eolPreference = EndOfLinePreference.TextDefined;
			if (options && options.lineEnding && options.lineEnding === '\n') {
				eolPreference = EndOfLinePreference.LF;
			} else if (options && options.lineEnding && options.lineEnding === '\r\n') {
				eolPreference = EndOfLinePreference.CRLF;
			}
			return this.model.getValue(eolPreference, preserveBOM);
		}
		return '';
	}

	public setValue(newValue: string): void {
		if (this.model) {
			this.model.setValue(newValue);
		}
	}

	public getModel(): ITextModel {
		return this.model;
	}

	public setModel(model: ITextModel = null): void {
		if (this.model === model) {
			// Current model is the new model
			return;
		}

		let detachedModel = this._detachModel();
		this._attachModel(model);

		let e: editorCommon.IModelChangedEvent = {
			oldModelUrl: detachedModel ? detachedModel.uri : null,
			newModelUrl: model ? model.uri : null
		};

		this._removeDecorationTypes();
		this._onDidChangeModel.fire(e);
		this._postDetachModelCleanup(detachedModel);
	}

	private _removeDecorationTypes(): void {
		this._decorationTypeKeysToIds = {};
		if (this._decorationTypeSubtypes) {
			for (let decorationType in this._decorationTypeSubtypes) {
				let subTypes = this._decorationTypeSubtypes[decorationType];
				for (let subType in subTypes) {
					this._removeDecorationType(decorationType + '-' + subType);
				}
			}
			this._decorationTypeSubtypes = {};
		}
	}

	public getVisibleRanges(): Range[] {
		if (!this.hasView) {
			return [];
		}
		return this.viewModel.getVisibleRanges();
	}

	public getWhitespaces(): IEditorWhitespace[] {
		if (!this.hasView) {
			return [];
		}
		return this.viewModel.viewLayout.getWhitespaces();
	}

	private _getVerticalOffsetForPosition(modelLineNumber: number, modelColumn: number): number {
		let modelPosition = this.model.validatePosition({
			lineNumber: modelLineNumber,
			column: modelColumn
		});
		let viewPosition = this.viewModel.coordinatesConverter.convertModelPositionToViewPosition(modelPosition);
		return this.viewModel.viewLayout.getVerticalOffsetForLineNumber(viewPosition.lineNumber);
	}

	public getTopForLineNumber(lineNumber: number): number {
		if (!this.hasView) {
			return -1;
		}
		return this._getVerticalOffsetForPosition(lineNumber, 1);
	}

	public getTopForPosition(lineNumber: number, column: number): number {
		if (!this.hasView) {
			return -1;
		}
		return this._getVerticalOffsetForPosition(lineNumber, column);
	}

	public setHiddenAreas(ranges: IRange[]): void {
		if (this.viewModel) {
			this.viewModel.setHiddenAreas(ranges.map(r => Range.lift(r)));
		}
	}

	public getVisibleColumnFromPosition(rawPosition: IPosition): number {
		if (!this.model) {
			return rawPosition.column;
		}

		let position = this.model.validatePosition(rawPosition);
		let tabSize = this.model.getOptions().tabSize;

		return CursorColumns.visibleColumnFromColumn(this.model.getLineContent(position.lineNumber), position.column, tabSize) + 1;
	}

	public getPosition(): Position {
		if (!this.cursor) {
			return null;
		}
		return this.cursor.getPosition().clone();
	}

	public setPosition(position: IPosition): void {
		if (!this.cursor) {
			return;
		}
		if (!Position.isIPosition(position)) {
			throw new Error('Invalid arguments');
		}
		this.cursor.setSelections('api', [{
			selectionStartLineNumber: position.lineNumber,
			selectionStartColumn: position.column,
			positionLineNumber: position.lineNumber,
			positionColumn: position.column
		}]);
	}

	private _sendRevealRange(modelRange: Range, verticalType: VerticalRevealType, revealHorizontal: boolean, scrollType: editorCommon.ScrollType): void {
		if (!this.model || !this.cursor) {
			return;
		}
		if (!Range.isIRange(modelRange)) {
			throw new Error('Invalid arguments');
		}
		const validatedModelRange = this.model.validateRange(modelRange);
		const viewRange = this.viewModel.coordinatesConverter.convertModelRangeToViewRange(validatedModelRange);

		this.cursor.emitCursorRevealRange(viewRange, verticalType, revealHorizontal, scrollType);
	}

	public revealLine(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealLine(lineNumber, VerticalRevealType.Simple, scrollType);
	}

	public revealLineInCenter(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealLine(lineNumber, VerticalRevealType.Center, scrollType);
	}

	public revealLineInCenterIfOutsideViewport(lineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealLine(lineNumber, VerticalRevealType.CenterIfOutsideViewport, scrollType);
	}

	private _revealLine(lineNumber: number, revealType: VerticalRevealType, scrollType: editorCommon.ScrollType): void {
		if (typeof lineNumber !== 'number') {
			throw new Error('Invalid arguments');
		}

		this._sendRevealRange(
			new Range(lineNumber, 1, lineNumber, 1),
			revealType,
			false,
			scrollType
		);
	}

	public revealPosition(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealPosition(
			position,
			VerticalRevealType.Simple,
			true,
			scrollType
		);
	}

	public revealPositionInCenter(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealPosition(
			position,
			VerticalRevealType.Center,
			true,
			scrollType
		);
	}

	public revealPositionInCenterIfOutsideViewport(position: IPosition, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealPosition(
			position,
			VerticalRevealType.CenterIfOutsideViewport,
			true,
			scrollType
		);
	}

	private _revealPosition(position: IPosition, verticalType: VerticalRevealType, revealHorizontal: boolean, scrollType: editorCommon.ScrollType): void {
		if (!Position.isIPosition(position)) {
			throw new Error('Invalid arguments');
		}

		this._sendRevealRange(
			new Range(position.lineNumber, position.column, position.lineNumber, position.column),
			verticalType,
			revealHorizontal,
			scrollType
		);
	}

	public getSelection(): Selection {
		if (!this.cursor) {
			return null;
		}
		return this.cursor.getSelection().clone();
	}

	public getSelections(): Selection[] {
		if (!this.cursor) {
			return null;
		}
		let selections = this.cursor.getSelections();
		let result: Selection[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			result[i] = selections[i].clone();
		}
		return result;
	}

	public setSelection(range: IRange): void;
	public setSelection(editorRange: Range): void;
	public setSelection(selection: ISelection): void;
	public setSelection(editorSelection: Selection): void;
	public setSelection(something: any): void {
		let isSelection = Selection.isISelection(something);
		let isRange = Range.isIRange(something);

		if (!isSelection && !isRange) {
			throw new Error('Invalid arguments');
		}

		if (isSelection) {
			this._setSelectionImpl(<ISelection>something);
		} else if (isRange) {
			// act as if it was an IRange
			let selection: ISelection = {
				selectionStartLineNumber: something.startLineNumber,
				selectionStartColumn: something.startColumn,
				positionLineNumber: something.endLineNumber,
				positionColumn: something.endColumn
			};
			this._setSelectionImpl(selection);
		}
	}

	private _setSelectionImpl(sel: ISelection): void {
		if (!this.cursor) {
			return;
		}
		let selection = new Selection(sel.selectionStartLineNumber, sel.selectionStartColumn, sel.positionLineNumber, sel.positionColumn);
		this.cursor.setSelections('api', [selection]);
	}

	public revealLines(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealLines(
			startLineNumber,
			endLineNumber,
			VerticalRevealType.Simple,
			scrollType
		);
	}

	public revealLinesInCenter(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealLines(
			startLineNumber,
			endLineNumber,
			VerticalRevealType.Center,
			scrollType
		);
	}

	public revealLinesInCenterIfOutsideViewport(startLineNumber: number, endLineNumber: number, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealLines(
			startLineNumber,
			endLineNumber,
			VerticalRevealType.CenterIfOutsideViewport,
			scrollType
		);
	}

	private _revealLines(startLineNumber: number, endLineNumber: number, verticalType: VerticalRevealType, scrollType: editorCommon.ScrollType): void {
		if (typeof startLineNumber !== 'number' || typeof endLineNumber !== 'number') {
			throw new Error('Invalid arguments');
		}

		this._sendRevealRange(
			new Range(startLineNumber, 1, endLineNumber, 1),
			verticalType,
			false,
			scrollType
		);
	}

	public revealRange(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth, revealVerticalInCenter: boolean = false, revealHorizontal: boolean = true): void {
		this._revealRange(
			range,
			revealVerticalInCenter ? VerticalRevealType.Center : VerticalRevealType.Simple,
			revealHorizontal,
			scrollType
		);
	}

	public revealRangeInCenter(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealRange(
			range,
			VerticalRevealType.Center,
			true,
			scrollType
		);
	}

	public revealRangeInCenterIfOutsideViewport(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealRange(
			range,
			VerticalRevealType.CenterIfOutsideViewport,
			true,
			scrollType
		);
	}

	public revealRangeAtTop(range: IRange, scrollType: editorCommon.ScrollType = editorCommon.ScrollType.Smooth): void {
		this._revealRange(
			range,
			VerticalRevealType.Top,
			true,
			scrollType
		);
	}

	private _revealRange(range: IRange, verticalType: VerticalRevealType, revealHorizontal: boolean, scrollType: editorCommon.ScrollType): void {
		if (!Range.isIRange(range)) {
			throw new Error('Invalid arguments');
		}

		this._sendRevealRange(
			Range.lift(range),
			verticalType,
			revealHorizontal,
			scrollType
		);
	}

	public setSelections(ranges: ISelection[]): void {
		if (!this.cursor) {
			return;
		}
		if (!ranges || ranges.length === 0) {
			throw new Error('Invalid arguments');
		}
		for (let i = 0, len = ranges.length; i < len; i++) {
			if (!Selection.isISelection(ranges[i])) {
				throw new Error('Invalid arguments');
			}
		}
		this.cursor.setSelections('api', ranges);
	}

	public getScrollWidth(): number {
		if (!this.hasView) {
			return -1;
		}
		return this.viewModel.viewLayout.getScrollWidth();
	}
	public getScrollLeft(): number {
		if (!this.hasView) {
			return -1;
		}
		return this.viewModel.viewLayout.getCurrentScrollLeft();
	}

	public getScrollHeight(): number {
		if (!this.hasView) {
			return -1;
		}
		return this.viewModel.viewLayout.getScrollHeight();
	}
	public getScrollTop(): number {
		if (!this.hasView) {
			return -1;
		}
		return this.viewModel.viewLayout.getCurrentScrollTop();
	}

	public setScrollLeft(newScrollLeft: number): void {
		if (!this.hasView) {
			return;
		}
		if (typeof newScrollLeft !== 'number') {
			throw new Error('Invalid arguments');
		}
		this.viewModel.viewLayout.setScrollPositionNow({
			scrollLeft: newScrollLeft
		});
	}
	public setScrollTop(newScrollTop: number): void {
		if (!this.hasView) {
			return;
		}
		if (typeof newScrollTop !== 'number') {
			throw new Error('Invalid arguments');
		}
		this.viewModel.viewLayout.setScrollPositionNow({
			scrollTop: newScrollTop
		});
	}
	public setScrollPosition(position: editorCommon.INewScrollPosition): void {
		if (!this.hasView) {
			return;
		}
		this.viewModel.viewLayout.setScrollPositionNow(position);
	}

	public saveViewState(): editorCommon.ICodeEditorViewState {
		if (!this.cursor || !this.hasView) {
			return null;
		}
		const contributionsState: { [key: string]: any } = {};

		const keys = Object.keys(this._contributions);
		for (let i = 0, len = keys.length; i < len; i++) {
			const id = keys[i];
			const contribution = this._contributions[id];
			if (typeof contribution.saveViewState === 'function') {
				contributionsState[id] = contribution.saveViewState();
			}
		}

		const cursorState = this.cursor.saveState();
		const viewState = this.viewModel.saveState();
		return {
			cursorState: cursorState,
			viewState: viewState,
			contributionsState: contributionsState
		};
	}

	public restoreViewState(s: editorCommon.ICodeEditorViewState): void {
		if (!this.cursor || !this.hasView) {
			return;
		}
		if (s && s.cursorState && s.viewState) {
			let codeEditorState = <editorCommon.ICodeEditorViewState>s;
			let cursorState = <any>codeEditorState.cursorState;
			if (Array.isArray(cursorState)) {
				this.cursor.restoreState(<editorCommon.ICursorState[]>cursorState);
			} else {
				// Backwards compatibility
				this.cursor.restoreState([<editorCommon.ICursorState>cursorState]);
			}

			let contributionsState = s.contributionsState || {};
			let keys = Object.keys(this._contributions);
			for (let i = 0, len = keys.length; i < len; i++) {
				let id = keys[i];
				let contribution = this._contributions[id];
				if (typeof contribution.restoreViewState === 'function') {
					contribution.restoreViewState(contributionsState[id]);
				}
			}

			const reducedState = this.viewModel.reduceRestoreState(s.viewState);
			const linesViewportData = this.viewModel.viewLayout.getLinesViewportDataAtScrollTop(reducedState.scrollTop);
			const startPosition = this.viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(linesViewportData.startLineNumber, 1));
			const endPosition = this.viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(linesViewportData.endLineNumber, 1));
			this.model.tokenizeViewport(startPosition.lineNumber, endPosition.lineNumber);
			this._view.restoreState(reducedState);
		}
	}

	public onVisible(): void {
	}

	public onHide(): void {
	}

	public getContribution<T extends editorCommon.IEditorContribution>(id: string): T {
		return <T>(this._contributions[id] || null);
	}

	public getActions(): editorCommon.IEditorAction[] {
		let result: editorCommon.IEditorAction[] = [];

		let keys = Object.keys(this._actions);
		for (let i = 0, len = keys.length; i < len; i++) {
			let id = keys[i];
			result.push(this._actions[id]);
		}

		return result;
	}

	public getSupportedActions(): editorCommon.IEditorAction[] {
		let result = this.getActions();

		result = result.filter(action => action.isSupported());

		return result;
	}

	public getAction(id: string): editorCommon.IEditorAction {
		return this._actions[id] || null;
	}

	public trigger(source: string, handlerId: string, payload: any): void {
		payload = payload || {};

		// Special case for typing
		if (handlerId === editorCommon.Handler.Type) {
			if (!this.cursor || typeof payload.text !== 'string' || payload.text.length === 0) {
				// nothing to do
				return;
			}
			if (source === 'keyboard') {
				this._onWillType.fire(payload.text);
			}
			this.cursor.trigger(source, handlerId, payload);
			if (source === 'keyboard') {
				this._onDidType.fire(payload.text);
			}
			return;
		}

		// Special case for pasting
		if (handlerId === editorCommon.Handler.Paste) {
			if (!this.cursor || typeof payload.text !== 'string' || payload.text.length === 0) {
				// nothing to do
				return;
			}
			const startPosition = this.cursor.getSelection().getStartPosition();
			this.cursor.trigger(source, handlerId, payload);
			const endPosition = this.cursor.getSelection().getStartPosition();
			if (source === 'keyboard') {
				this._onDidPaste.fire(
					new Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column)
				);
			}
			return;
		}

		const action = this.getAction(handlerId);
		if (action) {
			TPromise.as(action.run()).then(null, onUnexpectedError);
			return;
		}

		if (!this.cursor) {
			return;
		}

		if (this._triggerEditorCommand(source, handlerId, payload)) {
			return;
		}

		this.cursor.trigger(source, handlerId, payload);
	}

	private _triggerEditorCommand(source: string, handlerId: string, payload: any): boolean {
		const command = EditorExtensionsRegistry.getEditorCommand(handlerId);
		if (command) {
			payload = payload || {};
			payload.source = source;
			TPromise.as(command.runEditorCommand(null, this, payload)).done(null, onUnexpectedError);
			return true;
		}

		return false;
	}

	public _getCursors(): ICursors {
		return this.cursor;
	}

	public _getCursorConfiguration(): CursorConfiguration {
		return this.cursor.context.config;
	}

	public pushUndoStop(): boolean {
		if (!this.model) {
			return false;
		}
		if (this._configuration.editor.readOnly) {
			// read only editor => sorry!
			return false;
		}
		this.model.pushStackElement();
		return true;
	}

	public executeEdits(source: string, edits: IIdentifiedSingleEditOperation[], endCursorState?: Selection[]): boolean {
		if (!this.cursor) {
			// no view, no cursor
			return false;
		}
		if (this._configuration.editor.readOnly) {
			// read only editor => sorry!
			return false;
		}

		this.model.pushEditOperations(this.cursor.getSelections(), edits, () => {
			return endCursorState ? endCursorState : null;
		});

		if (endCursorState) {
			this.cursor.setSelections(source, endCursorState);
		}

		return true;
	}

	public executeCommand(source: string, command: editorCommon.ICommand): void {
		if (!this.cursor) {
			return;
		}
		this.cursor.trigger(source, editorCommon.Handler.ExecuteCommand, command);
	}

	public executeCommands(source: string, commands: editorCommon.ICommand[]): void {
		if (!this.cursor) {
			return;
		}
		this.cursor.trigger(source, editorCommon.Handler.ExecuteCommands, commands);
	}

	public changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any {
		if (!this.model) {
			//			console.warn('Cannot change decorations on editor that is not attached to a model');
			// callback will not be called
			return null;
		}
		return this.model.changeDecorations(callback, this.id);
	}

	public getLineDecorations(lineNumber: number): IModelDecoration[] {
		if (!this.model) {
			return null;
		}
		return this.model.getLineDecorations(lineNumber, this.id, this._configuration.editor.readOnly);
	}

	public deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[] {
		if (!this.model) {
			return [];
		}

		if (oldDecorations.length === 0 && newDecorations.length === 0) {
			return oldDecorations;
		}

		return this.model.deltaDecorations(oldDecorations, newDecorations, this.id);
	}

	public setDecorations(decorationTypeKey: string, decorationOptions: editorCommon.IDecorationOptions[]): void {

		let newDecorationsSubTypes: { [key: string]: boolean } = {};
		let oldDecorationsSubTypes = this._decorationTypeSubtypes[decorationTypeKey] || {};
		this._decorationTypeSubtypes[decorationTypeKey] = newDecorationsSubTypes;

		let newModelDecorations: IModelDeltaDecoration[] = [];

		for (let decorationOption of decorationOptions) {
			let typeKey = decorationTypeKey;
			if (decorationOption.renderOptions) {
				// identify custom reder options by a hash code over all keys and values
				// For custom render options register a decoration type if necessary
				let subType = hash(decorationOption.renderOptions).toString(16);
				// The fact that `decorationTypeKey` appears in the typeKey has no influence
				// it is just a mechanism to get predictable and unique keys (repeatable for the same options and unique across clients)
				typeKey = decorationTypeKey + '-' + subType;
				if (!oldDecorationsSubTypes[subType] && !newDecorationsSubTypes[subType]) {
					// decoration type did not exist before, register new one
					this._registerDecorationType(typeKey, decorationOption.renderOptions, decorationTypeKey);
				}
				newDecorationsSubTypes[subType] = true;
			}
			let opts = this._resolveDecorationOptions(typeKey, !!decorationOption.hoverMessage);
			if (decorationOption.hoverMessage) {
				opts.hoverMessage = decorationOption.hoverMessage;
			}
			newModelDecorations.push({ range: decorationOption.range, options: opts });
		}

		// remove decoration sub types that are no longer used, deregister decoration type if necessary
		for (let subType in oldDecorationsSubTypes) {
			if (!newDecorationsSubTypes[subType]) {
				this._removeDecorationType(decorationTypeKey + '-' + subType);
			}
		}

		// update all decorations
		let oldDecorationsIds = this._decorationTypeKeysToIds[decorationTypeKey] || [];
		this._decorationTypeKeysToIds[decorationTypeKey] = this.deltaDecorations(oldDecorationsIds, newModelDecorations);
	}

	public setDecorationsFast(decorationTypeKey: string, ranges: IRange[]): void {

		// remove decoration sub types that are no longer used, deregister decoration type if necessary
		let oldDecorationsSubTypes = this._decorationTypeSubtypes[decorationTypeKey] || {};
		for (let subType in oldDecorationsSubTypes) {
			this._removeDecorationType(decorationTypeKey + '-' + subType);
		}
		this._decorationTypeSubtypes[decorationTypeKey] = {};

		const opts = ModelDecorationOptions.createDynamic(this._resolveDecorationOptions(decorationTypeKey, false));
		let newModelDecorations: IModelDeltaDecoration[] = new Array<IModelDeltaDecoration>(ranges.length);
		for (let i = 0, len = ranges.length; i < len; i++) {
			newModelDecorations[i] = { range: ranges[i], options: opts };
		}

		// update all decorations
		let oldDecorationsIds = this._decorationTypeKeysToIds[decorationTypeKey] || [];
		this._decorationTypeKeysToIds[decorationTypeKey] = this.deltaDecorations(oldDecorationsIds, newModelDecorations);
	}

	public removeDecorations(decorationTypeKey: string): void {
		// remove decorations for type and sub type
		let oldDecorationsIds = this._decorationTypeKeysToIds[decorationTypeKey];
		if (oldDecorationsIds) {
			this.deltaDecorations(oldDecorationsIds, []);
		}
		if (this._decorationTypeKeysToIds.hasOwnProperty(decorationTypeKey)) {
			delete this._decorationTypeKeysToIds[decorationTypeKey];
		}
		if (this._decorationTypeSubtypes.hasOwnProperty(decorationTypeKey)) {
			delete this._decorationTypeSubtypes[decorationTypeKey];
		}
	}

	public getLayoutInfo(): editorOptions.EditorLayoutInfo {
		return this._configuration.editor.layoutInfo;
	}

	public createOverviewRuler(cssClassName: string): editorBrowser.IOverviewRuler {
		return this._view.createOverviewRuler(cssClassName);
	}

	public getDomNode(): HTMLElement {
		if (!this.hasView) {
			return null;
		}
		return this._view.domNode.domNode;
	}

	public delegateVerticalScrollbarMouseDown(browserEvent: IMouseEvent): void {
		if (!this.hasView) {
			return;
		}
		this._view.delegateVerticalScrollbarMouseDown(browserEvent);
	}

	public layout(dimension?: editorCommon.IDimension): void {
		this._configuration.observeReferenceElement(dimension);
		this.render();
	}

	public focus(): void {
		if (!this.hasView) {
			return;
		}
		this._view.focus();
	}

	public isFocused(): boolean {
		return this.hasView && this._view.isFocused();
	}

	public hasWidgetFocus(): boolean {
		return this._focusTracker && this._focusTracker.hasFocus();
	}

	public addContentWidget(widget: editorBrowser.IContentWidget): void {
		let widgetData: IContentWidgetData = {
			widget: widget,
			position: widget.getPosition()
		};

		if (this.contentWidgets.hasOwnProperty(widget.getId())) {
			console.warn('Overwriting a content widget with the same id.');
		}

		this.contentWidgets[widget.getId()] = widgetData;

		if (this.hasView) {
			this._view.addContentWidget(widgetData);
		}
	}

	public layoutContentWidget(widget: editorBrowser.IContentWidget): void {
		let widgetId = widget.getId();
		if (this.contentWidgets.hasOwnProperty(widgetId)) {
			let widgetData = this.contentWidgets[widgetId];
			widgetData.position = widget.getPosition();
			if (this.hasView) {
				this._view.layoutContentWidget(widgetData);
			}
		}
	}

	public removeContentWidget(widget: editorBrowser.IContentWidget): void {
		let widgetId = widget.getId();
		if (this.contentWidgets.hasOwnProperty(widgetId)) {
			let widgetData = this.contentWidgets[widgetId];
			delete this.contentWidgets[widgetId];
			if (this.hasView) {
				this._view.removeContentWidget(widgetData);
			}
		}
	}

	public addOverlayWidget(widget: editorBrowser.IOverlayWidget): void {
		let widgetData: IOverlayWidgetData = {
			widget: widget,
			position: widget.getPosition()
		};

		if (this.overlayWidgets.hasOwnProperty(widget.getId())) {
			console.warn('Overwriting an overlay widget with the same id.');
		}

		this.overlayWidgets[widget.getId()] = widgetData;

		if (this.hasView) {
			this._view.addOverlayWidget(widgetData);
		}
	}

	public layoutOverlayWidget(widget: editorBrowser.IOverlayWidget): void {
		let widgetId = widget.getId();
		if (this.overlayWidgets.hasOwnProperty(widgetId)) {
			let widgetData = this.overlayWidgets[widgetId];
			widgetData.position = widget.getPosition();
			if (this.hasView) {
				this._view.layoutOverlayWidget(widgetData);
			}
		}
	}

	public removeOverlayWidget(widget: editorBrowser.IOverlayWidget): void {
		let widgetId = widget.getId();
		if (this.overlayWidgets.hasOwnProperty(widgetId)) {
			let widgetData = this.overlayWidgets[widgetId];
			delete this.overlayWidgets[widgetId];
			if (this.hasView) {
				this._view.removeOverlayWidget(widgetData);
			}
		}
	}

	public changeViewZones(callback: (accessor: editorBrowser.IViewZoneChangeAccessor) => void): void {
		if (!this.hasView) {
			return;
		}
		let hasChanges = this._view.change(callback);
		if (hasChanges) {
			this._onDidChangeViewZones.fire();
		}
	}

	public getTargetAtClientPoint(clientX: number, clientY: number): editorBrowser.IMouseTarget {
		if (!this.hasView) {
			return null;
		}
		return this._view.getTargetAtClientPoint(clientX, clientY);
	}

	public getScrolledVisiblePosition(rawPosition: IPosition): { top: number; left: number; height: number; } {
		if (!this.hasView) {
			return null;
		}

		let position = this.model.validatePosition(rawPosition);
		let layoutInfo = this._configuration.editor.layoutInfo;

		let top = this._getVerticalOffsetForPosition(position.lineNumber, position.column) - this.getScrollTop();
		let left = this._view.getOffsetForColumn(position.lineNumber, position.column) + layoutInfo.glyphMarginWidth + layoutInfo.lineNumbersWidth + layoutInfo.decorationsWidth - this.getScrollLeft();

		return {
			top: top,
			left: left,
			height: this._configuration.editor.lineHeight
		};
	}

	public getOffsetForColumn(lineNumber: number, column: number): number {
		if (!this.hasView) {
			return -1;
		}
		return this._view.getOffsetForColumn(lineNumber, column);
	}

	public render(): void {
		if (!this.hasView) {
			return;
		}
		this._view.render(true, false);
	}

	public applyFontInfo(target: HTMLElement): void {
		Configuration.applyFontInfoSlow(target, this._configuration.editor.fontInfo);
	}

	protected _attachModel(model: ITextModel): void {
		this._view = null;

		this.model = model ? model : null;
		this.listenersToRemove = [];
		this.viewModel = null;
		this.cursor = null;

		if (this.model) {
			this.domElement.setAttribute('data-mode-id', this.model.getLanguageIdentifier().language);
			this._configuration.setIsDominatedByLongLines(this.model.isDominatedByLongLines());
			this._configuration.setMaxLineNumber(this.model.getLineCount());

			this.model.onBeforeAttached();

			this.viewModel = new ViewModel(this.id, this._configuration, this.model, (callback) => dom.scheduleAtNextAnimationFrame(callback));

			this.listenersToRemove.push(this.model.onDidChangeDecorations((e) => this._onDidChangeModelDecorations.fire(e)));
			this.listenersToRemove.push(this.model.onDidChangeLanguage((e) => {
				if (!this.model) {
					return;
				}
				this.domElement.setAttribute('data-mode-id', this.model.getLanguageIdentifier().language);
				this._onDidChangeModelLanguage.fire(e);
			}));
			this.listenersToRemove.push(this.model.onDidChangeLanguageConfiguration((e) => this._onDidChangeModelLanguageConfiguration.fire(e)));
			this.listenersToRemove.push(this.model.onDidChangeContent((e) => this._onDidChangeModelContent.fire(e)));
			this.listenersToRemove.push(this.model.onDidChangeOptions((e) => this._onDidChangeModelOptions.fire(e)));
			// Someone might destroy the model from under the editor, so prevent any exceptions by setting a null model
			this.listenersToRemove.push(this.model.onWillDispose(() => this.setModel(null)));

			this.cursor = new Cursor(
				this._configuration,
				this.model,
				this.viewModel
			);

			this._createView();

			this.listenersToRemove.push(this.cursor.onDidReachMaxCursorCount(() => {
				this._notificationService.warn(nls.localize('cursors.maximum', "The number of cursors has been limited to {0}.", Cursor.MAX_CURSOR_COUNT));
			}));

			this.listenersToRemove.push(this.cursor.onDidAttemptReadOnlyEdit(() => {
				this._onDidAttemptReadOnlyEdit.fire(void 0);
			}));

			this.listenersToRemove.push(this.cursor.onDidChange((e: CursorStateChangedEvent) => {

				let positions: Position[] = [];
				for (let i = 0, len = e.selections.length; i < len; i++) {
					positions[i] = e.selections[i].getPosition();
				}

				const e1: ICursorPositionChangedEvent = {
					position: positions[0],
					secondaryPositions: positions.slice(1),
					reason: e.reason,
					source: e.source
				};
				this._onDidChangeCursorPosition.fire(e1);

				const e2: ICursorSelectionChangedEvent = {
					selection: e.selections[0],
					secondarySelections: e.selections.slice(1),
					source: e.source,
					reason: e.reason
				};
				this._onDidChangeCursorSelection.fire(e2);
			}));

		} else {
			this.hasView = false;
		}

		if (this._view) {
			this.domElement.appendChild(this._view.domNode.domNode);

			let keys = Object.keys(this.contentWidgets);
			for (let i = 0, len = keys.length; i < len; i++) {
				let widgetId = keys[i];
				this._view.addContentWidget(this.contentWidgets[widgetId]);
			}

			keys = Object.keys(this.overlayWidgets);
			for (let i = 0, len = keys.length; i < len; i++) {
				let widgetId = keys[i];
				this._view.addOverlayWidget(this.overlayWidgets[widgetId]);
			}

			this._view.render(false, true);
			this.hasView = true;
			this._view.domNode.domNode.setAttribute('data-uri', model.uri.toString());
		}
	}

	protected _createView(): void {
		let commandDelegate: ICommandDelegate;
		if (this.isSimpleWidget) {
			commandDelegate = {
				paste: (source: string, text: string, pasteOnNewLine: boolean, multicursorText: string[]) => {
					this.cursor.trigger(source, editorCommon.Handler.Paste, { text, pasteOnNewLine, multicursorText });
				},
				type: (source: string, text: string) => {
					this.cursor.trigger(source, editorCommon.Handler.Type, { text });
				},
				replacePreviousChar: (source: string, text: string, replaceCharCnt: number) => {
					this.cursor.trigger(source, editorCommon.Handler.ReplacePreviousChar, { text, replaceCharCnt });
				},
				compositionStart: (source: string) => {
					this.cursor.trigger(source, editorCommon.Handler.CompositionStart, undefined);
				},
				compositionEnd: (source: string) => {
					this.cursor.trigger(source, editorCommon.Handler.CompositionEnd, undefined);
				},
				cut: (source: string) => {
					this.cursor.trigger(source, editorCommon.Handler.Cut, undefined);
				}
			};
		} else {
			commandDelegate = {
				paste: (source: string, text: string, pasteOnNewLine: boolean, multicursorText: string[]) => {
					this._commandService.executeCommand(editorCommon.Handler.Paste, {
						text: text,
						pasteOnNewLine: pasteOnNewLine,
						multicursorText: multicursorText
					});
				},
				type: (source: string, text: string) => {
					this._commandService.executeCommand(editorCommon.Handler.Type, {
						text: text
					});
				},
				replacePreviousChar: (source: string, text: string, replaceCharCnt: number) => {
					this._commandService.executeCommand(editorCommon.Handler.ReplacePreviousChar, {
						text: text,
						replaceCharCnt: replaceCharCnt
					});
				},
				compositionStart: (source: string) => {
					this._commandService.executeCommand(editorCommon.Handler.CompositionStart, {});
				},
				compositionEnd: (source: string) => {
					this._commandService.executeCommand(editorCommon.Handler.CompositionEnd, {});
				},
				cut: (source: string) => {
					this._commandService.executeCommand(editorCommon.Handler.Cut, {});
				}
			};
		}

		this._view = new View(
			commandDelegate,
			this._configuration,
			this._themeService,
			this.viewModel,
			this.cursor,
			(editorCommand: CoreEditorCommand, args: any) => {
				if (!this.cursor) {
					return;
				}
				editorCommand.runCoreEditorCommand(this.cursor, args);
			}
		);

		const viewEventBus = this._view.getInternalEventBus();

		viewEventBus.onDidGainFocus = () => {
			this._editorTextFocus.setValue(true);
			// In IE, the focus is not synchronous, so we give it a little help
			this._editorFocus.setValue(true);
		};

		viewEventBus.onDidScroll = (e) => this._onDidScrollChange.fire(e);
		viewEventBus.onDidLoseFocus = () => this._editorTextFocus.setValue(false);
		viewEventBus.onContextMenu = (e) => this._onContextMenu.fire(e);
		viewEventBus.onMouseDown = (e) => this._onMouseDown.fire(e);
		viewEventBus.onMouseUp = (e) => this._onMouseUp.fire(e);
		viewEventBus.onMouseDrag = (e) => this._onMouseDrag.fire(e);
		viewEventBus.onMouseDrop = (e) => this._onMouseDrop.fire(e);
		viewEventBus.onKeyUp = (e) => this._onKeyUp.fire(e);
		viewEventBus.onMouseMove = (e) => this._onMouseMove.fire(e);
		viewEventBus.onMouseLeave = (e) => this._onMouseLeave.fire(e);
		viewEventBus.onKeyDown = (e) => this._onKeyDown.fire(e);
	}

	protected _postDetachModelCleanup(detachedModel: ITextModel): void {
		if (detachedModel) {
			detachedModel.removeAllDecorationsWithOwnerId(this.id);
		}
	}

	private _detachModel(): ITextModel {
		let removeDomNode: HTMLElement = null;

		if (this._view) {
			this._view.dispose();
			removeDomNode = this._view.domNode.domNode;
			this._view = null;
		}

		if (this.model) {
			this.model.onBeforeDetached();
		}

		this.hasView = false;

		this.listenersToRemove = dispose(this.listenersToRemove);

		if (this.cursor) {
			this.cursor.dispose();
			this.cursor = null;
		}

		if (this.viewModel) {
			this.viewModel.dispose();
			this.viewModel = null;
		}

		let result = this.model;
		this.model = null;

		this.domElement.removeAttribute('data-mode-id');

		if (removeDomNode) {
			this.domElement.removeChild(removeDomNode);
		}

		return result;
	}

	private _registerDecorationType(key: string, options: editorCommon.IDecorationRenderOptions, parentTypeKey?: string): void {
		this._codeEditorService.registerDecorationType(key, options, parentTypeKey);
	}

	private _removeDecorationType(key: string): void {
		this._codeEditorService.removeDecorationType(key);
	}

	private _resolveDecorationOptions(typeKey: string, writable: boolean): IModelDecorationOptions {
		return this._codeEditorService.resolveDecorationOptions(typeKey, writable);
	}

	/* __GDPR__FRAGMENT__
		"EditorTelemetryData" : {}
	*/
	public getTelemetryData(): { [key: string]: any; } {
		return this._telemetryData;
	}
}

const enum BooleanEventValue {
	NotSet,
	False,
	True
}

export class BooleanEventEmitter extends Disposable {
	private readonly _onDidChangeToTrue: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeToTrue: Event<void> = this._onDidChangeToTrue.event;

	private readonly _onDidChangeToFalse: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeToFalse: Event<void> = this._onDidChangeToFalse.event;

	private _value: BooleanEventValue;

	constructor() {
		super();
		this._value = BooleanEventValue.NotSet;
	}

	public setValue(_value: boolean) {
		let value = (_value ? BooleanEventValue.True : BooleanEventValue.False);
		if (this._value === value) {
			return;
		}
		this._value = value;
		if (this._value === BooleanEventValue.True) {
			this._onDidChangeToTrue.fire();
		} else if (this._value === BooleanEventValue.False) {
			this._onDidChangeToFalse.fire();
		}
	}
}

class EditorContextKeysManager extends Disposable {

	private _editor: CodeEditorWidget;
	private _editorFocus: IContextKey<boolean>;
	private _textInputFocus: IContextKey<boolean>;
	private _editorTextFocus: IContextKey<boolean>;
	private _editorTabMovesFocus: IContextKey<boolean>;
	private _editorReadonly: IContextKey<boolean>;
	private _hasMultipleSelections: IContextKey<boolean>;
	private _hasNonEmptySelection: IContextKey<boolean>;

	constructor(
		editor: CodeEditorWidget,
		contextKeyService: IContextKeyService
	) {
		super();

		this._editor = editor;

		contextKeyService.createKey('editorId', editor.getId());
		this._editorFocus = EditorContextKeys.focus.bindTo(contextKeyService);
		this._textInputFocus = EditorContextKeys.textInputFocus.bindTo(contextKeyService);
		this._editorTextFocus = EditorContextKeys.editorTextFocus.bindTo(contextKeyService);
		this._editorTabMovesFocus = EditorContextKeys.tabMovesFocus.bindTo(contextKeyService);
		this._editorReadonly = EditorContextKeys.readOnly.bindTo(contextKeyService);
		this._hasMultipleSelections = EditorContextKeys.hasMultipleSelections.bindTo(contextKeyService);
		this._hasNonEmptySelection = EditorContextKeys.hasNonEmptySelection.bindTo(contextKeyService);

		this._register(this._editor.onDidChangeConfiguration(() => this._updateFromConfig()));
		this._register(this._editor.onDidChangeCursorSelection(() => this._updateFromSelection()));
		this._register(this._editor.onDidFocusEditor(() => this._updateFromFocus()));
		this._register(this._editor.onDidBlurEditor(() => this._updateFromFocus()));
		this._register(this._editor.onDidFocusEditorText(() => this._updateFromFocus()));
		this._register(this._editor.onDidBlurEditorText(() => this._updateFromFocus()));

		this._updateFromConfig();
		this._updateFromSelection();
		this._updateFromFocus();
	}

	private _updateFromConfig(): void {
		let config = this._editor.getConfiguration();

		this._editorTabMovesFocus.set(config.tabFocusMode);
		this._editorReadonly.set(config.readOnly);
	}

	private _updateFromSelection(): void {
		let selections = this._editor.getSelections();
		if (!selections) {
			this._hasMultipleSelections.reset();
			this._hasNonEmptySelection.reset();
		} else {
			this._hasMultipleSelections.set(selections.length > 1);
			this._hasNonEmptySelection.set(selections.some(s => !s.isEmpty()));
		}
	}

	private _updateFromFocus(): void {
		this._editorFocus.set(this._editor.hasWidgetFocus() && !this._editor.isSimpleWidget);
		this._editorTextFocus.set(this._editor.isFocused() && !this._editor.isSimpleWidget);
		this._textInputFocus.set(this._editor.isFocused());
	}
}

export class EditorModeContext extends Disposable {

	private _editor: CodeEditorWidget;

	private _langId: IContextKey<string>;
	private _hasCompletionItemProvider: IContextKey<boolean>;
	private _hasCodeActionsProvider: IContextKey<boolean>;
	private _hasCodeLensProvider: IContextKey<boolean>;
	private _hasDefinitionProvider: IContextKey<boolean>;
	private _hasImplementationProvider: IContextKey<boolean>;
	private _hasTypeDefinitionProvider: IContextKey<boolean>;
	private _hasHoverProvider: IContextKey<boolean>;
	private _hasDocumentHighlightProvider: IContextKey<boolean>;
	private _hasDocumentSymbolProvider: IContextKey<boolean>;
	private _hasReferenceProvider: IContextKey<boolean>;
	private _hasRenameProvider: IContextKey<boolean>;
	private _hasDocumentFormattingProvider: IContextKey<boolean>;
	private _hasDocumentSelectionFormattingProvider: IContextKey<boolean>;
	private _hasSignatureHelpProvider: IContextKey<boolean>;
	private _isInWalkThrough: IContextKey<boolean>;

	constructor(
		editor: CodeEditorWidget,
		contextKeyService: IContextKeyService
	) {
		super();
		this._editor = editor;

		this._langId = EditorContextKeys.languageId.bindTo(contextKeyService);
		this._hasCompletionItemProvider = EditorContextKeys.hasCompletionItemProvider.bindTo(contextKeyService);
		this._hasCodeActionsProvider = EditorContextKeys.hasCodeActionsProvider.bindTo(contextKeyService);
		this._hasCodeLensProvider = EditorContextKeys.hasCodeLensProvider.bindTo(contextKeyService);
		this._hasDefinitionProvider = EditorContextKeys.hasDefinitionProvider.bindTo(contextKeyService);
		this._hasImplementationProvider = EditorContextKeys.hasImplementationProvider.bindTo(contextKeyService);
		this._hasTypeDefinitionProvider = EditorContextKeys.hasTypeDefinitionProvider.bindTo(contextKeyService);
		this._hasHoverProvider = EditorContextKeys.hasHoverProvider.bindTo(contextKeyService);
		this._hasDocumentHighlightProvider = EditorContextKeys.hasDocumentHighlightProvider.bindTo(contextKeyService);
		this._hasDocumentSymbolProvider = EditorContextKeys.hasDocumentSymbolProvider.bindTo(contextKeyService);
		this._hasReferenceProvider = EditorContextKeys.hasReferenceProvider.bindTo(contextKeyService);
		this._hasRenameProvider = EditorContextKeys.hasRenameProvider.bindTo(contextKeyService);
		this._hasDocumentFormattingProvider = EditorContextKeys.hasDocumentFormattingProvider.bindTo(contextKeyService);
		this._hasDocumentSelectionFormattingProvider = EditorContextKeys.hasDocumentSelectionFormattingProvider.bindTo(contextKeyService);
		this._hasSignatureHelpProvider = EditorContextKeys.hasSignatureHelpProvider.bindTo(contextKeyService);
		this._isInWalkThrough = EditorContextKeys.isInEmbeddedEditor.bindTo(contextKeyService);

		const update = () => this._update();

		// update when model/mode changes
		this._register(editor.onDidChangeModel(update));
		this._register(editor.onDidChangeModelLanguage(update));

		// update when registries change
		this._register(modes.SuggestRegistry.onDidChange(update));
		this._register(modes.CodeActionProviderRegistry.onDidChange(update));
		this._register(modes.CodeLensProviderRegistry.onDidChange(update));
		this._register(modes.DefinitionProviderRegistry.onDidChange(update));
		this._register(modes.ImplementationProviderRegistry.onDidChange(update));
		this._register(modes.TypeDefinitionProviderRegistry.onDidChange(update));
		this._register(modes.HoverProviderRegistry.onDidChange(update));
		this._register(modes.DocumentHighlightProviderRegistry.onDidChange(update));
		this._register(modes.DocumentSymbolProviderRegistry.onDidChange(update));
		this._register(modes.ReferenceProviderRegistry.onDidChange(update));
		this._register(modes.RenameProviderRegistry.onDidChange(update));
		this._register(modes.DocumentFormattingEditProviderRegistry.onDidChange(update));
		this._register(modes.DocumentRangeFormattingEditProviderRegistry.onDidChange(update));
		this._register(modes.SignatureHelpProviderRegistry.onDidChange(update));

		update();
	}

	dispose() {
		super.dispose();
	}

	reset() {
		this._langId.reset();
		this._hasCompletionItemProvider.reset();
		this._hasCodeActionsProvider.reset();
		this._hasCodeLensProvider.reset();
		this._hasDefinitionProvider.reset();
		this._hasImplementationProvider.reset();
		this._hasTypeDefinitionProvider.reset();
		this._hasHoverProvider.reset();
		this._hasDocumentHighlightProvider.reset();
		this._hasDocumentSymbolProvider.reset();
		this._hasReferenceProvider.reset();
		this._hasRenameProvider.reset();
		this._hasDocumentFormattingProvider.reset();
		this._hasDocumentSelectionFormattingProvider.reset();
		this._hasSignatureHelpProvider.reset();
		this._isInWalkThrough.reset();
	}

	private _update() {
		const model = this._editor.getModel();
		if (!model) {
			this.reset();
			return;
		}
		this._langId.set(model.getLanguageIdentifier().language);
		this._hasCompletionItemProvider.set(modes.SuggestRegistry.has(model));
		this._hasCodeActionsProvider.set(modes.CodeActionProviderRegistry.has(model));
		this._hasCodeLensProvider.set(modes.CodeLensProviderRegistry.has(model));
		this._hasDefinitionProvider.set(modes.DefinitionProviderRegistry.has(model));
		this._hasImplementationProvider.set(modes.ImplementationProviderRegistry.has(model));
		this._hasTypeDefinitionProvider.set(modes.TypeDefinitionProviderRegistry.has(model));
		this._hasHoverProvider.set(modes.HoverProviderRegistry.has(model));
		this._hasDocumentHighlightProvider.set(modes.DocumentHighlightProviderRegistry.has(model));
		this._hasDocumentSymbolProvider.set(modes.DocumentSymbolProviderRegistry.has(model));
		this._hasReferenceProvider.set(modes.ReferenceProviderRegistry.has(model));
		this._hasRenameProvider.set(modes.RenameProviderRegistry.has(model));
		this._hasSignatureHelpProvider.set(modes.SignatureHelpProviderRegistry.has(model));
		this._hasDocumentFormattingProvider.set(modes.DocumentFormattingEditProviderRegistry.has(model) || modes.DocumentRangeFormattingEditProviderRegistry.has(model));
		this._hasDocumentSelectionFormattingProvider.set(modes.DocumentRangeFormattingEditProviderRegistry.has(model));
		this._isInWalkThrough.set(model.uri.scheme === Schemas.walkThroughSnippet);
	}
}

class CodeEditorWidgetFocusTracker extends Disposable {

	private _hasFocus: boolean;
	private _domFocusTracker: dom.IFocusTracker;

	private readonly _onChange: Emitter<void> = this._register(new Emitter<void>());
	public readonly onChange: Event<void> = this._onChange.event;

	constructor(domElement: HTMLElement) {
		super();

		this._hasFocus = false;
		this._domFocusTracker = this._register(dom.trackFocus(domElement));

		this._register(this._domFocusTracker.onDidFocus(() => {
			this._hasFocus = true;
			this._onChange.fire(void 0);
		}));
		this._register(this._domFocusTracker.onDidBlur(() => {
			this._hasFocus = false;
			this._onChange.fire(void 0);
		}));
	}

	public hasFocus(): boolean {
		return this._hasFocus;
	}
}

const squigglyStart = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 6 3' enable-background='new 0 0 6 3' height='3' width='6'><g fill='`);
const squigglyEnd = encodeURIComponent(`'><polygon points='5.5,0 2.5,3 1.1,3 4.1,0'/><polygon points='4,0 6,2 6,0.6 5.4,0'/><polygon points='0,2 1,3 2.4,3 0,0.6'/></g></svg>`);

function getSquigglySVGData(color: Color) {
	return squigglyStart + encodeURIComponent(color.toString()) + squigglyEnd;
}

const dotdotdotStart = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" height="3" width="12"><g fill="`);
const dotdotdotEnd = encodeURIComponent(`"><circle cx="1" cy="1" r="1"/><circle cx="5" cy="1" r="1"/><circle cx="9" cy="1" r="1"/></g></svg>`);

function getDotDotDotSVGData(color: Color) {
	return dotdotdotStart + encodeURIComponent(color.toString()) + dotdotdotEnd;
}

registerThemingParticipant((theme, collector) => {
	let errorBorderColor = theme.getColor(editorErrorBorder);
	if (errorBorderColor) {
		collector.addRule(`.monaco-editor .${ClassName.EditorErrorDecoration} { border-bottom: 4px double ${errorBorderColor}; }`);
	}
	let errorForeground = theme.getColor(editorErrorForeground);
	if (errorForeground) {
		collector.addRule(`.monaco-editor .${ClassName.EditorErrorDecoration} { background: url("data:image/svg+xml,${getSquigglySVGData(errorForeground)}") repeat-x bottom left; }`);
	}

	let warningBorderColor = theme.getColor(editorWarningBorder);
	if (warningBorderColor) {
		collector.addRule(`.monaco-editor .${ClassName.EditorWarningDecoration} { border-bottom: 4px double ${warningBorderColor}; }`);
	}
	let warningForeground = theme.getColor(editorWarningForeground);
	if (warningForeground) {
		collector.addRule(`.monaco-editor .${ClassName.EditorWarningDecoration} { background: url("data:image/svg+xml,${getSquigglySVGData(warningForeground)}") repeat-x bottom left; }`);
	}

	let infoBorderColor = theme.getColor(editorInfoBorder);
	if (infoBorderColor) {
		collector.addRule(`.monaco-editor .${ClassName.EditorInfoDecoration} { border-bottom: 4px double ${infoBorderColor}; }`);
	}
	let infoForeground = theme.getColor(editorInfoForeground);
	if (infoForeground) {
		collector.addRule(`.monaco-editor .${ClassName.EditorInfoDecoration} { background: url("data:image/svg+xml,${getSquigglySVGData(infoForeground)}") repeat-x bottom left; }`);
	}

	let hintBorderColor = theme.getColor(editorHintBorder);
	if (hintBorderColor) {
		collector.addRule(`.monaco-editor .${ClassName.EditorHintDecoration} { border-bottom: 2px dotted ${hintBorderColor}; }`);
	}
	let hintForeground = theme.getColor(editorHintForeground);
	if (hintForeground) {
		collector.addRule(`.monaco-editor .${ClassName.EditorHintDecoration} { background: url("data:image/svg+xml,${getDotDotDotSVGData(hintForeground)}") no-repeat bottom left; }`);
	}
});
