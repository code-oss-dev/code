/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./suggest';
import nls = require('vs/nls');
import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable, disposeAll } from 'vs/base/common/lifecycle';
import Errors = require('vs/base/common/errors');
import Event, { Emitter } from 'vs/base/common/event';
import dom = require('vs/base/browser/dom');
import Tree = require('vs/base/parts/tree/common/tree');
import TreeImpl = require('vs/base/parts/tree/browser/treeImpl');
import TreeDefaults = require('vs/base/parts/tree/browser/treeDefaults');
import HighlightedLabel = require('vs/base/browser/ui/highlightedlabel/highlightedLabel');
import { SuggestModel, CompletionItem, ICancelEvent, ISuggestEvent, ITriggerEvent } from './suggestModel';
import Mouse = require('vs/base/browser/mouseEvent');
import EditorBrowser = require('vs/editor/browser/editorBrowser');
import EditorCommon = require('vs/editor/common/editorCommon');
import EventEmitter = require('vs/base/common/eventEmitter');
import Timer = require('vs/base/common/timer');
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { SuggestRegistry, CONTEXT_SUGGESTION_SUPPORTS_ACCEPT_ON_KEY } from '../common/suggest';
import { IKeybindingService, IKeybindingContextKey } from 'vs/platform/keybinding/common/keybindingService';

var $ = dom.emmet;


// To be used as a tree element when we want to show a message
export class Message {
	constructor(public parent: MessageRoot, public message: string) {
		// nothing to do
	}
}

export class MessageRoot {
	public child: Message;

	constructor(message: string) {
		this.child = new Message(this, message);
	}
}

class DataSource implements Tree.IDataSource {

	private static _IdPool:number = 0;
	private root: ISuggestEvent;

	constructor() {
		this.root = null;
	}

	private isRoot(element: any) : boolean {
		if (element instanceof MessageRoot) {
			return true;
		} else if (element instanceof Message) {
			return false;
		} else if (element instanceof CompletionItem) {
			return false;
		} else if (typeof element.currentWord === 'string') {
			this.root = element;
			return true;
		} else {
			return false;
		}
	}

	public getId(tree: Tree.ITree, element: any): string {
		if (element instanceof MessageRoot) {
			return 'messageroot';
		} else if (element instanceof Message) {
			return 'message' + element.message;
		} else if (typeof element.currentWord === 'string') {
			return 'root';
		} else if (element instanceof CompletionItem) {
			return (<CompletionItem>element).id;
		} else {
			throw Errors.illegalArgument('element');
		}
	}

	public getParent(tree: Tree.ITree, element: any): TPromise<any> {
		if (element instanceof MessageRoot) {
			return TPromise.as(null);
		} else if (element instanceof Message) {
			return TPromise.as(element.parent);
		}
		return TPromise.as(this.isRoot(element)
			? null
			: this.root);
	}

	public getChildren(tree: Tree.ITree, element: any): TPromise<any[]> {
		if (element instanceof MessageRoot) {
			return TPromise.as([element.child]);
		} else if (element instanceof Message) {
			return TPromise.as([]);
		}

		return TPromise.as(this.isRoot(element)
			? this.root.completionItems
			: []);
	}

	public hasChildren(tree: Tree.ITree, element: any): boolean {
		return this.isRoot(element);
	}
}

class Controller extends TreeDefaults.DefaultController {

	/* protected */ public onLeftClick(tree:Tree.ITree, element:any, event:Mouse.StandardMouseEvent):boolean {
		event.preventDefault();
		event.stopPropagation();

		if (!(element instanceof Message)) {
			tree.setSelection([element], { origin: 'mouse' });
		}

		return true;
	}
}

interface IMessageTemplateData {
	element: HTMLElement;
}

interface ISuggestionTemplateData {
	root: HTMLElement;
	icon: HTMLElement;
	colorspan: HTMLElement;
	highlightedLabel: HighlightedLabel.HighlightedLabel;
	typeLabel: HTMLElement;
	documentationLabel: HTMLElement;
}

class Renderer implements Tree.IRenderer {

	public getHeight(tree:Tree.ITree, element:any):number {
		// var suggestion = <Modes.ISuggestion>element;

		if (element instanceof CompletionItem) {
			if ((<CompletionItem>element).suggestion.documentationLabel && tree.isFocused(element)) {
				return 35;
			}
		}

		return 19;
	}

