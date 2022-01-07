/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { HoverAction, HoverWidget } from 'vs/base/browser/ui/hover/hoverWidget';
import { coalesce } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Constants } from 'vs/base/common/uint';
import { IEmptyContentData } from 'vs/editor/browser/controller/mouseTarget';
import { ContentWidgetPositionPreference, IActiveCodeEditor, ICodeEditor, IContentWidget, IContentWidgetPosition, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IModelDecoration } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { TokenizationRegistry } from 'vs/editor/common/languages';
import { ColorPickerWidget } from 'vs/editor/contrib/colorPicker/colorPickerWidget';
import { ColorHoverParticipant } from 'vs/editor/contrib/hover/colorHoverParticipant';
import { HoverOperation, HoverStartMode, IHoverComputer } from 'vs/editor/contrib/hover/hoverOperation';
import { HoverAnchor, HoverAnchorType, HoverRangeAnchor, IEditorHoverAction, IEditorHoverParticipant, IEditorHoverRenderContext, IEditorHoverStatusBar, IHoverPart } from 'vs/editor/contrib/hover/hoverTypes';
import { MarkdownHoverParticipant } from 'vs/editor/contrib/hover/markdownHoverParticipant';
import { MarkerHoverParticipant } from 'vs/editor/contrib/hover/markerHoverParticipant';
import { InlineCompletionsHoverParticipant } from 'vs/editor/contrib/inlineCompletions/inlineCompletionsHoverParticipant';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { Context as SuggestContext } from 'vs/editor/contrib/suggest/suggest';
import { UnicodeHighlighterHoverParticipant } from 'vs/editor/contrib/unicodeHighlighter/unicodeHighlighter';
import { AsyncIterableObject } from 'vs/base/common/async';
import { InlayHintsHover } from 'vs/editor/contrib/inlayHints/inlayHintsHover';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';

const $ = dom.$;

export class ContentHoverController extends Disposable {

	private readonly _participants: IEditorHoverParticipant[];
	private readonly _widget: ContentHoverWidget;

	private _messages: IHoverPart[];
	private _messagesAreComplete: boolean;
	private readonly _computer: ContentHoverComputer;
	private readonly _hoverOperation: HoverOperation<IHoverPart>;
	private _highlightDecorations: string[];
	private _isChangingDecorations: boolean;
	private _shouldFocus: boolean;
	private _renderDisposable: DisposableStore | null;

