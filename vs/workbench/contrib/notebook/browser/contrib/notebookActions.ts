/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { localize } from 'vs/nls';
import { Action2, IAction2Options, MenuId, MenuItemAction, MenuRegistry, registerAction2 } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { InputFocusedContext, InputFocusedContextKey, IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { DELETE_CELL_COMMAND_ID, EDIT_CELL_COMMAND_ID, INSERT_CODE_CELL_ABOVE_COMMAND_ID, INSERT_CODE_CELL_BELOW_COMMAND_ID, INSERT_MARKDOWN_CELL_ABOVE_COMMAND_ID, INSERT_MARKDOWN_CELL_BELOW_COMMAND_ID, MOVE_CELL_DOWN_COMMAND_ID, MOVE_CELL_UP_COMMAND_ID, SAVE_CELL_COMMAND_ID, COPY_CELL_UP_COMMAND_ID, COPY_CELL_DOWN_COMMAND_ID } from 'vs/workbench/contrib/notebook/browser/constants';
import { INotebookEditor, KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED, NOTEBOOK_EDITOR_FOCUSED, ICellViewModel, CellState } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { INotebookService } from 'vs/workbench/contrib/notebook/browser/notebookService';
import { CellKind, NOTEBOOK_EDITOR_CURSOR_BOUNDARY } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.executeNotebookCell',
			title: localize('notebookActions.execute', "Execute Notebook Cell"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext),
				primary: KeyMod.WinCtrl | KeyCode.Enter,
				win: {
					primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.Enter
				},
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		runActiveCell(accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.executeNotebookCellSelectBelow',
			title: localize('notebookActions.executeAndSelectBelow', "Execute Notebook Cell and Select Below"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext),
				primary: KeyMod.Shift | KeyCode.Enter,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const activeCell = runActiveCell(accessor);
		if (!activeCell) {
			return;
		}

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		const idx = editor.viewModel?.getViewCellIndex(activeCell);
		if (typeof idx !== 'number') {
			return;
		}

		// Try to select below, fall back on inserting
		const nextCell = editor.viewModel?.viewCells[idx + 1];
		if (nextCell) {
			editor.focusNotebookCell(nextCell, false);
		} else {
			await editor.insertNotebookCell(activeCell, CellKind.Code, 'below');
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.executeNotebookCellInsertBelow',
			title: localize('notebookActions.executeAndInsertBelow', "Execute Notebook Cell and Insert Below"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext),
				primary: KeyMod.Alt | KeyCode.Enter,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const activeCell = runActiveCell(accessor);
		if (!activeCell) {
			return;
		}

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		await editor.insertNotebookCell(activeCell, CellKind.Code, 'below');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.executeNotebook',
			title: localize('notebookActions.executeNotebook', "Execute Notebook")
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let notebookService = accessor.get(INotebookService);

		let resource = editorService.activeEditor?.resource;

		if (!resource) {
			return;
		}

		let notebookProviders = notebookService.getContributedNotebookProviders(resource!);

		if (notebookProviders.length > 0) {
			let viewType = notebookProviders[0].id;
			notebookService.executeNotebook(viewType, resource);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.quitNotebookEdit',
			title: localize('notebookActions.quitEditing', "Quit Notebook Cell Editing"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib - 5
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let editor = getActiveNotebookEditor(editorService);

		if (!editor) {
			return;
		}

		let activeCell = editor.getActiveCell();
		if (activeCell) {
			if (activeCell.cellKind === CellKind.Markdown) {
				activeCell.state = CellState.Preview;
			}

			editor.focusNotebookCell(activeCell, false);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.hideFind',
			title: localize('notebookActions.hideFind', "Hide Find in Notebook"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let editor = getActiveNotebookEditor(editorService);

		editor?.hideFind();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.find',
			title: localize('notebookActions.findInNotebook', "Find in Notebook"),
			keybinding: {
				when: NOTEBOOK_EDITOR_FOCUSED,
				primary: KeyCode.KEY_F | KeyMod.CtrlCmd,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let editor = getActiveNotebookEditor(editorService);

		editor?.showFind();
	}
});

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'workbench.action.executeNotebook',
		title: localize('notebookActions.menu.executeNotebook', "Execute Notebook (Run all cells)"),
		icon: { id: 'codicon/debug-start' }
	},
	order: -1,
	group: 'navigation',
	when: NOTEBOOK_EDITOR_FOCUSED
});


MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'workbench.action.executeNotebookCell',
		title: localize('notebookActions.menu.execute', "Execute Notebook Cell"),
		icon: { id: 'codicon/debug-continue' }
	},
	order: -1,
	group: 'navigation',
	when: NOTEBOOK_EDITOR_FOCUSED
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.changeCellToCode',
			title: localize('notebookActions.changeCellToCode', "Change Cell to Code"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyCode.KEY_Y,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return changeActiveCellToKind(CellKind.Code, accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.changeCellToMarkdown',
			title: localize('notebookActions.changeCellToMarkdown', "Change Cell to Markdown"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyCode.KEY_M,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return changeActiveCellToKind(CellKind.Markdown, accessor);
	}
});

function getActiveNotebookEditor(editorService: IEditorService): INotebookEditor | undefined {
	// TODO can `isNotebookEditor` be on INotebookEditor to avoid a circular dependency?
	const activeEditorPane = editorService.activeEditorPane as any | undefined;
	return activeEditorPane?.isNotebookEditor ? activeEditorPane : undefined;
}

function runActiveCell(accessor: ServicesAccessor): ICellViewModel | undefined {
	const editorService = accessor.get(IEditorService);
	const notebookService = accessor.get(INotebookService);

	const resource = editorService.activeEditor?.resource;
	if (!resource) {
		return;
	}

	const editor = getActiveNotebookEditor(editorService);
	if (!editor) {
		return;
	}

	const notebookProviders = notebookService.getContributedNotebookProviders(resource);
	if (!notebookProviders.length) {
		return;
	}

	const activeCell = editor.getActiveCell();
	if (!activeCell) {
		return;
	}

	const idx = editor.viewModel?.getViewCellIndex(activeCell);
	if (typeof idx !== 'number') {
		return;
	}

	const viewType = notebookProviders[0].id;
	notebookService.executeNotebookActiveCell(viewType, resource);

	return activeCell;
}

async function changeActiveCellToKind(kind: CellKind, accessor: ServicesAccessor): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const editor = getActiveNotebookEditor(editorService);
	if (!editor) {
		return;
	}

	const activeCell = editor.getActiveCell();
	if (!activeCell) {
		return;
	}

	if (activeCell.cellKind === kind) {
		return;
	}

	const text = activeCell.getText();
	await editor.insertNotebookCell(activeCell, kind, 'below', text);
	const idx = editor.viewModel?.getViewCellIndex(activeCell);
	if (typeof idx !== 'number') {
		return;
	}

	const newCell = editor.viewModel?.viewCells[idx + 1];
	if (!newCell) {
		return;
	}

	editor.focusNotebookCell(newCell, false);
	editor.deleteNotebookCell(activeCell);
}

