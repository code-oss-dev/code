/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import * as Proto from '../protocol';
import { ITypeScriptServiceClient } from '../typescriptService';
import * as typeConverters from '../utils/typeConverters';
import FileConfigurationManager from './fileConfigurationManager';
import { disposeAll } from '../utils/dispose';

class TypeScriptFormattingProvider implements vscode.DocumentRangeFormattingEditProvider, vscode.OnTypeFormattingEditProvider {
	private enabled: boolean = true;

	public constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly formattingOptionsManager: FileConfigurationManager
	) { }

	public updateConfiguration(config: vscode.WorkspaceConfiguration): void {
		this.enabled = config.get('format.enable', true);
	}

	public isEnabled(): boolean {
		return this.enabled;
	}

	private async doFormat(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
		args: Proto.FormatRequestArgs,
		token: vscode.CancellationToken
	): Promise<vscode.TextEdit[]> {
		await this.formattingOptionsManager.ensureConfigurationOptions(document, options, token);
		try {
			const response = await this.client.execute('format', args, token);
			if (response.body) {
				return response.body.map(typeConverters.TextEdit.fromCodeEdit);
			}
		} catch {
			// noop
		}
		return [];
	}

	public async provideDocumentRangeFormattingEdits(
		document: vscode.TextDocument,
		range: vscode.Range,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken
	): Promise<vscode.TextEdit[]> {
		const absPath = this.client.normalizePath(document.uri);
		if (!absPath) {
			return [];
		}
		const args: Proto.FormatRequestArgs = {
			file: absPath,
			line: range.start.line + 1,
			offset: range.start.character + 1,
			endLine: range.end.line + 1,
			endOffset: range.end.character + 1
		};
		return this.doFormat(document, options, args, token);
	}

	public async provideOnTypeFormattingEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		ch: string,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken
	): Promise<vscode.TextEdit[]> {
		const filepath = this.client.normalizePath(document.uri);
		if (!filepath) {
			return [];
		}

		await this.formattingOptionsManager.ensureConfigurationOptions(document, options, token);

		const args: Proto.FormatOnKeyRequestArgs = {
			file: filepath,
			line: position.line + 1,
			offset: position.character + 1,
			key: ch
		};
		try {
			const response = await this.client.execute('formatonkey', args, token);
			const edits = response.body;
			const result: vscode.TextEdit[] = [];
			if (!edits) {
				return result;
			}
			for (const edit of edits) {
				const textEdit = typeConverters.TextEdit.fromCodeEdit(edit);
				const range = textEdit.range;
				// Work around for https://github.com/Microsoft/TypeScript/issues/6700.
				// Check if we have an edit at the beginning of the line which only removes white spaces and leaves
				// an empty line. Drop those edits
				if (range.start.character === 0 && range.start.line === range.end.line && textEdit.newText === '') {
					const lText = document.lineAt(range.start.line).text;
					// If the edit leaves something on the line keep the edit (note that the end character is exclusive).
					// Keep it also if it removes something else than whitespace
					if (lText.trim().length > 0 || lText.length > range.end.character) {
						result.push(textEdit);
					}
				} else {
					result.push(textEdit);
				}
			}
			return result;
		} catch {
			// noop
		}
		return [];
	}
}

class FormattingProviderManager {
	private formattingProviderRegistration: vscode.Disposable | undefined;
	private disposables: vscode.Disposable[] = [];
	constructor(
		private readonly modeId: string,
		private readonly formattingProvider: TypeScriptFormattingProvider,
		private readonly selector: vscode.DocumentSelector
	) {
		vscode.workspace.onDidChangeConfiguration(() => this.updateConfiguration(), null, this.disposables);
	}

	public dispose() {
		disposeAll(this.disposables);

		if (this.formattingProviderRegistration) {
			this.formattingProviderRegistration.dispose();
			this.formattingProviderRegistration = undefined;
		}
	}

	public updateConfiguration(): void {
		const config = vscode.workspace.getConfiguration(this.modeId);
		this.formattingProvider.updateConfiguration(config);

		if (!this.formattingProvider.isEnabled() && this.formattingProviderRegistration) {
			this.formattingProviderRegistration.dispose();
			this.formattingProviderRegistration = undefined;
		} else if (this.formattingProvider.isEnabled() && !this.formattingProviderRegistration) {
			this.formattingProviderRegistration = vscode.languages.registerDocumentRangeFormattingEditProvider(this.selector, this.formattingProvider);
		}
	}
}

export function register(
	selector: vscode.DocumentSelector,
	modeId: string,
	config: vscode.WorkspaceConfiguration,
	client: ITypeScriptServiceClient,
	fileConfigurationManager: FileConfigurationManager
) {
	const disposables: vscode.Disposable[] = [];
	const formattingProvider = new TypeScriptFormattingProvider(client, fileConfigurationManager);
	formattingProvider.updateConfiguration(config);
	disposables.push(vscode.languages.registerOnTypeFormattingEditProvider(selector, formattingProvider, ';', '}', '\n'));

	const formattingProviderManager = new FormattingProviderManager(modeId, formattingProvider, selector);
	formattingProviderManager.updateConfiguration();
	disposables.push(formattingProviderManager);

	return vscode.Disposable.from(...disposables);
}