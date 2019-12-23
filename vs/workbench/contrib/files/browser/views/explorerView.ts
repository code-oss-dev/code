/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import * as perf from 'vs/base/common/performance';
import { IAction, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { memoize } from 'vs/base/common/decorators';
import { IFilesConfiguration, ExplorerFolderContext, FilesExplorerFocusedContext, ExplorerFocusedContext, ExplorerRootContext, ExplorerResourceReadonlyContext, IExplorerService, ExplorerResourceCut, ExplorerResourceMoveableToTrash, ExplorerCompressedFocusContext, ExplorerCompressedFirstFocusContext, ExplorerCompressedLastFocusContext } from 'vs/workbench/contrib/files/common/files';
import { NewFolderAction, NewFileAction, FileCopiedContext, RefreshExplorerView, CollapseExplorerView } from 'vs/workbench/contrib/files/browser/fileActions';
import { toResource, SideBySideEditor } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import * as DOM from 'vs/base/browser/dom';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ExplorerDecorationsProvider } from 'vs/workbench/contrib/files/browser/views/explorerDecorationsProvider';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ResourceContextKey } from 'vs/workbench/common/resources';
import { IDecorationsService } from 'vs/workbench/services/decorations/browser/decorations';
import { TreeResourceNavigator2, WorkbenchCompressibleAsyncDataTree } from 'vs/platform/list/browser/listService';
import { DelayedDragHandler } from 'vs/base/browser/dnd';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IViewPaneOptions, ViewPane } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ILabelService } from 'vs/platform/label/common/label';
import { ExplorerDelegate, ExplorerDataSource, FilesRenderer, ICompressedNavigationController, FilesFilter, FileSorter, FileDragAndDrop, ExplorerCompressionDelegate, isCompressedFolderName } from 'vs/workbench/contrib/files/browser/views/explorerViewer';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { ITreeContextMenuEvent } from 'vs/base/browser/ui/tree/tree';
import { IMenuService, MenuId, IMenu } from 'vs/platform/actions/common/actions';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ExplorerItem, NewExplorerItem } from 'vs/workbench/contrib/files/common/explorerModel';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ResourceLabels } from 'vs/workbench/browser/labels';
import { createFileIconThemableTreeContainerScope } from 'vs/workbench/browser/parts/views/views';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IAsyncDataTreeViewState } from 'vs/base/browser/ui/tree/asyncDataTree';
import { FuzzyScore } from 'vs/base/common/filters';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { isEqualOrParent } from 'vs/base/common/resources';
import { values } from 'vs/base/common/map';
import { first } from 'vs/base/common/arrays';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IFileService, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { attachStyler, IColorMapping } from 'vs/platform/theme/common/styler';
import { ColorValue, listDropBackground } from 'vs/platform/theme/common/colorRegistry';
import { Color } from 'vs/base/common/color';
import { SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';

interface IExplorerViewColors extends IColorMapping {
	listDropBackground?: ColorValue | undefined;
}

interface IExplorerViewStyles {
	listDropBackground?: Color;
}

export class ExplorerView extends ViewPane {
	static readonly ID: string = 'workbench.explorer.fileView';
	static readonly TREE_VIEW_STATE_STORAGE_KEY: string = 'workbench.explorer.treeViewState';

	private tree!: WorkbenchCompressibleAsyncDataTree<ExplorerItem | ExplorerItem[], ExplorerItem, FuzzyScore>;
	private filter!: FilesFilter;

	private resourceContext: ResourceContextKey;
	private folderContext: IContextKey<boolean>;
	private readonlyContext: IContextKey<boolean>;
	private rootContext: IContextKey<boolean>;
	private resourceMoveableToTrash: IContextKey<boolean>;

	private renderer!: FilesRenderer;

	private styleElement!: HTMLStyleElement;
	private compressedFocusContext: IContextKey<boolean>;
	private compressedFocusFirstContext: IContextKey<boolean>;
	private compressedFocusLastContext: IContextKey<boolean>;

	// Refresh is needed on the initial explorer open
	private shouldRefresh = true;
	private dragHandler!: DelayedDragHandler;
	private autoReveal = false;
	private actions: IAction[] | undefined;

	constructor(
		options: IViewPaneOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IProgressService private readonly progressService: IProgressService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IDecorationsService decorationService: IDecorationsService,
		@ILabelService private readonly labelService: ILabelService,
		@IThemeService private readonly themeService: IWorkbenchThemeService,
		@IMenuService private readonly menuService: IMenuService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IStorageService private readonly storageService: IStorageService,
		@IClipboardService private clipboardService: IClipboardService,
		@IFileService private readonly fileService: IFileService
	) {
		super({ ...(options as IViewPaneOptions), id: ExplorerView.ID, ariaHeaderLabel: nls.localize('explorerSection', "Files Explorer Section") }, keybindingService, contextMenuService, configurationService, contextKeyService);

		this.resourceContext = instantiationService.createInstance(ResourceContextKey);
		this._register(this.resourceContext);

		this.folderContext = ExplorerFolderContext.bindTo(contextKeyService);
		this.readonlyContext = ExplorerResourceReadonlyContext.bindTo(contextKeyService);
		this.rootContext = ExplorerRootContext.bindTo(contextKeyService);
		this.resourceMoveableToTrash = ExplorerResourceMoveableToTrash.bindTo(contextKeyService);
		this.compressedFocusContext = ExplorerCompressedFocusContext.bindTo(contextKeyService);
		this.compressedFocusFirstContext = ExplorerCompressedFirstFocusContext.bindTo(contextKeyService);
		this.compressedFocusLastContext = ExplorerCompressedLastFocusContext.bindTo(contextKeyService);

		this.explorerService.registerContextProvider(this);

		const decorationProvider = new ExplorerDecorationsProvider(this.explorerService, contextService);
		this._register(decorationService.registerDecorationsProvider(decorationProvider));
		this._register(decorationProvider);
	}

	get name(): string {
		return this.labelService.getWorkspaceLabel(this.contextService.getWorkspace());
	}

	get title(): string {
		return this.name;
	}

	set title(value: string) {
		// noop
	}

	// Memoized locals
	@memoize private get contributedContextMenu(): IMenu {
		const contributedContextMenu = this.menuService.createMenu(MenuId.ExplorerContext, this.tree.contextKeyService);
		this._register(contributedContextMenu);
		return contributedContextMenu;
	}

	@memoize private get fileCopiedContextKey(): IContextKey<boolean> {
		return FileCopiedContext.bindTo(this.contextKeyService);
	}

	@memoize private get resourceCutContextKey(): IContextKey<boolean> {
		return ExplorerResourceCut.bindTo(this.contextKeyService);
	}

	// Split view methods

	protected renderHeader(container: HTMLElement): void {
		super.renderHeader(container);

		// Expand on drag over
		this.dragHandler = new DelayedDragHandler(container, () => this.setExpanded(true));

		const titleElement = container.querySelector('.title') as HTMLElement;
		const setHeader = () => {
			const workspace = this.contextService.getWorkspace();
			const title = workspace.folders.map(folder => folder.name).join();
			titleElement.textContent = this.name;
			titleElement.title = title;
		};

		this._register(this.contextService.onDidChangeWorkspaceName(setHeader));
		this._register(this.labelService.onDidChangeFormatters(setHeader));
		setHeader();
	}

	protected layoutBody(height: number, width: number): void {
		this.tree.layout(height, width);
	}

	renderBody(container: HTMLElement): void {
		const treeContainer = DOM.append(container, DOM.$('.explorer-folders-view'));

		this.styleElement = DOM.createStyleSheet(treeContainer);
		attachStyler<IExplorerViewColors>(this.themeService, { listDropBackground }, this.styleListDropBackground.bind(this));

		this.createTree(treeContainer);

		if (this.toolbar) {
			this.toolbar.setActions(this.getActions(), this.getSecondaryActions())();
		}

		this._register(this.labelService.onDidChangeFormatters(() => {
			this._onDidChangeTitleArea.fire();
		}));

		this._register(this.explorerService.onDidChangeRoots(() => this.setTreeInput()));
		this._register(this.explorerService.onDidChangeItem(e => {
			if (this.explorerService.isEditable(undefined)) {
				this.tree.domFocus();
			}
			this.refresh(e.recursive, e.item);
		}));
		this._register(this.explorerService.onDidChangeEditable(async e => {
			const isEditing = !!this.explorerService.getEditableData(e);

			if (isEditing) {
				await this.tree.expand(e.parent!);
			} else {
				DOM.removeClass(treeContainer, 'highlight');
			}

			await this.refresh(false, e.parent);

			if (isEditing) {
				DOM.addClass(treeContainer, 'highlight');
				this.tree.reveal(e);
			} else {
				this.tree.domFocus();
			}
		}));
		this._register(this.explorerService.onDidSelectResource(e => this.onSelectResource(e.resource, e.reveal)));
		this._register(this.explorerService.onDidCopyItems(e => this.onCopyItems(e.items, e.cut, e.previouslyCutItems)));

		// Update configuration
		const configuration = this.configurationService.getValue<IFilesConfiguration>();
		this.onConfigurationUpdated(configuration);

		// When the explorer viewer is loaded, listen to changes to the editor input
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this.selectActiveFile(true);
		}));

		// Also handle configuration updates
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated(this.configurationService.getValue<IFilesConfiguration>(), e)));

		this._register(this.onDidChangeBodyVisibility(async visible => {
			if (visible) {
				// If a refresh was requested and we are now visible, run it
				if (this.shouldRefresh) {
					this.shouldRefresh = false;
					await this.setTreeInput();
				}
				// Find resource to focus from active editor input if set
				this.selectActiveFile(false, true);
			}
		}));
	}

	getActions(): IAction[] {
		if (!this.actions) {
			this.actions = [
				this.instantiationService.createInstance(NewFileAction),
				this.instantiationService.createInstance(NewFolderAction),
				this.instantiationService.createInstance(RefreshExplorerView, RefreshExplorerView.ID, RefreshExplorerView.LABEL),
				this.instantiationService.createInstance(CollapseExplorerView, CollapseExplorerView.ID, CollapseExplorerView.LABEL)
			];
			this.actions.forEach(a => this._register(a));
		}
		return this.actions;
	}

	focus(): void {
		this.tree.domFocus();

		const focused = this.tree.getFocus();
		if (focused.length === 1) {
			if (this.autoReveal) {
				this.tree.reveal(focused[0], 0.5);
			}

			const activeFile = this.getActiveFile();
			if (!activeFile && !focused[0].isDirectory) {
				// Open the focused element in the editor if there is currently no file opened #67708
				this.editorService.openEditor({ resource: focused[0].resource, options: { preserveFocus: true, revealIfVisible: true } });
			}
		}
	}

	getContext(respectMultiSelection: boolean): ExplorerItem[] {
		let focusedStat: ExplorerItem | undefined;

		const focus = this.tree.getFocus();
		focusedStat = focus.length ? focus[0] : undefined;

		const compressedNavigationController = focusedStat && this.renderer.getCompressedNavigationController(focusedStat);
		focusedStat = compressedNavigationController ? compressedNavigationController.current : focusedStat;

		const selectedStats: ExplorerItem[] = [];

		for (const stat of this.tree.getSelection()) {
			const controller = this.renderer.getCompressedNavigationController(stat);
			if (controller && focusedStat && controller === compressedNavigationController) {
				if (stat === focusedStat) {
					selectedStats.push(stat);
				}
				// Ignore stats which are selected but are part of the same compact node as the focused stat
				continue;
			}

			if (controller) {
				selectedStats.push(...controller.items);
			} else {
				selectedStats.push(stat);
			}
		}
		if (!focusedStat) {
			if (respectMultiSelection) {
				return selectedStats;
			} else {
				return [];
			}
		}

		if (respectMultiSelection && selectedStats.indexOf(focusedStat) >= 0) {
			return selectedStats;
		}

		return [focusedStat];
	}

	private selectActiveFile(deselect?: boolean, reveal = this.autoReveal): void {
		if (this.autoReveal) {
			const activeFile = this.getActiveFile();
			if (activeFile) {
				const focus = this.tree.getFocus();
				if (focus.length === 1 && focus[0].resource.toString() === activeFile.toString()) {
					// No action needed, active file is already focused
					return;
				}
				this.explorerService.select(activeFile, reveal);
			} else if (deselect) {
				this.tree.setSelection([]);
				this.tree.setFocus([]);
			}
		}
	}

	private createTree(container: HTMLElement): void {
		this.filter = this.instantiationService.createInstance(FilesFilter);
		this._register(this.filter);
		const explorerLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility });
		this._register(explorerLabels);

		const updateWidth = (stat: ExplorerItem) => this.tree.updateWidth(stat);
		this.renderer = this.instantiationService.createInstance(FilesRenderer, explorerLabels, updateWidth);
		this._register(this.renderer);

		this._register(createFileIconThemableTreeContainerScope(container, this.themeService));

		const isCompressionEnabled = () => this.configurationService.getValue<boolean>('explorer.compactFolders');

		this.tree = this.instantiationService.createInstance<typeof WorkbenchCompressibleAsyncDataTree, WorkbenchCompressibleAsyncDataTree<ExplorerItem | ExplorerItem[], ExplorerItem, FuzzyScore>>(WorkbenchCompressibleAsyncDataTree, 'FileExplorer', container, new ExplorerDelegate(), new ExplorerCompressionDelegate(), [this.renderer],
			this.instantiationService.createInstance(ExplorerDataSource), {
			compressionEnabled: isCompressionEnabled(),
			accessibilityProvider: this.renderer,
			ariaLabel: nls.localize('treeAriaLabel', "Files Explorer"),
			identityProvider: {
				getId: (stat: ExplorerItem) => {
					if (stat instanceof NewExplorerItem) {
						return `new:${stat.resource}`;
					}

					return stat.resource;
				}
			},
			keyboardNavigationLabelProvider: {
				getKeyboardNavigationLabel: (stat: ExplorerItem) => {
					if (this.explorerService.isEditable(stat)) {
						return undefined;
					}

					return stat.name;
				},
				getCompressedNodeKeyboardNavigationLabel: (stats: ExplorerItem[]) => {
					if (stats.some(stat => this.explorerService.isEditable(stat))) {
						return undefined;
					}

					return stats.map(stat => stat.name).join('/');
				}
			},
			multipleSelectionSupport: true,
			filter: this.filter,
			sorter: this.instantiationService.createInstance(FileSorter),
			dnd: this.instantiationService.createInstance(FileDragAndDrop),
			autoExpandSingleChildren: true,
			additionalScrollHeight: ExplorerDelegate.ITEM_HEIGHT,
			overrideStyles: {
				listBackground: SIDE_BAR_BACKGROUND
			}
		});
		this._register(this.tree);

		// Bind configuration
		const onDidChangeCompressionConfiguration = Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('explorer.compactFolders'));
		this._register(onDidChangeCompressionConfiguration(_ => this.tree.updateOptions({ compressionEnabled: isCompressionEnabled() })));

		// Bind context keys
		FilesExplorerFocusedContext.bindTo(this.tree.contextKeyService);
		ExplorerFocusedContext.bindTo(this.tree.contextKeyService);

		// Update resource context based on focused element
		this._register(this.tree.onDidChangeFocus(e => this.onFocusChanged(e.elements)));
		this.onFocusChanged([]);
		const explorerNavigator = new TreeResourceNavigator2(this.tree);
		this._register(explorerNavigator);
		// Open when selecting via keyboard
		this._register(explorerNavigator.onDidOpenResource(async e => {
			const selection = this.tree.getSelection();
			// Do not react if the user is expanding selection via keyboard.
			// Check if the item was previously also selected, if yes the user is simply expanding / collapsing current selection #66589.
			const shiftDown = e.browserEvent instanceof KeyboardEvent && e.browserEvent.shiftKey;
			if (selection.length === 1 && !shiftDown) {
				if (selection[0].isDirectory || this.explorerService.isEditable(undefined)) {
					// Do not react if user is clicking on explorer items while some are being edited #70276
					// Do not react if clicking on directories
					return;
				}
				this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: 'workbench.files.openFile', from: 'explorer' });
				await this.editorService.openEditor({ resource: selection[0].resource, options: { preserveFocus: e.editorOptions.preserveFocus, pinned: e.editorOptions.pinned } }, e.sideBySide ? SIDE_GROUP : ACTIVE_GROUP);
			}
		}));

		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));

		this._register(this.tree.onDidScroll(e => {
			let editable = this.explorerService.getEditable();
			if (e.scrollTopChanged && editable && this.tree.getRelativeTop(editable.stat) === null) {
				editable.data.onFinish('', false);
			}
		}));

		// save view state
		this._register(this.storageService.onWillSaveState(() => {
			this.storageService.store(ExplorerView.TREE_VIEW_STATE_STORAGE_KEY, JSON.stringify(this.tree.getViewState()), StorageScope.WORKSPACE);
		}));
	}

	// React on events

	private onConfigurationUpdated(configuration: IFilesConfiguration, event?: IConfigurationChangeEvent): void {
		this.autoReveal = configuration?.explorer?.autoReveal;

		// Push down config updates to components of viewer
		let needsRefresh = false;
		if (this.filter) {
			needsRefresh = this.filter.updateConfiguration();
		}

		if (event && !needsRefresh) {
			needsRefresh = event.affectsConfiguration('explorer.decorations.colors')
				|| event.affectsConfiguration('explorer.decorations.badges');
		}

		// Refresh viewer as needed if this originates from a config event
		if (event && needsRefresh) {
			this.refresh(true);
		}
	}

	private setContextKeys(stat: ExplorerItem | null | undefined): void {
		const isSingleFolder = this.contextService.getWorkbenchState() === WorkbenchState.FOLDER;
		const resource = stat ? stat.resource : isSingleFolder ? this.contextService.getWorkspace().folders[0].uri : null;
		this.resourceContext.set(resource);
		this.folderContext.set((isSingleFolder && !stat) || !!stat && stat.isDirectory);
		this.readonlyContext.set(!!stat && stat.isReadonly);
		this.rootContext.set(!stat || (stat && stat.isRoot));
	}

	private onContextMenu(e: ITreeContextMenuEvent<ExplorerItem>): void {
		const disposables = new DisposableStore();
		let stat = e.element;
		let anchor = e.anchor;

		// Compressed folders
		if (stat) {
			const controller = this.renderer.getCompressedNavigationController(stat);

			if (controller) {
				if (e.browserEvent instanceof KeyboardEvent || isCompressedFolderName(e.browserEvent.target)) {
					anchor = controller.labels[controller.index];
				} else {
					controller.last();
				}
			}
		}

		// update dynamic contexts
		this.fileCopiedContextKey.set(this.clipboardService.hasResources());
		this.setContextKeys(stat);

		const selection = this.tree.getSelection();

		const actions: IAction[] = [];
		const roots = this.explorerService.roots; // If the click is outside of the elements pass the root resource if there is only one root. If there are multiple roots pass empty object.
		const arg = stat instanceof ExplorerItem ? stat.resource : roots.length === 1 ? roots[0].resource : {};
		disposables.add(createAndFillInContextMenuActions(this.contributedContextMenu, { arg, shouldForwardArgs: true }, actions, this.contextMenuService));

		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			onHide: (wasCancelled?: boolean) => {
				if (wasCancelled) {
					this.tree.domFocus();
				}

				disposables.dispose();
			},
			getActionsContext: () => stat && selection && selection.indexOf(stat) >= 0
				? selection.map((fs: ExplorerItem) => fs.resource)
				: stat instanceof ExplorerItem ? [stat.resource] : []
		});
	}

	private onFocusChanged(elements: ExplorerItem[]): void {
		const stat = elements && elements.length ? elements[0] : undefined;
		this.setContextKeys(stat);

		if (stat) {
			const enableTrash = this.configurationService.getValue<IFilesConfiguration>().files.enableTrash;
			const hasCapability = this.fileService.hasCapability(stat.resource, FileSystemProviderCapabilities.Trash);
			this.resourceMoveableToTrash.set(enableTrash && hasCapability);
		} else {
			this.resourceMoveableToTrash.reset();
		}

		const compressedNavigationController = stat && this.renderer.getCompressedNavigationController(stat);

		if (!compressedNavigationController) {
			this.compressedFocusContext.set(false);
			return;
		}

		this.compressedFocusContext.set(true);
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	// General methods

	/**
	 * Refresh the contents of the explorer to get up to date data from the disk about the file structure.
	 * If the item is passed we refresh only that level of the tree, otherwise we do a full refresh.
	 */
	private refresh(recursive: boolean, item?: ExplorerItem): Promise<void> {
		if (!this.tree || !this.isBodyVisible()) {
			this.shouldRefresh = true;
			return Promise.resolve(undefined);
		}

		// Tree node doesn't exist yet
		if (item && !this.tree.hasNode(item)) {
			return Promise.resolve(undefined);
		}

		const toRefresh = item || this.tree.getInput();

		return this.tree.updateChildren(toRefresh, recursive);
	}

	getOptimalWidth(): number {
		const parentNode = this.tree.getHTMLElement();
		const childNodes = ([] as HTMLElement[]).slice.call(parentNode.querySelectorAll('.explorer-item .label-name')); // select all file labels

		return DOM.getLargestChildWidth(parentNode, childNodes);
	}

	// private didLoad = false;

	private setTreeInput(): Promise<void> {
		if (!this.isBodyVisible()) {
			this.shouldRefresh = true;
			return Promise.resolve(undefined);
		}

		const initialInputSetup = !this.tree.getInput();
		if (initialInputSetup) {
			perf.mark('willResolveExplorer');
		}
		const roots = this.explorerService.roots;
		let input: ExplorerItem | ExplorerItem[] = roots[0];
		if (this.contextService.getWorkbenchState() !== WorkbenchState.FOLDER || roots[0].isError) {
			// Display roots only when multi folder workspace
			input = roots;
		}

		let viewState: IAsyncDataTreeViewState | undefined;
		if (this.tree && this.tree.getInput()) {
			viewState = this.tree.getViewState();
		} else {
			const rawViewState = this.storageService.get(ExplorerView.TREE_VIEW_STATE_STORAGE_KEY, StorageScope.WORKSPACE);
			if (rawViewState) {
				viewState = JSON.parse(rawViewState);
			}
		}

		const previousInput = this.tree.getInput();
		const promise = this.tree.setInput(input, viewState).then(() => {
			if (Array.isArray(input)) {
				if (!viewState || previousInput instanceof ExplorerItem) {
					// There is no view state for this workspace, expand all roots. Or we transitioned from a folder workspace.
					input.forEach(item => this.tree.expand(item).then(undefined, onUnexpectedError));
				}
				if (Array.isArray(previousInput) && previousInput.length < input.length) {
					// Roots added to the explorer -> expand them.
					input.slice(previousInput.length).forEach(item => this.tree.expand(item).then(undefined, onUnexpectedError));
				}
			}
			if (initialInputSetup) {
				perf.mark('didResolveExplorer');
			}
		});

		this.progressService.withProgress({
			location: ProgressLocation.Explorer,
			delay: this.layoutService.isRestored() ? 800 : 1200 // less ugly initial startup
		}, _progress => promise);

		return promise;
	}

	private getActiveFile(): URI | undefined {
		const input = this.editorService.activeEditor;

		// ignore diff editor inputs (helps to get out of diffing when returning to explorer)
		if (input instanceof DiffEditorInput) {
			return undefined;
		}

		// check for files
		return withNullAsUndefined(toResource(input, { supportSideBySide: SideBySideEditor.MASTER }));
	}

	private async onSelectResource(resource: URI | undefined, reveal = this.autoReveal, retry = 0): Promise<void> {
		// do no retry more than once to prevent inifinite loops in cases of inconsistent model
		if (retry === 2) {
			return;
		}

		if (!resource || !this.isBodyVisible()) {
			return;
		}

		// Expand all stats in the parent chain.
		let item: ExplorerItem | undefined = this.explorerService.roots.filter(i => isEqualOrParent(resource, i.resource))
			// Take the root that is the closest to the stat #72299
			.sort((first, second) => second.resource.path.length - first.resource.path.length)[0];

		while (item && item.resource.toString() !== resource.toString()) {
			if (item.isDisposed) {
				return this.onSelectResource(resource, reveal, retry + 1);
			}
			await this.tree.expand(item);
			item = first(values(item.children), i => isEqualOrParent(resource, i.resource));
		}

		if (item && item.parent) {
			if (reveal) {
				if (item.isDisposed) {
					return this.onSelectResource(resource, reveal, retry + 1);
				}
				this.tree.reveal(item, 0.5);
			}

			this.tree.setFocus([item]);
			this.tree.setSelection([item]);
		}
	}

	private onCopyItems(stats: ExplorerItem[], cut: boolean, previousCut: ExplorerItem[] | undefined): void {
		this.fileCopiedContextKey.set(stats.length > 0);
		this.resourceCutContextKey.set(cut && stats.length > 0);
		if (previousCut) {
			previousCut.forEach(item => this.tree.rerender(item));
		}
		if (cut) {
			stats.forEach(s => this.tree.rerender(s));
		}
	}

	collapseAll(): void {
		const treeInput = this.tree.getInput();
		if (Array.isArray(treeInput)) {
			const hasExpandedItemInsideFolder = treeInput.some(folder =>
				Array.from(folder.children.entries()).some(([_id, child]) =>
					this.tree.hasNode(child) && !this.tree.isCollapsed(child)));

			if (hasExpandedItemInsideFolder) {
				treeInput.forEach(folder => {
					folder.children.forEach(child => this.tree.hasNode(child) && this.tree.collapse(child));
				});

				return;
			}
		}

		this.tree.collapseAll();
	}

	previousCompressedStat(): void {
		const focused = this.tree.getFocus();
		if (!focused.length) {
			return;
		}

		const compressedNavigationController = this.renderer.getCompressedNavigationController(focused[0])!;
		compressedNavigationController.previous();
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	nextCompressedStat(): void {
		const focused = this.tree.getFocus();
		if (!focused.length) {
			return;
		}

		const compressedNavigationController = this.renderer.getCompressedNavigationController(focused[0])!;
		compressedNavigationController.next();
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	firstCompressedStat(): void {
		const focused = this.tree.getFocus();
		if (!focused.length) {
			return;
		}

		const compressedNavigationController = this.renderer.getCompressedNavigationController(focused[0])!;
		compressedNavigationController.first();
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	lastCompressedStat(): void {
		const focused = this.tree.getFocus();
		if (!focused.length) {
			return;
		}

		const compressedNavigationController = this.renderer.getCompressedNavigationController(focused[0])!;
		compressedNavigationController.last();
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	private updateCompressedNavigationContextKeys(controller: ICompressedNavigationController): void {
		this.compressedFocusFirstContext.set(controller.index === 0);
		this.compressedFocusLastContext.set(controller.index === controller.count - 1);
	}

	styleListDropBackground(styles: IExplorerViewStyles): void {
		const content: string[] = [];

		if (styles.listDropBackground) {
			content.push(`.explorer-viewlet .explorer-item .monaco-icon-name-container.multiple > .label-name.drop-target > .monaco-highlighted-label { background-color: ${styles.listDropBackground}; }`);
		}

		const newStyles = content.join('\n');
		if (newStyles !== this.styleElement.innerHTML) {
			this.styleElement.innerHTML = newStyles;
		}
	}

	dispose(): void {
		if (this.dragHandler) {
			this.dragHandler.dispose();
		}
		super.dispose();
	}
}