	public getTemplateId(tree: Tree.ITree, element: any): string {
		return (element instanceof Message) ? 'message' : 'suggestion';
	}

	public renderTemplate(tree: Tree.ITree, templateId: string, container: HTMLElement): any {
		if (templateId === 'message') {
			var span = $('span');
			span.style.opacity = '0.7';
			span.style.paddingLeft = '12px';
			container.appendChild(span);
			return <IMessageTemplateData> { element: span };
		}

		var data = <ISuggestionTemplateData> Object.create(null);
		data.root = container;

		data.icon = dom.append(container, $('.icon'));
		data.colorspan = dom.append(data.icon, $('span.colorspan'));

		var text = dom.append(container, $('.text'));
		var main = dom.append(text, $('.main'));
		data.highlightedLabel = new HighlightedLabel.HighlightedLabel(main);
		data.typeLabel = dom.append(main, $('span.type-label'));
		var documentation = dom.append(text, $('.docs'));
		data.documentationLabel = dom.append(documentation, $('.docs-label'));

		return data;
	}

	public renderElement(tree: Tree.ITree, element: any, templateId: string, templateData: any): void {
		if (templateId === 'message') {
			(<IMessageTemplateData> templateData).element.textContent = element.message;
			return;
		}

		var data = <ISuggestionTemplateData> templateData;
		var suggestion = (<CompletionItem> element).suggestion;

		if (suggestion.type && suggestion.type.charAt(0) === '#') {
			data.root.setAttribute('aria-label', 'color');
			data.icon.className = 'icon customcolor';
			data.colorspan.style.backgroundColor = suggestion.type.substring(1);
		} else {
			data.root.setAttribute('aria-label', suggestion.type);
			data.icon.className = 'icon ' + suggestion.type;
			data.colorspan.style.backgroundColor = '';
		}

		data.highlightedLabel.set(suggestion.label, (<CompletionItem> element).highlights);
		data.typeLabel.textContent = suggestion.typeLabel || '';
		data.documentationLabel.textContent = suggestion.documentationLabel || '';
	}

	public disposeTemplate(tree: Tree.ITree, templateId: string, templateData: any): void {
		if (templateId === 'message') {
			return;
		}

		var data = <ISuggestionTemplateData> templateData;
		data.highlightedLabel.dispose();
	}
}

function computeScore(suggestion:string, currentWord:string, currentWordLowerCase:string) : number {
	var suggestionLowerCase = suggestion.toLowerCase();
	var score = 0;

	for (var i = 0; i < currentWord.length && i < suggestion.length; i++) {
		if (currentWord[i] === suggestion[i]) {
			score += 2;
		} else if (currentWordLowerCase[i] === suggestionLowerCase[i]) {
			score += 1;
		} else {
			break;
		}
	}

	return score;
}

interface ITelemetryData {
	suggestionCount?: number;
	suggestedIndex?: number;
	selectedIndex?: number;
	hintLength?: number;
	wasCancelled?: boolean;
	wasAutomaticallyTriggered?: boolean;
}

export class SuggestWidget implements EditorBrowser.IContentWidget, IDisposable {
	static ID = 'editor.widget.suggestWidget';
	static WIDTH = 438;

	static LOADING_MESSAGE = new MessageRoot(nls.localize('suggestWidget.loading', "Loading..."));
	static NO_SUGGESTIONS_MESSAGE = new MessageRoot(nls.localize('suggestWidget.noSuggestions', "No suggestions."));

	private shouldShowEmptySuggestionList: boolean;
	private isActive: boolean;
	private isLoading: boolean;
	private isAuto: boolean;
	private listenersToRemove: EventEmitter.ListenerUnbind[];
	private modelListenersToRemove: IDisposable[];
	private suggestionSupportsAutoAccept: IKeybindingContextKey<boolean>;
	private loadingTimeout: number;

	private telemetryData: ITelemetryData;
	private telemetryService: ITelemetryService;
	private telemetryTimer: Timer.ITimerEvent;

	private element: HTMLElement;
	private tree: Tree.ITree;
	private renderer: Renderer;

	// Editor.IContentWidget.allowEditorOverflow
	public allowEditorOverflow = true;

	private _onDidVisibilityChange: Emitter<boolean> = new Emitter();
	public get onDidVisibilityChange(): Event<boolean> { return this._onDidVisibilityChange.event; }

