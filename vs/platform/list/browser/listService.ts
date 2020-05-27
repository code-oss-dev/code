/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createStyleSheet } from 'vs/base/browser/dom';
import { IListMouseEvent, IListTouchEvent, IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IPagedRenderer, PagedList, IPagedListOptions } from 'vs/base/browser/ui/list/listPaging';
import { DefaultStyleController, IListOptions, IMultipleSelectionController, IOpenController, isSelectionRangeChangeEvent, isSelectionSingleChangeEvent, List, IListAccessibilityProvider, IListOptionsUpdate } from 'vs/base/browser/ui/list/listWidget';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, dispose, IDisposable, toDisposable, DisposableStore, combinedDisposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { IConfigurationService, getMigratedSettingValue } from 'vs/platform/configuration/common/configuration';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { Registry } from 'vs/platform/registry/common/platform';
import { attachListStyler, computeStyles, defaultListStyles, IColorMapping } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { InputFocusedContextKey } from 'vs/platform/contextkey/common/contextkeys';
import { ObjectTree, IObjectTreeOptions, ICompressibleTreeRenderer, CompressibleObjectTree, ICompressibleObjectTreeOptions, ICompressibleObjectTreeOptionsUpdate } from 'vs/base/browser/ui/tree/objectTree';
import { ITreeRenderer, IAsyncDataSource, IDataSource } from 'vs/base/browser/ui/tree/tree';
import { AsyncDataTree, IAsyncDataTreeOptions, CompressibleAsyncDataTree, ITreeCompressionDelegate, ICompressibleAsyncDataTreeOptions, IAsyncDataTreeOptionsUpdate } from 'vs/base/browser/ui/tree/asyncDataTree';
import { DataTree, IDataTreeOptions } from 'vs/base/browser/ui/tree/dataTree';
import { IKeyboardNavigationEventFilter, IAbstractTreeOptions, RenderIndentGuides, IAbstractTreeOptionsUpdate } from 'vs/base/browser/ui/tree/abstractTree';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';

export type ListWidget = List<any> | PagedList<any> | ObjectTree<any, any> | DataTree<any, any, any> | AsyncDataTree<any, any, any>;

export const IListService = createDecorator<IListService>('listService');

export interface IListService {

	_serviceBrand: undefined;

	/**
	 * Returns the currently focused list widget if any.
	 */
	readonly lastFocusedList: ListWidget | undefined;
}

interface IRegisteredList {
	widget: ListWidget;
	extraContextKeys?: (IContextKey<boolean>)[];
}

export class ListService implements IListService {

	_serviceBrand: undefined;

	private disposables = new DisposableStore();
	private lists: IRegisteredList[] = [];
	private _lastFocusedWidget: ListWidget | undefined = undefined;
	private _hasCreatedStyleController: boolean = false;

	get lastFocusedList(): ListWidget | undefined {
		return this._lastFocusedWidget;
	}

	constructor(@IThemeService private readonly _themeService: IThemeService) {
	}

	register(widget: ListWidget, extraContextKeys?: (IContextKey<boolean>)[]): IDisposable {
		if (!this._hasCreatedStyleController) {
			this._hasCreatedStyleController = true;
			// create a shared default tree style sheet for performance reasons
			const styleController = new DefaultStyleController(createStyleSheet(), '');
			this.disposables.add(attachListStyler(styleController, this._themeService));
		}

		if (this.lists.some(l => l.widget === widget)) {
			throw new Error('Cannot register the same widget multiple times');
		}

		// Keep in our lists list
		const registeredList: IRegisteredList = { widget, extraContextKeys };
		this.lists.push(registeredList);

		// Check for currently being focused
		if (widget.getHTMLElement() === document.activeElement) {
			this._lastFocusedWidget = widget;
		}

		return combinedDisposable(
			widget.onDidFocus(() => this._lastFocusedWidget = widget),
			toDisposable(() => this.lists.splice(this.lists.indexOf(registeredList), 1)),
			widget.onDidDispose(() => {
				this.lists = this.lists.filter(l => l !== registeredList);
				if (this._lastFocusedWidget === widget) {
					this._lastFocusedWidget = undefined;
				}
			})
		);
	}

	dispose(): void {
		this.disposables.dispose();
	}
}

const RawWorkbenchListFocusContextKey = new RawContextKey<boolean>('listFocus', true);
export const WorkbenchListSupportsMultiSelectContextKey = new RawContextKey<boolean>('listSupportsMultiselect', true);
export const WorkbenchListFocusContextKey = ContextKeyExpr.and(RawWorkbenchListFocusContextKey, ContextKeyExpr.not(InputFocusedContextKey));
export const WorkbenchListHasSelectionOrFocus = new RawContextKey<boolean>('listHasSelectionOrFocus', false);
export const WorkbenchListDoubleSelection = new RawContextKey<boolean>('listDoubleSelection', false);
export const WorkbenchListMultiSelection = new RawContextKey<boolean>('listMultiSelection', false);
export const WorkbenchListSupportsKeyboardNavigation = new RawContextKey<boolean>('listSupportsKeyboardNavigation', true);
export const WorkbenchListAutomaticKeyboardNavigationKey = 'listAutomaticKeyboardNavigation';
export const WorkbenchListAutomaticKeyboardNavigation = new RawContextKey<boolean>(WorkbenchListAutomaticKeyboardNavigationKey, true);
export let didBindWorkbenchListAutomaticKeyboardNavigation = false;

