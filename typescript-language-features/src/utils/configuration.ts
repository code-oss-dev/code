/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as objects from '../utils/objects';

export enum TsServerLogLevel {
	Off,
	Normal,
	Terse,
	Verbose,
}

export namespace TsServerLogLevel {
	export function fromString(value: string): TsServerLogLevel {
		switch (value && value.toLowerCase()) {
			case 'normal':
				return TsServerLogLevel.Normal;
			case 'terse':
				return TsServerLogLevel.Terse;
			case 'verbose':
				return TsServerLogLevel.Verbose;
			case 'off':
			default:
				return TsServerLogLevel.Off;
		}
	}

	export function toString(value: TsServerLogLevel): string {
		switch (value) {
			case TsServerLogLevel.Normal:
				return 'normal';
			case TsServerLogLevel.Terse:
				return 'terse';
			case TsServerLogLevel.Verbose:
				return 'verbose';
			case TsServerLogLevel.Off:
			default:
				return 'off';
		}
	}
}

export const enum SeparateSyntaxServerConfiguration {
	Disabled,
	Enabled,
	/** Use a single syntax server for every request, even on desktop */
	ForAllRequests,
}

export class ImplicitProjectConfiguration {

	public readonly checkJs: boolean;
	public readonly experimentalDecorators: boolean;
	public readonly strictNullChecks: boolean;
	public readonly strictFunctionTypes: boolean;

	constructor(configuration: vscode.WorkspaceConfiguration) {
		this.checkJs = ImplicitProjectConfiguration.readCheckJs(configuration);
		this.experimentalDecorators = ImplicitProjectConfiguration.readExperimentalDecorators(configuration);
		this.strictNullChecks = ImplicitProjectConfiguration.readImplicitStrictNullChecks(configuration);
		this.strictFunctionTypes = ImplicitProjectConfiguration.readImplicitStrictFunctionTypes(configuration);
	}

	public isEqualTo(other: ImplicitProjectConfiguration): boolean {
		return objects.equals(this, other);
	}

	private static readCheckJs(configuration: vscode.WorkspaceConfiguration): boolean {
		return configuration.get<boolean>('js/ts.implicitProjectConfig.checkJs')
			?? configuration.get<boolean>('javascript.implicitProjectConfig.checkJs', false);
	}

	private static readExperimentalDecorators(configuration: vscode.WorkspaceConfiguration): boolean {
		return configuration.get<boolean>('js/ts.implicitProjectConfig.experimentalDecorators')
			?? configuration.get<boolean>('javascript.implicitProjectConfig.experimentalDecorators', false);
	}

	private static readImplicitStrictNullChecks(configuration: vscode.WorkspaceConfiguration): boolean {
		return configuration.get<boolean>('js/ts.implicitProjectConfig.strictNullChecks', false);
	}

	private static readImplicitStrictFunctionTypes(configuration: vscode.WorkspaceConfiguration): boolean {
		return configuration.get<boolean>('js/ts.implicitProjectConfig.strictFunctionTypes', true);
	}
}

export interface TypeScriptServiceConfiguration {
	readonly locale: string | null;
	readonly globalTsdk: string | null;
	readonly localTsdk: string | null;
	readonly npmLocation: string | null;
	readonly tsServerLogLevel: TsServerLogLevel;
	readonly tsServerPluginPaths: readonly string[];
	readonly implicitProjectConfiguration: ImplicitProjectConfiguration;
	readonly disableAutomaticTypeAcquisition: boolean;
	readonly separateSyntaxServer: SeparateSyntaxServerConfiguration;
	readonly enableProjectDiagnostics: boolean;
	readonly maxTsServerMemory: number;
	readonly enablePromptUseWorkspaceTsdk: boolean;
	readonly watchOptions: protocol.WatchOptions | undefined;
	readonly includePackageJsonAutoImports: 'auto' | 'on' | 'off' | undefined;
	readonly enableTsServerTracing: boolean;
}

export function areServiceConfigurationsEqual(a: TypeScriptServiceConfiguration, b: TypeScriptServiceConfiguration): boolean {
	return objects.equals(a, b);
}