export interface INotebookCellActionContext {
	cell: ICellViewModel;
	notebookEditor: INotebookEditor;
}

function getActiveCellContext(accessor: ServicesAccessor): INotebookCellActionContext | undefined {
	const editorService = accessor.get(IEditorService);

	const editor = getActiveNotebookEditor(editorService);
	if (!editor) {
		return;
	}

	const activeCell = editor.getActiveCell();
	if (!activeCell) {
		return;
	}

	return {
		cell: activeCell,
		notebookEditor: editor
	};
}

abstract class InsertCellCommand extends Action2 {
	constructor(
		desc: Readonly<IAction2Options>,
		private kind: CellKind,
		private direction: 'above' | 'below'
	) {
		super(desc);
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext): Promise<void> {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		await context.notebookEditor.insertNotebookCell(context.cell, this.kind, this.direction);
	}
}

registerAction2(class extends InsertCellCommand {
	constructor() {
		super(
			{
				id: INSERT_CODE_CELL_ABOVE_COMMAND_ID,
				title: localize('notebookActions.insertCodeCellAbove', "Insert Code Cell Above")
			},
			CellKind.Code,
			'above');
	}
});

registerAction2(class extends InsertCellCommand {
	constructor() {
		super(
			{
				id: INSERT_CODE_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.insertCodeCellBelow', "Insert Code Cell Below")
			},
			CellKind.Code,
			'below');
	}
});