function createScopedContextKeyService(contextKeyService: IContextKeyService, widget: ListWidget): IContextKeyService {
	const result = contextKeyService.createScoped(widget.getHTMLElement());
	RawWorkbenchListFocusContextKey.bindTo(result);
	return result;
}

export const multiSelectModifierSettingKey = 'workbench.list.multiSelectModifier';
export const openModeSettingKey = 'workbench.list.openMode';
export const horizontalScrollingKey = 'workbench.list.horizontalScrolling';
export const keyboardNavigationSettingKey = 'workbench.list.keyboardNavigation';
export const automaticKeyboardNavigationSettingKey = 'workbench.list.automaticKeyboardNavigation';
const treeIndentKey = 'workbench.tree.indent';
const treeRenderIndentGuidesKey = 'workbench.tree.renderIndentGuides';
const listSmoothScrolling = 'workbench.list.smoothScrolling';

function getHorizontalScrollingSetting(configurationService: IConfigurationService): boolean {
	return getMigratedSettingValue<boolean>(configurationService, horizontalScrollingKey, 'workbench.tree.horizontalScrolling');
}

function useAltAsMultipleSelectionModifier(configurationService: IConfigurationService): boolean {
	return configurationService.getValue(multiSelectModifierSettingKey) === 'alt';
}

function useSingleClickToOpen(configurationService: IConfigurationService): boolean {
	return configurationService.getValue(openModeSettingKey) !== 'doubleClick';
}

class MultipleSelectionController<T> extends Disposable implements IMultipleSelectionController<T> {
	private useAltAsMultipleSelectionModifier: boolean;

	constructor(private configurationService: IConfigurationService) {
		super();

		this.useAltAsMultipleSelectionModifier = useAltAsMultipleSelectionModifier(configurationService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(multiSelectModifierSettingKey)) {
				this.useAltAsMultipleSelectionModifier = useAltAsMultipleSelectionModifier(this.configurationService);
			}
		}));
	}

	isSelectionSingleChangeEvent(event: IListMouseEvent<T> | IListTouchEvent<T>): boolean {
		if (this.useAltAsMultipleSelectionModifier) {
			return event.browserEvent.altKey;
		}

		return isSelectionSingleChangeEvent(event);
	}

	isSelectionRangeChangeEvent(event: IListMouseEvent<T> | IListTouchEvent<T>): boolean {
		return isSelectionRangeChangeEvent(event);
	}
}

class WorkbenchOpenController extends Disposable implements IOpenController {
	private openOnSingleClick: boolean;

	constructor(private configurationService: IConfigurationService, private existingOpenController?: IOpenController) {
		super();

		this.openOnSingleClick = useSingleClickToOpen(configurationService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(openModeSettingKey)) {
				this.openOnSingleClick = useSingleClickToOpen(this.configurationService);
			}
		}));
	}

	shouldOpen(event: UIEvent): boolean {
		if (event instanceof MouseEvent) {
			const isLeftButton = event.button === 0;
			const isDoubleClick = event.detail === 2;
			if (isLeftButton && !this.openOnSingleClick && !isDoubleClick) {
				return false;
			}

			if (isLeftButton /* left mouse button */ || event.button === 1 /* middle mouse button */) {
				return this.existingOpenController ? this.existingOpenController.shouldOpen(event) : true;
			}

			return false;
		}

		return this.existingOpenController ? this.existingOpenController.shouldOpen(event) : true;
	}
}

function toWorkbenchListOptions<T>(options: IListOptions<T>, configurationService: IConfigurationService, keybindingService: IKeybindingService): [IListOptions<T>, IDisposable] {
	const disposables = new DisposableStore();
	const result = { ...options };

	if (options.multipleSelectionSupport !== false && !options.multipleSelectionController) {
		const multipleSelectionController = new MultipleSelectionController(configurationService);
		result.multipleSelectionController = multipleSelectionController;
		disposables.add(multipleSelectionController);
	}

	const openController = new WorkbenchOpenController(configurationService, options.openController);
	result.openController = openController;
	disposables.add(openController);

	result.keyboardNavigationDelegate = {
		mightProducePrintableCharacter(e) {
			return keybindingService.mightProducePrintableCharacter(e);
		}
	};

	return [result, disposables];
}

export interface IWorkbenchListOptionsUpdate extends IListOptionsUpdate {
	readonly overrideStyles?: IColorMapping;
}

export interface IWorkbenchListOptions<T> extends IWorkbenchListOptionsUpdate, IListOptions<T> {
	readonly accessibilityProvider: IListAccessibilityProvider<T>;
}

export class WorkbenchList<T> extends List<T> {

	readonly contextKeyService: IContextKeyService;
	private readonly configurationService: IConfigurationService;
	private readonly themeService: IThemeService;

	private listHasSelectionOrFocus: IContextKey<boolean>;
	private listDoubleSelection: IContextKey<boolean>;
	private listMultiSelection: IContextKey<boolean>;

	private _styler: IDisposable | undefined;
	private _useAltAsMultipleSelectionModifier: boolean;