	constructor(
		private readonly _editor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super();

		this._participants = [
			instantiationService.createInstance(ColorHoverParticipant, this._editor),
			instantiationService.createInstance(MarkdownHoverParticipant, this._editor),
			instantiationService.createInstance(InlineCompletionsHoverParticipant, this._editor),
			instantiationService.createInstance(UnicodeHighlighterHoverParticipant, this._editor),
			instantiationService.createInstance(MarkerHoverParticipant, this._editor),
			instantiationService.createInstance(InlayHintsHover, this._editor),
		];
		this._widget = this._register(instantiationService.createInstance(ContentHoverWidget, this._editor));

		this._messages = [];
		this._messagesAreComplete = false;
		this._computer = new ContentHoverComputer(this._editor, this._participants);
		this._highlightDecorations = [];
		this._isChangingDecorations = false;
		this._shouldFocus = false;
		this._renderDisposable = null;

		this._hoverOperation = this._register(new HoverOperation(this._editor, this._computer));
		this._register(this._hoverOperation.onResult((result) => {
			const actualResult = (result.hasLoadingMessage ? this._addLoadingMessage(result.value) : result.value);
			this._withResult(actualResult, result.isComplete);
		}));

		this._register(this._editor.onDidChangeModelDecorations(() => this._onModelDecorationsChanged()));
		this._register(dom.addStandardDisposableListener(this._widget.getDomNode(), 'keydown', (e) => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
			}
		}));
		this._register(TokenizationRegistry.onDidChange(() => {
			if (this._widget.position && this._computer.anchor && this._messages.length > 0) {
				this._widget.clear();
				this._renderMessages(this._computer.anchor, this._messages);
			}
		}));
	}

	private _addLoadingMessage(result: IHoverPart[]): IHoverPart[] {
		if (this._computer.anchor) {
			for (const participant of this._participants) {
				if (participant.createLoadingMessage) {
					const loadingMessage = participant.createLoadingMessage(this._computer.anchor);
					if (loadingMessage) {
						return result.slice(0).concat([loadingMessage]);
					}
				}
			}
		}
		return result;
	}

	private _shouldShowAt(mouseEvent: IEditorMouseEvent): boolean {
		const targetType = mouseEvent.target.type;
		if (targetType === MouseTargetType.CONTENT_TEXT) {
			return true;
		}

		if (targetType === MouseTargetType.CONTENT_EMPTY) {
			const epsilon = this._editor.getOption(EditorOption.fontInfo).typicalHalfwidthCharacterWidth / 2;
			const data = <IEmptyContentData>mouseEvent.target.detail;
			if (data && !data.isAfterLines && typeof data.horizontalDistanceToText === 'number' && data.horizontalDistanceToText < epsilon) {
				// Let hover kick in even when the mouse is technically in the empty area after a line, given the distance is small enough
				return true;
			}
		}

		return false;
	}

	public maybeShowAt(mouseEvent: IEditorMouseEvent): boolean {
		const anchorCandidates: HoverAnchor[] = [];

		for (const participant of this._participants) {
			if (participant.suggestHoverAnchor) {
				const anchor = participant.suggestHoverAnchor(mouseEvent);
				if (anchor) {
					anchorCandidates.push(anchor);
				}
			}
		}

		if (this._shouldShowAt(mouseEvent) && mouseEvent.target.range) {
			// TODO@rebornix. This should be removed if we move Color Picker out of Hover component.
			// Check if mouse is hovering on color decorator
			const hoverOnColorDecorator = [...mouseEvent.target.element?.classList.values() || []].find(className => className.startsWith('ced-colorBox'))
				&& mouseEvent.target.range.endColumn - mouseEvent.target.range.startColumn === 1;
			const showAtRange = (
				hoverOnColorDecorator // shift the mouse focus by one as color decorator is a `before` decoration of next character.
					? new Range(mouseEvent.target.range.startLineNumber, mouseEvent.target.range.startColumn + 1, mouseEvent.target.range.endLineNumber, mouseEvent.target.range.endColumn + 1)
					: mouseEvent.target.range
			);
			anchorCandidates.push(new HoverRangeAnchor(0, showAtRange));
		}

		if (anchorCandidates.length === 0) {
			return false;
		}

		anchorCandidates.sort((a, b) => b.priority - a.priority);
		this._startShowingAt(anchorCandidates[0], HoverStartMode.Delayed, false);

		return true;
	}

	private _onModelDecorationsChanged(): void {
		if (this._isChangingDecorations) {
			return;
		}
		if (this._widget.position) {
			// The decorations have changed and the hover is visible,
			// we need to recompute the displayed text
			this._hoverOperation.cancel();

			if (!this._widget.colorPicker) { // TODO@Michel ensure that displayed text for other decorations is computed even if color picker is in place
				this._hoverOperation.start(HoverStartMode.Delayed);
			}
		}
	}

	public startShowingAtRange(range: Range, mode: HoverStartMode, focus: boolean): void {
		this._startShowingAt(new HoverRangeAnchor(0, range), mode, focus);
	}

	private _startShowingAt(anchor: HoverAnchor, mode: HoverStartMode, focus: boolean): void {
		if (this._computer.anchor && this._computer.anchor.equals(anchor)) {
			// We have to show the widget at the exact same range as before, so no work is needed
			return;
		}

		this._hoverOperation.cancel();

		if (this._widget.position) {
			// The range might have changed, but the hover is visible
			// Instead of hiding it completely, filter out messages that are still in the new range and
			// kick off a new computation
			if (!this._computer.anchor || !anchor.canAdoptVisibleHover(this._computer.anchor, this._widget.position)) {
				this.hide();
			} else {
				const filteredMessages = this._messages.filter((m) => m.isValidForHoverAnchor(anchor));
				if (filteredMessages.length === 0) {
					this.hide();
				} else if (filteredMessages.length === this._messages.length && this._messagesAreComplete) {
					// no change
					return;
				} else {
					this._renderMessages(anchor, filteredMessages);
				}
			}
		}

		this._computer.anchor = anchor;
		this._shouldFocus = focus;
		this._hoverOperation.start(mode);
	}

	public hide(): void {
		this._computer.anchor = null;
		this._hoverOperation.cancel();

		this._widget.hide();

		this._isChangingDecorations = true;
		this._highlightDecorations = this._editor.deltaDecorations(this._highlightDecorations, []);
		this._isChangingDecorations = false;
		if (this._renderDisposable) {
			this._renderDisposable.dispose();
			this._renderDisposable = null;
		}
	}

	public isColorPickerVisible(): boolean {
		return !!this._widget.colorPicker;
	}

	private _withResult(result: IHoverPart[], complete: boolean): void {
		this._messages = result;
		this._messagesAreComplete = complete;

		if (this._computer.anchor && this._messages.length > 0) {
			this._renderMessages(this._computer.anchor, this._messages);
		} else if (complete) {
			this.hide();
		}
	}

	private _renderMessages(anchor: HoverAnchor, messages: IHoverPart[]): void {
		if (this._renderDisposable) {
			this._renderDisposable.dispose();
			this._renderDisposable = null;
		}

		// update column from which to show
		let renderColumn = Constants.MAX_SAFE_SMALL_INTEGER;
		let highlightRange: Range = messages[0].range;
		let forceShowAtRange: Range | null = null;
		const groupedHoverParts = new Map<IEditorHoverParticipant, IHoverPart[]>();
		for (const msg of messages) {
			renderColumn = Math.min(renderColumn, msg.range.startColumn);
			highlightRange = Range.plusRange(highlightRange, msg.range);
			if (msg.forceShowAtRange) {
				forceShowAtRange = msg.range;
			}

			if (!groupedHoverParts.has(msg.owner)) {
				groupedHoverParts.set(msg.owner, []);
			}
			groupedHoverParts.get(msg.owner)!.push(msg);
		}

		this._renderDisposable = new DisposableStore();
		const statusBar = this._renderDisposable.add(new EditorHoverStatusBar(this._keybindingService));
		const fragment = document.createDocumentFragment();

		let colorPicker: ColorPickerWidget | null = null;
		const context: IEditorHoverRenderContext = {
			fragment,
			statusBar,
			setColorPicker: (widget: ColorPickerWidget): void => {
				colorPicker = widget;
			},
			onContentsChanged: (): void => {
				this._widget.onContentsChanged();
			},
			hide: (): void => {
				this.hide();
			}
		};

		for (const participant of this._participants) {
			if (groupedHoverParts.has(participant)) {
				const participantHoverParts = groupedHoverParts.get(participant)!;
				this._renderDisposable.add(participant.renderHoverParts(context, participantHoverParts));
			}
		}
		if (statusBar.hasContent) {
			fragment.appendChild(statusBar.hoverElement);
		}

		// show

		if (fragment.hasChildNodes()) {
			if (forceShowAtRange) {
				this._widget.showAt(fragment, colorPicker, forceShowAtRange.getStartPosition(), forceShowAtRange, this._shouldFocus);
			} else {
				this._widget.showAt(fragment, colorPicker, new Position(anchor.range.startLineNumber, renderColumn), highlightRange, this._shouldFocus);
			}
		}

		this._isChangingDecorations = true;
		this._highlightDecorations = this._editor.deltaDecorations(this._highlightDecorations, highlightRange ? [{
			range: highlightRange,
			options: ContentHoverController._DECORATION_OPTIONS
		}] : []);
		this._isChangingDecorations = false;
	}

	private static readonly _DECORATION_OPTIONS = ModelDecorationOptions.register({
		description: 'content-hover-highlight',
		className: 'hoverHighlight'
	});
}

