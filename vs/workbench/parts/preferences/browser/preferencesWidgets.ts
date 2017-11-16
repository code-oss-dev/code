/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import URI from 'vs/base/common/uri';
import { Dimension } from 'vs/base/browser/builder';
import * as DOM from 'vs/base/browser/dom';
import { TPromise } from 'vs/base/common/winjs.base';
import { Disposable } from 'vs/base/common/lifecycle';
import { Widget } from 'vs/base/browser/ui/widget';
import { Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import Event, { Emitter } from 'vs/base/common/event';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition, OverlayWidgetPositionPreference, IViewZone, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { InputBox, IInputOptions } from 'vs/base/browser/ui/inputbox/inputBox';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextViewService, IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ISettingsGroup, IPreferencesService, getSettingsTargetName } from 'vs/workbench/parts/preferences/common/preferences';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IAction, IActionRunner } from 'vs/base/common/actions';
import { attachInputBoxStyler, attachStylerCallback, attachSelectBoxStyler, attachCheckboxStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { Position } from 'vs/editor/common/core/position';
import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { buttonBackground, buttonForeground, badgeForeground, badgeBackground, contrastBorder, errorForeground } from 'vs/platform/theme/common/colorRegistry';
import { IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ISelectBoxStyles, defaultStyles } from 'vs/base/browser/ui/selectBox/selectBox';
import { Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { Color } from 'vs/base/common/color';
import { SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { IMouseEvent } from 'vs/base/browser/mouseEvent';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IMarginData } from 'vs/editor/browser/controller/mouseTarget';
import { render as renderOcticons } from 'vs/base/browser/ui/octiconLabel/octiconLabel';

export class SettingsHeaderWidget extends Widget implements IViewZone {

	private id: number;
	private _domNode: HTMLElement;

	protected titleContainer: HTMLElement;
	private messageElement: HTMLElement;

	constructor(protected editor: ICodeEditor, private title: string) {
		super();
		this.create();
		this._register(this.editor.onDidChangeConfiguration(() => this.layout()));
		this._register(this.editor.onDidLayoutChange(() => this.layout()));
	}

	get domNode(): HTMLElement {
		return this._domNode;
	}

	get heightInLines(): number {
		return 1;
	}

	get afterLineNumber(): number {
		return 0;
	}

	protected create() {
		this._domNode = DOM.$('.settings-header-widget');

		this.titleContainer = DOM.append(this._domNode, DOM.$('.title-container'));
		if (this.title) {
			DOM.append(this.titleContainer, DOM.$('.title')).textContent = this.title;
		}
		this.messageElement = DOM.append(this.titleContainer, DOM.$('.message'));
		if (this.title) {
			this.messageElement.style.paddingLeft = '12px';
		}

		this.editor.changeViewZones(accessor => {
			this.id = accessor.addZone(this);
			this.layout();
		});
	}

	public setMessage(message: string): void {
		this.messageElement.textContent = message;
	}

	private layout(): void {
		const configuration = this.editor.getConfiguration();
		this.titleContainer.style.fontSize = configuration.fontInfo.fontSize + 'px';
		if (!configuration.contribInfo.folding) {
			this.titleContainer.style.paddingLeft = '12px';
		}
	}

	public dispose() {
		this.editor.changeViewZones(accessor => {
			accessor.removeZone(this.id);
		});
		super.dispose();
	}
}

export class DefaultSettingsHeaderWidget extends SettingsHeaderWidget {

	private linkElement: HTMLElement;
	private _onClick = this._register(new Emitter<void>());
	public onClick: Event<void> = this._onClick.event;

	protected create() {
		super.create();

		this.linkElement = DOM.append(this.titleContainer, DOM.$('a.settings-header-fuzzy-link'));
		this.linkElement.textContent = localize('defaultSettingsFuzzyPrompt', "Try fuzzy search!");

		this.onclick(this.linkElement, e => this._onClick.fire());
		this.toggleMessage(true);
	}

	public toggleMessage(hasSettings: boolean, promptFuzzy = false): void {
		if (hasSettings) {
			this.setMessage(localize('defaultSettings', "Place your settings in the right hand side editor to override."));
			DOM.addClass(this.linkElement, 'hidden');
		} else {
			this.setMessage(localize('noSettingsFound', "No Settings Found."));

			if (promptFuzzy) {
				DOM.removeClass(this.linkElement, 'hidden');
			} else {
				DOM.addClass(this.linkElement, 'hidden');
			}
		}
	}
}

export class SettingsGroupTitleWidget extends Widget implements IViewZone {

	private id: number;
	private _afterLineNumber: number;
	private _domNode: HTMLElement;

	private titleContainer: HTMLElement;
	private icon: HTMLElement;
	private title: HTMLElement;

	private _onToggled = this._register(new Emitter<boolean>());
	public onToggled: Event<boolean> = this._onToggled.event;

	private previousPosition: Position;

	constructor(private editor: ICodeEditor, public settingsGroup: ISettingsGroup) {
		super();
		this.create();
		this._register(this.editor.onDidChangeConfiguration(() => this.layout()));
		this._register(this.editor.onDidLayoutChange(() => this.layout()));
		this._register(this.editor.onDidChangeCursorPosition((e) => this.onCursorChange(e)));
	}

	get domNode(): HTMLElement {
		return this._domNode;
	}

	get heightInLines(): number {
		return 1.5;
	}

	get afterLineNumber(): number {
		return this._afterLineNumber;
	}

	private create() {
		this._domNode = DOM.$('.settings-group-title-widget');

		this.titleContainer = DOM.append(this._domNode, DOM.$('.title-container'));
		this.titleContainer.tabIndex = 0;
		this.onclick(this.titleContainer, () => this.toggle());
		this.onkeydown(this.titleContainer, (e) => this.onKeyDown(e));
		const focusTracker = this._register(DOM.trackFocus(this.titleContainer));

		this._register(focusTracker.onDidFocus(() => this.toggleFocus(true)));
		this._register(focusTracker.onDidBlur(() => this.toggleFocus(false)));

		this.icon = DOM.append(this.titleContainer, DOM.$('.expand-collapse-icon'));
		this.title = DOM.append(this.titleContainer, DOM.$('.title'));
		this.title.textContent = this.settingsGroup.title + ` (${this.settingsGroup.sections.reduce((count, section) => count + section.settings.length, 0)})`;

		this.layout();
	}

	public render() {
		this._afterLineNumber = this.settingsGroup.range.startLineNumber - 2;
		this.editor.changeViewZones(accessor => {
			this.id = accessor.addZone(this);
			this.layout();
		});
	}

	public toggleCollapse(collapse: boolean) {
		DOM.toggleClass(this.titleContainer, 'collapsed', collapse);
	}

	public toggleFocus(focus: boolean): void {
		DOM.toggleClass(this.titleContainer, 'focused', focus);
	}

	public isCollapsed(): boolean {
		return DOM.hasClass(this.titleContainer, 'collapsed');
	}

	private layout(): void {
		const configuration = this.editor.getConfiguration();
		const layoutInfo = this.editor.getLayoutInfo();
		this._domNode.style.width = layoutInfo.contentWidth - layoutInfo.verticalScrollbarWidth + 'px';
		this.titleContainer.style.lineHeight = configuration.lineHeight + 3 + 'px';
		this.titleContainer.style.height = configuration.lineHeight + 3 + 'px';
		this.titleContainer.style.fontSize = configuration.fontInfo.fontSize + 'px';
		this.icon.style.minWidth = `${this.getIconSize(16)}px`;
	}

	private getIconSize(minSize: number): number {
		const fontSize = this.editor.getConfiguration().fontInfo.fontSize;
		return fontSize > 8 ? Math.max(fontSize, minSize) : 12;
	}

	private onKeyDown(keyboardEvent: IKeyboardEvent): void {
		switch (keyboardEvent.keyCode) {
			case KeyCode.Enter:
			case KeyCode.Space:
				this.toggle();
				break;
			case KeyCode.LeftArrow:
				this.collapse(true);
				break;
			case KeyCode.RightArrow:
				this.collapse(false);
				break;
			case KeyCode.UpArrow:
				if (this.settingsGroup.range.startLineNumber - 3 !== 1) {
					this.editor.focus();
					const lineNumber = this.settingsGroup.range.startLineNumber - 2;
					this.editor.setPosition({ lineNumber, column: this.editor.getModel().getLineMinColumn(lineNumber) });
				}
				break;
			case KeyCode.DownArrow:
				const lineNumber = this.isCollapsed() ? this.settingsGroup.range.startLineNumber : this.settingsGroup.range.startLineNumber - 1;
				this.editor.focus();
				this.editor.setPosition({ lineNumber, column: this.editor.getModel().getLineMinColumn(lineNumber) });
				break;
		}
	}

	private toggle() {
		this.collapse(!this.isCollapsed());
	}

	private collapse(collapse: boolean) {
		if (collapse !== this.isCollapsed()) {
			DOM.toggleClass(this.titleContainer, 'collapsed', collapse);
			this._onToggled.fire(collapse);
		}
	}

	private onCursorChange(e: ICursorPositionChangedEvent): void {
		if (e.source !== 'mouse' && this.focusTitle(e.position)) {
			this.titleContainer.focus();
		}
	}

	private focusTitle(currentPosition: Position): boolean {
		const previousPosition = this.previousPosition;
		this.previousPosition = currentPosition;
		if (!previousPosition) {
			return false;
		}
		if (previousPosition.lineNumber === currentPosition.lineNumber) {
			return false;
		}
		if (currentPosition.lineNumber === this.settingsGroup.range.startLineNumber - 1 || currentPosition.lineNumber === this.settingsGroup.range.startLineNumber - 2) {
			return true;
		}
		if (this.isCollapsed() && currentPosition.lineNumber === this.settingsGroup.range.endLineNumber) {
			return true;
		}
		return false;
	}

	public dispose() {
		this.editor.changeViewZones(accessor => {
			accessor.removeZone(this.id);
		});
		super.dispose();
	}
}

export class SettingsTargetsWidget extends Widget {

	public actionRunner: IActionRunner;
	private settingsTargetsContainer: HTMLSelectElement;
	private targetLabel: HTMLSelectElement;
	private targetDetails: HTMLSelectElement;

	private _onDidTargetChange: Emitter<URI> = new Emitter<URI>();
	public readonly onDidTargetChange: Event<URI> = this._onDidTargetChange.event;

	private borderColor: Color;

	constructor(parent: HTMLElement, private _uri: URI, private _configuartionTarget: ConfigurationTarget,
		@IWorkspaceContextService private workspaceContextService: IWorkspaceContextService,
		@IPreferencesService private preferencesService: IPreferencesService,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IThemeService themeService: IThemeService) {
		super();

		this.borderColor = defaultStyles.selectBorder;
		this.create(parent);
		this._register(attachSelectBoxStyler(this, themeService, {
			selectBackground: SIDE_BAR_BACKGROUND
		}));
	}

	get configurationTarget(): ConfigurationTarget {
		return this._configuartionTarget;
	}

	public updateTargets(uri: URI, configuartionTarget: ConfigurationTarget): void {
		this._uri = uri;
		this._configuartionTarget = configuartionTarget;
		this.updateLabel();
	}

	private create(parent: HTMLElement): void {
		this.settingsTargetsContainer = DOM.append(parent, DOM.$('.settings-targets-widget'));
		this.settingsTargetsContainer.style.width = this.workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE ? '200px' : '150px';

		const targetElement = DOM.append(this.settingsTargetsContainer, DOM.$('.settings-target'));
		this.targetLabel = DOM.append(targetElement, DOM.$('.settings-target-label'));
		this.targetDetails = DOM.append(targetElement, DOM.$('.settings-target-details'));
		this.updateLabel();

		this.onclick(this.settingsTargetsContainer, e => this.showContextMenu(e));

		DOM.append(this.settingsTargetsContainer, DOM.$('.settings-target-dropdown-icon.octicon.octicon-triangle-down'));

		this.applyStyles();
	}

	private updateLabel(): void {
		this.targetLabel.textContent = getSettingsTargetName(this._configuartionTarget, this._uri, this.workspaceContextService);
		const details = ConfigurationTarget.WORKSPACE_FOLDER === this._configuartionTarget ? localize('folderSettingsDetails', "Folder Settings") : '';
		this.targetDetails.textContent = details;
		DOM.toggleClass(this.targetDetails, 'empty', !details);
	}

	private showContextMenu(event: IMouseEvent): void {
		const actions = this.getSettingsTargetsActions();
		let elementPosition = DOM.getDomNodePagePosition(this.settingsTargetsContainer);
		const anchor = { x: elementPosition.left, y: elementPosition.top + elementPosition.height + 5 };
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => TPromise.wrap(actions)
		});
		event.stopPropagation();
		event.preventDefault();
	}

	private getSettingsTargetsActions(): IAction[] {
		const actions: IAction[] = [];
		const userSettingsResource = this.preferencesService.userSettingsResource;
		actions.push(<IAction>{
			id: 'userSettingsTarget',
			label: getSettingsTargetName(ConfigurationTarget.USER, userSettingsResource, this.workspaceContextService),
			checked: this._uri.toString() === userSettingsResource.toString(),
			enabled: true,
			run: () => this.onTargetClicked(userSettingsResource)
		});

		if (this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY) {
			const workspaceSettingsResource = this.preferencesService.workspaceSettingsResource;
			actions.push(<IAction>{
				id: 'workspaceSettingsTarget',
				label: getSettingsTargetName(ConfigurationTarget.WORKSPACE, workspaceSettingsResource, this.workspaceContextService),
				checked: this._uri.toString() === workspaceSettingsResource.toString(),
				enabled: true,
				run: () => this.onTargetClicked(workspaceSettingsResource)
			});
		}

		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE && workspaceFolders.length > 0) {
			actions.push(new Separator());
			actions.push(...workspaceFolders.map((folder, index) => {
				return <IAction>{
					id: 'folderSettingsTarget' + index,
					label: getSettingsTargetName(ConfigurationTarget.WORKSPACE_FOLDER, folder.uri, this.workspaceContextService),
					checked: this._uri.toString() === folder.uri.toString(),
					enabled: true,
					run: () => this.onTargetClicked(folder.uri)
				};
			}));
		}

		return actions;
	}

	private onTargetClicked(target: URI): void {
		if (this._uri.toString() === target.toString()) {
			return;
		}
		this._onDidTargetChange.fire(target);
	}

	style(styles: ISelectBoxStyles): void {
		this.borderColor = styles.selectBorder;
		this.applyStyles();
	}

	private applyStyles(): void {
		if (this.settingsTargetsContainer) {
			this.settingsTargetsContainer.style.border = this.borderColor ? `1px solid ${this.borderColor}` : null;
		}
	}
}