	constructor(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: IListRenderer<T, any>[],
		options: IWorkbenchListOptions<T>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService
	) {
		const horizontalScrolling = typeof options.horizontalScrolling !== 'undefined' ? options.horizontalScrolling : getHorizontalScrollingSetting(configurationService);
		const [workbenchListOptions, workbenchListOptionsDisposable] = toWorkbenchListOptions(options, configurationService, keybindingService);

		super(user, container, delegate, renderers,
			{
				keyboardSupport: false,
				...computeStyles(themeService.getColorTheme(), defaultListStyles),
				...workbenchListOptions,
				horizontalScrolling
			}
		);

		this.disposables.add(workbenchListOptionsDisposable);

		this.contextKeyService = createScopedContextKeyService(contextKeyService, this);
		this.configurationService = configurationService;
		this.themeService = themeService;

		const listSupportsMultiSelect = WorkbenchListSupportsMultiSelectContextKey.bindTo(this.contextKeyService);
		listSupportsMultiSelect.set(!(options.multipleSelectionSupport === false));

		this.listHasSelectionOrFocus = WorkbenchListHasSelectionOrFocus.bindTo(this.contextKeyService);
		this.listDoubleSelection = WorkbenchListDoubleSelection.bindTo(this.contextKeyService);
		this.listMultiSelection = WorkbenchListMultiSelection.bindTo(this.contextKeyService);

		this._useAltAsMultipleSelectionModifier = useAltAsMultipleSelectionModifier(configurationService);

		this.disposables.add(this.contextKeyService);
		this.disposables.add((listService as ListService).register(this));

		if (options.overrideStyles) {
			this.updateStyles(options.overrideStyles);
		}

		this.disposables.add(this.onDidChangeSelection(() => {
			const selection = this.getSelection();
			const focus = this.getFocus();

			this.listHasSelectionOrFocus.set(selection.length > 0 || focus.length > 0);
			this.listMultiSelection.set(selection.length > 1);
			this.listDoubleSelection.set(selection.length === 2);
		}));
		this.disposables.add(this.onDidChangeFocus(() => {
			const selection = this.getSelection();
			const focus = this.getFocus();

			this.listHasSelectionOrFocus.set(selection.length > 0 || focus.length > 0);
		}));

		this.registerListeners();
	}

	updateOptions(options: IWorkbenchListOptionsUpdate): void {
		super.updateOptions(options);

		if (options.overrideStyles) {
			this.updateStyles(options.overrideStyles);
		}
	}

	dispose(): void {
		super.dispose();
		if (this._styler) {
			this._styler.dispose();
		}
	}

	private updateStyles(styles: IColorMapping): void {
		if (this._styler) {
			this._styler.dispose();
		}

		this._styler = attachListStyler(this, this.themeService, styles);
	}

	private registerListeners(): void {
		this.disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(multiSelectModifierSettingKey)) {
				this._useAltAsMultipleSelectionModifier = useAltAsMultipleSelectionModifier(this.configurationService);
			}
		}));
	}

	get useAltAsMultipleSelectionModifier(): boolean {
		return this._useAltAsMultipleSelectionModifier;
	}
}

export interface IWorkbenchPagedListOptions<T> extends IWorkbenchListOptionsUpdate, IPagedListOptions<T> {
	readonly accessibilityProvider: IListAccessibilityProvider<T>;
}

export class WorkbenchPagedList<T> extends PagedList<T> {

	readonly contextKeyService: IContextKeyService;
	private readonly configurationService: IConfigurationService;

	private readonly disposables: DisposableStore;

	private _useAltAsMultipleSelectionModifier: boolean;

	constructor(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<number>,
		renderers: IPagedRenderer<T, any>[],
		options: IWorkbenchPagedListOptions<T>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService
	) {
		const horizontalScrolling = typeof options.horizontalScrolling !== 'undefined' ? options.horizontalScrolling : getHorizontalScrollingSetting(configurationService);
		const [workbenchListOptions, workbenchListOptionsDisposable] = toWorkbenchListOptions(options, configurationService, keybindingService);
		super(user, container, delegate, renderers,
			{
				keyboardSupport: false,
				...computeStyles(themeService.getColorTheme(), defaultListStyles),
				...workbenchListOptions,
				horizontalScrolling
			}
		);

		this.disposables = new DisposableStore();
		this.disposables.add(workbenchListOptionsDisposable);

		this.contextKeyService = createScopedContextKeyService(contextKeyService, this);
		this.configurationService = configurationService;

		const listSupportsMultiSelect = WorkbenchListSupportsMultiSelectContextKey.bindTo(this.contextKeyService);
		listSupportsMultiSelect.set(!(options.multipleSelectionSupport === false));

		this._useAltAsMultipleSelectionModifier = useAltAsMultipleSelectionModifier(configurationService);

		this.disposables.add(this.contextKeyService);
		this.disposables.add((listService as ListService).register(this));

		if (options.overrideStyles) {
			this.disposables.add(attachListStyler(this, themeService, options.overrideStyles));
		}

		this.registerListeners();
	}

	private registerListeners(): void {
		this.disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(multiSelectModifierSettingKey)) {
				this._useAltAsMultipleSelectionModifier = useAltAsMultipleSelectionModifier(this.configurationService);
			}
		}));
	}

	get useAltAsMultipleSelectionModifier(): boolean {
		return this._useAltAsMultipleSelectionModifier;
	}

	dispose(): void {
		super.dispose();

		this.disposables.dispose();
	}
}

export interface IOpenResourceOptions {
	editorOptions: IEditorOptions;
	sideBySide: boolean;
	element: any;
	payload: any;
}

