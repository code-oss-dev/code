/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDomNodePagePosition } from 'vs/base/browser/dom';
import { IAnchor } from 'vs/base/browser/ui/contextview/contextview';
import { Action } from 'vs/base/common/actions';
import { canceled } from 'vs/base/common/errors';
import { ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { Lazy } from 'vs/base/common/lazy';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { CodeAction } from 'vs/editor/common/modes';
import { CodeActionSet, refactorCommandId, sourceActionCommandId, codeActionCommandId, organizeImportsCommandId, fixAllCommandId } from 'vs/editor/contrib/codeAction/codeAction';
import { CodeActionAutoApply, CodeActionCommandArgs, CodeActionKind } from 'vs/editor/contrib/codeAction/types';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';

interface CodeActionWidgetDelegate {
	onSelectCodeAction: (action: CodeAction) => Promise<any>;
}

interface ResolveCodeActionKeybinding {
	readonly kind: CodeActionKind;
	readonly preferred: boolean;
	readonly resolvedKeybinding: ResolvedKeybinding;
}

class CodeActionAction extends Action {
	constructor(
		public readonly action: CodeAction,
		callback: () => Promise<void>,
	) {
		super(action.command ? action.command.id : action.title, action.title, undefined, !action.disabled, callback);
	}
}

export class CodeActionWidget extends Disposable {

	private _visible: boolean = false;
	private readonly _showingActions = this._register(new MutableDisposable<CodeActionSet>());

	private readonly _keybindingResolver: CodeActionKeybindingResolver;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _contextMenuService: IContextMenuService,
		keybindingService: IKeybindingService,
		private readonly _delegate: CodeActionWidgetDelegate,
	) {
		super();

		this._keybindingResolver = new CodeActionKeybindingResolver({
			getKeybindings: () => keybindingService.getKeybindings()
		});
	}

	get isVisible(): boolean {
		return this._visible;
	}

	public async show(codeActions: CodeActionSet, at: IAnchor | IPosition): Promise<void> {
		if (!codeActions.validActions.length) {
			this._visible = false;
			return;
		}

		if (!this._editor.getDomNode()) {
			// cancel when editor went off-dom
			this._visible = false;
			throw canceled();
		}

		this._visible = true;
		this._showingActions.value = codeActions;

		const actions = codeActions.validActions.map(action =>
			new CodeActionAction(action, () => this._delegate.onSelectCodeAction(action)));

		const anchor = Position.isIPosition(at) ? this._toCoords(at) : at || { x: 0, y: 0 };
		const resolver = this._keybindingResolver.getResolver();

		this._contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			onHide: () => {
				this._visible = false;
				this._editor.focus();
			},
			autoSelectFirstItem: true,
			getKeyBinding: action => action instanceof CodeActionAction ? resolver(action.action) : undefined,
		});
	}

	private _toCoords(position: IPosition): { x: number, y: number } {
		if (!this._editor.hasModel()) {
			return { x: 0, y: 0 };
		}
		this._editor.revealPosition(position, ScrollType.Immediate);
		this._editor.render();

		// Translate to absolute editor position
		const cursorCoords = this._editor.getScrolledVisiblePosition(position);
		const editorCoords = getDomNodePagePosition(this._editor.getDomNode());
		const x = editorCoords.left + cursorCoords.left;
		const y = editorCoords.top + cursorCoords.top + cursorCoords.height;

		return { x, y };
	}
}

export class CodeActionKeybindingResolver {
	private static readonly codeActionCommands: readonly string[] = [
		refactorCommandId,
		codeActionCommandId,
		sourceActionCommandId,
		organizeImportsCommandId,
		fixAllCommandId
	];

	constructor(
		private readonly _keybindingProvider: {
			getKeybindings(): readonly ResolvedKeybindingItem[],
		},
	) { }

	public getResolver(): (action: CodeAction) => ResolvedKeybinding | undefined {
		// Lazy since we may not actually ever read the value
		const allCodeActionBindings = new Lazy<readonly ResolveCodeActionKeybinding[]>(() =>
			this._keybindingProvider.getKeybindings()
				.filter(item => CodeActionKeybindingResolver.codeActionCommands.indexOf(item.command!) >= 0)
				.filter(item => item.resolvedKeybinding)
				.map((item): ResolveCodeActionKeybinding => {
					// Special case these commands since they come built-in with VS Code and don't use 'commandArgs'
					let commandArgs = item.commandArgs;
					if (item.command === organizeImportsCommandId) {
						commandArgs = { kind: CodeActionKind.SourceOrganizeImports.value };
					} else if (item.command === fixAllCommandId) {
						commandArgs = { kind: CodeActionKind.SourceFixAll.value };
					}

					return {
						resolvedKeybinding: item.resolvedKeybinding!,
						...CodeActionCommandArgs.fromUser(commandArgs, {
							kind: CodeActionKind.None,
							apply: CodeActionAutoApply.Never
						})
					};
				}));

		return (action) => {
			if (action.kind) {
				const binding = this.bestKeybindingForCodeAction(action, allCodeActionBindings.getValue());
				return binding?.resolvedKeybinding;
			}
			return undefined;
		};
	}

	private bestKeybindingForCodeAction(
		action: CodeAction,
		candidates: readonly ResolveCodeActionKeybinding[],
	): ResolveCodeActionKeybinding | undefined {
		if (!action.kind) {
			return undefined;
		}
		const kind = new CodeActionKind(action.kind);

		return candidates
			.filter(candidate => candidate.kind.contains(kind))
			.filter(candidate => {
				if (candidate.preferred) {
					// If the candidate keybinding only applies to preferred actions, the this action must also be preferred
					return action.isPreferred;
				}
				return true;
			})
			.reduceRight((currentBest, candidate) => {
				if (!currentBest) {
					return candidate;
				}
				// Select the more specific binding
				return currentBest.kind.contains(candidate.kind) ? candidate : currentBest;
			}, undefined as ResolveCodeActionKeybinding | undefined);
	}
}
