/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { Slugifier } from '../slugify';
import { Disposable } from '../util/dispose';
import { SkinnyTextDocument } from '../workspaceContents';
import { MdReference, MdReferencesProvider } from './references';

const localize = nls.loadMessageBundle();


export class MdRenameProvider extends Disposable implements vscode.RenameProvider {

	private cachedRefs?: {
		readonly resource: vscode.Uri;
		readonly version: number;
		readonly position: vscode.Position;
		readonly references: MdReference[];
	} | undefined;

	public constructor(
		private readonly referencesProvider: MdReferencesProvider,
		private readonly slugifier: Slugifier,
	) {
		super();
	}

	public async prepareRename(document: SkinnyTextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<undefined | vscode.Range> {
		const references = await this.referencesProvider.getAllReferences(document, position, token);
		if (token.isCancellationRequested) {
			return undefined;
		}

		if (!references?.length) {
			throw new Error(localize('invalidRenameLocation', "Rename not supported at location"));
		}

		const triggerRef = references.find(ref => ref.isTriggerLocation);
		if (!triggerRef) {
			return undefined;
		}

		if (triggerRef.kind === 'header') {
			return triggerRef.headerTextLocation.range;
		} else {
			return triggerRef.fragmentLocation?.range ?? triggerRef.location.range;
		}
	}

	public async provideRenameEdits(document: SkinnyTextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit | undefined> {
		const references = await this.getAllReferences(document, position, token);
		if (token.isCancellationRequested || !references?.length) {
			return undefined;
		}

		const edit = new vscode.WorkspaceEdit();

		const slug = this.slugifier.fromHeading(newName);

		for (const ref of references) {
			if (ref.kind === 'header') {
				edit.replace(ref.location.uri, ref.headerTextLocation.range, newName);
			} else {
				edit.replace(ref.location.uri, ref.fragmentLocation?.range ?? ref.location.range, slug.value);
			}
		}

		return edit;
	}

	private async getAllReferences(document: SkinnyTextDocument, position: vscode.Position, token: vscode.CancellationToken) {
		const version = document.version;

		if (this.cachedRefs
			&& this.cachedRefs.resource.fsPath === document.uri.fsPath
			&& this.cachedRefs.version === document.version
			&& this.cachedRefs.position.isEqual(position)
		) {
			return this.cachedRefs.references;
		}

		const references = await this.referencesProvider.getAllReferences(document, position, token);
		this.cachedRefs = {
			resource: document.uri,
			version,
			position,
			references
		};
		return references;
	}
}