export interface IResourceResultsNavigationOptions {
	openOnFocus: boolean;
}

export interface IOpenEvent<T> {
	editorOptions: IEditorOptions;
	sideBySide: boolean;
	element: T;
	browserEvent?: UIEvent;
}

export interface IResourceNavigatorOptions {
	readonly openOnFocus?: boolean;
	readonly openOnSelection?: boolean;
	readonly openOnSingleClick?: boolean;
}

export interface SelectionKeyboardEvent extends KeyboardEvent {
	preserveFocus?: boolean;
}

export function getSelectionKeyboardEvent(typeArg = 'keydown', preserveFocus?: boolean): SelectionKeyboardEvent {
	const e = new KeyboardEvent(typeArg);
	(<SelectionKeyboardEvent>e).preserveFocus = preserveFocus;

	return e;
}

abstract class ResourceNavigator<T> extends Disposable {

	private readonly options: IResourceNavigatorOptions;

	private readonly _onDidOpenResource = new Emitter<IOpenEvent<T | null>>();
	readonly onDidOpenResource: Event<IOpenEvent<T | null>> = this._onDidOpenResource.event;

	constructor(
		private readonly treeOrList: {
			getFocus(): (T | null)[],
			getSelection(): (T | null)[],
			setSelection(elements: (T | null)[], browserEvent?: UIEvent): void,
			onDidChangeFocus: Event<{ browserEvent?: UIEvent }>,
			onDidChangeSelection: Event<{ browserEvent?: UIEvent }>,
			onDidOpen: Event<{ browserEvent?: UIEvent }>,
			readonly openOnSingleClick?: boolean
		},
		options?: IResourceNavigatorOptions
	) {
		super();

		this.options = { openOnSelection: true, ...(options || {}) };

		this.registerListeners();
	}

	private registerListeners(): void {
		if (this.options && this.options.openOnFocus) {
			this._register(this.treeOrList.onDidChangeFocus(e => this.onFocus(e.browserEvent)));
		}

		if (this.options && this.options.openOnSelection) {
			this._register(this.treeOrList.onDidChangeSelection(e => this.onSelection(e.browserEvent)));
		}

		this._register(this.treeOrList.onDidOpen(e => this.onSelection(e.browserEvent)));
	}

	private onFocus(browserEvent?: UIEvent): void {
		const focus = this.treeOrList.getFocus();
		this.treeOrList.setSelection(focus, browserEvent);

		if (!browserEvent) {
			return;
		}

		const isMouseEvent = browserEvent && browserEvent instanceof MouseEvent;

		if (!isMouseEvent) {
			const preserveFocus = (browserEvent instanceof KeyboardEvent && typeof (<SelectionKeyboardEvent>browserEvent).preserveFocus === 'boolean') ?
				!!(<SelectionKeyboardEvent>browserEvent).preserveFocus :
				true;

			this.open(preserveFocus, false, false, browserEvent);
		}
	}

	private onSelection(browserEvent?: MouseEvent | UIEvent): void {
		if (!browserEvent || browserEvent.type === 'contextmenu') {
			return;
		}

		const isKeyboardEvent = browserEvent instanceof KeyboardEvent;
		const isMiddleClick = browserEvent instanceof MouseEvent ? browserEvent.button === 1 : false;
		const isDoubleClick = browserEvent.detail === 2;
		const preserveFocus = (browserEvent instanceof KeyboardEvent && typeof (<SelectionKeyboardEvent>browserEvent).preserveFocus === 'boolean') ?
			!!(<SelectionKeyboardEvent>browserEvent).preserveFocus :
			!isDoubleClick;

		if (this.options.openOnSingleClick || this.treeOrList.openOnSingleClick || isDoubleClick || isKeyboardEvent) {
			const sideBySide = browserEvent instanceof MouseEvent && (browserEvent.ctrlKey || browserEvent.metaKey || browserEvent.altKey);
			this.open(preserveFocus, isDoubleClick || isMiddleClick, sideBySide, browserEvent);
		}
	}

	private open(preserveFocus: boolean, pinned: boolean, sideBySide: boolean, browserEvent?: UIEvent): void {
		this._onDidOpenResource.fire({
			editorOptions: {
				preserveFocus,
				pinned,
				revealIfVisible: true
			},
			sideBySide,
			element: this.treeOrList.getSelection()[0],
			browserEvent
		});
	}
}

export class ListResourceNavigator<T> extends ResourceNavigator<number> {
	constructor(list: WorkbenchList<T> | WorkbenchPagedList<T>, options?: IResourceNavigatorOptions) {
		super(list, options);
	}
}

export class TreeResourceNavigator<T, TFilterData> extends ResourceNavigator<T> {
	constructor(tree: WorkbenchObjectTree<T, TFilterData> | WorkbenchCompressibleObjectTree<T, TFilterData> | WorkbenchDataTree<any, T, TFilterData> | WorkbenchAsyncDataTree<any, T, TFilterData> | WorkbenchCompressibleAsyncDataTree<any, T, TFilterData>, options: IResourceNavigatorOptions = {}) {
		super(tree, options);
	}
}

function createKeyboardNavigationEventFilter(container: HTMLElement, keybindingService: IKeybindingService): IKeyboardNavigationEventFilter {
	let inChord = false;

	return event => {
		if (inChord) {
			inChord = false;
			return false;
		}

		const result = keybindingService.softDispatch(event, container);

		if (result && result.enterChord) {
			inChord = true;
			return false;
		}

		inChord = false;
		return true;
	};
}