registerAction2(class extends InsertCellCommand {
	constructor() {
		super(
			{
				id: INSERT_MARKDOWN_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.insertMarkdownCellAbove', "Insert Markdown Cell Above"),
			},
			CellKind.Markdown,
			'above');
	}
});

registerAction2(class extends InsertCellCommand {
	constructor() {
		super(
			{
				id: INSERT_MARKDOWN_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.insertMarkdownCellBelow', "Insert Markdown Cell Below"),
			},
			CellKind.Code,
			'below');
	}
});

export class InsertCodeCellAboveAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: INSERT_CODE_CELL_ABOVE_COMMAND_ID,
				title: localize('notebookActions.insertCodeCellAbove', "Insert Code Cell Above"),
				icon: { id: 'codicon/add' }
			},
			undefined,
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);
	}
}

export class InsertCodeCellBelowAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: INSERT_CODE_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.insertCodeCellBelow', "Insert Code Cell Below"),
				icon: { id: 'codicon/add' }
			},
			{
				id: INSERT_MARKDOWN_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.insertMarkdownCellBelow', "Insert Markdown Cell Below"),
				icon: { id: 'codicon/add' }
			},
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);
	}
}

export class InsertMarkdownCellAboveAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: INSERT_MARKDOWN_CELL_ABOVE_COMMAND_ID,
				title: localize('notebookActions.insertMarkdownCellAbove', "Insert Markdown Cell Above"),
				icon: { id: 'codicon/add' }
			},
			undefined,
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);
	}
}

export class InsertMarkdownCellBelowAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: INSERT_MARKDOWN_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.insertMarkdownCellBelow', "Insert Markdown Cell Below"),
				icon: { id: 'codicon/add' }
			},
			undefined,
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: EDIT_CELL_COMMAND_ID,
				title: localize('notebookActions.editCell', "Edit Cell"),
				keybinding: {
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
					primary: KeyCode.Enter,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
	}

	run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return context.notebookEditor.editNotebookCell(context.cell);
	}
});

export class EditCellAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: EDIT_CELL_COMMAND_ID,
				title: localize('notebookActions.editCell', "Edit Cell"),
				icon: { id: 'codicon/pencil' }
			},
			undefined,
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: SAVE_CELL_COMMAND_ID,
				title: localize('notebookActions.saveCell', "Save Cell")
			});
	}

	run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return context.notebookEditor.saveNotebookCell(context.cell);
	}
});

export class SaveCellAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: SAVE_CELL_COMMAND_ID,
				title: localize('notebookActions.saveCell', "Save Cell"),
				icon: { id: 'codicon/save' }
			},
			undefined,
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: DELETE_CELL_COMMAND_ID,
				title: localize('notebookActions.deleteCell', "Delete Cell")
			});
	}

	run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return context.notebookEditor.deleteNotebookCell(context.cell);
	}
});

export class DeleteCellAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: DELETE_CELL_COMMAND_ID,
				title: localize('notebookActions.deleteCell', "Delete Cell"),
				icon: { id: 'codicon/x' }
			},
			undefined,
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);

		this.class = 'codicon-x';
	}
}

async function moveCell(context: INotebookCellActionContext, direction: 'up' | 'down'): Promise<void> {
	direction === 'up' ?
		context.notebookEditor.moveCellUp(context.cell) :
		context.notebookEditor.moveCellDown(context.cell);
}

async function copyCell(context: INotebookCellActionContext, direction: 'up' | 'down'): Promise<void> {
	const text = context.cell.getText();
	const newCellDirection = direction === 'up' ? 'above' : 'below';
	await context.notebookEditor.insertNotebookCell(context.cell, context.cell.cellKind, newCellDirection, text);
}

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: MOVE_CELL_UP_COMMAND_ID,
				title: localize('notebookActions.moveCellUp', "Move Cell Up")
			});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return moveCell(context, 'up');
	}
});

