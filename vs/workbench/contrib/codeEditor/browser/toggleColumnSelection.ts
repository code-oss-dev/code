/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { MenuId, MenuRegistry, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { CoreNavigationCommands } from 'vs/editor/browser/controller/coreCommands';
import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { CursorColumns } from 'vs/editor/common/controller/cursorCommon';

export class ToggleColumnSelectionAction extends Action {
	public static readonly ID = 'editor.action.toggleColumnSelection';
	public static readonly LABEL = nls.localize('toggleColumnSelection', "Toggle Column Selection Mode");

	constructor(
		id: string,
		label: string,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService
	) {
		super(id, label);
	}

	private _getCodeEditor(): ICodeEditor | null {
		const codeEditor = this._codeEditorService.getFocusedCodeEditor();
		if (codeEditor) {
			return codeEditor;
		}
		return this._codeEditorService.getActiveCodeEditor();
	}

	public async run(): Promise<any> {
		const oldValue = this._configurationService.getValue<boolean>('editor.columnSelection');
		const codeEditor = this._getCodeEditor();
		await this._configurationService.updateValue('editor.columnSelection', !oldValue, ConfigurationTarget.USER);
		const newValue = this._configurationService.getValue<boolean>('editor.columnSelection');
		if (!codeEditor || codeEditor !== this._getCodeEditor() || oldValue === newValue || !codeEditor.hasModel()) {
			return;
		}
		const cursors = codeEditor._getCursors();
		if (codeEditor.getOption(EditorOption.columnSelection)) {
			const selection = codeEditor.getSelection();
			const modelSelectionStart = new Position(selection.selectionStartLineNumber, selection.selectionStartColumn);
			const viewSelectionStart = cursors.context.convertModelPositionToViewPosition(modelSelectionStart);
			const modelPosition = new Position(selection.positionLineNumber, selection.positionColumn);
			const viewPosition = cursors.context.convertModelPositionToViewPosition(modelPosition);

			CoreNavigationCommands.MoveTo.runCoreEditorCommand(cursors, {
				position: modelSelectionStart,
				viewPosition: viewSelectionStart
			});
			const visibleColumn = CursorColumns.visibleColumnFromColumn2(cursors.context.config, cursors.context.viewModel, viewPosition);
			CoreNavigationCommands.ColumnSelect.runCoreEditorCommand(cursors, {
				position: modelPosition,
				viewPosition: viewPosition,
				doColumnSelect: true,
				mouseColumn: visibleColumn + 1
			});
		} else {
			const columnSelectData = cursors.getColumnSelectData();
			const fromViewColumn = CursorColumns.columnFromVisibleColumn2(cursors.context.config, cursors.context.viewModel, columnSelectData.fromViewLineNumber, columnSelectData.fromViewVisualColumn);
			const fromPosition = cursors.context.convertViewPositionToModelPosition(columnSelectData.fromViewLineNumber, fromViewColumn);
			const toViewColumn = CursorColumns.columnFromVisibleColumn2(cursors.context.config, cursors.context.viewModel, columnSelectData.toViewLineNumber, columnSelectData.toViewVisualColumn);
			const toPosition = cursors.context.convertViewPositionToModelPosition(columnSelectData.toViewLineNumber, toViewColumn);

			codeEditor.setSelection(new Selection(fromPosition.lineNumber, fromPosition.column, toPosition.lineNumber, toPosition.column));
		}
	}
}

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.create(ToggleColumnSelectionAction, ToggleColumnSelectionAction.ID, ToggleColumnSelectionAction.LABEL), 'View: Toggle Column Selection Mode', nls.localize('view', "View"));

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
	group: '3_multi',
	command: {
		id: ToggleColumnSelectionAction.ID,
		title: nls.localize({ key: 'miColumnSelection', comment: ['&& denotes a mnemonic'] }, "Column &&Selection Mode"),
		toggled: ContextKeyExpr.equals('config.editor.columnSelection', true)
	},
	order: 1.5
});