export interface IWorkbenchObjectTreeOptions<T, TFilterData> extends IObjectTreeOptions<T, TFilterData> {
	readonly accessibilityProvider: IListAccessibilityProvider<T>;
	readonly overrideStyles?: IColorMapping;
}

export class WorkbenchObjectTree<T extends NonNullable<any>, TFilterData = void> extends ObjectTree<T, TFilterData> {

	private internals: WorkbenchTreeInternals<any, T, TFilterData>;
	get contextKeyService(): IContextKeyService { return this.internals.contextKeyService; }
	get useAltAsMultipleSelectionModifier(): boolean { return this.internals.useAltAsMultipleSelectionModifier; }

	constructor(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: ITreeRenderer<T, TFilterData, any>[],
		options: IWorkbenchObjectTreeOptions<T, TFilterData>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		const { options: treeOptions, getAutomaticKeyboardNavigation, disposable } = workbenchTreeDataPreamble<T, TFilterData, IWorkbenchObjectTreeOptions<T, TFilterData>>(container, options, contextKeyService, configurationService, keybindingService, accessibilityService);
		super(user, container, delegate, renderers, treeOptions);
		this.disposables.add(disposable);
		this.internals = new WorkbenchTreeInternals(this, treeOptions, getAutomaticKeyboardNavigation, options.overrideStyles, contextKeyService, listService, themeService, configurationService, accessibilityService);
		this.disposables.add(this.internals);
	}
}

export interface IWorkbenchCompressibleObjectTreeOptionsUpdate extends ICompressibleObjectTreeOptionsUpdate {
	readonly overrideStyles?: IColorMapping;
}

export interface IWorkbenchCompressibleObjectTreeOptions<T, TFilterData> extends IWorkbenchCompressibleObjectTreeOptionsUpdate, ICompressibleObjectTreeOptions<T, TFilterData> {
	readonly accessibilityProvider: IListAccessibilityProvider<T>;
}

export class WorkbenchCompressibleObjectTree<T extends NonNullable<any>, TFilterData = void> extends CompressibleObjectTree<T, TFilterData> {

	private internals: WorkbenchTreeInternals<any, T, TFilterData>;
	get contextKeyService(): IContextKeyService { return this.internals.contextKeyService; }
	get useAltAsMultipleSelectionModifier(): boolean { return this.internals.useAltAsMultipleSelectionModifier; }

	constructor(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: ICompressibleTreeRenderer<T, TFilterData, any>[],
		options: IWorkbenchCompressibleObjectTreeOptions<T, TFilterData>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		const { options: treeOptions, getAutomaticKeyboardNavigation, disposable } = workbenchTreeDataPreamble<T, TFilterData, IWorkbenchCompressibleObjectTreeOptions<T, TFilterData>>(container, options, contextKeyService, configurationService, keybindingService, accessibilityService);
		super(user, container, delegate, renderers, treeOptions);
		this.disposables.add(disposable);
		this.internals = new WorkbenchTreeInternals(this, treeOptions, getAutomaticKeyboardNavigation, options.overrideStyles, contextKeyService, listService, themeService, configurationService, accessibilityService);
		this.disposables.add(this.internals);
	}

	updateOptions(options: IWorkbenchCompressibleObjectTreeOptionsUpdate = {}): void {
		super.updateOptions(options);

		if (options.overrideStyles) {
			this.internals.updateStyleOverrides(options.overrideStyles);
		}
	}
}

export interface IWorkbenchDataTreeOptionsUpdate extends IAbstractTreeOptionsUpdate {
	readonly overrideStyles?: IColorMapping;
}

export interface IWorkbenchDataTreeOptions<T, TFilterData> extends IWorkbenchDataTreeOptionsUpdate, IDataTreeOptions<T, TFilterData> {
	readonly accessibilityProvider: IListAccessibilityProvider<T>;
}

export class WorkbenchDataTree<TInput, T, TFilterData = void> extends DataTree<TInput, T, TFilterData> {

	private internals: WorkbenchTreeInternals<TInput, T, TFilterData>;
	get contextKeyService(): IContextKeyService { return this.internals.contextKeyService; }
	get useAltAsMultipleSelectionModifier(): boolean { return this.internals.useAltAsMultipleSelectionModifier; }

	constructor(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: ITreeRenderer<T, TFilterData, any>[],
		dataSource: IDataSource<TInput, T>,
		options: IWorkbenchDataTreeOptions<T, TFilterData>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		const { options: treeOptions, getAutomaticKeyboardNavigation, disposable } = workbenchTreeDataPreamble<T, TFilterData, IWorkbenchDataTreeOptions<T, TFilterData>>(container, options, contextKeyService, configurationService, keybindingService, accessibilityService);
		super(user, container, delegate, renderers, dataSource, treeOptions);
		this.disposables.add(disposable);
		this.internals = new WorkbenchTreeInternals(this, treeOptions, getAutomaticKeyboardNavigation, options.overrideStyles, contextKeyService, listService, themeService, configurationService, accessibilityService);
		this.disposables.add(this.internals);
	}

	updateOptions(options: IWorkbenchDataTreeOptionsUpdate = {}): void {
		super.updateOptions(options);

		if (options.overrideStyles) {
			this.internals.updateStyleOverrides(options.overrideStyles);
		}
	}
}

