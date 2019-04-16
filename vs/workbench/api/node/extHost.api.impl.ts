/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'vs/base/common/cancellation';
import * as errors from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import * as path from 'vs/base/common/path';
import Severity from 'vs/base/common/severity';
import { URI } from 'vs/base/common/uri';
import { TextEditorCursorStyle } from 'vs/editor/common/config/editorOptions';
import { OverviewRulerLane } from 'vs/editor/common/model';
import * as languageConfiguration from 'vs/editor/common/modes/languageConfiguration';
import { score } from 'vs/editor/common/modes/languageSelector';
import * as files from 'vs/platform/files/common/files';
import { ExtHostContext, IInitData, IMainContext, MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostApiCommands } from 'vs/workbench/api/common/extHostApiCommands';
import { ExtHostClipboard } from 'vs/workbench/api/common/extHostClipboard';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { ExtHostComments } from 'vs/workbench/api/common/extHostComments';
import { ExtHostConfiguration, ExtHostConfigProvider } from 'vs/workbench/api/common/extHostConfiguration';
import { ExtHostDebugService } from 'vs/workbench/api/node/extHostDebugService';
import { ExtHostDecorations } from 'vs/workbench/api/common/extHostDecorations';
import { ExtHostDiagnostics } from 'vs/workbench/api/common/extHostDiagnostics';
import { ExtHostDialogs } from 'vs/workbench/api/common/extHostDialogs';
import { ExtHostDocumentContentProvider } from 'vs/workbench/api/common/extHostDocumentContentProviders';
import { ExtHostDocumentSaveParticipant } from 'vs/workbench/api/common/extHostDocumentSaveParticipant';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { ExtensionActivatedByAPI } from 'vs/workbench/api/common/extHostExtensionActivator';
import { ExtHostExtensionService } from 'vs/workbench/api/node/extHostExtensionService';
import { ExtHostFileSystem } from 'vs/workbench/api/common/extHostFileSystem';
import { ExtHostFileSystemEventService } from 'vs/workbench/api/common/extHostFileSystemEventService';
import { ExtHostHeapService } from 'vs/workbench/api/common/extHostHeapService';
import { ExtHostLanguageFeatures, ISchemeTransformer } from 'vs/workbench/api/common/extHostLanguageFeatures';
import { ExtHostLanguages } from 'vs/workbench/api/common/extHostLanguages';
import { ExtHostLogService } from 'vs/workbench/api/common/extHostLogService';
import { ExtHostMessageService } from 'vs/workbench/api/common/extHostMessageService';
import { ExtHostOutputService } from 'vs/workbench/api/common/extHostOutput';
import { LogOutputChannelFactory } from 'vs/workbench/api/node/extHostOutputService';
import { ExtHostProgress } from 'vs/workbench/api/common/extHostProgress';
import { ExtHostQuickOpen } from 'vs/workbench/api/common/extHostQuickOpen';
import { ExtHostSCM } from 'vs/workbench/api/common/extHostSCM';
import { ExtHostSearch, registerEHSearchProviders } from 'vs/workbench/api/node/extHostSearch';
import { ExtHostStatusBar } from 'vs/workbench/api/common/extHostStatusBar';
import { ExtHostStorage } from 'vs/workbench/api/common/extHostStorage';
import { ExtHostTask } from 'vs/workbench/api/node/extHostTask';
import { ExtHostTerminalService } from 'vs/workbench/api/node/extHostTerminalService';
import { ExtHostEditors } from 'vs/workbench/api/common/extHostTextEditors';
import { ExtHostTreeViews } from 'vs/workbench/api/common/extHostTreeViews';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { ExtHostUrls } from 'vs/workbench/api/common/extHostUrls';
import { ExtHostWebviews } from 'vs/workbench/api/common/extHostWebview';
import { ExtHostWindow } from 'vs/workbench/api/common/extHostWindow';
import { ExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { throwProposedApiError, checkProposedApiEnabled } from 'vs/workbench/services/extensions/common/extensions';
import { ProxyIdentifier } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import * as vscode from 'vscode';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { originalFSPath } from 'vs/base/common/resources';
import { CLIServer } from 'vs/workbench/api/node/extHostCLIServer';
import { withNullAsUndefined } from 'vs/base/common/types';
import { values } from 'vs/base/common/collections';
import { Schemas } from 'vs/base/common/network';

export interface IExtensionApiFactory {
	(extension: IExtensionDescription, registry: ExtensionDescriptionRegistry, configProvider: ExtHostConfigProvider): typeof vscode;
}

function proposedApiFunction<T>(extension: IExtensionDescription, fn: T): T {
	if (extension.enableProposedApi) {
		return fn;
	} else {
		return throwProposedApiError.bind(null, extension) as any as T;
	}
}

/**
 * This method instantiates and returns the extension API surface
 */
export function createApiFactory(
	initData: IInitData,
	rpcProtocol: IMainContext,
	extHostWorkspace: ExtHostWorkspace,
	extHostConfiguration: ExtHostConfiguration,
	extensionService: ExtHostExtensionService,
	extHostLogService: ExtHostLogService,
	extHostStorage: ExtHostStorage,
	schemeTransformer: ISchemeTransformer | null,
	outputChannelName: string
): IExtensionApiFactory {

	// Addressable instances
	rpcProtocol.set(ExtHostContext.ExtHostLogService, extHostLogService);
	const extHostHeapService = rpcProtocol.set(ExtHostContext.ExtHostHeapService, new ExtHostHeapService());
	const extHostDecorations = rpcProtocol.set(ExtHostContext.ExtHostDecorations, new ExtHostDecorations(rpcProtocol));
	const extHostWebviews = rpcProtocol.set(ExtHostContext.ExtHostWebviews, new ExtHostWebviews(rpcProtocol));
	const extHostUrls = rpcProtocol.set(ExtHostContext.ExtHostUrls, new ExtHostUrls(rpcProtocol));
	const extHostDocumentsAndEditors = rpcProtocol.set(ExtHostContext.ExtHostDocumentsAndEditors, new ExtHostDocumentsAndEditors(rpcProtocol));
	const extHostDocuments = rpcProtocol.set(ExtHostContext.ExtHostDocuments, new ExtHostDocuments(rpcProtocol, extHostDocumentsAndEditors));
	const extHostDocumentContentProviders = rpcProtocol.set(ExtHostContext.ExtHostDocumentContentProviders, new ExtHostDocumentContentProvider(rpcProtocol, extHostDocumentsAndEditors, extHostLogService));
	const extHostDocumentSaveParticipant = rpcProtocol.set(ExtHostContext.ExtHostDocumentSaveParticipant, new ExtHostDocumentSaveParticipant(extHostLogService, extHostDocuments, rpcProtocol.getProxy(MainContext.MainThreadTextEditors)));
	const extHostEditors = rpcProtocol.set(ExtHostContext.ExtHostEditors, new ExtHostEditors(rpcProtocol, extHostDocumentsAndEditors));
	const extHostCommands = rpcProtocol.set(ExtHostContext.ExtHostCommands, new ExtHostCommands(rpcProtocol, extHostHeapService, extHostLogService));
	const extHostTreeViews = rpcProtocol.set(ExtHostContext.ExtHostTreeViews, new ExtHostTreeViews(rpcProtocol.getProxy(MainContext.MainThreadTreeViews), extHostCommands, extHostLogService));
	rpcProtocol.set(ExtHostContext.ExtHostWorkspace, extHostWorkspace);
	rpcProtocol.set(ExtHostContext.ExtHostConfiguration, extHostConfiguration);
	const extHostDiagnostics = rpcProtocol.set(ExtHostContext.ExtHostDiagnostics, new ExtHostDiagnostics(rpcProtocol));
	const extHostLanguageFeatures = rpcProtocol.set(ExtHostContext.ExtHostLanguageFeatures, new ExtHostLanguageFeatures(rpcProtocol, schemeTransformer, extHostDocuments, extHostCommands, extHostHeapService, extHostDiagnostics, extHostLogService));
	const extHostFileSystem = rpcProtocol.set(ExtHostContext.ExtHostFileSystem, new ExtHostFileSystem(rpcProtocol, extHostLanguageFeatures));
	const extHostFileSystemEvent = rpcProtocol.set(ExtHostContext.ExtHostFileSystemEventService, new ExtHostFileSystemEventService(rpcProtocol, extHostDocumentsAndEditors));
	const extHostQuickOpen = rpcProtocol.set(ExtHostContext.ExtHostQuickOpen, new ExtHostQuickOpen(rpcProtocol, extHostWorkspace, extHostCommands));
	const extHostTerminalService = rpcProtocol.set(ExtHostContext.ExtHostTerminalService, new ExtHostTerminalService(rpcProtocol, extHostConfiguration, extHostWorkspace, extHostDocumentsAndEditors, extHostLogService));
	const extHostDebugService = rpcProtocol.set(ExtHostContext.ExtHostDebugService, new ExtHostDebugService(rpcProtocol, extHostWorkspace, extensionService, extHostDocumentsAndEditors, extHostConfiguration, extHostTerminalService, extHostCommands));
	const extHostSCM = rpcProtocol.set(ExtHostContext.ExtHostSCM, new ExtHostSCM(rpcProtocol, extHostCommands, extHostLogService));
	const extHostComment = rpcProtocol.set(ExtHostContext.ExtHostComments, new ExtHostComments(rpcProtocol, extHostCommands, extHostDocuments));
	const extHostSearch = rpcProtocol.set(ExtHostContext.ExtHostSearch, new ExtHostSearch(rpcProtocol, schemeTransformer, extHostLogService));
	const extHostTask = rpcProtocol.set(ExtHostContext.ExtHostTask, new ExtHostTask(rpcProtocol, extHostWorkspace, extHostDocumentsAndEditors, extHostConfiguration, extHostTerminalService));
	const extHostWindow = rpcProtocol.set(ExtHostContext.ExtHostWindow, new ExtHostWindow(rpcProtocol));
	rpcProtocol.set(ExtHostContext.ExtHostExtensionService, extensionService);
	const extHostProgress = rpcProtocol.set(ExtHostContext.ExtHostProgress, new ExtHostProgress(rpcProtocol.getProxy(MainContext.MainThreadProgress)));
	const extHostOutputService = rpcProtocol.set(ExtHostContext.ExtHostOutputService, new ExtHostOutputService(LogOutputChannelFactory, initData.logsLocation, rpcProtocol));
	rpcProtocol.set(ExtHostContext.ExtHostStorage, extHostStorage);
	if (initData.remoteAuthority) {
		extHostTask.registerTaskSystem(Schemas.vscodeRemote, {
			scheme: Schemas.vscodeRemote,
			authority: initData.remoteAuthority,
			platform: process.platform
		});

		registerEHSearchProviders(extHostSearch, extHostLogService);

		const cliServer = new CLIServer(extHostCommands);
		process.env['VSCODE_IPC_HOOK_CLI'] = cliServer.ipcHandlePath;
	}

	// Check that no named customers are missing
	const expected: ProxyIdentifier<any>[] = values(ExtHostContext);
	rpcProtocol.assertRegistered(expected);

	// Other instances
	const extHostClipboard = new ExtHostClipboard(rpcProtocol);
	const extHostMessageService = new ExtHostMessageService(rpcProtocol);
	const extHostDialogs = new ExtHostDialogs(rpcProtocol);
	const extHostStatusBar = new ExtHostStatusBar(rpcProtocol);
	const extHostLanguages = new ExtHostLanguages(rpcProtocol, extHostDocuments);

	// Register an output channel for exthost log
	extHostOutputService.createOutputChannelFromLogFile(outputChannelName, extHostLogService.logFile);

	// Register API-ish commands
	ExtHostApiCommands.register(extHostCommands);

	return function (extension: IExtensionDescription, extensionRegistry: ExtensionDescriptionRegistry, configProvider: ExtHostConfigProvider): typeof vscode {

		// Check document selectors for being overly generic. Technically this isn't a problem but
		// in practice many extensions say they support `fooLang` but need fs-access to do so. Those
		// extension should specify then the `file`-scheme, e.g `{ scheme: 'fooLang', language: 'fooLang' }`
		// We only inform once, it is not a warning because we just want to raise awareness and because
		// we cannot say if the extension is doing it right or wrong...
		const checkSelector = (function () {
			let done = (!extension.isUnderDevelopment);
			function informOnce(selector: vscode.DocumentSelector) {
				if (!done) {
					console.info(`Extension '${extension.identifier.value}' uses a document selector without scheme. Learn more about this: https://go.microsoft.com/fwlink/?linkid=872305`);
					done = true;
				}
			}
			return function perform(selector: vscode.DocumentSelector): vscode.DocumentSelector {
				if (Array.isArray(selector)) {
					selector.forEach(perform);
				} else if (typeof selector === 'string') {
					informOnce(selector);
				} else {
					if (typeof selector.scheme === 'undefined') {
						informOnce(selector);
					}
					if (!extension.enableProposedApi && typeof selector.exclusive === 'boolean') {
						throwProposedApiError(extension);
					}
				}
				return selector;
			};
		})();


		// namespace: commands
		const commands: typeof vscode.commands = {
			registerCommand(id: string, command: <T>(...args: any[]) => T | Thenable<T>, thisArgs?: any): vscode.Disposable {
				return extHostCommands.registerCommand(true, id, command, thisArgs);
			},
			registerTextEditorCommand(id: string, callback: (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => void, thisArg?: any): vscode.Disposable {
				return extHostCommands.registerCommand(true, id, (...args: any[]): any => {
					const activeTextEditor = extHostEditors.getActiveTextEditor();
					if (!activeTextEditor) {
						console.warn('Cannot execute ' + id + ' because there is no active text editor.');
						return undefined;
					}

					return activeTextEditor.edit((edit: vscode.TextEditorEdit) => {
						args.unshift(activeTextEditor, edit);
						callback.apply(thisArg, args);

					}).then((result) => {
						if (!result) {
							console.warn('Edits from command ' + id + ' were not applied.');
						}
					}, (err) => {
						console.warn('An error occurred while running command ' + id, err);
					});
				});
			},
			registerDiffInformationCommand: proposedApiFunction(extension, (id: string, callback: (diff: vscode.LineChange[], ...args: any[]) => any, thisArg?: any): vscode.Disposable => {
				return extHostCommands.registerCommand(true, id, async (...args: any[]): Promise<any> => {
					const activeTextEditor = extHostEditors.getActiveTextEditor();
					if (!activeTextEditor) {
						console.warn('Cannot execute ' + id + ' because there is no active text editor.');
						return undefined;
					}

					const diff = await extHostEditors.getDiffInformation(activeTextEditor.id);
					callback.apply(thisArg, [diff, ...args]);
				});
			}),
			executeCommand<T>(id: string, ...args: any[]): Thenable<T> {
				return extHostCommands.executeCommand<T>(id, ...args);
			},
			getCommands(filterInternal: boolean = false): Thenable<string[]> {
				return extHostCommands.getCommands(filterInternal);
			},
			onDidExecuteCommand: proposedApiFunction(extension, (listener, thisArgs?, disposables?) => {
				return extHostCommands.onDidExecuteCommand(listener, thisArgs, disposables);
			}),
		};

		// namespace: env
		const env: typeof vscode.env = Object.freeze({
			get machineId() { return initData.telemetryInfo.machineId; },
			get sessionId() { return initData.telemetryInfo.sessionId; },
			get language() { return initData.environment.appLanguage; },
			get appName() { return initData.environment.appName; },
			get appRoot() { return initData.environment.appRoot!.fsPath; },
			get uriScheme() { return initData.environment.appUriScheme; },
			get logLevel() {
				checkProposedApiEnabled(extension);
				return typeConverters.LogLevel.to(extHostLogService.getLevel());
			},
			get onDidChangeLogLevel() {
				checkProposedApiEnabled(extension);
				return Event.map(extHostLogService.onDidChangeLogLevel, l => typeConverters.LogLevel.to(l));
			},
			get clipboard(): vscode.Clipboard {
				return extHostClipboard;
			},
			openExternal(uri: URI) {
				return extHostWindow.openUri(uri, { allowTunneling: !!initData.remoteAuthority });
			}
		});

		// namespace: extensions
		const extensions: typeof vscode.extensions = {
			getExtension(extensionId: string): Extension<any> | undefined {
				const desc = extensionRegistry.getExtensionDescription(extensionId);
				if (desc) {
					return new Extension(extensionService, desc);
				}
				return undefined;
			},
			get all(): Extension<any>[] {
				return extensionRegistry.getAllExtensionDescriptions().map((desc) => new Extension(extensionService, desc));
			},
			get onDidChange() {
				return extensionRegistry.onDidChange;
			}
		};

		// namespace: languages
		const languages: typeof vscode.languages = {
			createDiagnosticCollection(name?: string): vscode.DiagnosticCollection {
				return extHostDiagnostics.createDiagnosticCollection(name);
			},
			get onDidChangeDiagnostics() {
				return extHostDiagnostics.onDidChangeDiagnostics;
			},
			getDiagnostics: (resource?: vscode.Uri) => {
				return <any>extHostDiagnostics.getDiagnostics(resource);
			},
			getLanguages(): Thenable<string[]> {
				return extHostLanguages.getLanguages();
			},
			setTextDocumentLanguage(document: vscode.TextDocument, languageId: string): Thenable<vscode.TextDocument> {
				return extHostLanguages.changeLanguage(document.uri, languageId);
			},
			match(selector: vscode.DocumentSelector, document: vscode.TextDocument): number {
				return score(typeConverters.LanguageSelector.from(selector), document.uri, document.languageId, true);
			},
			registerCodeActionsProvider(selector: vscode.DocumentSelector, provider: vscode.CodeActionProvider, metadata?: vscode.CodeActionProviderMetadata): vscode.Disposable {
				return extHostLanguageFeatures.registerCodeActionProvider(extension, checkSelector(selector), provider, metadata);
			},
			registerCodeLensProvider(selector: vscode.DocumentSelector, provider: vscode.CodeLensProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerCodeLensProvider(extension, checkSelector(selector), provider);
			},
			registerCodeInsetProvider(selector: vscode.DocumentSelector, provider: vscode.CodeInsetProvider): vscode.Disposable {
				checkProposedApiEnabled(extension);
				return extHostLanguageFeatures.registerCodeInsetProvider(extension, checkSelector(selector), provider);
			},
			registerDefinitionProvider(selector: vscode.DocumentSelector, provider: vscode.DefinitionProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerDefinitionProvider(extension, checkSelector(selector), provider);
			},
			registerDeclarationProvider(selector: vscode.DocumentSelector, provider: vscode.DeclarationProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerDeclarationProvider(extension, checkSelector(selector), provider);
			},
			registerImplementationProvider(selector: vscode.DocumentSelector, provider: vscode.ImplementationProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerImplementationProvider(extension, checkSelector(selector), provider);
			},
			registerTypeDefinitionProvider(selector: vscode.DocumentSelector, provider: vscode.TypeDefinitionProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerTypeDefinitionProvider(extension, checkSelector(selector), provider);
			},
			registerHoverProvider(selector: vscode.DocumentSelector, provider: vscode.HoverProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerHoverProvider(extension, checkSelector(selector), provider, extension.identifier);
			},
			registerDocumentHighlightProvider(selector: vscode.DocumentSelector, provider: vscode.DocumentHighlightProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerDocumentHighlightProvider(extension, checkSelector(selector), provider);
			},
			registerReferenceProvider(selector: vscode.DocumentSelector, provider: vscode.ReferenceProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerReferenceProvider(extension, checkSelector(selector), provider);
			},
			registerRenameProvider(selector: vscode.DocumentSelector, provider: vscode.RenameProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerRenameProvider(extension, checkSelector(selector), provider);
			},
			registerDocumentSymbolProvider(selector: vscode.DocumentSelector, provider: vscode.DocumentSymbolProvider, metadata?: vscode.DocumentSymbolProviderMetadata): vscode.Disposable {
				return extHostLanguageFeatures.registerDocumentSymbolProvider(extension, checkSelector(selector), provider, metadata);
			},
			registerWorkspaceSymbolProvider(provider: vscode.WorkspaceSymbolProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerWorkspaceSymbolProvider(extension, provider);
			},
			registerDocumentFormattingEditProvider(selector: vscode.DocumentSelector, provider: vscode.DocumentFormattingEditProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerDocumentFormattingEditProvider(extension, checkSelector(selector), provider);
			},
			registerDocumentRangeFormattingEditProvider(selector: vscode.DocumentSelector, provider: vscode.DocumentRangeFormattingEditProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerDocumentRangeFormattingEditProvider(extension, checkSelector(selector), provider);
			},
			registerOnTypeFormattingEditProvider(selector: vscode.DocumentSelector, provider: vscode.OnTypeFormattingEditProvider, firstTriggerCharacter: string, ...moreTriggerCharacters: string[]): vscode.Disposable {
				return extHostLanguageFeatures.registerOnTypeFormattingEditProvider(extension, checkSelector(selector), provider, [firstTriggerCharacter].concat(moreTriggerCharacters));
			},
			registerSignatureHelpProvider(selector: vscode.DocumentSelector, provider: vscode.SignatureHelpProvider, firstItem?: string | vscode.SignatureHelpProviderMetadata, ...remaining: string[]): vscode.Disposable {
				if (typeof firstItem === 'object') {
					return extHostLanguageFeatures.registerSignatureHelpProvider(extension, checkSelector(selector), provider, firstItem);
				}
				return extHostLanguageFeatures.registerSignatureHelpProvider(extension, checkSelector(selector), provider, typeof firstItem === 'undefined' ? [] : [firstItem, ...remaining]);
			},
			registerCompletionItemProvider(selector: vscode.DocumentSelector, provider: vscode.CompletionItemProvider, ...triggerCharacters: string[]): vscode.Disposable {
				return extHostLanguageFeatures.registerCompletionItemProvider(extension, checkSelector(selector), provider, triggerCharacters);
			},
			registerDocumentLinkProvider(selector: vscode.DocumentSelector, provider: vscode.DocumentLinkProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerDocumentLinkProvider(extension, checkSelector(selector), provider);
			},
			registerColorProvider(selector: vscode.DocumentSelector, provider: vscode.DocumentColorProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerColorProvider(extension, checkSelector(selector), provider);
			},
			registerFoldingRangeProvider(selector: vscode.DocumentSelector, provider: vscode.FoldingRangeProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerFoldingRangeProvider(extension, checkSelector(selector), provider);
			},
			registerSelectionRangeProvider(selector: vscode.DocumentSelector, provider: vscode.SelectionRangeProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerSelectionRangeProvider(extension, selector, provider);
			},
			registerCallHierarchyProvider(selector: vscode.DocumentSelector, provider: vscode.CallHierarchyItemProvider): vscode.Disposable {
				checkProposedApiEnabled(extension);
				return extHostLanguageFeatures.registerCallHierarchyProvider(extension, selector, provider);
			},
			setLanguageConfiguration: (language: string, configuration: vscode.LanguageConfiguration): vscode.Disposable => {
				return extHostLanguageFeatures.setLanguageConfiguration(language, configuration);
			}
		};

		// namespace: window
		const window: typeof vscode.window = {
			get activeTextEditor() {
				return extHostEditors.getActiveTextEditor();
			},
			get visibleTextEditors() {
				return extHostEditors.getVisibleTextEditors();
			},
			get activeTerminal() {
				return extHostTerminalService.activeTerminal;
			},
			get terminals() {
				return extHostTerminalService.terminals;
			},
			showTextDocument(documentOrUri: vscode.TextDocument | vscode.Uri, columnOrOptions?: vscode.ViewColumn | vscode.TextDocumentShowOptions, preserveFocus?: boolean): Thenable<vscode.TextEditor> {
				let documentPromise: Promise<vscode.TextDocument>;
				if (URI.isUri(documentOrUri)) {
					documentPromise = Promise.resolve(workspace.openTextDocument(documentOrUri));
				} else {
					documentPromise = Promise.resolve(<vscode.TextDocument>documentOrUri);
				}
				return documentPromise.then(document => {
					return extHostEditors.showTextDocument(document, columnOrOptions, preserveFocus);
				});
			},
			createTextEditorDecorationType(options: vscode.DecorationRenderOptions): vscode.TextEditorDecorationType {
				return extHostEditors.createTextEditorDecorationType(options);
			},
			onDidChangeActiveTextEditor(listener, thisArg?, disposables?) {
				return extHostEditors.onDidChangeActiveTextEditor(listener, thisArg, disposables);
			},
			onDidChangeVisibleTextEditors(listener, thisArg, disposables) {
				return extHostEditors.onDidChangeVisibleTextEditors(listener, thisArg, disposables);
			},
			onDidChangeTextEditorSelection(listener: (e: vscode.TextEditorSelectionChangeEvent) => any, thisArgs?: any, disposables?: extHostTypes.Disposable[]) {
				return extHostEditors.onDidChangeTextEditorSelection(listener, thisArgs, disposables);
			},
			onDidChangeTextEditorOptions(listener: (e: vscode.TextEditorOptionsChangeEvent) => any, thisArgs?: any, disposables?: extHostTypes.Disposable[]) {
				return extHostEditors.onDidChangeTextEditorOptions(listener, thisArgs, disposables);
			},
			onDidChangeTextEditorVisibleRanges(listener: (e: vscode.TextEditorVisibleRangesChangeEvent) => any, thisArgs?: any, disposables?: extHostTypes.Disposable[]) {
				return extHostEditors.onDidChangeTextEditorVisibleRanges(listener, thisArgs, disposables);
			},
			onDidChangeTextEditorViewColumn(listener, thisArg?, disposables?) {
				return extHostEditors.onDidChangeTextEditorViewColumn(listener, thisArg, disposables);
			},
			onDidCloseTerminal(listener, thisArg?, disposables?) {
				return extHostTerminalService.onDidCloseTerminal(listener, thisArg, disposables);
			},
			onDidOpenTerminal(listener, thisArg?, disposables?) {
				return extHostTerminalService.onDidOpenTerminal(listener, thisArg, disposables);
			},
			onDidChangeActiveTerminal(listener, thisArg?, disposables?) {
				return extHostTerminalService.onDidChangeActiveTerminal(listener, thisArg, disposables);
			},
			onDidChangeTerminalDimensions(listener, thisArg?, disposables?) {
				return extHostTerminalService.onDidChangeTerminalDimensions(listener, thisArg, disposables);
			},
			get state() {
				return extHostWindow.state;
			},
			onDidChangeWindowState(listener, thisArg?, disposables?) {
				return extHostWindow.onDidChangeWindowState(listener, thisArg, disposables);
			},
			showInformationMessage(message: string, first: vscode.MessageOptions | string | vscode.MessageItem, ...rest: Array<string | vscode.MessageItem>) {
				return extHostMessageService.showMessage(extension, Severity.Info, message, first, rest);
			},
			showWarningMessage(message: string, first: vscode.MessageOptions | string | vscode.MessageItem, ...rest: Array<string | vscode.MessageItem>) {
				return extHostMessageService.showMessage(extension, Severity.Warning, message, first, rest);
			},
			showErrorMessage(message: string, first: vscode.MessageOptions | string | vscode.MessageItem, ...rest: Array<string | vscode.MessageItem>) {
				return extHostMessageService.showMessage(extension, Severity.Error, message, first, rest);
			},
			showQuickPick(items: any, options: vscode.QuickPickOptions, token?: vscode.CancellationToken): any {
				return extHostQuickOpen.showQuickPick(items, !!extension.enableProposedApi, options, token);
			},
			showWorkspaceFolderPick(options: vscode.WorkspaceFolderPickOptions) {
				return extHostQuickOpen.showWorkspaceFolderPick(options);
			},
			showInputBox(options?: vscode.InputBoxOptions, token?: vscode.CancellationToken) {
				return extHostQuickOpen.showInput(options, token);
			},
			showOpenDialog(options) {
				return extHostDialogs.showOpenDialog(options);
			},
			showSaveDialog(options) {
				return extHostDialogs.showSaveDialog(options);
			},
			createStatusBarItem(position?: vscode.StatusBarAlignment, priority?: number): vscode.StatusBarItem {
				return extHostStatusBar.createStatusBarEntry(extension.identifier, <number>position, priority);
			},
			setStatusBarMessage(text: string, timeoutOrThenable?: number | Thenable<any>): vscode.Disposable {
				return extHostStatusBar.setStatusBarMessage(text, timeoutOrThenable);
			},
			withScmProgress<R>(task: (progress: vscode.Progress<number>) => Thenable<R>) {
				console.warn(`[Deprecation Warning] function 'withScmProgress' is deprecated and should no longer be used. Use 'withProgress' instead.`);
				return extHostProgress.withProgress(extension, { location: extHostTypes.ProgressLocation.SourceControl }, (progress, token) => task({ report(n: number) { /*noop*/ } }));
			},
			withProgress<R>(options: vscode.ProgressOptions, task: (progress: vscode.Progress<{ message?: string; worked?: number }>, token: vscode.CancellationToken) => Thenable<R>) {
				return extHostProgress.withProgress(extension, options, task);
			},
			createOutputChannel(name: string): vscode.OutputChannel {
				return extHostOutputService.createOutputChannel(name);
			},
			createWebviewPanel(viewType: string, title: string, showOptions: vscode.ViewColumn | { viewColumn: vscode.ViewColumn, preserveFocus?: boolean }, options: vscode.WebviewPanelOptions & vscode.WebviewOptions): vscode.WebviewPanel {
				return extHostWebviews.createWebviewPanel(extension, viewType, title, showOptions, options);
			},
			createTerminal(nameOrOptions?: vscode.TerminalOptions | string, shellPath?: string, shellArgs?: string[] | string): vscode.Terminal {
				if (typeof nameOrOptions === 'object') {
					return extHostTerminalService.createTerminalFromOptions(<vscode.TerminalOptions>nameOrOptions);
				}
				return extHostTerminalService.createTerminal(<string>nameOrOptions, shellPath, shellArgs);
			},
			createTerminalRenderer(name: string): vscode.TerminalRenderer {
				return extHostTerminalService.createTerminalRenderer(name);
			},
			registerTreeDataProvider(viewId: string, treeDataProvider: vscode.TreeDataProvider<any>): vscode.Disposable {
				return extHostTreeViews.registerTreeDataProvider(viewId, treeDataProvider, extension);
			},
			createTreeView(viewId: string, options: { treeDataProvider: vscode.TreeDataProvider<any> }): vscode.TreeView<any> {
				return extHostTreeViews.createTreeView(viewId, options, extension);
			},
			registerWebviewPanelSerializer: (viewType: string, serializer: vscode.WebviewPanelSerializer) => {
				return extHostWebviews.registerWebviewPanelSerializer(viewType, serializer);
			},
			registerDecorationProvider: proposedApiFunction(extension, (provider: vscode.DecorationProvider) => {
				return extHostDecorations.registerDecorationProvider(provider, extension.identifier);
			}),
			registerUriHandler(handler: vscode.UriHandler) {
				return extHostUrls.registerUriHandler(extension.identifier, handler);
			},
			createQuickPick<T extends vscode.QuickPickItem>(): vscode.QuickPick<T> {
				return extHostQuickOpen.createQuickPick(extension.identifier, !!extension.enableProposedApi);
			},
			createInputBox(): vscode.InputBox {
				return extHostQuickOpen.createInputBox(extension.identifier);
			}
		};

		// namespace: workspace
		const workspace: typeof vscode.workspace = {
			get rootPath() {
				return extHostWorkspace.getPath();
			},
			set rootPath(value) {
				throw errors.readonly();
			},
			getWorkspaceFolder(resource) {
				return extHostWorkspace.getWorkspaceFolder(resource);
			},
			get workspaceFolders() {
				return extHostWorkspace.getWorkspaceFolders();
			},
			get name() {
				return extHostWorkspace.name;
			},
			set name(value) {
				throw errors.readonly();
			},
			get workspaceFile() {
				return extHostWorkspace.workspaceFile;
			},
			set workspaceFile(value) {
				throw errors.readonly();
			},
			updateWorkspaceFolders: (index, deleteCount, ...workspaceFoldersToAdd) => {
				return extHostWorkspace.updateWorkspaceFolders(extension, index, deleteCount || 0, ...workspaceFoldersToAdd);
			},
			onDidChangeWorkspaceFolders: function (listener, thisArgs?, disposables?) {
				return extHostWorkspace.onDidChangeWorkspace(listener, thisArgs, disposables);
			},
			asRelativePath: (pathOrUri, includeWorkspace?) => {
				return extHostWorkspace.getRelativePath(pathOrUri, includeWorkspace);
			},
			findFiles: (include, exclude, maxResults?, token?) => {
				return extHostWorkspace.findFiles(typeConverters.GlobPattern.from(include), typeConverters.GlobPattern.from(withNullAsUndefined(exclude)), maxResults, extension.identifier, token);
			},
			findTextInFiles: (query: vscode.TextSearchQuery, optionsOrCallback: vscode.FindTextInFilesOptions | ((result: vscode.TextSearchResult) => void), callbackOrToken?: vscode.CancellationToken | ((result: vscode.TextSearchResult) => void), token?: vscode.CancellationToken) => {
				let options: vscode.FindTextInFilesOptions;
				let callback: (result: vscode.TextSearchResult) => void;

				if (typeof optionsOrCallback === 'object') {
					options = optionsOrCallback;
					callback = callbackOrToken as (result: vscode.TextSearchResult) => void;
				} else {
					options = {};
					callback = optionsOrCallback;
					token = callbackOrToken as vscode.CancellationToken;
				}

				return extHostWorkspace.findTextInFiles(query, options || {}, callback, extension.identifier, token);
			},
			saveAll: (includeUntitled?) => {
				return extHostWorkspace.saveAll(includeUntitled);
			},
			applyEdit(edit: vscode.WorkspaceEdit): Thenable<boolean> {
				return extHostEditors.applyWorkspaceEdit(edit);
			},
			createFileSystemWatcher: (pattern, ignoreCreate, ignoreChange, ignoreDelete): vscode.FileSystemWatcher => {
				return extHostFileSystemEvent.createFileSystemWatcher(typeConverters.GlobPattern.from(pattern), ignoreCreate, ignoreChange, ignoreDelete);
			},
			get textDocuments() {
				return extHostDocuments.getAllDocumentData().map(data => data.document);
			},
			set textDocuments(value) {
				throw errors.readonly();
			},
			openTextDocument(uriOrFileNameOrOptions?: vscode.Uri | string | { language?: string; content?: string; }) {
				let uriPromise: Thenable<URI>;

				const options = uriOrFileNameOrOptions as { language?: string; content?: string; };
				if (typeof uriOrFileNameOrOptions === 'string') {
					uriPromise = Promise.resolve(URI.file(uriOrFileNameOrOptions));
				} else if (uriOrFileNameOrOptions instanceof URI) {
					uriPromise = Promise.resolve(uriOrFileNameOrOptions);
				} else if (!options || typeof options === 'object') {
					uriPromise = extHostDocuments.createDocumentData(options);
				} else {
					throw new Error('illegal argument - uriOrFileNameOrOptions');
				}

				return uriPromise.then(uri => {
					return extHostDocuments.ensureDocumentData(uri).then(() => {
						return extHostDocuments.getDocument(uri);
					});
				});
			},
			onDidOpenTextDocument: (listener, thisArgs?, disposables?) => {
				return extHostDocuments.onDidAddDocument(listener, thisArgs, disposables);
			},
			onDidCloseTextDocument: (listener, thisArgs?, disposables?) => {
				return extHostDocuments.onDidRemoveDocument(listener, thisArgs, disposables);
			},
			onDidChangeTextDocument: (listener, thisArgs?, disposables?) => {
				return extHostDocuments.onDidChangeDocument(listener, thisArgs, disposables);
			},
			onDidSaveTextDocument: (listener, thisArgs?, disposables?) => {
				return extHostDocuments.onDidSaveDocument(listener, thisArgs, disposables);
			},
			onWillSaveTextDocument: (listener, thisArgs?, disposables?) => {
				return extHostDocumentSaveParticipant.getOnWillSaveTextDocumentEvent(extension)(listener, thisArgs, disposables);
			},
			onDidChangeConfiguration: (listener: (_: any) => any, thisArgs?: any, disposables?: extHostTypes.Disposable[]) => {
				return configProvider.onDidChangeConfiguration(listener, thisArgs, disposables);
			},
			getConfiguration(section?: string, resource?: vscode.Uri): vscode.WorkspaceConfiguration {
				resource = arguments.length === 1 ? undefined : resource;
				return configProvider.getConfiguration(section, resource, extension.identifier);
			},
			registerTextDocumentContentProvider(scheme: string, provider: vscode.TextDocumentContentProvider) {
				return extHostDocumentContentProviders.registerTextDocumentContentProvider(scheme, provider);
			},
			registerTaskProvider: (type: string, provider: vscode.TaskProvider) => {
				return extHostTask.registerTaskProvider(extension, provider);
			},
			registerFileSystemProvider(scheme, provider, options) {
				return extHostFileSystem.registerFileSystemProvider(scheme, provider, options);
			},
			registerFileSearchProvider: proposedApiFunction(extension, (scheme: string, provider: vscode.FileSearchProvider) => {
				return extHostSearch.registerFileSearchProvider(scheme, provider);
			}),
			registerTextSearchProvider: proposedApiFunction(extension, (scheme: string, provider: vscode.TextSearchProvider) => {
				return extHostSearch.registerTextSearchProvider(scheme, provider);
			}),
			registerDocumentCommentProvider: proposedApiFunction(extension, (provider: vscode.DocumentCommentProvider) => {
				return extHostComment.registerDocumentCommentProvider(extension.identifier, provider);
			}),
			registerWorkspaceCommentProvider: proposedApiFunction(extension, (provider: vscode.WorkspaceCommentProvider) => {
				return extHostComment.registerWorkspaceCommentProvider(extension.identifier, provider);
			}),
			registerRemoteAuthorityResolver: proposedApiFunction(extension, (authorityPrefix: string, resolver: vscode.RemoteAuthorityResolver) => {
				return extensionService.registerRemoteAuthorityResolver(authorityPrefix, resolver);
			}),
			registerResourceLabelFormatter: proposedApiFunction(extension, (formatter: vscode.ResourceLabelFormatter) => {
				return extHostFileSystem.registerResourceLabelFormatter(formatter);
			}),
			onDidRenameFile: proposedApiFunction(extension, (listener: (e: vscode.FileRenameEvent) => any, thisArg?: any, disposables?: vscode.Disposable[]) => {
				return extHostFileSystemEvent.onDidRenameFile(listener, thisArg, disposables);
			}),
			onWillRenameFile: proposedApiFunction(extension, (listener: (e: vscode.FileWillRenameEvent) => any, thisArg?: any, disposables?: vscode.Disposable[]) => {
				return extHostFileSystemEvent.getOnWillRenameFileEvent(extension)(listener, thisArg, disposables);
			})
		};

		// namespace: scm
		const scm: typeof vscode.scm = {
			get inputBox() {
				return extHostSCM.getLastInputBox(extension)!; // Strict null override - Deprecated api
			},
			createSourceControl(id: string, label: string, rootUri?: vscode.Uri) {
				return extHostSCM.createSourceControl(extension, id, label, rootUri);
			}
		};

		const comment: typeof vscode.comment = {
			createCommentController(id: string, label: string) {
				return extHostComment.createCommentController(extension, id, label);
			}
		};

		// namespace: debug
		const debug: typeof vscode.debug = {
			get activeDebugSession() {
				return extHostDebugService.activeDebugSession;
			},
			get activeDebugConsole() {
				return extHostDebugService.activeDebugConsole;
			},
			get breakpoints() {
				return extHostDebugService.breakpoints;
			},
			onDidStartDebugSession(listener, thisArg?, disposables?) {
				return extHostDebugService.onDidStartDebugSession(listener, thisArg, disposables);
			},
			onDidTerminateDebugSession(listener, thisArg?, disposables?) {
				return extHostDebugService.onDidTerminateDebugSession(listener, thisArg, disposables);
			},
			onDidChangeActiveDebugSession(listener, thisArg?, disposables?) {
				return extHostDebugService.onDidChangeActiveDebugSession(listener, thisArg, disposables);
			},
			onDidReceiveDebugSessionCustomEvent(listener, thisArg?, disposables?) {
				return extHostDebugService.onDidReceiveDebugSessionCustomEvent(listener, thisArg, disposables);
			},
			onDidChangeBreakpoints(listener, thisArgs?, disposables?) {
				return extHostDebugService.onDidChangeBreakpoints(listener, thisArgs, disposables);
			},
			registerDebugConfigurationProvider(debugType: string, provider: vscode.DebugConfigurationProvider) {
				return extHostDebugService.registerDebugConfigurationProvider(debugType, provider);
			},
			registerDebugAdapterDescriptorFactory(debugType: string, factory: vscode.DebugAdapterDescriptorFactory) {
				return extHostDebugService.registerDebugAdapterDescriptorFactory(extension, debugType, factory);
			},
			registerDebugAdapterTrackerFactory(debugType: string, factory: vscode.DebugAdapterTrackerFactory) {
				return extHostDebugService.registerDebugAdapterTrackerFactory(debugType, factory);
			},
			startDebugging(folder: vscode.WorkspaceFolder | undefined, nameOrConfig: string | vscode.DebugConfiguration, parentSession?: vscode.DebugSession) {
				return extHostDebugService.startDebugging(folder, nameOrConfig, parentSession);
			},
			addBreakpoints(breakpoints: vscode.Breakpoint[]) {
				return extHostDebugService.addBreakpoints(breakpoints);
			},
			removeBreakpoints(breakpoints: vscode.Breakpoint[]) {
				return extHostDebugService.removeBreakpoints(breakpoints);
			}
		};

		const tasks: typeof vscode.tasks = {
			registerTaskProvider: (type: string, provider: vscode.TaskProvider) => {
				return extHostTask.registerTaskProvider(extension, provider);
			},
			fetchTasks: (filter?: vscode.TaskFilter): Thenable<vscode.Task[]> => {
				return extHostTask.fetchTasks(filter);
			},
			executeTask: (task: vscode.Task): Thenable<vscode.TaskExecution> => {
				return extHostTask.executeTask(extension, task);
			},
			get taskExecutions(): vscode.TaskExecution[] {
				return extHostTask.taskExecutions;
			},
			onDidStartTask: (listeners, thisArgs?, disposables?) => {
				return extHostTask.onDidStartTask(listeners, thisArgs, disposables);
			},
			onDidEndTask: (listeners, thisArgs?, disposables?) => {
				return extHostTask.onDidEndTask(listeners, thisArgs, disposables);
			},
			onDidStartTaskProcess: (listeners, thisArgs?, disposables?) => {
				return extHostTask.onDidStartTaskProcess(listeners, thisArgs, disposables);
			},
			onDidEndTaskProcess: (listeners, thisArgs?, disposables?) => {
				return extHostTask.onDidEndTaskProcess(listeners, thisArgs, disposables);
			}
		};

		return <typeof vscode>{
			version: initData.version,
			// namespaces
			commands,
			debug,
			env,
			extensions,
			languages,
			scm,
			comment,
			tasks,
			window,
			workspace,
			// types
			Breakpoint: extHostTypes.Breakpoint,
			CancellationTokenSource: CancellationTokenSource,
			CodeAction: extHostTypes.CodeAction,
			CodeActionKind: extHostTypes.CodeActionKind,
			CodeActionTrigger: extHostTypes.CodeActionTrigger,
			CodeLens: extHostTypes.CodeLens,
			CodeInset: extHostTypes.CodeInset,
			Color: extHostTypes.Color,
			ColorInformation: extHostTypes.ColorInformation,
			ColorPresentation: extHostTypes.ColorPresentation,
			Comment: extHostTypes.Comment,
			CommentLegacy: extHostTypes.Comment,
			CommentThreadCollapsibleState: extHostTypes.CommentThreadCollapsibleState,
			CompletionItem: extHostTypes.CompletionItem,
			CompletionItemKind: extHostTypes.CompletionItemKind,
			CompletionList: extHostTypes.CompletionList,
			CompletionTriggerKind: extHostTypes.CompletionTriggerKind,
			ConfigurationTarget: extHostTypes.ConfigurationTarget,
			DebugAdapterExecutable: extHostTypes.DebugAdapterExecutable,
			DebugAdapterServer: extHostTypes.DebugAdapterServer,
			DecorationRangeBehavior: extHostTypes.DecorationRangeBehavior,
			Diagnostic: extHostTypes.Diagnostic,
			DiagnosticRelatedInformation: extHostTypes.DiagnosticRelatedInformation,
			DiagnosticSeverity: extHostTypes.DiagnosticSeverity,
			DiagnosticTag: extHostTypes.DiagnosticTag,
			Disposable: extHostTypes.Disposable,
			DocumentHighlight: extHostTypes.DocumentHighlight,
			DocumentHighlightKind: extHostTypes.DocumentHighlightKind,
			DocumentLink: extHostTypes.DocumentLink,
			DocumentSymbol: extHostTypes.DocumentSymbol,
			EndOfLine: extHostTypes.EndOfLine,
			EventEmitter: Emitter,
			CustomExecution: extHostTypes.CustomExecution,
			FileChangeType: extHostTypes.FileChangeType,
			FileSystemError: extHostTypes.FileSystemError,
			FileType: files.FileType,
			FoldingRange: extHostTypes.FoldingRange,
			FoldingRangeKind: extHostTypes.FoldingRangeKind,
			FunctionBreakpoint: extHostTypes.FunctionBreakpoint,
			Hover: extHostTypes.Hover,
			IndentAction: languageConfiguration.IndentAction,
			Location: extHostTypes.Location,
			LogLevel: extHostTypes.LogLevel,
			MarkdownString: extHostTypes.MarkdownString,
			OverviewRulerLane: OverviewRulerLane,
			ParameterInformation: extHostTypes.ParameterInformation,
			Position: extHostTypes.Position,
			ProcessExecution: extHostTypes.ProcessExecution,
			ProgressLocation: extHostTypes.ProgressLocation,
			QuickInputButtons: extHostTypes.QuickInputButtons,
			Range: extHostTypes.Range,
			RelativePattern: extHostTypes.RelativePattern,
			ResolvedAuthority: extHostTypes.ResolvedAuthority,
			RemoteAuthorityResolverError: extHostTypes.RemoteAuthorityResolverError,
			Selection: extHostTypes.Selection,
			SelectionRange: extHostTypes.SelectionRange,
			ShellExecution: extHostTypes.ShellExecution,
			ShellQuoting: extHostTypes.ShellQuoting,
			SignatureHelpTriggerKind: extHostTypes.SignatureHelpTriggerKind,
			SignatureHelp: extHostTypes.SignatureHelp,
			SignatureInformation: extHostTypes.SignatureInformation,
			SnippetString: extHostTypes.SnippetString,
			SourceBreakpoint: extHostTypes.SourceBreakpoint,
			SourceControlInputBoxValidationType: extHostTypes.SourceControlInputBoxValidationType,
			StatusBarAlignment: extHostTypes.StatusBarAlignment,
			SymbolInformation: extHostTypes.SymbolInformation,
			SymbolKind: extHostTypes.SymbolKind,
			Task: extHostTypes.Task,
			Task2: extHostTypes.Task,
			TaskGroup: extHostTypes.TaskGroup,
			TaskPanelKind: extHostTypes.TaskPanelKind,
			TaskRevealKind: extHostTypes.TaskRevealKind,
			TaskScope: extHostTypes.TaskScope,
			TextDocumentSaveReason: extHostTypes.TextDocumentSaveReason,
			TextEdit: extHostTypes.TextEdit,
			TextEditorCursorStyle: TextEditorCursorStyle,
			TextEditorLineNumbersStyle: extHostTypes.TextEditorLineNumbersStyle,
			TextEditorRevealType: extHostTypes.TextEditorRevealType,
			TextEditorSelectionChangeKind: extHostTypes.TextEditorSelectionChangeKind,
			ThemeColor: extHostTypes.ThemeColor,
			ThemeIcon: extHostTypes.ThemeIcon,
			TreeItem: extHostTypes.TreeItem,
			TreeItem2: extHostTypes.TreeItem,
			TreeItemCollapsibleState: extHostTypes.TreeItemCollapsibleState,
			Uri: URI,
			ViewColumn: extHostTypes.ViewColumn,
			WorkspaceEdit: extHostTypes.WorkspaceEdit,
			// proposed
			CallHierarchyDirection: extHostTypes.CallHierarchyDirection,
			CallHierarchyItem: extHostTypes.CallHierarchyItem
		};
	};
}

class Extension<T> implements vscode.Extension<T> {

	private _extensionService: ExtHostExtensionService;
	private _identifier: ExtensionIdentifier;

	public id: string;
	public extensionPath: string;
	public packageJSON: IExtensionDescription;

	constructor(extensionService: ExtHostExtensionService, description: IExtensionDescription) {
		this._extensionService = extensionService;
		this._identifier = description.identifier;
		this.id = description.identifier.value;
		this.extensionPath = path.normalize(originalFSPath(description.extensionLocation));
		this.packageJSON = description;
	}

	get isActive(): boolean {
		return this._extensionService.isActivated(this._identifier);
	}

	get exports(): T {
		if (this.packageJSON.api === 'none') {
			return undefined!; // Strict nulloverride - Public api
		}
		return <T>this._extensionService.getExtensionExports(this._identifier);
	}

	activate(): Thenable<T> {
		return this._extensionService.activateByIdWithErrors(this._identifier, new ExtensionActivatedByAPI(false)).then(() => this.exports);
	}
}