class ContentHoverVisibleData {
	constructor(
		public readonly colorPicker: ColorPickerWidget | null,
		public readonly showAtPosition: Position | null,
		public readonly showAtRange: Range | null,
		public readonly preferAbove: boolean,
		public readonly stoleFocus: boolean,
	) { }
}

export class ContentHoverWidget extends Disposable implements IContentWidget {

	static readonly ID = 'editor.contrib.contentHoverWidget';

	public readonly allowEditorOverflow = true;

	private readonly _hoverVisibleKey = EditorContextKeys.hoverVisible.bindTo(this._contextKeyService);
	private readonly _hover: HoverWidget = this._register(new HoverWidget());

	private _visibleData: ContentHoverVisibleData | null = null;

	/**
	 * Returns `null` if the hover is not visible.
	 */
	public get position(): Position | null {
		return this._visibleData?.showAtPosition ?? null;
	}

	/**
	 * Returns `null` if the color picker is not visible.
	 */
	public get colorPicker(): ColorPickerWidget | null {
		return this._visibleData?.colorPicker ?? null;
	}

	constructor(
		private readonly _editor: ICodeEditor,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
	) {
		super();

		this._register(this._editor.onDidLayoutChange(() => this._layout()));
		this._register(this._editor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => {
			if (e.hasChanged(EditorOption.fontInfo)) {
				this._updateFont();
			}
		}));