export interface IWorkbenchAsyncDataTreeOptionsUpdate extends IAsyncDataTreeOptionsUpdate {
	readonly overrideStyles?: IColorMapping;
}

export interface IWorkbenchAsyncDataTreeOptions<T, TFilterData> extends IWorkbenchAsyncDataTreeOptionsUpdate, IAsyncDataTreeOptions<T, TFilterData> {
	readonly accessibilityProvider: IListAccessibilityProvider<T>;
}

export class WorkbenchAsyncDataTree<TInput, T, TFilterData = void> extends AsyncDataTree<TInput, T, TFilterData> {

	private internals: WorkbenchTreeInternals<TInput, T, TFilterData>;
	get contextKeyService(): IContextKeyService { return this.internals.contextKeyService; }
	get useAltAsMultipleSelectionModifier(): boolean { return this.internals.useAltAsMultipleSelectionModifier; }

	constructor(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: ITreeRenderer<T, TFilterData, any>[],
		dataSource: IAsyncDataSource<TInput, T>,
		options: IWorkbenchAsyncDataTreeOptions<T, TFilterData>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		const { options: treeOptions, getAutomaticKeyboardNavigation, disposable } = workbenchTreeDataPreamble<T, TFilterData, IWorkbenchAsyncDataTreeOptions<T, TFilterData>>(container, options, contextKeyService, configurationService, keybindingService, accessibilityService);
		super(user, container, delegate, renderers, dataSource, treeOptions);
		this.disposables.add(disposable);
		this.internals = new WorkbenchTreeInternals(this, treeOptions, getAutomaticKeyboardNavigation, options.overrideStyles, contextKeyService, listService, themeService, configurationService, accessibilityService);
		this.disposables.add(this.internals);
	}

	updateOptions(options: IWorkbenchAsyncDataTreeOptionsUpdate = {}): void {
		super.updateOptions(options);

		if (options.overrideStyles) {
			this.internals.updateStyleOverrides(options.overrideStyles);
		}
	}
}

export interface IWorkbenchCompressibleAsyncDataTreeOptions<T, TFilterData> extends ICompressibleAsyncDataTreeOptions<T, TFilterData> {
	readonly accessibilityProvider: IListAccessibilityProvider<T>;
	readonly overrideStyles?: IColorMapping;
}

export class WorkbenchCompressibleAsyncDataTree<TInput, T, TFilterData = void> extends CompressibleAsyncDataTree<TInput, T, TFilterData> {

	private internals: WorkbenchTreeInternals<TInput, T, TFilterData>;
	get contextKeyService(): IContextKeyService { return this.internals.contextKeyService; }
	get useAltAsMultipleSelectionModifier(): boolean { return this.internals.useAltAsMultipleSelectionModifier; }

	constructor(
		user: string,
		container: HTMLElement,
		virtualDelegate: IListVirtualDelegate<T>,
		compressionDelegate: ITreeCompressionDelegate<T>,
		renderers: ICompressibleTreeRenderer<T, TFilterData, any>[],
		dataSource: IAsyncDataSource<TInput, T>,
		options: IWorkbenchCompressibleAsyncDataTreeOptions<T, TFilterData>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		const { options: treeOptions, getAutomaticKeyboardNavigation, disposable } = workbenchTreeDataPreamble<T, TFilterData, IWorkbenchCompressibleAsyncDataTreeOptions<T, TFilterData>>(container, options, contextKeyService, configurationService, keybindingService, accessibilityService);
		super(user, container, virtualDelegate, compressionDelegate, renderers, dataSource, treeOptions);
		this.disposables.add(disposable);
		this.internals = new WorkbenchTreeInternals(this, treeOptions, getAutomaticKeyboardNavigation, options.overrideStyles, contextKeyService, listService, themeService, configurationService, accessibilityService);
		this.disposables.add(this.internals);
	}
}

function workbenchTreeDataPreamble<T, TFilterData, TOptions extends IAbstractTreeOptions<T, TFilterData> | IAsyncDataTreeOptions<T, TFilterData>>(
	container: HTMLElement,
	options: TOptions,
	contextKeyService: IContextKeyService,
	configurationService: IConfigurationService,
	keybindingService: IKeybindingService,
	accessibilityService: IAccessibilityService,
): { options: TOptions, getAutomaticKeyboardNavigation: () => boolean | undefined, disposable: IDisposable } {
	WorkbenchListSupportsKeyboardNavigation.bindTo(contextKeyService);

	if (!didBindWorkbenchListAutomaticKeyboardNavigation) {
		WorkbenchListAutomaticKeyboardNavigation.bindTo(contextKeyService);
		didBindWorkbenchListAutomaticKeyboardNavigation = true;
	}

	const getAutomaticKeyboardNavigation = () => {
		// give priority to the context key value to disable this completely
		let automaticKeyboardNavigation = contextKeyService.getContextKeyValue<boolean>(WorkbenchListAutomaticKeyboardNavigationKey);

		if (automaticKeyboardNavigation) {
			automaticKeyboardNavigation = configurationService.getValue<boolean>(automaticKeyboardNavigationSettingKey);
		}

		return automaticKeyboardNavigation;
	};

	const accessibilityOn = accessibilityService.isScreenReaderOptimized();
	const keyboardNavigation = accessibilityOn ? 'simple' : configurationService.getValue<string>(keyboardNavigationSettingKey);
	const horizontalScrolling = typeof options.horizontalScrolling !== 'undefined' ? options.horizontalScrolling : getHorizontalScrollingSetting(configurationService);
	const openOnSingleClick = useSingleClickToOpen(configurationService);
	const [workbenchListOptions, disposable] = toWorkbenchListOptions(options, configurationService, keybindingService);
	const additionalScrollHeight = options.additionalScrollHeight;

	return {
		getAutomaticKeyboardNavigation,
		disposable,
		options: {
			// ...options, // TODO@Joao why is this not splatted here?
			keyboardSupport: false,
			...workbenchListOptions,
			indent: configurationService.getValue<number>(treeIndentKey),
			renderIndentGuides: configurationService.getValue<RenderIndentGuides>(treeRenderIndentGuidesKey),
			smoothScrolling: configurationService.getValue<boolean>(listSmoothScrolling),
			automaticKeyboardNavigation: getAutomaticKeyboardNavigation(),
			simpleKeyboardNavigation: keyboardNavigation === 'simple',
			filterOnType: keyboardNavigation === 'filter',
			horizontalScrolling,
			openOnSingleClick,
			keyboardNavigationEventFilter: createKeyboardNavigationEventFilter(container, keybindingService),
			additionalScrollHeight,
			hideTwistiesOfChildlessElements: options.hideTwistiesOfChildlessElements
		} as TOptions
	};
}