export class MoveCellUpAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: MOVE_CELL_UP_COMMAND_ID,
				title: localize('notebookActions.moveCellUp', "Move Cell Up"),
				icon: { id: 'codicon/arrow-up' }
			},
			{
				id: COPY_CELL_UP_COMMAND_ID,
				title: localize('notebookActions.copyCellUp', "Copy Cell Up"),
				icon: { id: 'codicon/arrow-up' }
			},
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: MOVE_CELL_DOWN_COMMAND_ID,
				title: localize('notebookActions.moveCellDown', "Move Cell Down")
			});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return moveCell(context, 'down');
	}
});

export class MoveCellDownAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: MOVE_CELL_DOWN_COMMAND_ID,
				title: localize('notebookActions.moveCellDown', "Move Cell Down"),
				icon: { id: 'codicon/arrow-down' }
			},
			{
				id: COPY_CELL_DOWN_COMMAND_ID,
				title: localize('notebookActions.copyCellDown', "Copy Cell Down"),
				icon: { id: 'codicon/arrow-down' }
			},
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);

		this.class = 'codicon-arrow-down';
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: COPY_CELL_UP_COMMAND_ID,
				title: localize('notebookActions.copyCellUp', "Copy Cell Up")
			});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return copyCell(context, 'up');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: COPY_CELL_DOWN_COMMAND_ID,
				title: localize('notebookActions.copyCellDown', "Copy Cell Down")
			});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return copyCell(context, 'down');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.cursorDown',
			title: 'Notebook Cursor Move Down',
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.has(InputFocusedContextKey), NOTEBOOK_EDITOR_CURSOR_BOUNDARY.notEqualsTo('top'), NOTEBOOK_EDITOR_CURSOR_BOUNDARY.notEqualsTo('none')),
				primary: KeyCode.DownArrow,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext): Promise<void> {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		const editor = context.notebookEditor;
		const activeCell = context.cell;

		const idx = editor.viewModel?.getViewCellIndex(activeCell);
		if (typeof idx !== 'number') {
			return;
		}

		const newCell = editor.viewModel?.viewCells[idx + 1];

		if (!newCell) {
			return;
		}

		editor.focusNotebookCell(newCell, true);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.cursorUp',
			title: 'Notebook Cursor Move Up',
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.has(InputFocusedContextKey), NOTEBOOK_EDITOR_CURSOR_BOUNDARY.notEqualsTo('bottom'), NOTEBOOK_EDITOR_CURSOR_BOUNDARY.notEqualsTo('none')),
				primary: KeyCode.UpArrow,
				weight: KeybindingWeight.WorkbenchContrib
			},
		});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext): Promise<void> {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		const editor = context.notebookEditor;
		const activeCell = context.cell;

		const idx = editor.viewModel?.getViewCellIndex(activeCell);
		if (typeof idx !== 'number') {
			return;
		}

		if (idx < 1) {
			// we don't do loop
			return;
		}

		const newCell = editor.viewModel?.viewCells[idx - 1];

		if (!newCell) {
			return;
		}

		editor.focusNotebookCell(newCell, true);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.undo',
			title: 'Notebook Undo',
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyMod.CtrlCmd | KeyCode.KEY_Z,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		const viewModel = editor.viewModel;

		if (!viewModel) {
			return;
		}

		viewModel.undo();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.redo',
			title: 'Notebook Redo',
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		const viewModel = editor.viewModel;

		if (!viewModel) {
			return;
		}

		viewModel.redo();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.testResize',
			title: 'Notebook Test Cell Resize',
			keybinding: {
				when: IsDevelopmentContext,
				primary: undefined,
				weight: KeybindingWeight.WorkbenchContrib
			},
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const resource = editorService.activeEditor?.resource;
		if (!resource) {
			return;
		}

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		const cells = editor.viewModel?.viewCells;

		if (cells && cells.length) {
			const firstCell = cells[0];
			editor.layoutNotebookCell(firstCell, 400);
		}
	}
});
