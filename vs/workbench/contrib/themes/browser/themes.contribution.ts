/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchActionRegistry, Extensions, CATEGORIES } from 'vs/workbench/common/actions';
import { IWorkbenchThemeService, IWorkbenchTheme, ThemeSettingTarget, IWorkbenchColorTheme } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { VIEWLET_ID, IExtensionsViewPaneContainer } from 'vs/workbench/contrib/extensions/common/extensions';
import { IExtensionGalleryService, IExtensionManagementService, IGalleryExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IColorRegistry, Extensions as ColorRegistryExtensions } from 'vs/platform/theme/common/colorRegistry';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Color } from 'vs/base/common/color';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { colorThemeSchemaId } from 'vs/workbench/services/themes/common/colorThemeSchema';
import { isPromiseCanceledError, onUnexpectedError } from 'vs/base/common/errors';
import { IQuickInputButton, IQuickInputService, IQuickPickItem, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { DEFAULT_PRODUCT_ICON_THEME_ID } from 'vs/workbench/services/themes/browser/productIconThemeData';
import { IPaneCompositePartService } from 'vs/workbench/services/panecomposite/browser/panecomposite';
import { ViewContainerLocation } from 'vs/workbench/common/views';
import { ThrottledDelayer } from 'vs/base/common/async';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { ILogService } from 'vs/platform/log/common/log';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';

export const manageExtensionIcon = registerIcon('theme-selection-manage-extension', Codicon.gear, localize('manageExtensionIcon', 'Icon for the \'Manage\' action in the theme selection quick pick.'));

export class SelectColorThemeAction extends Action {

	static readonly ID = 'workbench.action.selectTheme';
	static readonly LABEL = localize('selectTheme.label', "Color Theme");

	static readonly INSTALL_ADDITIONAL = localize('installColorThemes', "Install Additional Color Themes...");


	constructor(
		id: string,
		label: string,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IPaneCompositePartService private readonly paneCompositeService: IPaneCompositePartService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@ILogService private readonly logService: ILogService,
		@IProgressService private progressService: IProgressService
	) {
		super(id, label);
	}

	override run(): Promise<void> {
		return this.themeService.getColorThemes().then(themes => {
			const currentTheme = this.themeService.getColorTheme();

			const picks: QuickPickInput<ThemeItem>[] = [
				...toEntries(themes.filter(t => t.type === ColorScheme.LIGHT), localize('themes.category.light', "light themes")),
				...toEntries(themes.filter(t => t.type === ColorScheme.DARK), localize('themes.category.dark', "dark themes")),
				...toEntries(themes.filter(t => t.type === ColorScheme.HIGH_CONTRAST), localize('themes.category.hc', "high contrast themes")),
				...configurationEntries(SelectColorThemeAction.INSTALL_ADDITIONAL)
			];

			let selectThemeTimeout: number | undefined;

			const selectTheme = (theme: IWorkbenchTheme | undefined, applyTheme: boolean) => {
				if (selectThemeTimeout) {
					clearTimeout(selectThemeTimeout);
				}
				selectThemeTimeout = window.setTimeout(() => {
					selectThemeTimeout = undefined;
					const newTheme = (theme ?? currentTheme) as IWorkbenchColorTheme;
					this.themeService.setColorTheme(newTheme, applyTheme ? 'auto' : 'preview').then(undefined,
						err => {
							onUnexpectedError(err);
							this.themeService.setColorTheme(currentTheme.id, undefined);
						}
					);
				}, applyTheme ? 0 : 200);
			};

			return new Promise((s, _) => {
				let isCompleted = false;

				const autoFocusIndex = picks.findIndex(p => isItem(p) && p.id === currentTheme.id);
				const quickpick = this.quickInputService.createQuickPick<ThemeItem>();
				quickpick.items = picks;
				quickpick.sortByLabel = false;
				quickpick.matchOnDescription = true;
				quickpick.placeholder = localize('themes.selectTheme', "Select Color Theme (Up/Down Keys to Preview)");
				quickpick.activeItems = [picks[autoFocusIndex] as ThemeItem];
				quickpick.canSelectMany = false;
				quickpick.onDidAccept(async _ => {
					const themeItem = quickpick.activeItems[0];
					if (!themeItem || themeItem.theme === undefined) { // 'pick in marketplace' entry
						openExtensionViewlet(this.paneCompositeService, `category:themes ${quickpick.value}`);
					} else {
						let themeToSet = themeItem.theme;
						if (themeItem.galleryExtension) {
							const success = await this.installExtension(themeItem.galleryExtension);
							if (!success) {
								themeToSet = currentTheme;
							}
						}
						selectTheme(themeToSet, true);
					}
					isCompleted = true;
					quickpick.hide();
					s();
				});
				quickpick.onDidTriggerItemButton(e => {
					if (isItem(e.item)) {
						const extensionId = e.item.theme?.extensionData?.extensionId;
						if (extensionId) {
							openExtensionViewlet(this.paneCompositeService, `@id:${extensionId}`);
						} else {
							openExtensionViewlet(this.paneCompositeService, `category:themes ${quickpick.value}`);
						}
					}
				});

				quickpick.onDidChangeActive(themes => selectTheme(themes[0]?.theme, false));
				quickpick.onDidHide(() => {
					if (!isCompleted) {
						selectTheme(currentTheme, true);
						s();
						isCompleted = true;
					}
				});
				quickpick.show();

				if (this.extensionGalleryService.isEnabled()) {
					const mpQueryDelayer = new ThrottledDelayer<void>(200);
					let tokenSource: CancellationTokenSource | undefined;

					const marketplaceThemes = new MarketplaceThemes(this.extensionGalleryService, this.extensionManagementService, this.themeService, this.logService);

					const updateItems = (searchingOngoing: boolean) => {
						const items = picks.concat(...marketplaceThemes.themes);
						if (searchingOngoing) {
							items.push({ label: '$(sync~spin) Searching for themes...', id: undefined, alwaysShow: true });
						}
						const activeItemId = quickpick.activeItems[0]?.id;
						const newActiveItem = activeItemId ? items.find(i => isItem(i) && i.id === activeItemId) : undefined;

						quickpick.items = items;
						if (newActiveItem) {
							quickpick.activeItems = [newActiveItem as ThemeItem];
						}
					};

					const searchMarketPlace = () => {
						if (tokenSource) {
							tokenSource.cancel();
							tokenSource = undefined;
						}
						mpQueryDelayer.trigger(async () => {
							if (!isCompleted) {
								updateItems(true); // add the spinning icon
								tokenSource = new CancellationTokenSource();
								await marketplaceThemes.triggerSearch(quickpick.value, tokenSource.token, () => updateItems(true));
								updateItems(false);
							}
						});
					};
					quickpick.onDidChangeValue(() => searchMarketPlace());
					searchMarketPlace();
				}
			});
		});
	}

	private async installExtension(galleryExtension: IGalleryExtension) {
		try {
			openExtensionViewlet(this.paneCompositeService, `@id:${galleryExtension.identifier.id}`);
			await this.progressService.withProgress({
				location: ProgressLocation.Notification,
				title: localize('installing extensions', "Installing Extension {0}...", galleryExtension.displayName)
			}, () => {
				return this.extensionManagementService.installFromGallery(galleryExtension);
			});
			return true;
		} catch (e) {
			this.logService.error(`Problem installing extension ${galleryExtension.identifier.id}`, e);
			return false;
		}
	}

}

class MarketplaceThemes {
	private installedExtensions: Set<string> | undefined;

	constructor(
		private extensionGalleryService: IExtensionGalleryService,
		private extensionManagementService: IExtensionManagementService,
		private themeService: IWorkbenchThemeService,
		private logService: ILogService
	) {

	}

	private async getInstalledExtesionIds() {
		if (!this.installedExtensions) {
			this.installedExtensions = new Set();
			const installed = await this.extensionManagementService.getInstalled();
			for (const ext of installed) {
				this.installedExtensions.add(ext.identifier.id);
			}
		}
		return this.installedExtensions;
	}

	private marketplaceExtensions: Set<string> = new Set();
	private marketplaceThemes: ThemeItem[] = [];

	public get themes(): ThemeItem[] {
		return this.marketplaceThemes;
	}

	public async triggerSearch(value: string, token: CancellationToken, themesUpdated: () => void): Promise<void> {
		try {
			const installedExtensions = await this.getInstalledExtesionIds();

			const options = { text: `category:themes ${value}`, pageSize: 10 };

			const pager = await this.extensionGalleryService.query(options, token);
			for (let i = 0; i < pager.total && i < 2; i++) {
				if (token.isCancellationRequested) {
					break;
				}

				const gallery = await pager.getPage(i, token);
				for (let i = 0; i < gallery.length; i++) {
					if (token.isCancellationRequested) {
						break;
					}
					const ext = gallery[i];
					if (!installedExtensions.has(ext.identifier.id) && !this.marketplaceExtensions.has(ext.identifier.id)) {
						this.marketplaceExtensions.add(ext.identifier.id);
						const themes = await this.themeService.getMarketplaceColorThemes(ext.identifier.id, ext.version);
						for (const theme of themes) {
							this.marketplaceThemes.push({ id: theme.id, theme: theme, label: theme.label, description: `${ext.displayName} · ${ext.publisherDisplayName}`, galleryExtension: ext, buttons: [configureButton] });
						}
					}
				}
				this.marketplaceThemes.sort((t1, t2) => t1.label.localeCompare(t2.label));
				themesUpdated();
			}
		} catch (e) {
			if (!isPromiseCanceledError(e)) {
				this.logService.error(`Error while searching for themes:`, e);
			}
		}
	}
}

abstract class AbstractIconThemeAction extends Action {
	constructor(
		id: string,
		label: string,
		private readonly quickInputService: IQuickInputService,
		private readonly extensionGalleryService: IExtensionGalleryService,
		private readonly paneCompositeService: IPaneCompositePartService

	) {
		super(id, label);
	}

	protected abstract get builtInEntry(): QuickPickInput<ThemeItem>;
	protected abstract get installMessage(): string;
	protected abstract get placeholderMessage(): string;
	protected abstract get marketplaceTag(): string;

	protected abstract setTheme(id: string, settingsTarget: ThemeSettingTarget): Promise<any>;

	protected pick(themes: IWorkbenchTheme[], currentTheme: IWorkbenchTheme) {
		let picks: QuickPickInput<ThemeItem>[] = [this.builtInEntry, ...toEntries(themes), ...configurationEntries(this.installMessage)];

		let selectThemeTimeout: number | undefined;

		const selectTheme = (theme: ThemeItem, applyTheme: boolean) => {
			if (selectThemeTimeout) {
				clearTimeout(selectThemeTimeout);
			}
			selectThemeTimeout = window.setTimeout(() => {
				selectThemeTimeout = undefined;
				const themeId = theme && theme.id !== undefined ? theme.id : currentTheme.id;
				this.setTheme(themeId, applyTheme ? 'auto' : 'preview').then(undefined,
					err => {
						onUnexpectedError(err);
						this.setTheme(currentTheme.id, undefined);
					}
				);
			}, applyTheme ? 0 : 200);
		};

		return new Promise<void>((s, _) => {
			let isCompleted = false;

			const autoFocusIndex = picks.findIndex(p => isItem(p) && p.id === currentTheme.id);
			const quickpick = this.quickInputService.createQuickPick<ThemeItem>();
			quickpick.items = this.extensionGalleryService.isEnabled() ? picks.concat(configurationEntries(this.installMessage)) : picks;
			quickpick.placeholder = this.placeholderMessage;
			quickpick.activeItems = [picks[autoFocusIndex] as ThemeItem];
			quickpick.canSelectMany = false;
			quickpick.onDidAccept(_ => {
				const theme = quickpick.activeItems[0];
				if (!theme || typeof theme.id === 'undefined') { // 'pick in marketplace' entry
					openExtensionViewlet(this.paneCompositeService, `${this.marketplaceTag} ${quickpick.value}`);
				} else {
					selectTheme(theme, true);
				}
				isCompleted = true;
				quickpick.hide();
				s();
			});
			quickpick.onDidChangeActive(themes => selectTheme(themes[0], false));
			quickpick.onDidHide(() => {
				if (!isCompleted) {
					selectTheme(currentTheme, true);
					s();
				}
			});
			quickpick.show();
		});
	}
}

class SelectFileIconThemeAction extends AbstractIconThemeAction {

	static readonly ID = 'workbench.action.selectIconTheme';
	static readonly LABEL = localize('selectIconTheme.label', "File Icon Theme");

	constructor(
		id: string,
		label: string,
		@IQuickInputService quickInputService: IQuickInputService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IExtensionGalleryService extensionGalleryService: IExtensionGalleryService,
		@IPaneCompositePartService paneCompositeService: IPaneCompositePartService

	) {
		super(id, label, quickInputService, extensionGalleryService, paneCompositeService);
	}

	protected builtInEntry: QuickPickInput<ThemeItem> = { id: '', label: localize('noIconThemeLabel', 'None'), description: localize('noIconThemeDesc', 'Disable File Icons') };
	protected installMessage = localize('installIconThemes', "Install Additional File Icon Themes...");
	protected placeholderMessage = localize('themes.selectIconTheme', "Select File Icon Theme");
	protected marketplaceTag = 'tag:icon-theme';
	protected setTheme(id: string, settingsTarget: ThemeSettingTarget) {
		return this.themeService.setFileIconTheme(id, settingsTarget);
	}

	override async run(): Promise<void> {
		this.pick(await this.themeService.getFileIconThemes(), this.themeService.getFileIconTheme());
	}
}


class SelectProductIconThemeAction extends AbstractIconThemeAction {

	static readonly ID = 'workbench.action.selectProductIconTheme';
	static readonly LABEL = localize('selectProductIconTheme.label', "Product Icon Theme");

	constructor(
		id: string,
		label: string,
		@IQuickInputService quickInputService: IQuickInputService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IExtensionGalleryService extensionGalleryService: IExtensionGalleryService,
		@IPaneCompositePartService paneCompositeService: IPaneCompositePartService

	) {
		super(id, label, quickInputService, extensionGalleryService, paneCompositeService);
	}

	protected builtInEntry: QuickPickInput<ThemeItem> = { id: DEFAULT_PRODUCT_ICON_THEME_ID, label: localize('defaultProductIconThemeLabel', 'Default') };
	protected installMessage = localize('installProductIconThemes', "Install Additional Product Icon Themes...");
	protected placeholderMessage = localize('themes.selectProductIconTheme', "Select Product Icon Theme");
	protected marketplaceTag = 'tag:product-icon-theme';
	protected setTheme(id: string, settingsTarget: ThemeSettingTarget) {
		return this.themeService.setProductIconTheme(id, settingsTarget);
	}

	override async run(): Promise<void> {
		this.pick(await this.themeService.getProductIconThemes(), this.themeService.getProductIconTheme());
	}
}

function configurationEntries(label: string): QuickPickInput<ThemeItem>[] {
	return [
		{
			type: 'separator',
			label: 'marketplace themes'
		},
		{
			id: undefined,
			label: label,
			alwaysShow: true,
			buttons: [configureButton]
		}
	];

}

function openExtensionViewlet(paneCompositeService: IPaneCompositePartService, query: string) {
	return paneCompositeService.openPaneComposite(VIEWLET_ID, ViewContainerLocation.Sidebar, true).then(viewlet => {
		if (viewlet) {
			(viewlet?.getViewPaneContainer() as IExtensionsViewPaneContainer).search(query);
			viewlet.focus();
		}
	});
}
interface ThemeItem extends IQuickPickItem {
	id: string | undefined;
	theme?: IWorkbenchTheme;
	galleryExtension?: IGalleryExtension;
	label: string;
	description?: string;
	alwaysShow?: boolean;
}

function isItem(i: QuickPickInput<ThemeItem>): i is ThemeItem {
	return (<any>i)['type'] !== 'separator';
}

function toEntry(theme: IWorkbenchTheme): ThemeItem {
	const item: ThemeItem = { id: theme.id, theme: theme, label: theme.label, description: theme.description };
	if (theme.extensionData) {
		item.buttons = [configureButton];
	}
	return item;
}

function toEntries(themes: Array<IWorkbenchTheme>, label?: string): QuickPickInput<ThemeItem>[] {
	const sorter = (t1: ThemeItem, t2: ThemeItem) => t1.label.localeCompare(t2.label);
	let entries: QuickPickInput<ThemeItem>[] = themes.map(toEntry).sort(sorter);
	if (entries.length > 0 && label) {
		entries.unshift({ type: 'separator', label });
	}
	return entries;
}

const configureButton: IQuickInputButton = {
	iconClass: ThemeIcon.asClassName(manageExtensionIcon),
	tooltip: localize('manage extension', "Manage Extension"),
};
class GenerateColorThemeAction extends Action {

	static readonly ID = 'workbench.action.generateColorTheme';
	static readonly LABEL = localize('generateColorTheme.label', "Generate Color Theme From Current Settings");

	constructor(
		id: string,
		label: string,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	override run(): Promise<any> {
		let theme = this.themeService.getColorTheme();
		let colors = Registry.as<IColorRegistry>(ColorRegistryExtensions.ColorContribution).getColors();
		let colorIds = colors.map(c => c.id).sort();
		let resultingColors: { [key: string]: string | null } = {};
		let inherited: string[] = [];
		for (let colorId of colorIds) {
			const color = theme.getColor(colorId, false);
			if (color) {
				resultingColors[colorId] = Color.Format.CSS.formatHexA(color, true);
			} else {
				inherited.push(colorId);
			}
		}
		const nullDefaults = [];
		for (let id of inherited) {
			const color = theme.getColor(id);
			if (color) {
				resultingColors['__' + id] = Color.Format.CSS.formatHexA(color, true);
			} else {
				nullDefaults.push(id);
			}
		}
		for (let id of nullDefaults) {
			resultingColors['__' + id] = null;
		}
		let contents = JSON.stringify({
			'$schema': colorThemeSchemaId,
			type: theme.type,
			colors: resultingColors,
			tokenColors: theme.tokenColors.filter(t => !!t.scope)
		}, null, '\t');
		contents = contents.replace(/\"__/g, '//"');

		return this.editorService.openEditor({ resource: undefined, contents, mode: 'jsonc', options: { pinned: true } });
	}
}

const category = localize('preferences', "Preferences");

const colorThemeDescriptor = SyncActionDescriptor.from(SelectColorThemeAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyT) });
Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions).registerWorkbenchAction(colorThemeDescriptor, 'Preferences: Color Theme', category);