class WorkbenchTreeInternals<TInput, T, TFilterData> {

	readonly contextKeyService: IContextKeyService;
	private hasSelectionOrFocus: IContextKey<boolean>;
	private hasDoubleSelection: IContextKey<boolean>;
	private hasMultiSelection: IContextKey<boolean>;
	private _useAltAsMultipleSelectionModifier: boolean;
	private disposables: IDisposable[] = [];
	private styler: IDisposable | undefined;

	constructor(
		private tree: WorkbenchObjectTree<T, TFilterData> | CompressibleObjectTree<T, TFilterData> | WorkbenchDataTree<TInput, T, TFilterData> | WorkbenchAsyncDataTree<TInput, T, TFilterData> | WorkbenchCompressibleAsyncDataTree<TInput, T, TFilterData>,
		options: IAbstractTreeOptions<T, TFilterData> | IAsyncDataTreeOptions<T, TFilterData>,
		getAutomaticKeyboardNavigation: () => boolean | undefined,
		overrideStyles: IColorMapping | undefined,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService private themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		this.contextKeyService = createScopedContextKeyService(contextKeyService, tree);

		const listSupportsMultiSelect = WorkbenchListSupportsMultiSelectContextKey.bindTo(this.contextKeyService);
		listSupportsMultiSelect.set(!(options.multipleSelectionSupport === false));

		this.hasSelectionOrFocus = WorkbenchListHasSelectionOrFocus.bindTo(this.contextKeyService);
		this.hasDoubleSelection = WorkbenchListDoubleSelection.bindTo(this.contextKeyService);
		this.hasMultiSelection = WorkbenchListMultiSelection.bindTo(this.contextKeyService);

		this._useAltAsMultipleSelectionModifier = useAltAsMultipleSelectionModifier(configurationService);

		const interestingContextKeys = new Set();
		interestingContextKeys.add(WorkbenchListAutomaticKeyboardNavigationKey);
		const updateKeyboardNavigation = () => {
			const accessibilityOn = accessibilityService.isScreenReaderOptimized();
			const keyboardNavigation = accessibilityOn ? 'simple' : configurationService.getValue<string>(keyboardNavigationSettingKey);
			tree.updateOptions({
				simpleKeyboardNavigation: keyboardNavigation === 'simple',
				filterOnType: keyboardNavigation === 'filter'
			});
		};

		this.updateStyleOverrides(overrideStyles);

		this.disposables.push(
			this.contextKeyService,
			(listService as ListService).register(tree),
			tree.onDidChangeSelection(() => {
				const selection = tree.getSelection();
				const focus = tree.getFocus();

				this.hasSelectionOrFocus.set(selection.length > 0 || focus.length > 0);
				this.hasMultiSelection.set(selection.length > 1);
				this.hasDoubleSelection.set(selection.length === 2);
			}),
			tree.onDidChangeFocus(() => {
				const selection = tree.getSelection();
				const focus = tree.getFocus();

				this.hasSelectionOrFocus.set(selection.length > 0 || focus.length > 0);
			}),
			configurationService.onDidChangeConfiguration(e => {
				let options: any = {};
				if (e.affectsConfiguration(openModeSettingKey)) {
					options = { ...options, openOnSingleClick: useSingleClickToOpen(configurationService) };
				}
				if (e.affectsConfiguration(multiSelectModifierSettingKey)) {
					this._useAltAsMultipleSelectionModifier = useAltAsMultipleSelectionModifier(configurationService);
				}
				if (e.affectsConfiguration(treeIndentKey)) {
					const indent = configurationService.getValue<number>(treeIndentKey);
					options = { ...options, indent };
				}
				if (e.affectsConfiguration(treeRenderIndentGuidesKey)) {
					const renderIndentGuides = configurationService.getValue<RenderIndentGuides>(treeRenderIndentGuidesKey);
					options = { ...options, renderIndentGuides };
				}
				if (e.affectsConfiguration(listSmoothScrolling)) {
					const smoothScrolling = configurationService.getValue<boolean>(listSmoothScrolling);
					options = { ...options, smoothScrolling };
				}
				if (e.affectsConfiguration(keyboardNavigationSettingKey)) {
					updateKeyboardNavigation();
				}
				if (e.affectsConfiguration(automaticKeyboardNavigationSettingKey)) {
					options = { ...options, automaticKeyboardNavigation: getAutomaticKeyboardNavigation() };
				}
				if (Object.keys(options).length > 0) {
					tree.updateOptions(options);
				}
			}),
			this.contextKeyService.onDidChangeContext(e => {
				if (e.affectsSome(interestingContextKeys)) {
					tree.updateOptions({ automaticKeyboardNavigation: getAutomaticKeyboardNavigation() });
				}
			}),
			accessibilityService.onDidChangeScreenReaderOptimized(() => updateKeyboardNavigation())
		);
	}