		this._setVisibleData(null);
		this._layout();
		this._editor.addContentWidget(this);
	}

	public override dispose(): void {
		this._editor.removeContentWidget(this);
		super.dispose();
	}

	public getId(): string {
		return ContentHoverWidget.ID;
	}

	public getDomNode(): HTMLElement {
		return this._hover.containerDomNode;
	}

	public getPosition(): IContentWidgetPosition | null {
		if (!this._visibleData) {
			return null;
		}
		let preferAbove = this._visibleData.preferAbove;
		if (!preferAbove && this._contextKeyService.getContextKeyValue<boolean>(SuggestContext.Visible.key)) {
			// Prefer rendering above if the suggest widget is visible
			preferAbove = true;
		}
		return {
			position: this._visibleData.showAtPosition,
			range: this._visibleData.showAtRange,
			preference: (
				preferAbove
					? [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW]
					: [ContentWidgetPositionPreference.BELOW, ContentWidgetPositionPreference.ABOVE]
			),
		};
	}

	private _setVisibleData(visibleData: ContentHoverVisibleData | null): void {
		this._visibleData = visibleData;
		this._hoverVisibleKey.set(!!this._visibleData);
		this._hover.containerDomNode.classList.toggle('hidden', !this._visibleData);
	}

	private _layout(): void {
		const height = Math.max(this._editor.getLayoutInfo().height / 4, 250);
		const { fontSize, lineHeight } = this._editor.getOption(EditorOption.fontInfo);

		this._hover.contentsDomNode.style.fontSize = `${fontSize}px`;
		this._hover.contentsDomNode.style.lineHeight = `${lineHeight / fontSize}`;
		this._hover.contentsDomNode.style.maxHeight = `${height}px`;
		this._hover.contentsDomNode.style.maxWidth = `${Math.max(this._editor.getLayoutInfo().width * 0.66, 500)}px`;
	}

	private _updateFont(): void {
		const codeClasses: HTMLElement[] = Array.prototype.slice.call(this._hover.contentsDomNode.getElementsByClassName('code'));
		codeClasses.forEach(node => this._editor.applyFontInfo(node));
	}

	public showAt(node: DocumentFragment, colorPicker: ColorPickerWidget | null, position: Position, range: Range | null, focus: boolean): void {
		this._setVisibleData(new ContentHoverVisibleData(colorPicker, position, range, this._editor.getOption(EditorOption.hover).above, focus));

		this._hover.contentsDomNode.textContent = '';
		this._hover.contentsDomNode.appendChild(node);
		this._updateFont();

		this._editor.layoutContentWidget(this);
		this._hover.onContentsChanged();

		// Simply force a synchronous render on the editor
		// such that the widget does not really render with left = '0px'
		this._editor.render();
		if (focus) {
			this._hover.containerDomNode.focus();
		}
		if (colorPicker) {
			colorPicker.layout();
		}
	}

	public hide(): void {
		if (this._visibleData) {
			const stoleFocus = this._visibleData.stoleFocus;
			this._setVisibleData(null);
			this._editor.layoutContentWidget(this);
			if (stoleFocus) {
				this._editor.focus();
			}
		}
	}

	public onContentsChanged(): void {
		this._hover.onContentsChanged();
	}

	public clear(): void {
		this._hover.contentsDomNode.textContent = '';
	}
}

