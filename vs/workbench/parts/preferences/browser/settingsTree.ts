/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Button } from 'vs/base/browser/ui/button/button';
import { InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { renderOcticons } from 'vs/base/browser/ui/octiconLabel/octiconLabel';
import { SelectBox } from 'vs/base/browser/ui/selectBox/selectBox';
import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import { TPromise } from 'vs/base/common/winjs.base';
import { IAccessibilityProvider, IDataSource, IFilter, IRenderer, ITree } from 'vs/base/parts/tree/browser/tree';
import { localize } from 'vs/nls';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { WorkbenchTreeController } from 'vs/platform/list/browser/listService';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { attachButtonStyler, attachInputBoxStyler, attachSelectBoxStyler } from 'vs/platform/theme/common/styler';
import { ICssStyleCollector, ITheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { SettingsTarget } from 'vs/workbench/parts/preferences/browser/preferencesWidgets';
import { ISearchResult, ISetting, ISettingsGroup } from 'vs/workbench/services/preferences/common/preferences';
import { DefaultSettingsEditorModel } from 'vs/workbench/services/preferences/common/preferencesModels';
import { IMouseEvent } from 'vs/base/browser/mouseEvent';

const $ = DOM.$;

export const modifiedItemForeground = registerColor('settings.modifiedItemForeground', {
	light: '#019001',
	dark: '#73C991',
	hc: '#73C991'
}, localize('modifiedItemForeground', "The foreground color for a modified setting."));

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {
	const modifiedItemForegroundColor = theme.getColor(modifiedItemForeground);
	if (modifiedItemForegroundColor) {
		collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item.is-configured .setting-item-title { color: ${modifiedItemForegroundColor}; }`);
	}
});

export interface ITreeItem {
	id: string;
}

export enum TreeItemType {
	setting,
	groupTitle,
	buttonRow
}

export interface ISettingElement extends ITreeItem {
	type: TreeItemType.setting;
	parent: ISettingsGroup;
	setting: ISetting;

	displayCategory: string;
	displayLabel: string;
	value: any;
	isConfigured: boolean;
	overriddenScopeList: string[];
	description: string;
	valueType?: string | string[];
	enum?: string[];
}

export interface IGroupElement extends ITreeItem {
	type: TreeItemType.groupTitle;
	parent: DefaultSettingsEditorModel;
	group: ISettingsGroup;
	index: number;
}

const ALL_SETTINGS_BUTTON_ID = 'all_settings_button_row';
export interface IButtonElement extends ITreeItem {
	type: TreeItemType.buttonRow;
	parent: DefaultSettingsEditorModel;
}

export type TreeElement = ISettingElement | IGroupElement | IButtonElement;
export type TreeElementOrRoot = TreeElement | DefaultSettingsEditorModel | SearchResultModel;

export class SettingsDataSource implements IDataSource {
	constructor(
		private viewState: ISettingsEditorViewState,
		@IConfigurationService private configurationService: IConfigurationService
	) { }

	getGroupElement(group: ISettingsGroup, index: number): IGroupElement {
		return <IGroupElement>{
			type: TreeItemType.groupTitle,
			group,
			id: `${group.title}_${group.id}`,
			index
		};
	}

	getSettingElement(setting: ISetting, group: ISettingsGroup): ISettingElement {
		const targetSelector = this.viewState.settingsTarget === ConfigurationTarget.USER ? 'user' : 'workspace';
		const inspected = this.configurationService.inspect(setting.key);
		const isConfigured = typeof inspected[targetSelector] !== 'undefined';
		const displayValue = isConfigured ? inspected[targetSelector] : inspected.default;
		const overriddenScopeList = [];
		if (targetSelector === 'user' && typeof inspected.workspace !== 'undefined') {
			overriddenScopeList.push(localize('workspace', "Workspace"));
		}

		if (targetSelector === 'workspace' && typeof inspected.user !== 'undefined') {
			overriddenScopeList.push(localize('user', "User"));
		}

		const displayKeyFormat = settingKeyToDisplayFormat(setting.key);
		return <ISettingElement>{
			type: TreeItemType.setting,
			parent: group,
			id: `${group.id}_${setting.key}`,
			setting,

			displayLabel: displayKeyFormat.label,
			displayCategory: displayKeyFormat.category,
			isExpanded: false,

			value: displayValue,
			isConfigured,
			overriddenScopeList,
			description: setting.description.join('\n'),
			enum: setting.enum,
			valueType: setting.type
		};
	}

	getId(tree: ITree, element: TreeElementOrRoot): string {
		return element instanceof DefaultSettingsEditorModel ? 'root' : element.id;
	}

	hasChildren(tree: ITree, element: TreeElementOrRoot): boolean {
		if (element instanceof DefaultSettingsEditorModel) {
			return true;
		}

		if (element instanceof SearchResultModel) {
			return true;
		}

		if (element.type === TreeItemType.groupTitle) {
			return true;
		}

		return false;
	}

	_getChildren(element: TreeElementOrRoot): TreeElement[] {
		if (element instanceof DefaultSettingsEditorModel) {
			return this.getRootChildren(element);
		} else if (element instanceof SearchResultModel) {
			return this.getGroupChildren(element.resultsAsGroup());
		} else if (element.type === TreeItemType.groupTitle) {
			return this.getGroupChildren(element.group);
		} else {
			// No children...
			return null;
		}
	}

	getChildren(tree: ITree, element: TreeElementOrRoot): TPromise<any, any> {
		return TPromise.as(this._getChildren(element));
	}

	private getRootChildren(root: DefaultSettingsEditorModel): TreeElement[] {
		const groupItems: TreeElement[] = root.settingsGroups
			.map((g, i) => this.getGroupElement(g, i));

		groupItems.splice(1, 0, <IButtonElement>{
			id: ALL_SETTINGS_BUTTON_ID,
			type: TreeItemType.buttonRow,
			parent: root
		});

		return groupItems;
	}

	private getGroupChildren(group: ISettingsGroup): ISettingElement[] {
		const entries: ISettingElement[] = [];
		for (const section of group.sections) {
			for (const setting of section.settings) {
				entries.push(this.getSettingElement(setting, group));
			}
		}

		return entries;
	}

	getParent(tree: ITree, element: TreeElement): TPromise<any, any> {
		if (!element) {
			return null;
		}

		if (!(element instanceof DefaultSettingsEditorModel)) {
			return TPromise.wrap(element.parent);
		}

		return TPromise.wrap(null);
	}
}

export function settingKeyToDisplayFormat(key: string): { category: string, label: string } {
	let label = key
		.replace(/\.([a-z])/g, (match, p1) => `.${p1.toUpperCase()}`)
		.replace(/([a-z])([A-Z])/g, '$1 $2') // fooBar => foo Bar
		.replace(/^[a-z]/g, match => match.toUpperCase()); // foo => Foo

	const lastDotIdx = label.lastIndexOf('.');
	let category = '';
	if (lastDotIdx >= 0) {
		category = label.substr(0, lastDotIdx);
		label = label.substr(lastDotIdx + 1);
	}

	return { category, label };
}

export interface ISettingsEditorViewState {
	settingsTarget: SettingsTarget;
	showConfiguredOnly?: boolean;
	showAllSettings?: boolean;
}

export interface IDisposableTemplate {
	toDispose: IDisposable[];
}

export interface ISettingItemTemplate extends IDisposableTemplate {
	parent: HTMLElement;

	context?: ISettingElement;
	containerElement: HTMLElement;
	categoryElement: HTMLElement;
	labelElement: HTMLElement;
	descriptionElement: HTMLElement;
	expandIndicatorElement: HTMLElement;
	valueElement: HTMLElement;
	overridesElement: HTMLElement;
}

export interface IGroupTitleTemplate extends IDisposableTemplate {
	context?: IGroupElement;
	parent: HTMLElement;
	labelElement: HTMLElement;
}

export interface IButtonRowTemplate extends IDisposableTemplate {
	parent: HTMLElement;

	button: Button;
	entry?: IButtonElement;
}

const SETTINGS_ELEMENT_TEMPLATE_ID = 'settings.entry.template';
const SETTINGS_GROUP_ELEMENT_TEMPLATE_ID = 'settings.group.template';
const BUTTON_ROW_ELEMENT_TEMPLATE = 'settings.buttonRow.template';

export interface ISettingChangeEvent {
	key: string;
	value: any; // undefined => reset/unconfigure
}

export class SettingsRenderer implements IRenderer {

	private static readonly SETTING_ROW_HEIGHT = 75;

	private readonly _onDidClickButton: Emitter<string> = new Emitter<string>();
	public readonly onDidClickButton: Event<string> = this._onDidClickButton.event;

	private readonly _onDidChangeSetting: Emitter<ISettingChangeEvent> = new Emitter<ISettingChangeEvent>();
	public readonly onDidChangeSetting: Event<ISettingChangeEvent> = this._onDidChangeSetting.event;

	private readonly _onDidOpenSettings: Emitter<void> = new Emitter<void>();
	public readonly onDidOpenSettings: Event<void> = this._onDidOpenSettings.event;

	private measureContainer: HTMLElement;

	constructor(
		private viewState: ISettingsEditorViewState,
		_measureContainer: HTMLElement,
		@IThemeService private themeService: IThemeService,
		@IContextViewService private contextViewService: IContextViewService
	) {
		this.measureContainer = DOM.append(_measureContainer, $('.setting-measure-container.monaco-tree-row'));
	}

	getHeight(tree: ITree, element: TreeElement): number {
		if (element.type === TreeItemType.groupTitle) {
			return 30;
		}

		if (element.type === TreeItemType.setting) {
			const isSelected = this.elementIsSelected(tree, element);
			if (isSelected) {
				return this.measureSettingElementHeight(tree, element);
			} else {
				return SettingsRenderer.SETTING_ROW_HEIGHT;
			}
		}

		if (element.type === TreeItemType.buttonRow) {
			return 60;
		}

		return 0;
	}

	private measureSettingElementHeight(tree: ITree, element: ISettingElement): number {
		const measureHelper = DOM.append(this.measureContainer, $('.setting-measure-helper'));

		const template = this.renderSettingTemplate(measureHelper);
		this.renderSettingElement(tree, element, template, true);

		const height = measureHelper.offsetHeight;
		this.measureContainer.removeChild(measureHelper);
		return height;
	}

	getTemplateId(tree: ITree, element: TreeElement): string {
		if (element.type === TreeItemType.groupTitle) {
			return SETTINGS_GROUP_ELEMENT_TEMPLATE_ID;
		}

		if (element.type === TreeItemType.buttonRow) {
			return BUTTON_ROW_ELEMENT_TEMPLATE;
		}

		if (element.type === TreeItemType.setting) {
			return SETTINGS_ELEMENT_TEMPLATE_ID;
		}

		return '';
	}

	renderTemplate(tree: ITree, templateId: string, container: HTMLElement) {
		if (templateId === SETTINGS_GROUP_ELEMENT_TEMPLATE_ID) {
			return this.renderGroupTitleTemplate(container);
		}

		if (templateId === BUTTON_ROW_ELEMENT_TEMPLATE) {
			return this.renderButtonRowTemplate(container);
		}

		if (templateId === SETTINGS_ELEMENT_TEMPLATE_ID) {
			return this.renderSettingTemplate(container);
		}

		return null;
	}

	private renderGroupTitleTemplate(container: HTMLElement): IGroupTitleTemplate {
		DOM.addClass(container, 'group-title');

		const labelElement = DOM.append(container, $('h3.settings-group-title-label'));

		const toDispose = [];
		const template: IGroupTitleTemplate = {
			parent: container,
			labelElement,
			toDispose
		};

		return template;
	}

	private renderButtonRowTemplate(container: HTMLElement): IButtonRowTemplate {
		DOM.addClass(container, 'all-settings');

		const buttonElement = DOM.append(container, $('.all-settings-button'));

		const button = new Button(buttonElement);
		const toDispose: IDisposable[] = [button];

		const template: IButtonRowTemplate = {
			parent: container,
			toDispose,

			button
		};
		template.toDispose.push(attachButtonStyler(button, this.themeService));
		template.toDispose.push(button.onDidClick(e => this._onDidClickButton.fire(template.entry && template.entry.id)));

		return template;
	}

	private renderSettingTemplate(container: HTMLElement): ISettingItemTemplate {
		DOM.addClass(container, 'setting-item');

		const leftElement = DOM.append(container, $('.setting-item-left'));
		const rightElement = DOM.append(container, $('.setting-item-right'));

		const titleElement = DOM.append(leftElement, $('.setting-item-title'));
		const categoryElement = DOM.append(titleElement, $('span.setting-item-category'));
		const labelElement = DOM.append(titleElement, $('span.setting-item-label'));
		const overridesElement = DOM.append(titleElement, $('span.setting-item-overrides'));
		const descriptionElement = DOM.append(leftElement, $('.setting-item-description'));
		const expandIndicatorElement = DOM.append(leftElement, $('.expand-indicator'));

		const valueElement = DOM.append(rightElement, $('.setting-item-value'));

		const toDispose = [];
		const template: ISettingItemTemplate = {
			parent: container,
			toDispose,

			containerElement: container,
			categoryElement,
			labelElement,
			descriptionElement,
			expandIndicatorElement,
			valueElement,
			overridesElement
		};

		// Prevent clicks from being handled by list
		toDispose.push(DOM.addDisposableListener(valueElement, 'mousedown', (e: IMouseEvent) => e.stopPropagation()));

		return template;
	}

	renderElement(tree: ITree, element: TreeElement, templateId: string, template: any): void {
		if (templateId === SETTINGS_ELEMENT_TEMPLATE_ID) {
			return this.renderSettingElement(tree, <ISettingElement>element, template);
		}

		if (templateId === SETTINGS_GROUP_ELEMENT_TEMPLATE_ID) {
			(<IGroupTitleTemplate>template).labelElement.textContent = (<IGroupElement>element).group.title;
			return;
		}

		if (templateId === BUTTON_ROW_ELEMENT_TEMPLATE) {
			return this.renderButtonRowElement(<IButtonElement>element, template);
		}
	}

	private elementIsSelected(tree: ITree, element: TreeElement): boolean {
		const selection = tree.getSelection();
		const selectedElement: TreeElement = selection && selection[0];
		return selectedElement && selectedElement.id === element.id;
	}

	private renderSettingElement(tree: ITree, element: ISettingElement, template: ISettingItemTemplate, measuring?: boolean): void {
		const isSelected = !!this.elementIsSelected(tree, element);
		const setting = element.setting;

		template.context = element;
		DOM.toggleClass(template.parent, 'is-configured', element.isConfigured);
		DOM.toggleClass(template.parent, 'is-expanded', isSelected);
		template.containerElement.id = element.id;

		const titleTooltip = setting.key;
		template.categoryElement.textContent = element.displayCategory + ': ';
		template.categoryElement.title = titleTooltip;

		template.labelElement.textContent = element.displayLabel;
		template.labelElement.title = titleTooltip;
		template.descriptionElement.textContent = element.description;

		if (!measuring) {
			const expandedHeight = this.measureSettingElementHeight(tree, element);
			const isExpandable = expandedHeight > SettingsRenderer.SETTING_ROW_HEIGHT;
			DOM.toggleClass(template.parent, 'is-expandable', isExpandable);

			if (isSelected) {
				template.expandIndicatorElement.innerHTML = renderOcticons('$(chevron-up)');
			} else if (isExpandable) {
				template.expandIndicatorElement.innerHTML = renderOcticons('$(chevron-down)');
			} else {
				template.expandIndicatorElement.innerHTML = '';
			}
		}

		this.renderValue(element, isSelected, template);

		const resetButton = new Button(template.valueElement);
		resetButton.element.title = localize('resetButtonTitle', "Reset");
		resetButton.element.classList.add('setting-reset-button');
		resetButton.element.tabIndex = isSelected ? 0 : -1;

		attachButtonStyler(resetButton, this.themeService, {
			buttonBackground: Color.transparent.toString(),
			buttonHoverBackground: Color.transparent.toString()
		});

		template.toDispose.push(resetButton.onDidClick(e => {
			this._onDidChangeSetting.fire({ key: element.setting.key, value: undefined });
		}));
		template.toDispose.push(resetButton);

		const alsoConfiguredInLabel = localize('alsoConfiguredIn', "Also modified in:");
		let overridesElementText = element.isConfigured ? 'Modified ' : '';

		if (element.overriddenScopeList.length) {
			overridesElementText = overridesElementText + `(${alsoConfiguredInLabel} ${element.overriddenScopeList.join(', ')})`;
		}

		template.overridesElement.textContent = overridesElementText;
	}

	private renderValue(element: ISettingElement, isSelected: boolean, template: ISettingItemTemplate): void {
		const onChange = value => this._onDidChangeSetting.fire({ key: element.setting.key, value });
		template.valueElement.innerHTML = '';
		if (element.valueType === 'string' && element.enum) {
			this.renderEnum(element, isSelected, template, onChange);
		} else if (element.valueType === 'boolean') {
			this.renderBool(element, isSelected, template, onChange);
		} else if (element.valueType === 'string') {
			this.renderText(element, isSelected, template, onChange);
		} else if (element.valueType === 'number') {
			this.renderText(element, isSelected, template, value => onChange(parseInt(value)));
		} else {
			this.renderEditInSettingsJson(element, isSelected, template);
		}
	}

	private renderBool(element: ISettingElement, isSelected: boolean, template: ISettingItemTemplate, onChange: (value: boolean) => void): void {
		const checkboxElement = <HTMLInputElement>DOM.append(template.valueElement, $('input.setting-value-checkbox.setting-value-input'));
		checkboxElement.type = 'checkbox';
		checkboxElement.checked = element.value;
		checkboxElement.tabIndex = isSelected ? 0 : -1;

		template.toDispose.push(DOM.addDisposableListener(checkboxElement, 'change', e => onChange(checkboxElement.checked)));
	}

	private renderEnum(element: ISettingElement, isSelected: boolean, template: ISettingItemTemplate, onChange: (value: string) => void): void {
		const idx = element.enum.indexOf(element.value);
		const selectBox = new SelectBox(element.enum, idx, this.contextViewService);
		template.toDispose.push(selectBox);
		template.toDispose.push(attachSelectBoxStyler(selectBox, this.themeService));
		selectBox.render(template.valueElement);
		if (template.valueElement.firstElementChild) {
			template.valueElement.firstElementChild.setAttribute('tabindex', isSelected ? '0' : '-1');
		}

		template.toDispose.push(
			selectBox.onDidSelect(e => onChange(element.enum[e.index])));
	}

	private renderText(element: ISettingElement, isSelected: boolean, template: ISettingItemTemplate, onChange: (value: string) => void): void {
		const inputBox = new InputBox(template.valueElement, this.contextViewService);
		template.toDispose.push(attachInputBoxStyler(inputBox, this.themeService));
		template.toDispose.push(inputBox);
		inputBox.value = element.value;
		inputBox.inputElement.tabIndex = isSelected ? 0 : -1;

		template.toDispose.push(
			inputBox.onDidChange(e => onChange(e)));
	}

	private renderEditInSettingsJson(element: ISettingElement, isSelected: boolean, template: ISettingItemTemplate): void {
		const openSettingsButton = new Button(template.valueElement, { title: true, buttonBackground: null, buttonHoverBackground: null });
		openSettingsButton.onDidClick(() => this._onDidOpenSettings.fire());
		openSettingsButton.label = localize('editInSettingsJson', "Edit in settings.json");
		openSettingsButton.element.classList.add('edit-in-settings-button');
		openSettingsButton.element.tabIndex = isSelected ? 0 : -1;

		template.toDispose.push(openSettingsButton);
		template.toDispose.push(attachButtonStyler(openSettingsButton, this.themeService, {
			buttonBackground: Color.transparent.toString(),
			buttonHoverBackground: Color.transparent.toString(),
			buttonForeground: 'foreground'
		}));
	}

	private renderButtonRowElement(element: IButtonElement, template: IButtonRowTemplate): void {
		template.button.label = this.viewState.showAllSettings ?
			localize('showFewerSettings', "Show Fewer Settings") :
			localize('showAllSettings', "Show All Settings");
	}

	disposeTemplate(tree: ITree, templateId: string, template: IDisposableTemplate): void {
		dispose(template.toDispose);
	}
}

export class SettingsTreeFilter implements IFilter {
	constructor(private viewState: ISettingsEditorViewState) { }

	isVisible(tree: ITree, element: TreeElement): boolean {
		if (this.viewState.showConfiguredOnly && element.type === TreeItemType.setting) {
			return element.isConfigured;
		}

		if (!this.viewState.showAllSettings && element.type === TreeItemType.groupTitle) {
			return element.index === 0;
		}

		return true;
	}
}

export class SettingsTreeController extends WorkbenchTreeController {
	constructor(
		@IConfigurationService configurationService: IConfigurationService
	) {
		super({}, configurationService);
	}
}

export class SettingsAccessibilityProvider implements IAccessibilityProvider {
	getAriaLabel(tree: ITree, element: TreeElement): string {
		if (!element) {
			return '';
		}

		if (element.type === TreeItemType.setting) {
			return localize('settingRowAriaLabel', "{0} {1}, Setting", element.displayCategory, element.displayLabel);
		}

		if (element.type === TreeItemType.groupTitle) {
			return localize('groupRowAriaLabel', "{0}, group", element.group.title);
		}

		if (element.type === TreeItemType.buttonRow) {
			return localize('buttonRowAriaLabel', "{0}, button", element.id);
		}

		return '';
	}
}

export enum SearchResultIdx {
	Local = 0,
	Remote = 1
}

export class SearchResultModel {
	private rawSearchResults: ISearchResult[];
	private cachedUniqueSearchResults: ISearchResult[];

	readonly id = 'searchResultModel';

	getUniqueResults(): ISearchResult[] {
		if (this.cachedUniqueSearchResults) {
			return this.cachedUniqueSearchResults;
		}

		if (!this.rawSearchResults) {
			return [];
		}

		const localMatchKeys = new Set();
		const localResult = objects.deepClone(this.rawSearchResults[SearchResultIdx.Local]);
		if (localResult) {
			localResult.filterMatches.forEach(m => localMatchKeys.add(m.setting.key));
		}

		const remoteResult = objects.deepClone(this.rawSearchResults[SearchResultIdx.Remote]);
		if (remoteResult) {
			remoteResult.filterMatches = remoteResult.filterMatches.filter(m => !localMatchKeys.has(m.setting.key));
		}

		this.cachedUniqueSearchResults = [localResult, remoteResult];
		return this.cachedUniqueSearchResults;
	}

	getRawResults(): ISearchResult[] {
		return this.rawSearchResults;
	}

	setResult(type: SearchResultIdx, result: ISearchResult): void {
		this.cachedUniqueSearchResults = null;
		this.rawSearchResults = this.rawSearchResults || [];
		this.rawSearchResults[type] = result;
	}

	resultsAsGroup(): ISettingsGroup {
		const flatSettings: ISetting[] = [];
		this.getUniqueResults()
			.filter(r => !!r)
			.forEach(r => {
				flatSettings.push(
					...r.filterMatches.map(m => m.setting));
			});

		return <ISettingsGroup>{
			id: 'settingsSearchResultGroup',
			range: null,
			sections: [
				{ settings: flatSettings }
			],
			title: 'searchResults',
			titleRange: null
		};
	}
}