const fileIconThemeDescriptor = SyncActionDescriptor.from(SelectFileIconThemeAction);
Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions).registerWorkbenchAction(fileIconThemeDescriptor, 'Preferences: File Icon Theme', category);

const productIconThemeDescriptor = SyncActionDescriptor.from(SelectProductIconThemeAction);
Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions).registerWorkbenchAction(productIconThemeDescriptor, 'Preferences: Product Icon Theme', category);


const generateColorThemeDescriptor = SyncActionDescriptor.from(GenerateColorThemeAction);
Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions).registerWorkbenchAction(generateColorThemeDescriptor, 'Developer: Generate Color Theme From Current Settings', CATEGORIES.Developer.value);

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	group: '4_themes',
	command: {
		id: SelectColorThemeAction.ID,
		title: localize({ key: 'miSelectColorTheme', comment: ['&& denotes a mnemonic'] }, "&&Color Theme")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	group: '4_themes',
	command: {
		id: SelectFileIconThemeAction.ID,
		title: localize({ key: 'miSelectIconTheme', comment: ['&& denotes a mnemonic'] }, "File &&Icon Theme")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	group: '4_themes',
	command: {
		id: SelectProductIconThemeAction.ID,
		title: localize({ key: 'miSelectProductIconTheme', comment: ['&& denotes a mnemonic'] }, "&&Product Icon Theme")
	},
	order: 3
});


MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '4_themes',
	command: {
		id: SelectColorThemeAction.ID,
		title: localize('selectTheme.label', "Color Theme")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '4_themes',
	command: {
		id: SelectFileIconThemeAction.ID,
		title: localize('themes.selectIconTheme.label', "File Icon Theme")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '4_themes',
	command: {
		id: SelectProductIconThemeAction.ID,
		title: localize('themes.selectProductIconTheme.label', "Product Icon Theme")
	},
	order: 3
});
