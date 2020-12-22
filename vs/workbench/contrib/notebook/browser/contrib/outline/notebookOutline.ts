/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./notebookOutline';
import * as dom from 'vs/base/browser/dom';
import { Codicon } from 'vs/base/common/codicons';
import { Emitter, Event } from 'vs/base/common/event';
import { combinedDisposable, IDisposable, Disposable, DisposableStore, MutableDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IOutline, IOutlineBreadcrumbsConfig, IOutlineCreator, IOutlineQuickPickConfig, IOutlineService, IOutlineTreeConfig, IQuickPickDataSource } from 'vs/workbench/services/outline/browser/outline';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IEditorPane } from 'vs/workbench/common/editor';
import { IKeyboardNavigationLabelProvider, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IDataSource, ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { createMatches, FuzzyScore } from 'vs/base/common/filters';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { Iterable } from 'vs/base/common/iterator';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { getIconClassesForModeId } from 'vs/editor/common/services/getIconClasses';
import { SymbolKind } from 'vs/editor/common/modes';
import { IWorkbenchDataTreeOptions } from 'vs/platform/list/browser/listService';

export class OutlineEntry {
	constructor(
		readonly cell: ICellViewModel,
		readonly label: string,
		readonly icon: ThemeIcon
	) { }
}

class NotebookOutlineTemplate {

	static readonly templateId = 'NotebookOutlineRenderer';

	constructor(
		readonly iconLabel: IconLabel,
		readonly iconClass: HTMLElement,
	) { }
}

class NotebookOutlineRenderer implements ITreeRenderer<OutlineEntry, FuzzyScore, NotebookOutlineTemplate> {

	templateId: string = NotebookOutlineTemplate.templateId;

	constructor(@IThemeService private readonly _themeService: IThemeService) { }

	renderTemplate(container: HTMLElement): NotebookOutlineTemplate {
		container.classList.add('notebook-outline-element', 'show-file-icons');
		const iconClass = dom.$('.element-icon');
		container.append(iconClass);
		const iconLabel = new IconLabel(container, { supportHighlights: true });
		return new NotebookOutlineTemplate(iconLabel, iconClass);
	}

	renderElement(element: ITreeNode<OutlineEntry, FuzzyScore>, _index: number, templateData: NotebookOutlineTemplate, _height: number | undefined): void {
		templateData.iconLabel.setLabel(element.element.label, undefined, { matches: createMatches(element.filterData) });
		if (this._themeService.getFileIconTheme().hasFileIcons) {
			templateData.iconClass.classList.add(...getIconClassesForModeId(element.element.cell.language));
		} else {
			templateData.iconClass.classList.add(...ThemeIcon.asClassNameArray(element.element.icon));
		}

	}

	disposeTemplate(templateData: NotebookOutlineTemplate): void {
		templateData.iconLabel.dispose();
	}
}

class NotebookOutlineAccessibility implements IListAccessibilityProvider<OutlineEntry> {
	getAriaLabel(element: OutlineEntry): string | null {
		return element.label;
	}
	getWidgetAriaLabel(): string {
		return '';
	}
}

class NotebookNavigationLabelProvider implements IKeyboardNavigationLabelProvider<OutlineEntry> {
	getKeyboardNavigationLabel(element: OutlineEntry): { toString(): string | undefined; } | { toString(): string | undefined; }[] | undefined {
		return element.label;
	}
}

class NotebookOutlineVirtualDelegate implements IListVirtualDelegate<OutlineEntry> {

	getHeight(_element: OutlineEntry): number {
		return 22;
	}

	getTemplateId(_element: OutlineEntry): string {
		return NotebookOutlineTemplate.templateId;
	}
}

class NotebookQuickPickProvider implements IQuickPickDataSource<OutlineEntry> {

	constructor(
		private _getEntries: () => OutlineEntry[],
		@IThemeService private readonly _themeService: IThemeService
	) { }

	getQuickPickElements(): Iterable<{ element: OutlineEntry; kind?: SymbolKind | undefined; label: string; iconClasses?: string[] | undefined; ariaLabel?: string | undefined; description?: string | undefined; }> {
		return this._getEntries().map(entry => {
			return {
				element: entry,
				iconClasses: this._themeService.getFileIconTheme().hasFileIcons ? getIconClassesForModeId(entry.cell.language) : ThemeIcon.asClassNameArray(entry.icon),
				label: entry.label,
				ariaLabel: entry.label
			};
		});
	}
}

class NotebookCellOutline implements IOutline<OutlineEntry> {

	private readonly _dispoables = new DisposableStore();

	private readonly _onDidChangeActive = new Emitter<void>();
	private readonly _onDidChange = new Emitter<this>();

	readonly onDidChangeActive: Event<void> = this._onDidChangeActive.event;
	readonly onDidChange: Event<this> = this._onDidChange.event;

	private _entries: OutlineEntry[] = [];
	private _activeEntry: number = -1;
	private readonly _entriesDisposables = new DisposableStore();

	readonly breadcrumbsConfig: IOutlineBreadcrumbsConfig<OutlineEntry>;
	readonly treeConfig: IOutlineTreeConfig<OutlineEntry>;
	readonly quickPickConfig: IOutlineQuickPickConfig<OutlineEntry>;

	constructor(
		private readonly _editor: NotebookEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorService private readonly _editorService: IEditorService,
	) {
		const selectionListener = new MutableDisposable();
		this._dispoables.add(selectionListener);
		const installSelectionListener = () => {
			if (!_editor.viewModel) {
				selectionListener.clear();
			} else {
				selectionListener.value = combinedDisposable(
					_editor.viewModel.onDidChangeSelection(() => this._recomputeActive()),
					_editor.viewModel.onDidChangeViewCells(() => {
						this._recomputeState();
					}));
			}
		};

		this._dispoables.add(_editor.onDidChangeModel(() => {
			this._recomputeState();
			installSelectionListener();
		}));

		this._recomputeState();
		installSelectionListener();

		const options: IWorkbenchDataTreeOptions<OutlineEntry, FuzzyScore> = {
			collapseByDefault: true,
			expandOnlyOnTwistieClick: true,
			multipleSelectionSupport: false,
			accessibilityProvider: new NotebookOutlineAccessibility(),
			identityProvider: { getId: element => element.cell.handle },
			keyboardNavigationLabelProvider: new NotebookNavigationLabelProvider()
		};

		const treeDataSource: IDataSource<this, OutlineEntry> = { getChildren: parent => parent === this ? this._entries : [] };
		const delegate = new NotebookOutlineVirtualDelegate();
		const renderers = [instantiationService.createInstance(NotebookOutlineRenderer)];

		this.breadcrumbsConfig = {
			breadcrumbsDataSource: { getBreadcrumbElements: () => this._activeEntry >= 0 ? Iterable.single(this._entries[this._activeEntry]) : Iterable.empty() },
			treeDataSource,
			delegate,
			renderers,
			options
		};

		this.treeConfig = {
			treeDataSource,
			delegate,
			renderers,
			options
		};

		this.quickPickConfig = {
			quickPickDataSource: instantiationService.createInstance(NotebookQuickPickProvider, () => this._entries),
		};
	}

	dispose(): void {
		this._dispoables.dispose();
	}

	private _recomputeState(): void {
		this._entriesDisposables.clear();
		this._activeEntry = -1;
		this._entries.length = 0;

		const { viewModel } = this._editor;
		if (!viewModel) {
			return;
		}

		const [selected] = viewModel.selectionHandles;

		for (const cell of viewModel.viewCells) {
			const content = cell.getText();
			const regexp = cell.cellKind === CellKind.Markdown
				? /^[ \t]*(\#+)(.+)$/gm // md: header
				: /^.*\w+.*\w*$/m;		// code: none empty line

			const matches = content.match(regexp);
			if (matches && matches.length) {
				for (let j = 0; j < matches.length; j++) {
					const newLen = this._entries.push(new OutlineEntry(
						cell,
						matches[j].replace(/^[ \t]*(\#+)/, '').trim(),
						cell.cellKind === CellKind.Markdown ? Codicon.markdown : Codicon.code
					));
					if (cell.handle === selected) {
						this._activeEntry = newLen - 1;
					}
				}
			}

			// send an event whenever any of the cells change
			this._entriesDisposables.add(cell.model.onDidChangeContent(() => {
				this._recomputeState();
				this._onDidChange.fire(this);
			}));
		}
		this._onDidChange.fire(this);
		this._onDidChangeActive.fire();
	}

	private _recomputeActive(): void {
		let newIdx = -1;
		const { viewModel } = this._editor;
		if (viewModel) {
			const [selected] = viewModel.selectionHandles;
			newIdx = this._entries.findIndex(entry => entry.cell.handle === selected);
		}
		if (newIdx !== this._activeEntry) {
			this._activeEntry = newIdx;
			this._onDidChangeActive.fire();
		}
	}

	get isEmpty(): boolean {
		return this._entries.length === 0;
	}

	async reveal(entry: OutlineEntry, options: IEditorOptions, sideBySide: boolean): Promise<void> {

		await this._editorService.openEditor({
			resource: entry.cell.uri,
			options: { ...options }
		}, sideBySide ? SIDE_GROUP : undefined);
	}

	preview(entry: OutlineEntry): IDisposable {
		const widget = this._editor.getControl();
		if (!widget) {
			return Disposable.None;
		}
		widget.revealInCenterIfOutsideViewport(entry.cell);
		widget.selectElement(entry.cell);
		const ids = widget.deltaCellDecorations([], [{
			handle: entry.cell.handle,
			options: { className: 'nb-symbolHighlight', outputClassName: 'nb-symbolHighlight' }
		}]);
		return toDisposable(() => { widget.deltaCellDecorations(ids, []); });

	}

	getParent(_entry: OutlineEntry): OutlineEntry | undefined {
		return undefined;
	}
}

class NotebookOutlineCreator implements IOutlineCreator<NotebookEditor, OutlineEntry> {

	readonly dispose: () => void;

	constructor(
		@IOutlineService outlineService: IOutlineService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		const reg = outlineService.registerOutlineCreator(this);
		this.dispose = () => reg.dispose();
	}

	matches(candidate: IEditorPane): candidate is NotebookEditor {
		return candidate.getId() === NotebookEditor.ID;
	}

	async createOutline(editor: NotebookEditor): Promise<IOutline<OutlineEntry> | undefined> {
		return this._instantiationService.createInstance(NotebookCellOutline, editor);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(NotebookOutlineCreator, LifecyclePhase.Eventually);
