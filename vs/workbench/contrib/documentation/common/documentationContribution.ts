/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ITextModel } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import { CodeActionKind } from 'vs/editor/contrib/codeAction/types';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IExtensionPoint } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { DocumentationExtensionPoint } from './documentationExtensionPoint';

interface ICodeActionContribution {
	title: string;
	when: ContextKeyExpr;
	command: string;
}

export class DocumentationContribution extends Disposable implements IWorkbenchContribution, modes.CodeActionProvider {

	private codeActionContributions: ICodeActionContribution[] = [];
	private readonly emptyCodeActionsList = { actions: [], dispose: () => { } };

	constructor(
		extensionPoint: IExtensionPoint<DocumentationExtensionPoint>,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		this._register(modes.CodeActionProviderRegistry.register('*', this));

		extensionPoint.setHandler(points => {
			this.codeActionContributions = [];
			for (const documentation of points) {
				if (documentation.value.refactoring) {
					for (const contribution of documentation.value.refactoring) {
						const precondition = ContextKeyExpr.deserialize(contribution.when);
						if (!precondition) {
							continue;
						}

						this.codeActionContributions.push({
							title: contribution.title,
							when: precondition,
							command: contribution.command
						});
					}
				}

				if (documentation.value.view) {
					for (const contribution of documentation.value.view) {
						const precondition = ContextKeyExpr.deserialize(contribution.when);

						// TODO
					}
				}
			}
		});
	}

	async provideCodeActions(_model: ITextModel, _range: Range | Selection, context: modes.CodeActionContext, _token: CancellationToken): Promise<modes.CodeActionList> {
		return this.emptyCodeActionsList;
	}

	public _getAdditionalMenuItems(context: modes.CodeActionContext, actions: readonly modes.CodeAction[]): modes.Command[] {
		if (context.only !== CodeActionKind.Refactor.value) {
			if (!actions.some(action => action.kind && CodeActionKind.Refactor.contains(new CodeActionKind(action.kind)))) {
				return [];
			}
		}

		return this.codeActionContributions
			.filter(contribution => this.contextKeyService.contextMatchesRules(contribution.when))
			.map(contribution => {
				return {
					id: contribution.command,
					title: contribution.title
				};
			});
	}
}