	constructor(
		private editor: EditorBrowser.ICodeEditor,
		private model: SuggestModel,
		@IKeybindingService keybindingService: IKeybindingService,
		@ITelemetryService telemetryService: ITelemetryService
	) {
		this.isActive = false;
		this.isLoading = false;
		this.isAuto = false;
		this.modelListenersToRemove = [];
		this.suggestionSupportsAutoAccept = keybindingService.createKey<boolean>(CONTEXT_SUGGESTION_SUPPORTS_ACCEPT_ON_KEY, true);

		this.telemetryData = null;
		this.telemetryService = telemetryService;

		var onModelModeChanged = () => {
			var model = this.editor.getModel();
			this.shouldShowEmptySuggestionList = SuggestRegistry.all(model)
				.some(support => support.shouldShowEmptySuggestionList());
		};

		onModelModeChanged();
		this.listenersToRemove = [];
		this.listenersToRemove.push(editor.addListener(EditorCommon.EventType.ModelChanged, onModelModeChanged));
		this.listenersToRemove.push(editor.addListener(EditorCommon.EventType.ModelModeChanged, onModelModeChanged));
		this.listenersToRemove.push(editor.addListener(EditorCommon.EventType.ModelModeSupportChanged, (e: EditorCommon.IModeSupportChangedEvent) => {
			if (e.suggestSupport) {
				onModelModeChanged();
			}
		}));
		let subscription = SuggestRegistry.onDidChange(onModelModeChanged);
		this.listenersToRemove.push(() => subscription.dispose());

		this.element = $('.editor-widget.suggest-widget.monaco-editor-background');
		this.element.style.width = SuggestWidget.WIDTH + 'px';
		this.element.style.top = '0';
		this.element.style.left = '0';

		if (!this.editor.getConfiguration().iconsInSuggestions) {
			dom.addClass(this.element, 'no-icons');
		}

		this.renderer = new Renderer();
		const dataSource = new DataSource();
		const controller = new Controller();
		const configuration = { renderer: this.renderer, dataSource, controller };

		this.tree = new TreeImpl.Tree(this.element, configuration, {
			twistiePixels: 0,
			alwaysFocused: true,
			verticalScrollMode: 'visible',
			useShadows: false
		});

		this.listenersToRemove.push(editor.addListener(EditorCommon.EventType.EditorTextBlur, () => {
			TPromise.timeout(150).done(() => {
				if (this.tree && !this.tree.isDOMFocused()) {
					this.hide();
				}
			});
		}));

		this.listenersToRemove.push(this.tree.addListener('selection', (e:Tree.ISelectionEvent) => {
			if (e.selection && e.selection.length > 0) {
				var element = e.selection[0];
				if (!element.hasOwnProperty('suggestions') && !(element instanceof MessageRoot) && !(element instanceof Message)) {

					this.telemetryData.selectedIndex = (<ISuggestEvent> this.tree.getInput()).completionItems.indexOf(element);
					this.telemetryData.wasCancelled = false;
					this.submitTelemetryData();

					const item: CompletionItem = element;
					const container = item.container;
					const overwriteBefore = (typeof container.overwriteBefore === 'undefined') ? container.currentWord.length : container.overwriteBefore;
					const overwriteAfter = (typeof container.overwriteAfter === 'undefined') ? 0 : Math.max(0, container.overwriteAfter);
					this.model.accept(item.suggestion, overwriteBefore, overwriteAfter);

					this.editor.focus();
				}
			}
		}));

		var oldFocus: any = null;

		this.listenersToRemove.push(this.tree.addListener('focus', (e:Tree.IFocusEvent) => {
			var focus = e.focus;
			var payload = e.payload;

			if(focus instanceof CompletionItem) {
				this.resolveDetails(<CompletionItem>focus);
				this.suggestionSupportsAutoAccept.set(!(<CompletionItem>focus).suggestion.noAutoAccept);
			}

			if (focus === oldFocus) {
				return;
			}

			var elementsToRefresh: any[] = [];

			if (oldFocus) {
				elementsToRefresh.push(oldFocus);
			}

			if (focus) {
				elementsToRefresh.push(focus);
			}

			oldFocus = focus;

			this.tree.refreshAll(elementsToRefresh).done(() => {
				this.updateWidgetHeight();

				if (focus) {
					return this.tree.reveal(focus, (payload && payload.firstSuggestion) ? 0 : null);
				}
			}, Errors.onUnexpectedError);
		}));

		this.editor.addContentWidget(this);

		this.listenersToRemove.push(this.editor.addListener(EditorCommon.EventType.CursorSelectionChanged, (e: EditorCommon.ICursorSelectionChangedEvent) => {
			if (this.isActive) {
				this.editor.layoutContentWidget(this);
			}
		}));

		this.hide();

		var timer : Timer.ITimerEvent = null, loadingHandle:number;
		this.modelListenersToRemove.push(this.model.onDidTrigger(e => this.onDidTrigger(e)));
		this.modelListenersToRemove.push(this.model.onDidSuggest(e => this.onDidSuggest(e)));
		this.modelListenersToRemove.push(this.model.onDidCancel(e => this.onDidCancel(e)));
	}