export interface SearchOptions extends IInputOptions {
	focusKey?: IContextKey<boolean>;
	showFuzzyToggle?: boolean;
	showResultCount?: boolean;
}

export class SearchWidget extends Widget {

	public domNode: HTMLElement;

	private countElement: HTMLElement;
	private searchContainer: HTMLElement;
	private inputBox: InputBox;
	private fuzzyToggle: Checkbox;
	private controlsDiv: HTMLElement;

	private _onDidChange: Emitter<string> = this._register(new Emitter<string>());
	public readonly onDidChange: Event<string> = this._onDidChange.event;

	private _onFocus: Emitter<void> = this._register(new Emitter<void>());
	public readonly onFocus: Event<void> = this._onFocus.event;

	constructor(parent: HTMLElement, protected options: SearchOptions,
		@IContextViewService private contextViewService: IContextViewService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IThemeService private themeService: IThemeService
	) {
		super();
		this.create(parent);
	}

	public get fuzzyEnabled(): boolean {
		return this.fuzzyToggle.checked && this.fuzzyToggle.enabled;
	}

	public set fuzzyEnabled(value: boolean) {
		this.fuzzyToggle.checked = value;
	}

	private create(parent: HTMLElement) {
		this.domNode = DOM.append(parent, DOM.$('div.settings-header-widget'));
		this.createSearchContainer(DOM.append(this.domNode, DOM.$('div.settings-search-container')));
		this.controlsDiv = DOM.append(this.domNode, DOM.$('div.settings-search-controls'));
		if (this.options.showFuzzyToggle) {
			this.fuzzyToggle = this._register(new Checkbox({
				actionClassName: 'prefs-fuzzy-search-toggle',
				isChecked: false,
				onChange: () => {
					this.inputBox.focus();
					this._onDidChange.fire();
				},
				title: localize('enableFuzzySearch', 'Enable experimental fuzzy search')
			}));
			this.fuzzyToggle.domNode.innerHTML = renderOcticons('$(light-bulb)');
			DOM.append(this.controlsDiv, this.fuzzyToggle.domNode);
			this._register(attachCheckboxStyler(this.fuzzyToggle, this.themeService));
		}

		if (this.options.showResultCount) {
			this.countElement = DOM.append(this.controlsDiv, DOM.$('.settings-count-widget'));
			this._register(attachStylerCallback(this.themeService, { badgeBackground, contrastBorder }, colors => {
				const background = colors.badgeBackground ? colors.badgeBackground.toString() : null;
				const border = colors.contrastBorder ? colors.contrastBorder.toString() : null;

				this.countElement.style.backgroundColor = background;

				this.countElement.style.borderWidth = border ? '1px' : null;
				this.countElement.style.borderStyle = border ? 'solid' : null;
				this.countElement.style.borderColor = border;

				this.styleCountElementForeground();
			}));
		}

		this.inputBox.inputElement.setAttribute('aria-live', 'assertive');
		const focusTracker = this._register(DOM.trackFocus(this.inputBox.inputElement));
		this._register(focusTracker.onDidFocus(() => this._onFocus.fire()));

		if (this.options.focusKey) {
			this._register(focusTracker.onDidFocus(() => this.options.focusKey.set(true)));
			this._register(focusTracker.onDidBlur(() => this.options.focusKey.set(false)));
		}
	}

