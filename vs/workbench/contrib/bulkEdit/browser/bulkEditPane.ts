/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/bulkEdit';
import { WorkbenchAsyncDataTree, TreeResourceNavigator, IOpenEvent } from 'vs/platform/list/browser/listService';
import { WorkspaceEdit } from 'vs/editor/common/modes';
import { BulkEditElement, BulkEditDelegate, TextEditElementRenderer, FileElementRenderer, BulkEditDataSource, BulkEditIdentityProvider, FileElement, TextEditElement, BulkEditAccessibilityProvider, BulkEditAriaProvider, CategoryElementRenderer, BulkEditNaviLabelProvider } from 'vs/workbench/contrib/bulkEdit/browser/bulkEditTree';
import { FuzzyScore } from 'vs/base/common/filters';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerThemingParticipant, ITheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { diffInserted, diffRemoved } from 'vs/platform/theme/common/colorRegistry';
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { BulkEditPreviewProvider, BulkFileOperations, BulkFileOperationType, BulkCategory } from 'vs/workbench/contrib/bulkEdit/browser/bulkEditPreview';
import { ILabelService } from 'vs/platform/label/common/label';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { URI } from 'vs/base/common/uri';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService, RawContextKey, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { ResourceLabels, IResourceLabelsContainer } from 'vs/workbench/browser/labels';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import Severity from 'vs/base/common/severity';
import { basename } from 'vs/base/common/resources';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IAction } from 'vs/base/common/actions';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { ITreeContextMenuEvent } from 'vs/base/browser/ui/tree/tree';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ITextEditorOptions } from 'vs/platform/editor/common/editor';
import type { IAsyncDataTreeViewState } from 'vs/base/browser/ui/tree/asyncDataTree';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';

const enum State {
	Data = 'data',
	Message = 'message'
}

export class BulkEditPane extends ViewPane {

	static readonly ID = 'refactorPreview';

	static readonly ctxHasCategories = new RawContextKey('refactorPreview.hasCategories', false);
	static readonly ctxGroupByFile = new RawContextKey('refactorPreview.groupByFile', true);

	private static readonly _memGroupByFile = `${BulkEditPane.ID}.groupByFile`;

	private _tree!: WorkbenchAsyncDataTree<BulkFileOperations, BulkEditElement, FuzzyScore>;
	private _treeDataSource!: BulkEditDataSource;
	private _treeViewStates = new Map<boolean, IAsyncDataTreeViewState>();
	private _message!: HTMLSpanElement;

	private readonly _ctxHasCategories: IContextKey<boolean>;
	private readonly _ctxGroupByFile: IContextKey<boolean>;

	private readonly _disposables = new DisposableStore();
	private readonly _sessionDisposables = new DisposableStore();
	private _currentResolve?: (edit?: WorkspaceEdit) => void;
	private _currentInput?: BulkFileOperations;


	constructor(
		options: IViewletViewOptions,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILabelService private readonly _labelService: ILabelService,
		@ITextModelService private readonly _textModelService: ITextModelService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IMenuService private readonly _menuService: IMenuService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IStorageService private readonly _storageService: IStorageService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(
			{ ...options, titleMenuId: MenuId.BulkEditTitle },
			keybindingService, contextMenuService, configurationService, _contextKeyService, _instaService
		);

		this.element.classList.add('bulk-edit-panel', 'show-file-icons');
		this._ctxHasCategories = BulkEditPane.ctxHasCategories.bindTo(_contextKeyService);
		this._ctxGroupByFile = BulkEditPane.ctxGroupByFile.bindTo(_contextKeyService);
	}

	dispose(): void {
		this._tree.dispose();
		this._disposables.dispose();
	}