	get useAltAsMultipleSelectionModifier(): boolean {
		return this._useAltAsMultipleSelectionModifier;
	}

	updateStyleOverrides(overrideStyles?: IColorMapping): void {
		dispose(this.styler);
		this.styler = overrideStyles ? attachListStyler(this.tree, this.themeService, overrideStyles) : Disposable.None;
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
		dispose(this.styler);
		this.styler = undefined;
	}
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	'id': 'workbench',
	'order': 7,
	'title': localize('workbenchConfigurationTitle', "Workbench"),
	'type': 'object',
	'properties': {
		[multiSelectModifierSettingKey]: {
			'type': 'string',
			'enum': ['ctrlCmd', 'alt'],
			'enumDescriptions': [
				localize('multiSelectModifier.ctrlCmd', "Maps to `Control` on Windows and Linux and to `Command` on macOS."),
				localize('multiSelectModifier.alt', "Maps to `Alt` on Windows and Linux and to `Option` on macOS.")
			],
			'default': 'ctrlCmd',
			'description': localize({
				key: 'multiSelectModifier',
				comment: [
					'- `ctrlCmd` refers to a value the setting can take and should not be localized.',
					'- `Control` and `Command` refer to the modifier keys Ctrl or Cmd on the keyboard and can be localized.'
				]
			}, "The modifier to be used to add an item in trees and lists to a multi-selection with the mouse (for example in the explorer, open editors and scm view). The 'Open to Side' mouse gestures - if supported - will adapt such that they do not conflict with the multiselect modifier.")
		},
		[openModeSettingKey]: {
			'type': 'string',
			'enum': ['singleClick', 'doubleClick'],
			'default': 'singleClick',
			'description': localize({
				key: 'openModeModifier',
				comment: ['`singleClick` and `doubleClick` refers to a value the setting can take and should not be localized.']
			}, "Controls how to open items in trees and lists using the mouse (if supported). For parents with children in trees, this setting will control if a single click expands the parent or a double click. Note that some trees and lists might choose to ignore this setting if it is not applicable. ")
		},
		[horizontalScrollingKey]: {
			'type': 'boolean',
			'default': false,
			'description': localize('horizontalScrolling setting', "Controls whether lists and trees support horizontal scrolling in the workbench. Warning: turning on this setting has a performance implication.")
		},
		'workbench.tree.horizontalScrolling': {
			'type': 'boolean',
			'default': false,
			'description': localize('tree horizontalScrolling setting', "Controls whether trees support horizontal scrolling in the workbench."),
			'deprecationMessage': localize('deprecated', "This setting is deprecated, please use '{0}' instead.", horizontalScrollingKey)
		},
		[treeIndentKey]: {
			'type': 'number',
			'default': 8,
			minimum: 0,
			maximum: 40,
			'description': localize('tree indent setting', "Controls tree indentation in pixels.")
		},
		[treeRenderIndentGuidesKey]: {
			type: 'string',
			enum: ['none', 'onHover', 'always'],
			default: 'onHover',
			description: localize('render tree indent guides', "Controls whether the tree should render indent guides.")
		},
		[listSmoothScrolling]: {
			type: 'boolean',
			default: false,
			description: localize('list smoothScrolling setting', "Controls whether lists and trees have smooth scrolling."),
		},
		[keyboardNavigationSettingKey]: {
			'type': 'string',
			'enum': ['simple', 'highlight', 'filter'],
			'enumDescriptions': [
				localize('keyboardNavigationSettingKey.simple', "Simple keyboard navigation focuses elements which match the keyboard input. Matching is done only on prefixes."),
				localize('keyboardNavigationSettingKey.highlight', "Highlight keyboard navigation highlights elements which match the keyboard input. Further up and down navigation will traverse only the highlighted elements."),
				localize('keyboardNavigationSettingKey.filter', "Filter keyboard navigation will filter out and hide all the elements which do not match the keyboard input.")
			],
			'default': 'highlight',
			'description': localize('keyboardNavigationSettingKey', "Controls the keyboard navigation style for lists and trees in the workbench. Can be simple, highlight and filter.")
		},
		[automaticKeyboardNavigationSettingKey]: {
			'type': 'boolean',
			'default': true,
			markdownDescription: localize('automatic keyboard navigation setting', "Controls whether keyboard navigation in lists and trees is automatically triggered simply by typing. If set to `false`, keyboard navigation is only triggered when executing the `list.toggleKeyboardNavigation` command, for which you can assign a keyboard shortcut.")
		}
	}
});