	private createSearchContainer(searchContainer: HTMLElement) {
		this.searchContainer = searchContainer;
		const searchInput = DOM.append(this.searchContainer, DOM.$('div.settings-search-input'));
		this.inputBox = this._register(this.createInputBox(searchInput));
		this._register(this.inputBox.onDidChange(value => this._onDidChange.fire(value)));
	}

	protected createInputBox(parent: HTMLElement): InputBox {
		const box = this._register(new InputBox(parent, this.contextViewService, this.options));
		this._register(attachInputBoxStyler(box, this.themeService));

		return box;
	}

	public showMessage(message: string, count: number): void {
		if (this.countElement) {
			this.countElement.textContent = message;
			this.inputBox.inputElement.setAttribute('aria-label', message);
			DOM.toggleClass(this.countElement, 'no-results', count === 0);
			this.inputBox.inputElement.style.paddingRight = this.getControlsWidth() + 'px';
			this.styleCountElementForeground();
		}
	}

	public setFuzzyToggleVisible(visible: boolean): void {
		if (visible) {
			this.fuzzyToggle.domNode.classList.remove('hidden');
			this.fuzzyToggle.enable();
		} else {
			this.fuzzyToggle.domNode.classList.add('hidden');
			this.fuzzyToggle.disable();
		}
	}