	private onDidTrigger(e: ITriggerEvent) {
		if (!this.isActive) {
			this.telemetryTimer = this.telemetryService.start('suggestWidgetLoadingTime');
			this.isLoading = true;
			this.isAuto = !!e.auto;

			if (!this.isAuto) {
				this.loadingTimeout = setTimeout(() => {
					this.loadingTimeout = null;
					dom.removeClass(this.element, 'empty');
					this.tree.setInput(SuggestWidget.LOADING_MESSAGE).done(null, Errors.onUnexpectedError);
					this.updateWidgetHeight();
					this.show();
				}, 50);
			}

			if (!e.retrigger) {
				this.telemetryData = {
					wasAutomaticallyTriggered: e.characterTriggered
				};
			}
		}
	}

	private onDidSuggest(e: ISuggestEvent) {
		const wasLoading = this.isLoading;
		this.isLoading = false;
		clearTimeout(this.loadingTimeout);

		if (!e.completionItems) { // empty

			if (e.auto) {
				this.hide();
			} else if (wasLoading) {
				if (this.shouldShowEmptySuggestionList) {
					dom.removeClass(this.element, 'empty');
					this.tree.setInput(SuggestWidget.NO_SUGGESTIONS_MESSAGE).done(null, Errors.onUnexpectedError);
					this.updateWidgetHeight();
					this.show();
				} else {
					this.hide();
				}
			} else {
				dom.addClass(this.element, 'empty');
			}

			if(this.telemetryTimer) {
				this.telemetryTimer.data = { reason: 'empty'};
				this.telemetryTimer.stop();
				this.telemetryTimer = null;
			}

			return;
		}

		const currentWord = e.currentWord;
		const currentWordLowerCase = currentWord.toLowerCase();
		const suggestions = e.completionItems;

		let bestSuggestionIndex = -1;
		let bestSuggestion = suggestions[0];
		let bestScore = -1;

		for (var i = 0, len = suggestions.length; i < len; i++) {
			var score = computeScore(suggestions[i].suggestion.label, currentWord, currentWordLowerCase);
			if (score > bestScore) {
				bestScore = score;
				bestSuggestion = suggestions[i];
				bestSuggestionIndex = i;
			}
		}

		dom.removeClass(this.element, 'empty');
		this.tree.setInput(e).done(null, Errors.onUnexpectedError);
		this.tree.setFocus(bestSuggestion, { firstSuggestion: true });
		this.updateWidgetHeight();
		this.show();

		this.telemetryData = this.telemetryData || {};
		this.telemetryData.suggestionCount = suggestions.length;
		this.telemetryData.suggestedIndex = bestSuggestionIndex;
		this.telemetryData.hintLength = currentWord.length;

		if(this.telemetryTimer) {
			this.telemetryTimer.data = { reason: 'results'};
			this.telemetryTimer.stop();
			this.telemetryTimer = null;
		}
	}

	private onDidCancel(e: ICancelEvent) {
		this.isLoading = false;

		if (!e.retrigger) {
			this.hide();

			if (this.telemetryData) {
				this.telemetryData.selectedIndex = -1;
				this.telemetryData.wasCancelled = true;
				this.submitTelemetryData();
			}
		}

		if (this.telemetryTimer) {
			this.telemetryTimer.data = { reason: 'cancel' };
			this.telemetryTimer.stop();
			this.telemetryTimer = null;
		}
	}

	private currentSuggestionDetails:TPromise<CompletionItem>;