	protected renderBody(parent: HTMLElement): void {
		super.renderBody(parent);

		const resourceLabels = this._instaService.createInstance(
			ResourceLabels,
			<IResourceLabelsContainer>{ onDidChangeVisibility: this.onDidChangeBodyVisibility }
		);
		this._disposables.add(resourceLabels);

		// tree
		const treeContainer = document.createElement('div');
		treeContainer.className = 'tree';
		treeContainer.style.width = '100%';
		treeContainer.style.height = '100%';
		parent.appendChild(treeContainer);

		this._treeDataSource = this._instaService.createInstance(BulkEditDataSource);
		this._treeDataSource.groupByFile = this._storageService.getBoolean(BulkEditPane._memGroupByFile, StorageScope.GLOBAL, true);
		this._ctxGroupByFile.set(this._treeDataSource.groupByFile);

		this._tree = this._instaService.createInstance(
			WorkbenchAsyncDataTree, this.id, treeContainer,
			new BulkEditDelegate(),
			[new TextEditElementRenderer(), this._instaService.createInstance(FileElementRenderer, resourceLabels), new CategoryElementRenderer()],
			this._treeDataSource,
			{
				accessibilityProvider: this._instaService.createInstance(BulkEditAccessibilityProvider),
				ariaProvider: new BulkEditAriaProvider(),
				identityProvider: new BulkEditIdentityProvider(),
				expandOnlyOnTwistieClick: true,
				multipleSelectionSupport: false,
				keyboardNavigationLabelProvider: new BulkEditNaviLabelProvider(),
			}
		);

		this._disposables.add(this._tree.onContextMenu(this._onContextMenu, this));

		const navigator = new TreeResourceNavigator(this._tree, { openOnFocus: true });
		this._disposables.add(navigator);
		this._disposables.add(navigator.onDidOpenResource(e => this._openElementAsEditor(e)));

		// message
		this._message = document.createElement('span');
		this._message.className = 'message';
		this._message.innerText = localize('empty.msg', "Invoke a code action, like rename, to see a preview of its changes here.");
		parent.appendChild(this._message);

		//
		this._setState(State.Message);
	}

	protected layoutBody(height: number, width: number): void {
		this._tree.layout(height, width);
	}

	private _setState(state: State): void {
		this.element.dataset['state'] = state;
	}

	async setInput(edit: WorkspaceEdit, token: CancellationToken): Promise<WorkspaceEdit | undefined> {
		this._setState(State.Data);
		this._sessionDisposables.clear();
		this._treeViewStates.clear();

		if (this._currentResolve) {
			this._currentResolve(undefined);
			this._currentResolve = undefined;
		}

		const input = await this._instaService.invokeFunction(BulkFileOperations.create, edit);
		const provider = this._instaService.createInstance(BulkEditPreviewProvider, input);
		this._sessionDisposables.add(provider);
		this._sessionDisposables.add(input);

		//
		const hasCategories = input.categories.length > 1;
		this._ctxHasCategories.set(hasCategories);
		this._treeDataSource.groupByFile = !hasCategories || this._treeDataSource.groupByFile;

		this._currentInput = input;

		return new Promise(async resolve => {

			token.onCancellationRequested(() => resolve());

			this._currentResolve = resolve;
			this._setTreeInput(input);

			// refresh when check state changes
			this._sessionDisposables.add(input.onDidChangeCheckedState(() => {
				this._tree.updateChildren();
			}));
		});
	}

	private async _setTreeInput(input: BulkFileOperations) {

		const viewState = this._treeViewStates.get(this._treeDataSource.groupByFile);
		await this._tree.setInput(input, viewState);
		this._tree.domFocus();

		if (viewState) {
			return;
		}

		// async expandAll is the default when no view state is given
		const expand = [...this._tree.getNode(input).children];
		while (expand.length > 0) {
			const { element } = expand.pop()!;
			if (element instanceof FileElement) {
				await this._tree.expand(element, true);
			}
			if (element instanceof BulkCategory) {
				await this._tree.expand(element, true);
				expand.push(...this._tree.getNode(element).children);
			}
		}
	}

	accept(): void {

		const conflicts = this._currentInput?.conflicts.list();

		if (!conflicts || conflicts.length === 0) {
			this._done(true);
			return;
		}

		let message: string;
		if (conflicts.length === 1) {
			message = localize('conflict.1', "Cannot apply refactoring because '{0}' has changed in the meantime.", this._labelService.getUriLabel(conflicts[0], { relative: true }));
		} else {
			message = localize('conflict.N', "Cannot apply refactoring because {0} other files have changed in the meantime.", conflicts.length);
		}

		this._dialogService.show(Severity.Warning, message, []).finally(() => this._done(false));
	}

	discard() {
		this._done(false);
	}