	private styleCountElementForeground() {
		const colorId = DOM.hasClass(this.countElement, 'no-results') ? errorForeground : badgeForeground;
		const color = this.themeService.getTheme().getColor(colorId);
		this.countElement.style.color = color ? color.toString() : null;
	}

	public layout(dimension: Dimension) {
		if (dimension.width < 400) {
			if (this.countElement) {
				DOM.addClass(this.countElement, 'hide');
			}

			this.inputBox.inputElement.style.paddingRight = '0px';
		} else {
			if (this.countElement) {
				DOM.removeClass(this.countElement, 'hide');
			}

			this.inputBox.inputElement.style.paddingRight = this.getControlsWidth() + 'px';
		}
	}

	private getControlsWidth(): number {
		const countWidth = this.countElement ? DOM.getTotalWidth(this.countElement) : 0;
		const fuzzyToggleWidth = this.fuzzyToggle ? DOM.getTotalWidth(this.fuzzyToggle.domNode) : 0;
		return countWidth + fuzzyToggleWidth + 20;
	}

	public focus() {
		this.inputBox.focus();
		if (this.getValue()) {
			this.inputBox.select();
		}
	}

	public hasFocus(): boolean {
		return this.inputBox.hasFocus();
	}

	public clear() {
		this.inputBox.value = '';
	}

