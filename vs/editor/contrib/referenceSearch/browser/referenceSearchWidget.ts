/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import 'vs/css!./referenceSearchWidget';
import * as nls from 'vs/nls';
import * as collections from 'vs/base/common/collections';
import {onUnexpectedError} from 'vs/base/common/errors';
import {getPathLabel} from 'vs/base/common/labels';
import Event, {Emitter} from 'vs/base/common/event';
import {IDisposable, cAll, dispose} from 'vs/base/common/lifecycle';
import {Schemas} from 'vs/base/common/network';
import * as strings from 'vs/base/common/strings';
import URI from 'vs/base/common/uri';
import {TPromise} from 'vs/base/common/winjs.base';
import {$, Builder} from 'vs/base/browser/builder';
import * as dom from 'vs/base/browser/dom';
import {IKeyboardEvent} from 'vs/base/browser/keyboardEvent';
import {IMouseEvent} from 'vs/base/browser/mouseEvent';
import {CountBadge} from 'vs/base/browser/ui/countBadge/countBadge';
import {FileLabel} from 'vs/base/browser/ui/filelabel/fileLabel';
import {LeftRightWidget} from 'vs/base/browser/ui/leftRightWidget/leftRightWidget';
import * as tree from 'vs/base/parts/tree/browser/tree';
import {DefaultController, LegacyRenderer} from 'vs/base/parts/tree/browser/treeDefaults';
import {Tree} from 'vs/base/parts/tree/browser/treeImpl';
import {IEditorService} from 'vs/platform/editor/common/editor';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {ServiceCollection} from 'vs/platform/instantiation/common/serviceCollection';
import {IKeybindingService} from 'vs/platform/keybinding/common/keybindingService';
import {IWorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import {DefaultConfig} from 'vs/editor/common/config/defaultConfig';
import {Range} from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import {Model} from 'vs/editor/common/model/model';
import {ICodeEditor, IMouseTarget} from 'vs/editor/browser/editorBrowser';
import {EmbeddedCodeEditorWidget} from 'vs/editor/browser/widget/embeddedCodeEditorWidget';
import {PeekViewWidget, IPeekViewService} from 'vs/editor/contrib/zoneWidget/browser/peekViewWidget';
import {EventType, FileReferences, OneReference, ReferencesModel} from './referenceSearchModel';

class DecorationsManager implements IDisposable {

	private static DecorationOptions:editorCommon.IModelDecorationOptions = {
		stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'reference-decoration'
	};

	private _decorationSet = collections.createStringDictionary<OneReference>();
	private _decorationIgnoreSet = collections.createStringDictionary<OneReference>();
	private _callOnDispose:Function[] = [];
	private _callOnModelChange:Function[] = [];

	constructor(private editor:ICodeEditor, private model:ReferencesModel) {
		this._callOnDispose.push(this.editor.addListener(editorCommon.EventType.ModelChanged, () => this._onModelChanged()));
		this._onModelChanged();
	}

	public dispose(): void {
		this._callOnModelChange = cAll(this._callOnModelChange);
		this._callOnDispose = cAll(this._callOnDispose);
		this.removeDecorations();
	}

	private _onModelChanged():void {

		this.removeDecorations();
		this._callOnModelChange = cAll(this._callOnModelChange);

		var model = this.editor.getModel();
		if(!model) {
			return;
		}

		for(var i = 0, len = this.model.children.length; i < len; i++) {
			if(this.model.children[i].resource.toString() === model.getAssociatedResource().toString()) {
				this._addDecorations(this.model.children[i]);
				return;
			}
		}
	}

	private _addDecorations(reference:FileReferences):void {
		this._callOnModelChange.push(this.editor.getModel().addListener(editorCommon.EventType.ModelDecorationsChanged, (event) => this._onDecorationChanged(event)));

		this.editor.getModel().changeDecorations((accessor) => {
			var newDecorations: editorCommon.IModelDeltaDecoration[] = [];
			var newDecorationsActualIndex: number[] = [];

			for(let i = 0, len = reference.children.length; i < len; i++) {
				let oneReference = reference.children[i];
				if(this._decorationIgnoreSet[oneReference.id]) {
					continue;
				}
				newDecorations.push({
					range: oneReference.range,
					options: DecorationsManager.DecorationOptions
				});
				newDecorationsActualIndex.push(i);
			}

			var decorations = accessor.deltaDecorations([], newDecorations);

			for (var i = 0; i < decorations.length; i++) {
				this._decorationSet[decorations[i]] = reference.children[newDecorationsActualIndex[i]];
			}
		});
	}

	private _onDecorationChanged(event:any):void {
		var addedOrChangedDecorations = <any[]> event.addedOrChangedDecorations,
			toRemove:string[] = [];

		for(var i = 0, len = addedOrChangedDecorations.length; i < len; i++) {
			var reference = collections.lookup(this._decorationSet, <string> addedOrChangedDecorations[i].id);
			if(!reference) {
				continue;
			}

			var newRange = <editorCommon.IRange> addedOrChangedDecorations[i].range,
				ignore = false;

			if(Range.equalsRange(newRange, reference.range)) {
				continue;

			} else if(Range.spansMultipleLines(newRange)) {
				ignore = true;

			} else {
				var lineLength = reference.range.endColumn - reference.range.startColumn,
					newLineLength = newRange.endColumn - newRange.startColumn;

				if(lineLength !== newLineLength) {
					ignore = true;
				}
			}

			if(ignore) {
				this._decorationIgnoreSet[reference.id] = reference;
				toRemove.push(addedOrChangedDecorations[i].id);
			} else {
				reference.range = newRange;
			}
		}

		this.editor.changeDecorations((accessor) => {
			for (let i = 0, len = toRemove.length; i < len; i++) {
				delete this._decorationSet[toRemove[i]];
			}
			accessor.deltaDecorations(toRemove, []);
		});
	}

	public removeDecorations():void {
		var keys = Object.keys(this._decorationSet);
		if (keys.length > 0) {
			this.editor.changeDecorations((accessor) => {
				accessor.deltaDecorations(keys, []);
			});
		}
		this._decorationSet = {};
	}
}

class DataSource implements tree.IDataSource {

	public getId(tree:tree.ITree, element:any):string {
		if(element instanceof ReferencesModel) {
			return 'root';
		} else if(element instanceof FileReferences) {
			return (<FileReferences> element).id;
		} else if(element instanceof OneReference) {
			return (<OneReference> element).id;
		}
	}

	public hasChildren(tree:tree.ITree, element:any):boolean {
		return element instanceof FileReferences || element instanceof ReferencesModel;
	}

	public getChildren(tree:tree.ITree, element:any):TPromise<any[]> {
		if(element instanceof ReferencesModel) {
			return TPromise.as((<ReferencesModel> element).children);
		} else if(element instanceof FileReferences) {
			return (<FileReferences> element).resolve().then(val => val.children);
		} else {
			return TPromise.as([]);
		}
	}

	public getParent(tree:tree.ITree, element:any):TPromise<any> {
		var result:any = null;
		if(element instanceof FileReferences) {
			result = (<FileReferences> element).parent;
		} else if (element instanceof OneReference) {
			result = (<OneReference> element).parent;
		}
		return TPromise.as(result);
	}
}

class Controller extends DefaultController {

	static Events = {
		FOCUSED: 'events/custom/focused',
		SELECTED: 'events/custom/selected',
		OPEN_TO_SIDE: 'events/custom/opentoside'
	};

	public onMouseDown(tree:tree.ITree, element:any, event:IMouseEvent):boolean {
		if (event.leftButton) {
			if (element instanceof FileReferences) {
				event.preventDefault();
				event.stopPropagation();
				return this._expandCollapse(tree, element);
			}

			var result = super.onClick(tree, element, event);
			if (event.ctrlKey || event.metaKey) {
				tree.emit(Controller.Events.OPEN_TO_SIDE, element);
			} else if(event.detail === 2) {
				tree.emit(Controller.Events.SELECTED, element);
			} else {
				tree.emit(Controller.Events.FOCUSED, element);
			}
			return result;
		}

		return false;
	}

	public onClick(tree:tree.ITree, element:any, event:IMouseEvent):boolean {
		if (event.leftButton) {
			return false; // Already handled by onMouseDown
		}

		return super.onClick(tree, element, event);
	}

	private _expandCollapse(tree:tree.ITree, element:any):boolean {

		if (tree.isExpanded(element)) {
			tree.collapse(element).done(null, onUnexpectedError);
		} else {
			tree.expand(element).done(null, onUnexpectedError);
		}
		return true;
	}

	public onEscape(tree:tree.ITree, event:IKeyboardEvent):boolean {
		return false;
	}

	public onEnter(tree:tree.ITree, event:IKeyboardEvent):boolean {
		var element = tree.getFocus();
		if (element instanceof FileReferences) {
			return this._expandCollapse(tree, element);
		}

		var result = super.onEnter(tree, event);
		if (event.ctrlKey || event.metaKey) {
			tree.emit(Controller.Events.OPEN_TO_SIDE, element);
		} else {
			tree.emit(Controller.Events.SELECTED, element);
		}
		return result;
	}

	public onUp(tree:tree.ITree, event:IKeyboardEvent):boolean {
		super.onUp(tree, event);
		this._fakeFocus(tree, event);
		return true;
	}

	public onPageUp(tree:tree.ITree, event:IKeyboardEvent):boolean {
		super.onPageUp(tree, event);
		this._fakeFocus(tree, event);
		return true;
	}

	public onLeft(tree:tree.ITree, event:IKeyboardEvent):boolean {
		super.onLeft(tree, event);
		this._fakeFocus(tree, event);
		return true;
	}

	public onDown(tree:tree.ITree, event:IKeyboardEvent):boolean {
		super.onDown(tree, event);
		this._fakeFocus(tree, event);
		return true;
	}

	public onPageDown(tree:tree.ITree, event:IKeyboardEvent):boolean {
		super.onPageDown(tree, event);
		this._fakeFocus(tree, event);
		return true;
	}

	public onRight(tree:tree.ITree, event:IKeyboardEvent):boolean {
		super.onRight(tree, event);
		this._fakeFocus(tree, event);
		return true;
	}

	private _fakeFocus(tree:tree.ITree, event:IKeyboardEvent):void {
		// focus next item
		var focus = tree.getFocus();
		tree.setSelection([focus]);
		// send out event
		tree.emit(Controller.Events.FOCUSED, focus);
	}
}

class Renderer extends LegacyRenderer {
	private _contextService:IWorkspaceContextService;

	constructor(private editor: ICodeEditor, @IWorkspaceContextService contextService:IWorkspaceContextService) {
		super();
		this._contextService = contextService;
	}

	public getHeight(tree:tree.ITree, element:any):number {
		return 1.2 * this.editor.getConfiguration().lineHeight;
	}

	protected render(tree:tree.ITree, element:any, container:HTMLElement):tree.IElementCallback {

		dom.clearNode(container);

		if(element instanceof FileReferences) {
			var fileReferences = <FileReferences> element,
				fileReferencesContainer = $('.reference-file');

			/* tslint:disable:no-unused-expression */
			new LeftRightWidget(fileReferencesContainer, (left: HTMLElement) => {
				var resource = fileReferences.resource;
				new FileLabel(left, resource, this._contextService);

				return <IDisposable> null;

			}, (right: HTMLElement) => {
				var len = fileReferences.children.length;
				return new CountBadge(right, len, len > 1 ? nls.localize('referencesCount', "{0} references", len) : nls.localize('referenceCount', "{0} reference", len));
			});
			/* tslint:enable:no-unused-expression */

			fileReferencesContainer.appendTo(container);

		} else if(element instanceof OneReference) {

			var oneReference = <OneReference> element,
				oneReferenceContainer = $('.reference'),
				preview = oneReference.parent.preview.preview(oneReference.range);

			oneReferenceContainer.innerHtml(
				strings.format(
					'<span>{0}</span><span class="referenceMatch">{1}</span><span>{2}</span>',
					strings.escape(preview.before),
					strings.escape(preview.inside),
					strings.escape(preview.after))).appendTo(container);
		}

		return null;
	}

}

/**
 * ZoneWidget that is shown inside the editor
 */
export class ReferenceWidget extends PeekViewWidget {

	public static INNER_EDITOR_CONTEXT_KEY = 'inReferenceSearchEditor';

	private _editorService: IEditorService;
	private _contextService: IWorkspaceContextService;
	private _instantiationService: IInstantiationService;

	private _decorationsManager: DecorationsManager;
	private _model: ReferencesModel;
	private _callOnModel: IDisposable[] = [];
	private _onDidDoubleClick = new Emitter<{ reference: URI, range: Range, originalEvent: MouseEvent }>();

	private _tree: Tree;
	private _treeContainer: Builder;
	private _preview: ICodeEditor;
	private _previewNotAvailableMessage: Model;
	private _previewContainer: Builder;
	private _messageContainer: Builder;

	private _lastHeight: string;

	constructor(
		editorService: IEditorService,
		keybindingService: IKeybindingService,
		contextService: IWorkspaceContextService,
		instantiationService: IInstantiationService,
		editor: ICodeEditor
	) {
		super(editor, keybindingService, ReferenceWidget.INNER_EDITOR_CONTEXT_KEY, { frameColor: '#007ACC', showFrame: false, showArrow: true });
		this._editorService = editorService;
		this._contextService = contextService;
		this._instantiationService = instantiationService.createChild(new ServiceCollection([IPeekViewService, this]));

		this._tree = null;
		this._treeContainer = null;

		this._preview = null;
		this._previewContainer = null;

		this._lastHeight = null;

		this.create();
	}

	get onDidDoubleClick():Event<{ reference: URI, range: Range, originalEvent: MouseEvent }> {
		return this._onDidDoubleClick.event;
	}

	protected _onTitleClick(e: MouseEvent): void {
		if (!this._preview || !this._preview.getModel()) {
			return;
		}
		var model = this._preview.getModel(),
			lineNumber = this._preview.getPosition().lineNumber,
			titleRange = new Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber));

		this._onDidDoubleClick.fire({ reference: this._getFocusedReference(), range: titleRange, originalEvent: e });
	}

	protected _fillBody(containerElement: HTMLElement): void {
		var container = $(containerElement);

		container.addClass('reference-zone-widget');

		// message pane
		container.div({ 'class': 'messages' }, div => {
			this._messageContainer = div.hide();
		});

		// editor
		container.div({ 'class': 'preview inline' }, (div: Builder) => {

			var options: editorCommon.IEditorOptions = {
				scrollBeyondLastLine: false,
				scrollbar: DefaultConfig.editor.scrollbar,
				overviewRulerLanes: 2
			};

			this._preview = this._instantiationService.createInstance(EmbeddedCodeEditorWidget, div.getHTMLElement(), options, this.editor);
			this._previewContainer = div.hide();
			this._previewNotAvailableMessage = new Model(nls.localize('missingPreviewMessage', "no preview available"), Model.DEFAULT_CREATION_OPTIONS, null);
		});

		// tree
		container.div({ 'class': 'ref-tree inline' }, (div: Builder) => {
			var config = {
				dataSource: this._instantiationService.createInstance(DataSource),
				renderer: this._instantiationService.createInstance(Renderer, this.editor),
				//sorter: new Sorter(),
				controller: new Controller()
			};

			var options = {
				allowHorizontalScroll: false,
				twistiePixels: 20,
				ariaLabel: nls.localize('treeAriaLabel', "References")
			};
			this._tree = new Tree(div.getHTMLElement(), config, options);

			this._treeContainer = div.hide();
		});
	}

	protected _doLayoutBody(heightInPixel: number): void {
		super._doLayoutBody(heightInPixel);

		var h = heightInPixel + 'px';
		if (h === this._lastHeight) {
			return;
		}

		// set height
		this._treeContainer.style({ height: h });
		this._previewContainer.style({ height: h });

		// forward
		this._tree.layout(heightInPixel);
		this._preview.layout();

		this._lastHeight = h;
	}

	public onWidth(widthInPixel: number): void {
		this._preview.layout();
	}

	public setModel(newModel: ReferencesModel): void {
		// clean up
		this._callOnModel = dispose(this._callOnModel);
		this._model = newModel;
		if (this._model) {
			this._onNewModel();
		}
	}

	public showMessage(message: string): void {
		this.setTitle('');
		this._messageContainer.innerHtml(message).show();
	}

	private _onNewModel(): void {

		this._messageContainer.hide();

		this._decorationsManager = new DecorationsManager(this._preview, this._model);
		this._callOnModel.push(this._decorationsManager);

		// listen on model changes
		this._callOnModel.push(this._model.addListener2(EventType.OnReferenceRangeChanged, (reference: OneReference) => {
			this._tree.refresh(reference);
		}));

		// listen on selection and focus
		this._callOnModel.push(this._tree.addListener2(Controller.Events.FOCUSED, (element) => {
			if (element instanceof OneReference) {
				this._showReferencePreview(element);
			}
		}));
		this._callOnModel.push(this._tree.addListener2(Controller.Events.SELECTED, (element: any) => {
			if (element instanceof OneReference) {
				this._showReferencePreview(element);
				this._model.currentReference = element;
			}
		}));
		this._callOnModel.push(this._tree.addListener2(Controller.Events.OPEN_TO_SIDE, (element: any) => {
			if (element instanceof OneReference) {
				this._editorService.openEditor({
					resource: (<OneReference>element).resource,
					options: {
						selection: element.range
					}
				}, true);
			}
		}));

		var input = this._model.children.length === 1 ? <any>this._model.children[0] : <any>this._model;

		this._tree.setInput(input).then(() => {
			this._tree.setSelection([this._model.currentReference]);
		}).done(null, onUnexpectedError);

		// listen on editor
		this._callOnModel.push(this._preview.addListener2(editorCommon.EventType.MouseDown, (e: { event: MouseEvent; target: IMouseTarget; }) => {
			if (e.event.detail === 2) {
				this._onDidDoubleClick.fire({ reference: this._getFocusedReference(), range: e.target.range, originalEvent: e.event });
			}
		}));

		// make sure things are rendered
		dom.addClass(this.container, 'results-loaded');
		this._treeContainer.show();
		this._previewContainer.show();
		this._preview.layout();
		this._tree.layout();
		this.focus();

		// preview the current reference
		this._showReferencePreview(this._model.nextReference(this._model.currentReference));
	}

	private _getFocusedReference(): URI {
		var element = this._tree.getFocus();
		if (element instanceof OneReference) {
			return (<OneReference>element).resource;
		} else if (element instanceof FileReferences) {
			var referenceFile = (<FileReferences>element);
			if (referenceFile.children.length > 0) {
				return referenceFile.children[0].resource;
			}
		}
		return null;
	}

	public focus(): void {
		this._tree.DOMFocus();
	}

	private _showReferencePreview(reference: OneReference): void {

		// show in editor
		this._editorService.resolveEditorModel({ resource: reference.resource }).done((model) => {

			if (model) {
				this._preview.setModel(model.textEditorModel);
				var sel = Range.lift(reference.range).collapseToStart();
				this._preview.setSelection(sel);
				this._preview.revealRangeInCenter(sel);
			} else {
				this._preview.setModel(this._previewNotAvailableMessage);
			}

			// Update widget header
			if (reference.resource.scheme !== Schemas.inMemory) {
				this.setTitle(reference.name, getPathLabel(reference.directory, this._contextService));
			} else {
				this.setTitle(nls.localize('peekView.alternateTitle', "References"));
			}

		}, onUnexpectedError);

		// show in tree
		this._tree.reveal(reference)
			.then(() => {
				this._tree.setSelection([reference]);
				this._tree.setFocus(reference);
			})
			.done(null, onUnexpectedError);
	}

	public dispose(): void {
		this.setModel(null);
		dispose(<IDisposable[]>[this._preview, this._previewNotAvailableMessage, this._tree]);
		super.dispose();
	}
}