	private resolveDetails(item: CompletionItem): void {
		if (item) {
			if(this.currentSuggestionDetails) {
				this.currentSuggestionDetails.cancel();
			}

			this.currentSuggestionDetails = item.resolveDetails(this.editor.getModel().getAssociatedResource(),
				this.model.getRequestPosition() || this.editor.getPosition());

			this.currentSuggestionDetails.then(() => {
				this.currentSuggestionDetails = undefined;
				return this.tree.refresh(item).then(() => this.updateWidgetHeight());
			}, (err) => {
				return Errors.isPromiseCanceledError(err) ? null : err;
			}).done(undefined, Errors.onUnexpectedError);
		}
	}

	public selectNextPage(): boolean {
		if (this.isLoading) {
			return !this.isAuto;
		}
		if (this.isActive) {
			this.tree.focusNextPage();
			return true;
		}
		return false;
	}

	public selectNext(): boolean {
		if (this.isLoading) {
			return !this.isAuto;
		}
		if (this.isActive) {
			var focus = this.tree.getFocus();
			this.tree.focusNext(1);
			if (focus === this.tree.getFocus()) {
				this.tree.focusFirst();
			}
			return true;
		}
		return false;
	}

	public selectPreviousPage(): boolean {
		if (this.isLoading) {
			return !this.isAuto;
		}
		if (this.isActive) {
			this.tree.focusPreviousPage();
			return true;
		}
		return false;
	}

	public selectPrevious(): boolean {
		if (this.isLoading) {
			return !this.isAuto;
		}
		if (this.isActive) {
			var focus = this.tree.getFocus();
			this.tree.focusPrevious(1);
			if (focus === this.tree.getFocus()) {
				this.tree.focusLast();
			}
			return true;
		}
		return false;
	}

	public acceptSelectedSuggestion() : boolean {
		if (this.isLoading) {
			return !this.isAuto;
		}
		if (this.isActive) {
			var focus = this.tree.getFocus();
			if (focus) {
				this.tree.setSelection([focus]);
			} else {
				this.model.cancel();
			}
			return true;
		}
		return false;
	}

	public show(): void {
		this._onDidVisibilityChange.fire(true);
		this.isActive = true;
		this.tree.layout();
		this.editor.layoutContentWidget(this);
		TPromise.timeout(100).done(() => {
			dom.addClass(this.element, 'visible');
		});
	}

	public cancel(): void {
		this.model.cancel();
	}

	public hide(): void {
		this._onDidVisibilityChange.fire(false);
		this.isActive = false;
		dom.removeClass(this.element, 'visible');
		this.editor.layoutContentWidget(this);
	}

	public getPosition():EditorBrowser.IContentWidgetPosition {
		if (this.isActive) {
			return {
				position: this.editor.getPosition(),
				preference: [EditorBrowser.ContentWidgetPositionPreference.BELOW, EditorBrowser.ContentWidgetPositionPreference.ABOVE]
			};
		}
		return null;
	}

	public getDomNode() : HTMLElement {
		return this.element;
	}

	public getId() : string {
		return SuggestWidget.ID;
	}

	private submitTelemetryData() : void {
		this.telemetryService.publicLog('suggestWidget', this.telemetryData);
		this.telemetryData = null;
	}

	private updateWidgetHeight(): void {
		var input = this.tree.getInput();
		var maxHeight = 1000;
		var height = 0;

		if (input === SuggestWidget.LOADING_MESSAGE || input === SuggestWidget.NO_SUGGESTIONS_MESSAGE) {
			height = 19;
		} else {
			var focus = this.tree.getFocus();
			var focusHeight = focus ? this.renderer.getHeight(this.tree, focus) : 19;
			height += focusHeight;

			var maxSuggestions = Math.floor((maxHeight - focusHeight) / 19);
			var data = <ISuggestEvent>input;
			height += Math.min(data.completionItems.length - 1, 11, maxSuggestions) * 19;
		}

		this.element.style.height = height + 'px';

		this.tree.layout(height);
		this.editor.layoutContentWidget(this);
	}

	public dispose() : void {
		this.modelListenersToRemove = disposeAll(this.modelListenersToRemove);
		this.model = null;
		this.tree.dispose();
		this.tree = null;
		this.element = null;

		this.listenersToRemove.forEach((element) => {
			element();
		});
		this.listenersToRemove = null;
	}
}