	public getValue(): string {
		return this.inputBox.value;
	}

	public setValue(value: string): string {
		return this.inputBox.value = value;
	}

	public dispose(): void {
		if (this.options.focusKey) {
			this.options.focusKey.set(false);
		}
		super.dispose();
	}
}

export class FloatingClickWidget extends Widget implements IOverlayWidget {

	private _domNode: HTMLElement;

	private _onClick: Emitter<void> = this._register(new Emitter<void>());
	public onClick: Event<void> = this._onClick.event;

	constructor(
		private editor: ICodeEditor,
		private label: string,
		keyBindingAction: string,
		@IKeybindingService keybindingService: IKeybindingService,
		@IThemeService private themeService: IThemeService
	) {
		super();

		if (keyBindingAction) {
			let keybinding = keybindingService.lookupKeybinding(keyBindingAction);
			if (keybinding) {
				this.label += ' (' + keybinding.getLabel() + ')';
			}
		}
	}

	public render() {
		this._domNode = DOM.$('.floating-click-widget');
		this._register(attachStylerCallback(this.themeService, { buttonBackground, buttonForeground }, colors => {
			this._domNode.style.backgroundColor = colors.buttonBackground;
			this._domNode.style.color = colors.buttonForeground;
		}));

		DOM.append(this._domNode, DOM.$('')).textContent = this.label;
		this.onclick(this._domNode, e => this._onClick.fire());
		this.editor.addOverlayWidget(this);
	}

