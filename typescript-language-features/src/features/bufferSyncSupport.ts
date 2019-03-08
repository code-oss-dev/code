/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Proto from '../protocol';
import { ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { Delayer } from '../utils/async';
import { Disposable } from '../utils/dispose';
import * as languageModeIds from '../utils/languageModeIds';
import { ResourceMap } from '../utils/resourceMap';
import * as typeConverters from '../utils/typeConverters';

const enum BufferKind {
	TypeScript = 1,
	JavaScript = 2,
}

const enum BufferState {
	Initial = 1,
	Open = 2,
	Closed = 2,
}

function mode2ScriptKind(mode: string): 'TS' | 'TSX' | 'JS' | 'JSX' | undefined {
	switch (mode) {
		case languageModeIds.typescript: return 'TS';
		case languageModeIds.typescriptreact: return 'TSX';
		case languageModeIds.javascript: return 'JS';
		case languageModeIds.javascriptreact: return 'JSX';
	}
	return undefined;
}

/**
 * Manages synchronization of buffers with the TS server.
 *
 * If supported, batches together file changes. This allows the TS server to more efficiently process changes.
 */
class BufferSynchronizer {

	private _pending: Proto.UpdateOpenRequestArgs = {};

	constructor(
		private readonly client: ITypeScriptServiceClient
	) { }

	public open(args: Proto.OpenRequestArgs) {
		if (this.supportsBatching) {
			if (!this._pending.openFiles) {
				this._pending.openFiles = [];
			}
			this._pending.openFiles.push(args);
		} else {
			this.client.executeWithoutWaitingForResponse('open', args);
		}
	}

	public close(file: string) {
		if (this.supportsBatching) {
			if (!this._pending.closedFiles) {
				this._pending.closedFiles = [];
			}
			this._pending.closedFiles.push(file);
		} else {
			const args: Proto.FileRequestArgs = { file };
			this.client.executeWithoutWaitingForResponse('close', args);
		}
	}

	public change(filepath: string, events: vscode.TextDocumentContentChangeEvent[]) {
		if (this.supportsBatching) {
			if (!events.length) {
				return;
			}
			if (!this._pending.changedFiles) {
				this._pending.changedFiles = [];
			}

			this._pending.changedFiles.push({
				fileName: filepath,
				textChanges: events.map((change): Proto.CodeEdit => ({
					newText: change.text,
					start: typeConverters.Position.toLocation(change.range.start),
					end: typeConverters.Position.toLocation(change.range.end),
				})).reverse(), // Send the edits end-of-document to start-of-document order
			});
		} else {
			for (const { range, text } of events) {
				const args: Proto.ChangeRequestArgs = {
					insertString: text,
					...typeConverters.Range.toFormattingRequestArgs(filepath, range)
				};
				this.client.executeWithoutWaitingForResponse('change', args);
			}
		}
	}

	public beforeCommand(command: string) {
		if (command === 'updateOpen') {
			return;
		}

		if (!this.supportsBatching) {
			// We've already eagerly synchronized
			return;
		}

		if (this._pending.changedFiles || this._pending.closedFiles || this._pending.openFiles) {
			this.client.executeWithoutWaitingForResponse('updateOpen', this._pending);
			this._pending = {};
		}
	}

	private get supportsBatching() {
		return this.client.apiVersion.gte(API.v340) && vscode.workspace.getConfiguration('typescript', null).get<boolean>('useBatchedBufferSync', true);
	}
}

class SyncedBuffer {

	private state = BufferState.Initial;

	constructor(
		private readonly document: vscode.TextDocument,
		public readonly filepath: string,
		private readonly client: ITypeScriptServiceClient,
		private readonly synchronizer: BufferSynchronizer,
	) { }

	public open(): void {
		const args: Proto.OpenRequestArgs = {
			file: this.filepath,
			fileContent: this.document.getText(),
		};

		if (this.client.apiVersion.gte(API.v203)) {
			const scriptKind = mode2ScriptKind(this.document.languageId);
			if (scriptKind) {
				args.scriptKindName = scriptKind;
			}
		}

		if (this.client.apiVersion.gte(API.v230)) {
			args.projectRootPath = this.client.getWorkspaceRootForResource(this.document.uri);
		}

		if (this.client.apiVersion.gte(API.v240)) {
			const tsPluginsForDocument = this.client.pluginManager.plugins
				.filter(x => x.languages.indexOf(this.document.languageId) >= 0);

			if (tsPluginsForDocument.length) {
				(args as any).plugins = tsPluginsForDocument.map(plugin => plugin.name);
			}
		}

		this.synchronizer.open(args);
		this.state = BufferState.Open;
	}

	public get resource(): vscode.Uri {
		return this.document.uri;
	}

	public get lineCount(): number {
		return this.document.lineCount;
	}

	public get kind(): BufferKind {
		switch (this.document.languageId) {
			case languageModeIds.javascript:
			case languageModeIds.javascriptreact:
				return BufferKind.JavaScript;

			case languageModeIds.typescript:
			case languageModeIds.typescriptreact:
			default:
				return BufferKind.TypeScript;
		}
	}

	public close(): void {
		this.synchronizer.close(this.filepath);
		this.state = BufferState.Closed;
	}

	public onContentChanged(events: vscode.TextDocumentContentChangeEvent[]): void {
		if (this.state !== BufferState.Open) {
			console.error(`Unexpected buffer state: ${this.state}`);
		}

		this.synchronizer.change(this.filepath, events);
	}
}

class SyncedBufferMap extends ResourceMap<SyncedBuffer> {

	public getForPath(filePath: string): SyncedBuffer | undefined {
		return this.get(vscode.Uri.file(filePath));
	}

	public get allBuffers(): Iterable<SyncedBuffer> {
		return this.values;
	}
}

class PendingDiagnostics extends ResourceMap<number> {
	public getOrderedFileSet(): ResourceMap<void> {
		const orderedResources = Array.from(this.entries)
			.sort((a, b) => a.value - b.value)
			.map(entry => entry.resource);

		const map = new ResourceMap<void>();
		for (const resource of orderedResources) {
			map.set(resource, undefined);
		}
		return map;
	}
}

class GetErrRequest {

	public static executeGetErrRequest(
		client: ITypeScriptServiceClient,
		files: ResourceMap<void>,
		onDone: () => void
	) {
		const token = new vscode.CancellationTokenSource();
		return new GetErrRequest(client, files, token, onDone);
	}

	private _done: boolean = false;

	private constructor(
		client: ITypeScriptServiceClient,
		public readonly files: ResourceMap<void>,
		private readonly _token: vscode.CancellationTokenSource,
		onDone: () => void
	) {
		const args: Proto.GeterrRequestArgs = {
			delay: 0,
			files: Array.from(files.entries)
				.map(entry => client.normalizedPath(entry.resource))
				.filter(x => !!x) as string[]
		};

		client.executeAsync('geterr', args, _token.token)
			.finally(() => {
				if (this._done) {
					return;
				}
				this._done = true;
				onDone();
			});
	}

	public cancel(): any {
		if (!this._done) {
			this._token.cancel();
		}

		this._token.dispose();
	}
}

export default class BufferSyncSupport extends Disposable {

	private readonly client: ITypeScriptServiceClient;

	private _validateJavaScript: boolean = true;
	private _validateTypeScript: boolean = true;
	private readonly modeIds: Set<string>;
	private readonly syncedBuffers: SyncedBufferMap;
	private readonly pendingDiagnostics: PendingDiagnostics;
	private readonly diagnosticDelayer: Delayer<any>;
	private pendingGetErr: GetErrRequest | undefined;
	private listening: boolean = false;
	private readonly synchronizer: BufferSynchronizer;

	constructor(
		client: ITypeScriptServiceClient,
		modeIds: string[]
	) {
		super();
		this.client = client;
		this.modeIds = new Set<string>(modeIds);

		this.diagnosticDelayer = new Delayer<any>(300);

		const pathNormalizer = (path: vscode.Uri) => this.client.normalizedPath(path);
		this.syncedBuffers = new SyncedBufferMap(pathNormalizer);
		this.pendingDiagnostics = new PendingDiagnostics(pathNormalizer);
		this.synchronizer = new BufferSynchronizer(client);

		this.updateConfiguration();
		vscode.workspace.onDidChangeConfiguration(this.updateConfiguration, this, this._disposables);
	}

	private readonly _onDelete = this._register(new vscode.EventEmitter<vscode.Uri>());
	public readonly onDelete = this._onDelete.event;

	public listen(): void {
		if (this.listening) {
			return;
		}
		this.listening = true;
		vscode.workspace.onDidOpenTextDocument(this.openTextDocument, this, this._disposables);
		vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this, this._disposables);
		vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, this._disposables);
		vscode.workspace.textDocuments.forEach(this.openTextDocument, this);
	}

	public handles(resource: vscode.Uri): boolean {
		return this.syncedBuffers.has(resource);
	}

	public toResource(filePath: string): vscode.Uri {
		const buffer = this.syncedBuffers.getForPath(filePath);
		if (buffer) {
			return buffer.resource;
		}
		return vscode.Uri.file(filePath);
	}

	public reOpenDocuments(): void {
		for (const buffer of this.syncedBuffers.allBuffers) {
			buffer.open();
		}
	}

	public openTextDocument(document: vscode.TextDocument): void {
		if (!this.modeIds.has(document.languageId)) {
			return;
		}
		const resource = document.uri;
		const filepath = this.client.normalizedPath(resource);
		if (!filepath) {
			return;
		}

		if (this.syncedBuffers.has(resource)) {
			return;
		}

		const syncedBuffer = new SyncedBuffer(document, filepath, this.client, this.synchronizer);
		this.syncedBuffers.set(resource, syncedBuffer);
		syncedBuffer.open();
		this.requestDiagnostic(syncedBuffer);
	}

	public closeResource(resource: vscode.Uri): void {
		const syncedBuffer = this.syncedBuffers.get(resource);
		if (!syncedBuffer) {
			return;
		}
		this.pendingDiagnostics.delete(resource);
		this.syncedBuffers.delete(resource);
		syncedBuffer.close();
		this._onDelete.fire(resource);
		this.requestAllDiagnostics();
	}

	public interuptGetErr<R>(f: () => R): R {
		if (!this.pendingGetErr) {
			return f();
		}

		this.pendingGetErr.cancel();
		this.pendingGetErr = undefined;
		const result = f();
		this.triggerDiagnostics();
		return result;
	}

	public beforeCommand(command: string): void {
		this.synchronizer.beforeCommand(command);
	}

	private onDidCloseTextDocument(document: vscode.TextDocument): void {
		this.closeResource(document.uri);
	}

	private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
		const syncedBuffer = this.syncedBuffers.get(e.document.uri);
		if (!syncedBuffer) {
			return;
		}

		syncedBuffer.onContentChanged(e.contentChanges);
		const didTrigger = this.requestDiagnostic(syncedBuffer);

		if (!didTrigger && this.pendingGetErr) {
			// In this case we always want to re-trigger all diagnostics
			this.pendingGetErr.cancel();
			this.pendingGetErr = undefined;
			this.triggerDiagnostics();
		}
	}

	public requestAllDiagnostics() {
		for (const buffer of this.syncedBuffers.allBuffers) {
			if (this.shouldValidate(buffer)) {
				this.pendingDiagnostics.set(buffer.resource, Date.now());
			}
		}
		this.triggerDiagnostics();
	}

	public getErr(resources: vscode.Uri[]): any {
		const handledResources = resources.filter(resource => this.handles(resource));
		if (!handledResources.length) {
			return;
		}

		for (const resource of handledResources) {
			this.pendingDiagnostics.set(resource, Date.now());
		}

		this.triggerDiagnostics();
	}

	private triggerDiagnostics(delay: number = 200) {
		this.diagnosticDelayer.trigger(() => {
			this.sendPendingDiagnostics();
		}, delay);
	}

	private requestDiagnostic(buffer: SyncedBuffer): boolean {
		if (!this.shouldValidate(buffer)) {
			return false;
		}

		this.pendingDiagnostics.set(buffer.resource, Date.now());

		const delay = Math.min(Math.max(Math.ceil(buffer.lineCount / 20), 300), 800);
		this.triggerDiagnostics(delay);
		return true;
	}

	public hasPendingDiagnostics(resource: vscode.Uri): boolean {
		return this.pendingDiagnostics.has(resource);
	}

	private sendPendingDiagnostics(): void {
		const orderedFileSet = this.pendingDiagnostics.getOrderedFileSet();

		// Add all open TS buffers to the geterr request. They might be visible
		for (const buffer of this.syncedBuffers.values) {
			orderedFileSet.set(buffer.resource, undefined);
		}

		if (orderedFileSet.size) {
			if (this.pendingGetErr) {
				this.pendingGetErr.cancel();

				for (const file of this.pendingGetErr.files.entries) {
					orderedFileSet.set(file.resource, undefined);
				}
			}

			const getErr = this.pendingGetErr = GetErrRequest.executeGetErrRequest(this.client, orderedFileSet, () => {
				if (this.pendingGetErr === getErr) {
					this.pendingGetErr = undefined;
				}
			});
		}

		this.pendingDiagnostics.clear();
	}

	private updateConfiguration() {
		const jsConfig = vscode.workspace.getConfiguration('javascript', null);
		const tsConfig = vscode.workspace.getConfiguration('typescript', null);

		this._validateJavaScript = jsConfig.get<boolean>('validate.enable', true);
		this._validateTypeScript = tsConfig.get<boolean>('validate.enable', true);
	}

	private shouldValidate(buffer: SyncedBuffer) {
		switch (buffer.kind) {
			case BufferKind.JavaScript:
				return this._validateJavaScript;

			case BufferKind.TypeScript:
			default:
				return this._validateTypeScript;
		}
	}
}
