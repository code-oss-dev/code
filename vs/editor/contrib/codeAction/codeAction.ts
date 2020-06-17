/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals, flatten, isNonEmptyArray, mergeSort, coalesce } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { illegalArgument, isPromiseCanceledError, onUnexpectedExternalError } from 'vs/base/common/errors';
import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { TextModelCancellationTokenSource } from 'vs/editor/browser/core/editorState';
import { registerLanguageCommand } from 'vs/editor/browser/editorExtensions';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ITextModel } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { CodeActionFilter, CodeActionKind, CodeActionTrigger, filtersAction, mayIncludeActionsOfKind } from './types';
import { IProgress, Progress } from 'vs/platform/progress/common/progress';

export const codeActionCommandId = 'editor.action.codeAction';
export const refactorCommandId = 'editor.action.refactor';
export const sourceActionCommandId = 'editor.action.sourceAction';
export const organizeImportsCommandId = 'editor.action.organizeImports';
export const fixAllCommandId = 'editor.action.fixAll';

export interface CodeActionSet extends IDisposable {
	readonly validActions: readonly modes.CodeAction[];
	readonly allActions: readonly modes.CodeAction[];
	readonly hasAutoFix: boolean;

	readonly documentation: readonly modes.Command[];
}

class ManagedCodeActionSet extends Disposable implements CodeActionSet {

	private static codeActionsComparator(a: modes.CodeAction, b: modes.CodeAction): number {
		if (a.isPreferred && !b.isPreferred) {
			return -1;
		} else if (!a.isPreferred && b.isPreferred) {
			return 1;
		}

		if (isNonEmptyArray(a.diagnostics)) {
			if (isNonEmptyArray(b.diagnostics)) {
				return a.diagnostics[0].message.localeCompare(b.diagnostics[0].message);
			} else {
				return -1;
			}
		} else if (isNonEmptyArray(b.diagnostics)) {
			return 1;
		} else {
			return 0;	// both have no diagnostics
		}
	}

	public readonly validActions: readonly modes.CodeAction[];
	public readonly allActions: readonly modes.CodeAction[];

	public constructor(
		actions: readonly modes.CodeAction[],
		public readonly documentation: readonly modes.Command[],
		disposables: DisposableStore,
	) {
		super();
		this._register(disposables);
		this.allActions = mergeSort([...actions], ManagedCodeActionSet.codeActionsComparator);
		this.validActions = this.allActions.filter(action => !action.disabled);
	}

	public get hasAutoFix() {
		return this.validActions.some(fix => !!fix.kind && CodeActionKind.QuickFix.contains(new CodeActionKind(fix.kind)) && !!fix.isPreferred);
	}
}

export function getCodeActions(
	model: ITextModel,
	rangeOrSelection: Range | Selection,
	trigger: CodeActionTrigger,
	progress: IProgress<modes.CodeActionProvider>,
	token: CancellationToken,
): Promise<CodeActionSet> {
	const filter = trigger.filter || {};

	const codeActionContext: modes.CodeActionContext = {
		only: filter.include?.value,
		trigger: trigger.type,
	};

	const cts = new TextModelCancellationTokenSource(model, token);
	const providers = getCodeActionProviders(model, filter);

	const disposables = new DisposableStore();
	const promises = providers.map(async provider => {
		try {
			progress.report(provider);
			const providedCodeActions = await provider.provideCodeActions(model, rangeOrSelection, codeActionContext, cts.token);
			if (providedCodeActions) {
				disposables.add(providedCodeActions);
			}

			if (cts.token.isCancellationRequested) {
				return { actions: [] as modes.CodeAction[], documentation: undefined };
			}

			const filteredActions = (providedCodeActions?.actions || []).filter(action => action && filtersAction(filter, action));
			const documentation = getDocumentation(provider, filteredActions, filter.include);
			return { actions: filteredActions, documentation };
		} catch (err) {
			if (isPromiseCanceledError(err)) {
				throw err;
			}
			onUnexpectedExternalError(err);
			return { actions: [] as modes.CodeAction[], documentation: undefined };
		}
	});

	const listener = modes.CodeActionProviderRegistry.onDidChange(() => {
		const newProviders = modes.CodeActionProviderRegistry.all(model);
		if (!equals(newProviders, providers)) {
			cts.cancel();
		}
	});

	return Promise.all(promises).then(actions => {
		const allActions = flatten(actions.map(x => x.actions));
		const allDocumentation = coalesce(actions.map(x => x.documentation));
		return new ManagedCodeActionSet(allActions, allDocumentation, disposables);
	})
		.finally(() => {
			listener.dispose();
			cts.dispose();
		});
}

function getCodeActionProviders(
	model: ITextModel,
	filter: CodeActionFilter
) {
	return modes.CodeActionProviderRegistry.all(model)
		// Don't include providers that we know will not return code actions of interest
		.filter(provider => {
			if (!provider.providedCodeActionKinds) {
				// We don't know what type of actions this provider will return.
				return true;
			}
			return provider.providedCodeActionKinds.some(kind => mayIncludeActionsOfKind(filter, new CodeActionKind(kind)));
		});
}

function getDocumentation(
	provider: modes.CodeActionProvider,
	providedCodeActions: readonly modes.CodeAction[],
	only?: CodeActionKind
): modes.Command | undefined {
	if (!provider.documentation) {
		return undefined;
	}

	const documentation = provider.documentation.map(entry => ({ kind: new CodeActionKind(entry.kind), command: entry.command }));

	if (only) {
		let currentBest: { readonly kind: CodeActionKind, readonly command: modes.Command } | undefined;
		for (const entry of documentation) {
			if (entry.kind.contains(only)) {
				if (!currentBest) {
					currentBest = entry;
				} else {
					// Take best match
					if (currentBest.kind.contains(entry.kind)) {
						currentBest = entry;
					}
				}
			}
		}
		if (currentBest) {
			return currentBest?.command;
		}
	}

	// Otherwise, check to see if any of the provided actions match.
	for (const action of providedCodeActions) {
		if (!action.kind) {
			continue;
		}

		for (const entry of documentation) {
			if (entry.kind.contains(new CodeActionKind(action.kind))) {
				return entry.command;
			}
		}
	}

	return undefined;
}

registerLanguageCommand('_executeCodeActionProvider', async function (accessor, args): Promise<ReadonlyArray<modes.CodeAction>> {
	const { resource, rangeOrSelection, kind } = args;
	if (!(resource instanceof URI)) {
		throw illegalArgument();
	}

	const model = accessor.get(IModelService).getModel(resource);
	if (!model) {
		throw illegalArgument();
	}

	const validatedRangeOrSelection = Selection.isISelection(rangeOrSelection)
		? Selection.liftSelection(rangeOrSelection)
		: Range.isIRange(rangeOrSelection)
			? model.validateRange(rangeOrSelection)
			: undefined;

	if (!validatedRangeOrSelection) {
		throw illegalArgument();
	}

	const codeActionSet = await getCodeActions(
		model,
		validatedRangeOrSelection,
		{ type: modes.CodeActionTriggerType.Manual, filter: { includeSourceActions: true, include: kind && kind.value ? new CodeActionKind(kind.value) : undefined } },
		Progress.None,
		CancellationToken.None);

	setTimeout(() => codeActionSet.dispose(), 100);
	return codeActionSet.validActions;
});