export function loadServiceConfigurationFromWorkspace(): TypeScriptServiceConfiguration {
	const configuration = vscode.workspace.getConfiguration();
	return {
		locale: extractLocale(configuration),
		globalTsdk: extractGlobalTsdk(configuration),
		localTsdk: extractLocalTsdk(configuration),
		npmLocation: readNpmLocation(configuration),
		tsServerLogLevel: readTsServerLogLevel(configuration),
		tsServerPluginPaths: readTsServerPluginPaths(configuration),
		implicitProjectConfiguration: new ImplicitProjectConfiguration(configuration),
		disableAutomaticTypeAcquisition: readDisableAutomaticTypeAcquisition(configuration),
		separateSyntaxServer: readUseSeparateSyntaxServer(configuration),
		enableProjectDiagnostics: readEnableProjectDiagnostics(configuration),
		maxTsServerMemory: readMaxTsServerMemory(configuration),
		enablePromptUseWorkspaceTsdk: readEnablePromptUseWorkspaceTsdk(configuration),
		watchOptions: readWatchOptions(configuration),
		includePackageJsonAutoImports: readIncludePackageJsonAutoImports(configuration),
		enableTsServerTracing: readEnableTsServerTracing(configuration),
	};
}

function fixPathPrefixes(inspectValue: string): string {
	const pathPrefixes = ['~' + path.sep];
	for (const pathPrefix of pathPrefixes) {
		if (inspectValue.startsWith(pathPrefix)) {
			return path.join(os.homedir(), inspectValue.slice(pathPrefix.length));
		}
	}
	return inspectValue;
}

function extractGlobalTsdk(configuration: vscode.WorkspaceConfiguration): string | null {
	const inspect = configuration.inspect('typescript.tsdk');
	if (inspect && typeof inspect.globalValue === 'string') {
		return fixPathPrefixes(inspect.globalValue);
	}
	return null;
}

function extractLocalTsdk(configuration: vscode.WorkspaceConfiguration): string | null {
	const inspect = configuration.inspect('typescript.tsdk');
	if (inspect && typeof inspect.workspaceValue === 'string') {
		return fixPathPrefixes(inspect.workspaceValue);
	}
	return null;
}

function readTsServerLogLevel(configuration: vscode.WorkspaceConfiguration): TsServerLogLevel {
	const setting = configuration.get<string>('typescript.tsserver.log', 'off');
	return TsServerLogLevel.fromString(setting);
}

function readTsServerPluginPaths(configuration: vscode.WorkspaceConfiguration): string[] {
	return configuration.get<string[]>('typescript.tsserver.pluginPaths', []);
}

function readNpmLocation(configuration: vscode.WorkspaceConfiguration): string | null {
	return configuration.get<string | null>('typescript.npm', null);
}

function readDisableAutomaticTypeAcquisition(configuration: vscode.WorkspaceConfiguration): boolean {
	return configuration.get<boolean>('typescript.disableAutomaticTypeAcquisition', false);
}

function extractLocale(configuration: vscode.WorkspaceConfiguration): string | null {
	return configuration.get<string | null>('typescript.locale', null);
}

function readUseSeparateSyntaxServer(configuration: vscode.WorkspaceConfiguration): SeparateSyntaxServerConfiguration {
	const value = configuration.get<boolean | string>('typescript.tsserver.useSeparateSyntaxServer', true);
	if (value === 'forAllRequests') {
		return SeparateSyntaxServerConfiguration.ForAllRequests;
	}
	if (value === true) {
		return SeparateSyntaxServerConfiguration.Enabled;
	}
	return SeparateSyntaxServerConfiguration.Disabled;
}

function readEnableProjectDiagnostics(configuration: vscode.WorkspaceConfiguration): boolean {
	return configuration.get<boolean>('typescript.tsserver.experimental.enableProjectDiagnostics', false);
}

function readWatchOptions(configuration: vscode.WorkspaceConfiguration): protocol.WatchOptions | undefined {
	return configuration.get<protocol.WatchOptions>('typescript.tsserver.watchOptions');
}

function readIncludePackageJsonAutoImports(configuration: vscode.WorkspaceConfiguration): 'auto' | 'on' | 'off' | undefined {
	return configuration.get<'auto' | 'on' | 'off'>('typescript.preferences.includePackageJsonAutoImports');
}

function readMaxTsServerMemory(configuration: vscode.WorkspaceConfiguration): number {
	const defaultMaxMemory = 3072;
	const minimumMaxMemory = 128;
	const memoryInMB = configuration.get<number>('typescript.tsserver.maxTsServerMemory', defaultMaxMemory);
	if (!Number.isSafeInteger(memoryInMB)) {
		return defaultMaxMemory;
	}
	return Math.max(memoryInMB, minimumMaxMemory);
}

function readEnablePromptUseWorkspaceTsdk(configuration: vscode.WorkspaceConfiguration): boolean {
	return configuration.get<boolean>('typescript.enablePromptUseWorkspaceTsdk', false);
}

function readEnableTsServerTracing(configuration: vscode.WorkspaceConfiguration): boolean {
	return configuration.get<boolean>('typescript.tsserver.enableTracing', false);
}