class EditorHoverStatusBar extends Disposable implements IEditorHoverStatusBar {

	public readonly hoverElement: HTMLElement;
	private readonly actionsElement: HTMLElement;
	private _hasContent: boolean = false;

	public get hasContent() {
		return this._hasContent;
	}

	constructor(
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super();
		this.hoverElement = $('div.hover-row.status-bar');
		this.actionsElement = dom.append(this.hoverElement, $('div.actions'));
	}

	public addAction(actionOptions: { label: string, iconClass?: string, run: (target: HTMLElement) => void, commandId: string }): IEditorHoverAction {
		const keybinding = this._keybindingService.lookupKeybinding(actionOptions.commandId);
		const keybindingLabel = keybinding ? keybinding.getLabel() : null;
		this._hasContent = true;
		return this._register(HoverAction.render(this.actionsElement, actionOptions, keybindingLabel));
	}

	public append(element: HTMLElement): HTMLElement {
		const result = dom.append(this.actionsElement, element);
		this._hasContent = true;
		return result;
	}
}

class ContentHoverComputer implements IHoverComputer<IHoverPart> {

	private _anchor: HoverAnchor | null = null;

	public get anchor(): HoverAnchor | null {
		return this._anchor;
	}

	public set anchor(value: HoverAnchor | null) {
		this._anchor = value;
	}

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _participants: readonly IEditorHoverParticipant[]
	) {
	}

	private static _getLineDecorations(editor: IActiveCodeEditor, anchor: HoverAnchor): IModelDecoration[] {
		if (anchor.type !== HoverAnchorType.Range) {
			return [];
		}

		const model = editor.getModel();
		const lineNumber = anchor.range.startLineNumber;
		const maxColumn = model.getLineMaxColumn(lineNumber);
		return editor.getLineDecorations(lineNumber).filter((d) => {
			if (d.options.isWholeLine) {
				return true;
			}

			const startColumn = (d.range.startLineNumber === lineNumber) ? d.range.startColumn : 1;
			const endColumn = (d.range.endLineNumber === lineNumber) ? d.range.endColumn : maxColumn;
			if (d.options.showIfCollapsed) {
				// Relax check around `showIfCollapsed` decorations to also include +/- 1 character
				if (startColumn > anchor.range.startColumn + 1 || anchor.range.endColumn - 1 > endColumn) {
					return false;
				}
			} else {
				if (startColumn > anchor.range.startColumn || anchor.range.endColumn > endColumn) {
					return false;
				}
			}

			return true;
		});
	}

	public computeAsync(token: CancellationToken): AsyncIterableObject<IHoverPart> {
		const anchor = this._anchor;

		if (!this._editor.hasModel() || !anchor) {
			return AsyncIterableObject.EMPTY;
		}

		const lineDecorations = ContentHoverComputer._getLineDecorations(this._editor, anchor);
		return AsyncIterableObject.merge(
			this._participants.map((participant) => {
				if (!participant.computeAsync) {
					return AsyncIterableObject.EMPTY;
				}
				return participant.computeAsync(anchor, lineDecorations, token);
			})
		);
	}

	public computeSync(): IHoverPart[] {
		if (!this._editor.hasModel() || !this._anchor) {
			return [];
		}

		const lineDecorations = ContentHoverComputer._getLineDecorations(this._editor, this._anchor);

		let result: IHoverPart[] = [];
		for (const participant of this._participants) {
			result = result.concat(participant.computeSync(this._anchor, lineDecorations));
		}

		return coalesce(result);
	}
}
