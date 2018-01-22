/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { ITree, ITreeConfiguration, ITreeOptions } from 'vs/base/parts/tree/browser/tree';
import { List, IListCreationOptions } from 'vs/base/browser/ui/list/listWidget';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable, toDisposable, combinedDisposable, dispose } from 'vs/base/common/lifecycle';
import { IContextKeyService, IContextKey, RawContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { PagedList, IPagedRenderer } from 'vs/base/browser/ui/list/listPaging';
import { IDelegate, IRenderer } from 'vs/base/browser/ui/list/list';
import { Tree } from 'vs/base/parts/tree/browser/treeImpl';
import { attachListStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { InputFocusedContextKey } from 'vs/platform/workbench/common/contextkeys';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { mixin } from 'vs/base/common/objects';
import { localize } from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';

export type ListWidget = List<any> | PagedList<any> | ITree;

export const IListService = createDecorator<IListService>('listService');

export interface IListService {

	_serviceBrand: any;

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

	_serviceBrand: any;

	private lists: IRegisteredList[] = [];
	private _lastFocusedWidget: ListWidget | undefined = undefined;

	get lastFocusedList(): ListWidget | undefined {
		return this._lastFocusedWidget;
	}

	constructor( @IContextKeyService contextKeyService: IContextKeyService) { }

	register(widget: ListWidget, extraContextKeys?: (IContextKey<boolean>)[]): IDisposable {
		if (this.lists.some(l => l.widget === widget)) {
			throw new Error('Cannot register the same widget multiple times');
		}

		// Keep in our lists list
		const registeredList: IRegisteredList = { widget, extraContextKeys };
		this.lists.push(registeredList);

		// Check for currently being focused
		if (widget.isDOMFocused()) {
			this._lastFocusedWidget = widget;
		}

		const result = combinedDisposable([
			widget.onDidFocus(() => this._lastFocusedWidget = widget),
			toDisposable(() => this.lists.splice(this.lists.indexOf(registeredList), 1))
		]);

		return result;
	}
}

const RawWorkbenchListFocusContextKey = new RawContextKey<boolean>('listFocus', true);
export const WorkbenchListSupportsMultiSelectContextKey = new RawContextKey<boolean>('listSupportsMultiselect', true);
export const WorkbenchListFocusContextKey = ContextKeyExpr.and(RawWorkbenchListFocusContextKey, ContextKeyExpr.not(InputFocusedContextKey));
export const WorkbenchListDoubleSelection = new RawContextKey<boolean>('listDoubleSelection', false);

export type Widget = List<any> | PagedList<any> | ITree;

function createScopedContextKeyService(contextKeyService: IContextKeyService, widget: Widget): IContextKeyService {
	const result = contextKeyService.createScoped(widget.getHTMLElement());

	if (widget instanceof List || widget instanceof PagedList) {
		WorkbenchListSupportsMultiSelectContextKey.bindTo(result);
	}

	RawWorkbenchListFocusContextKey.bindTo(result);
	return result;
}

export const multiSelectModifierSettingKey = 'workbench.multiSelectModifier';

function useAltAsMultiSelectModifier(configurationService: IConfigurationService): { useAltAsMultiSelectModifier: boolean } {
	return { useAltAsMultiSelectModifier: configurationService.getValue(multiSelectModifierSettingKey) === 'alt' };
}

export class WorkbenchList<T> extends List<T> {

	readonly contextKeyService: IContextKeyService;
	private listDoubleSelection: IContextKey<boolean>;

	constructor(
		container: HTMLElement,
		delegate: IDelegate<T>,
		renderers: IRenderer<T, any>[],
		private options: IListCreationOptions<T>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(container, delegate, renderers, mixin(options, useAltAsMultiSelectModifier(configurationService)));
		this.contextKeyService = createScopedContextKeyService(contextKeyService, this);
		this.listDoubleSelection = WorkbenchListDoubleSelection.bindTo(this.contextKeyService);

		this.disposables.push(combinedDisposable([
			this.contextKeyService,
			(listService as ListService).register(this),
			attachListStyler(this, themeService)
		]));
		this.disposables.push(this.onSelectionChange(() => {
			const selection = this.getSelection();
			this.listDoubleSelection.set(selection && selection.length === 2);
		}));
		this.disposables.push(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(multiSelectModifierSettingKey)) {
				this.updateOptions(useAltAsMultiSelectModifier(configurationService));
			}
		}));
	}

	public get useAltAsMultiSelectModifier(): boolean {
		return this.options.useAltAsMultiSelectModifier;
	}
}

export class WorkbenchPagedList<T> extends PagedList<T> {

	readonly contextKeyService: IContextKeyService;
	private disposable: IDisposable;

	constructor(
		container: HTMLElement,
		delegate: IDelegate<number>,
		renderers: IPagedRenderer<T, any>[],
		options: IListCreationOptions<any>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(container, delegate, renderers, mixin(options, useAltAsMultiSelectModifier(configurationService)));
		this.contextKeyService = createScopedContextKeyService(contextKeyService, this);

		this.disposable = combinedDisposable([
			this.contextKeyService,
			(listService as ListService).register(this),
			attachListStyler(this, themeService),
			configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(multiSelectModifierSettingKey)) {
					this.updateOptions(useAltAsMultiSelectModifier(configurationService));
				}
			})
		]);
	}

	dispose(): void {
		this.disposable.dispose();
	}
}

export class WorkbenchTree extends Tree {

	readonly contextKeyService: IContextKeyService;
	protected disposables: IDisposable[] = [];
	private listDoubleSelection: IContextKey<boolean>;

	constructor(
		container: HTMLElement,
		configuration: ITreeConfiguration,
		options: ITreeOptions,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService
	) {
		super(container, configuration, options);

		this.contextKeyService = createScopedContextKeyService(contextKeyService, this);
		this.listDoubleSelection = WorkbenchListDoubleSelection.bindTo(this.contextKeyService);

		this.disposables.push(
			this.contextKeyService,
			(listService as ListService).register(this),
			attachListStyler(this, themeService)
		);
		this.disposables.push(this.onDidChangeSelection(() => {
			const selection = this.getSelection();
			this.listDoubleSelection.set(selection && selection.length === 2);
		}));
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	'id': 'workbench',
	'order': 7,
	'title': localize('workbenchConfigurationTitle', "Workbench"),
	'type': 'object',
	'properties': {
		'workbench.multiSelectModifier': {
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
			}, "The modifier to be used to add an item to a multi-selection with the mouse (for example in trees and lists, if supported). `ctrlCmd` maps to `Control` on Windows and Linux and to `Command` on macOS. The 'Open to Side' mouse gestures - if supported - will adapt such that they do not conflict with the multiselect modifier.")
		}
	}
});