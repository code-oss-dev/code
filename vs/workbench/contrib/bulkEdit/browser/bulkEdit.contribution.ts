/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { WorkspaceEdit } from 'vs/editor/common/modes';
import { BulkEditPane } from 'vs/workbench/contrib/bulkEdit/browser/bulkEditPane';
import { IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation, IViewsRegistry, FocusedViewContext, IViewsService } from 'vs/workbench/common/views';
import { localize } from 'vs/nls';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { RawContextKey, IContextKeyService, IContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { BulkEditPreviewProvider } from 'vs/workbench/contrib/bulkEdit/browser/bulkEditPreview';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { WorkbenchListFocusContextKey } from 'vs/platform/list/browser/listService';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { URI } from 'vs/base/common/uri';
import { MenuId, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { IEditorInput } from 'vs/workbench/common/editor';
import type { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import Severity from 'vs/base/common/severity';

async function getBulkEditPane(viewsService: IViewsService): Promise<BulkEditPane | undefined> {
	const view = await viewsService.openView(BulkEditPane.ID, true);
	if (view instanceof BulkEditPane) {
		return view;
	}
	return undefined;
}

class UXState {

	private readonly _activePanel: string | undefined;

	constructor(
		@IPanelService private readonly _panelService: IPanelService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
	) {
		this._activePanel = _panelService.getActivePanel()?.getId();
	}

	async restore(): Promise<void> {

		// (1) restore previous panel
		if (typeof this._activePanel === 'string') {
			await this._panelService.openPanel(this._activePanel);
		} else {
			this._panelService.hideActivePanel();
		}

		// (2) close preview editors
		for (let group of this._editorGroupsService.groups) {
			let previewEditors: IEditorInput[] = [];
			for (let input of group.editors) {

				let resource: URI | undefined;
				if (input instanceof DiffEditorInput) {
					resource = input.modifiedInput.resource;
				} else {
					resource = input.resource;
				}

				if (resource?.scheme === BulkEditPreviewProvider.Schema) {
					previewEditors.push(input);
				}
			}

			if (previewEditors.length) {
				group.closeEditors(previewEditors, { preserveFocus: true });
			}
		}
	}
}

class PreviewSession {
	constructor(
		readonly uxState: UXState,
		readonly cts: CancellationTokenSource = new CancellationTokenSource(),
	) { }
}

class BulkEditPreviewContribution {

	static readonly ctxEnabled = new RawContextKey('refactorPreview.enabled', false);

	private readonly _ctxEnabled: IContextKey<boolean>;

	private _activeSession: PreviewSession | undefined;

	constructor(
		@IPanelService private readonly _panelService: IPanelService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IBulkEditService bulkEditService: IBulkEditService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		bulkEditService.setPreviewHandler((edit) => this._previewEdit(edit));
		this._ctxEnabled = BulkEditPreviewContribution.ctxEnabled.bindTo(contextKeyService);
	}

	private async _previewEdit(edit: WorkspaceEdit) {
		this._ctxEnabled.set(true);

		const uxState = this._activeSession?.uxState ?? new UXState(this._panelService, this._editorGroupsService);
		const view = await getBulkEditPane(this._viewsService);
		if (!view) {
			this._ctxEnabled.set(false);
			return edit;
		}

		// check for active preview session and let the user decide
		if (view.hasInput()) {
			const choice = await this._dialogService.show(
				Severity.Info,
				localize('overlap', "Another refactoring is being previewed."),
				[localize('cancel', "Cancel"), localize('continue', "Continue")],
				{ detail: localize('detail', "Press 'Continue' to discard the previous refactoring and continue with the current refactoring.") }
			);

			if (choice.choice === 0) {
				// this refactoring is being cancelled
				return { edits: [] };
			}
		}

		// session
		let session: PreviewSession;
		if (this._activeSession) {
			this._activeSession.cts.dispose(true);
			session = new PreviewSession(uxState);
		} else {
			session = new PreviewSession(uxState);
		}
		this._activeSession = session;

		// the actual work...
		try {

			const newEditOrUndefined = await view.setInput(edit, session.cts.token);
			if (!newEditOrUndefined) {
				return { edits: [] };
			}

			return newEditOrUndefined;

		} finally {
			// restore UX state
			if (this._activeSession === session) {
				await this._activeSession.uxState.restore();
				this._activeSession.cts.dispose();
				this._ctxEnabled.set(false);
				this._activeSession = undefined;
			}
		}
	}
}


// CMD: accept
registerAction2(class ApplyAction extends Action2 {

	constructor() {
		super({
			id: 'refactorPreview.apply',
			title: { value: localize('apply', "Apply Refactoring"), original: 'Apply Refactoring' },
			category: localize('cat', "Refactor Preview"),
			icon: { id: 'codicon/check' },
			precondition: ContextKeyExpr.and(BulkEditPreviewContribution.ctxEnabled, BulkEditPane.ctxHasCheckedChanges),
			menu: [{
				id: MenuId.BulkEditTitle,
				group: 'navigation'
			}, {
				id: MenuId.BulkEditContext,
				order: 1
			}],
			keybinding: {
				weight: KeybindingWeight.EditorContrib - 10,
				when: ContextKeyExpr.and(BulkEditPreviewContribution.ctxEnabled, FocusedViewContext.isEqualTo(BulkEditPane.ID)),
				primary: KeyMod.Shift + KeyCode.Enter,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<any> {
		const viewsService = accessor.get(IViewsService);
		const view = await getBulkEditPane(viewsService);
		if (view) {
			view.accept();
		}
	}
});

// CMD: discard
registerAction2(class DiscardAction extends Action2 {

	constructor() {
		super({
			id: 'refactorPreview.discard',
			title: { value: localize('Discard', "Discard Refactoring"), original: 'Discard Refactoring' },
			category: localize('cat', "Refactor Preview"),
			icon: { id: 'codicon/clear-all' },
			precondition: BulkEditPreviewContribution.ctxEnabled,
			menu: [{
				id: MenuId.BulkEditTitle,
				group: 'navigation'
			}, {
				id: MenuId.BulkEditContext,
				order: 2
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await getBulkEditPane(viewsService);
		if (view) {
			view.discard();
		}
	}
});


// CMD: toggle change
registerAction2(class ToggleAction extends Action2 {

	constructor() {
		super({
			id: 'refactorPreview.toggleCheckedState',
			title: { value: localize('toogleSelection', "Toggle Change"), original: 'Toggle Change' },
			category: localize('cat', "Refactor Preview"),
			precondition: BulkEditPreviewContribution.ctxEnabled,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: WorkbenchListFocusContextKey,
				primary: KeyCode.Space,
			},
			menu: {
				id: MenuId.BulkEditContext,
				group: 'navigation'
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await getBulkEditPane(viewsService);
		if (view) {
			view.toggleChecked();
		}
	}
});


// CMD: toggle category
registerAction2(class GroupByFile extends Action2 {

	constructor() {
		super({
			id: 'refactorPreview.groupByFile',
			title: { value: localize('groupByFile', "Group Changes By File"), original: 'Group Changes By File' },
			category: localize('cat', "Refactor Preview"),
			icon: { id: 'codicon/ungroup-by-ref-type' },
			precondition: ContextKeyExpr.and(BulkEditPane.ctxHasCategories, BulkEditPane.ctxGroupByFile.negate(), BulkEditPreviewContribution.ctxEnabled),
			menu: [{
				id: MenuId.BulkEditTitle,
				when: ContextKeyExpr.and(BulkEditPane.ctxHasCategories, BulkEditPane.ctxGroupByFile.negate()),
				group: 'navigation',
				order: 3,
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await getBulkEditPane(viewsService);
		if (view) {
			view.groupByFile();
		}
	}
});

registerAction2(class GroupByType extends Action2 {

	constructor() {
		super({
			id: 'refactorPreview.groupByType',
			title: { value: localize('groupByType', "Group Changes By Type"), original: 'Group Changes By Type' },
			category: localize('cat', "Refactor Preview"),
			icon: { id: 'codicon/group-by-ref-type' },
			precondition: ContextKeyExpr.and(BulkEditPane.ctxHasCategories, BulkEditPane.ctxGroupByFile, BulkEditPreviewContribution.ctxEnabled),
			menu: [{
				id: MenuId.BulkEditTitle,
				when: ContextKeyExpr.and(BulkEditPane.ctxHasCategories, BulkEditPane.ctxGroupByFile),
				group: 'navigation',
				order: 3
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await getBulkEditPane(viewsService);
		if (view) {
			view.groupByType();
		}
	}
});

registerAction2(class ToggleGrouping extends Action2 {

	constructor() {
		super({
			id: 'refactorPreview.toggleGrouping',
			title: { value: localize('groupByType', "Group Changes By Type"), original: 'Group Changes By Type' },
			category: localize('cat', "Refactor Preview"),
			icon: { id: 'codicon/list-tree' },
			toggled: BulkEditPane.ctxGroupByFile.negate(),
			precondition: ContextKeyExpr.and(BulkEditPane.ctxHasCategories, BulkEditPreviewContribution.ctxEnabled),
			menu: [{
				id: MenuId.BulkEditContext,
				order: 3
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await getBulkEditPane(viewsService);
		if (view) {
			view.toggleGrouping();
		}
	}
});

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	BulkEditPreviewContribution, LifecyclePhase.Ready
);

const container = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: BulkEditPane.ID,
	name: localize('panel', "Refactor Preview"),
	hideIfEmpty: true,
	ctorDescriptor: new SyncDescriptor(
		ViewPaneContainer,
		[BulkEditPane.ID, BulkEditPane.ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]
	)
}, ViewContainerLocation.Panel);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: BulkEditPane.ID,
	name: localize('panel', "Refactor Preview"),
	when: BulkEditPreviewContribution.ctxEnabled,
	ctorDescriptor: new SyncDescriptor(BulkEditPane),
}], container);