	public dispose(): void {
		this.editor.removeOverlayWidget(this);
		super.dispose();
	}

	public getId(): string {
		return 'editor.overlayWidget.floatingClickWidget';
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getPosition(): IOverlayWidgetPosition {
		return {
			preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER
		};
	}
}

export class EditPreferenceWidget<T> extends Disposable {

	public static GLYPH_MARGIN_CLASS_NAME = 'edit-preferences-widget';

	private _line: number;
	private _preferences: T[];

	private _editPreferenceDecoration: string[];

	private _onClick: Emitter<IEditorMouseEvent> = new Emitter<IEditorMouseEvent>();
	public get onClick(): Event<IEditorMouseEvent> { return this._onClick.event; }

	constructor(private editor: ICodeEditor
	) {
		super();
		this._editPreferenceDecoration = [];
		this._register(this.editor.onMouseDown((e: IEditorMouseEvent) => {
			const data = e.target.detail as IMarginData;
			if (e.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN || data.isAfterLines || !this.isVisible()) {
				return;
			}
			this._onClick.fire(e);
		}));
	}

	get preferences(): T[] {
		return this._preferences;
	}

	getLine(): number {
		return this._line;
	}

	show(line: number, hoverMessage: string, preferences: T[]): void {
		this._preferences = preferences;
		const newDecoration: editorCommon.IModelDeltaDecoration[] = [];
		this._line = line;
		newDecoration.push({
			options: {
				glyphMarginClassName: EditPreferenceWidget.GLYPH_MARGIN_CLASS_NAME,
				glyphMarginHoverMessage: new MarkdownString().appendText(hoverMessage),
				stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
			},
			range: {
				startLineNumber: line,
				startColumn: 1,
				endLineNumber: line,
				endColumn: 1
			}
		});
		this._editPreferenceDecoration = this.editor.deltaDecorations(this._editPreferenceDecoration, newDecoration);
	}

	hide(): void {
		this._editPreferenceDecoration = this.editor.deltaDecorations(this._editPreferenceDecoration, []);
	}

	isVisible(): boolean {
		return this._editPreferenceDecoration.length > 0;
	}

	dispose(): void {
		this.hide();
		super.dispose();
	}
}