	toggleChecked() {
		const [first] = this._tree.getFocus();
		if (first instanceof FileElement) {
			first.edit.updateChecked(!first.edit.isChecked());
		} else if (first instanceof TextEditElement && first.parent.edit.isChecked()) {
			first.edit.updateChecked(!first.edit.isChecked());
		}
	}

	groupByFile(): void {
		if (!this._treeDataSource.groupByFile) {
			this.toggleGrouping();
		}
	}

	groupByType(): void {
		if (this._treeDataSource.groupByFile) {
			this.toggleGrouping();
		}
	}

	toggleGrouping() {
		const input = this._tree.getInput();
		if (input) {

			// (1) capture view state
			let oldViewState = this._tree.getViewState();
			this._treeViewStates.set(this._treeDataSource.groupByFile, oldViewState);

			// (2) toggle and update
			this._treeDataSource.groupByFile = !this._treeDataSource.groupByFile;
			this._setTreeInput(input);

			// (3) remember preference
			this._storageService.store(BulkEditPane._memGroupByFile, this._treeDataSource.groupByFile, StorageScope.GLOBAL);
			this._ctxGroupByFile.set(this._treeDataSource.groupByFile);
		}
	}

	private _done(accept: boolean): void {
		if (this._currentResolve) {
			this._currentResolve(accept ? this._currentInput?.asWorkspaceEdit() : undefined);
			this._currentInput = undefined;
		}
		this._setState(State.Message);
		this._sessionDisposables.clear();
	}

	private async _openElementAsEditor(e: IOpenEvent<BulkEditElement | null>): Promise<void> {
		type Mutable<T> = {
			-readonly [P in keyof T]: T[P]
		};

		let options: Mutable<ITextEditorOptions> = { ...e.editorOptions };
		let fileElement: FileElement;
		if (e.element instanceof TextEditElement) {
			fileElement = e.element.parent;
			options.selection = e.element.edit.textEdit.edit.range;

		} else if (e.element instanceof FileElement) {
			fileElement = e.element;
			options.selection = e.element.edit.textEdits[0]?.textEdit.edit.range;

		} else {
			// invalid event
			return;
		}

		let leftResource: URI | undefined;
		if (fileElement.edit.type & BulkFileOperationType.TextEdit) {
			try {
				(await this._textModelService.createModelReference(fileElement.uri)).dispose();
				leftResource = fileElement.uri;
			} catch {
				leftResource = BulkEditPreviewProvider.emptyPreview;
			}
		}

		const previewUri = BulkEditPreviewProvider.asPreviewUri(fileElement.uri);

		if (leftResource) {
			// show diff editor
			this._editorService.openEditor({
				leftResource,
				rightResource: previewUri,
				label: localize('edt.title', "{0} (refactor preview)", basename(fileElement.uri)),
				options
			});
		} else {
			// show 'normal' editor
			let typeLabel: string | undefined;
			if (fileElement.edit.type & BulkFileOperationType.Rename) {
				typeLabel = localize('rename', "rename");
			} else if (fileElement.edit.type & BulkFileOperationType.Create) {
				typeLabel = localize('create', "create");
			} else if (fileElement.edit.type & BulkFileOperationType.Delete) {
				typeLabel = localize('delete', "delete");
			}

			this._editorService.openEditor({
				label: typeLabel && localize('edt.title2', "{0} ({1}, refactor preview)", basename(fileElement.uri), typeLabel),
				resource: previewUri,
				options
			});
		}
	}

	private _onContextMenu(e: ITreeContextMenuEvent<any>): void {
		const menu = this._menuService.createMenu(MenuId.BulkEditContext, this._contextKeyService);
		const actions: IAction[] = [];
		const disposable = createAndFillInContextMenuActions(menu, undefined, actions, this._contextMenuService);

		this._contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => e.anchor,
			onHide: () => {
				disposable.dispose();
				menu.dispose();
			}
		});
	}
}

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {

	const diffInsertedColor = theme.getColor(diffInserted);
	if (diffInsertedColor) {
		collector.addRule(`.monaco-workbench .bulk-edit-panel .highlight.insert { background-color: ${diffInsertedColor}; }`);
	}
	const diffRemovedColor = theme.getColor(diffRemoved);
	if (diffRemovedColor) {
		collector.addRule(`.monaco-workbench .bulk-edit-panel .highlight.remove { background-color: ${diffRemovedColor}; }`);
	}
});
