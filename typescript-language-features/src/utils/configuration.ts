/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

export const enum SyntaxServerConfiguration {
	Never,
	Always,
	/** Use a single syntax server for every request, even on desktop */
	Auto,
}

export class ImplicitProjectConfiguration {

	public readonly target: string | undefined;
	public readonly module: string | undefined;
	public readonly checkJs: boolean;
	public readonly experimentalDecorators: boolean;
	public readonly strictNullChecks: boolean;
	public readonly strictFunctionTypes: boolean;

	constructor(configuration: vscode.WorkspaceConfiguration) {
		this.target = ImplicitProjectConfiguration.readTarget(configuration);
		this.module = ImplicitProjectConfiguration.readModule(configuration);
		this.checkJs = ImplicitProjectConfiguration.readCheckJs(configuration);
		this.experimentalDecorators = ImplicitProjectConfiguration.readExperimentalDecorators(configuration);
		this.strictNullChecks = ImplicitProjectConfiguration.readImplicitStrictNullChecks(configuration);
		this.strictFunctionTypes = ImplicitProjectConfiguration.readImplicitStrictFunctionTypes(configuration);
	}

	public isEqualTo(other: ImplicitProjectConfiguration): boolean {
		return objects.equals(this, other);
	}

	private static readTarget(configuration: vscode.WorkspaceConfiguration): string | undefined {
		return configuration.get<string>('js/ts.implicitProjectConfig.target');
	}

	private static readModule(configuration: vscode.WorkspaceConfiguration): string | undefined {
		return configuration.get<string>('js/ts.implicitProjectConfig.module');
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
	readonly useSyntaxServer: SyntaxServerConfiguration;
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

export interface ServiceConfigurationProvider {
	loadFromWorkspace(): TypeScriptServiceConfiguration;
}

export abstract class BaseServiceConfigurationProvider implements ServiceConfigurationProvider {

	public loadFromWorkspace(): TypeScriptServiceConfiguration {
		const configuration = vscode.workspace.getConfiguration();
		return {
			locale: this.extractLocale(configuration),
			globalTsdk: this.extractGlobalTsdk(configuration),
			localTsdk: this.extractLocalTsdk(configuration),
			npmLocation: this.readNpmLocation(configuration),
			tsServerLogLevel: this.readTsServerLogLevel(configuration),
			tsServerPluginPaths: this.readTsServerPluginPaths(configuration),
			implicitProjectConfiguration: new ImplicitProjectConfiguration(configuration),
			disableAutomaticTypeAcquisition: this.readDisableAutomaticTypeAcquisition(configuration),
			useSyntaxServer: this.readUseSyntaxServer(configuration),
			enableProjectDiagnostics: this.readEnableProjectDiagnostics(configuration),
			maxTsServerMemory: this.readMaxTsServerMemory(configuration),
			enablePromptUseWorkspaceTsdk: this.readEnablePromptUseWorkspaceTsdk(configuration),
			watchOptions: this.readWatchOptions(configuration),
			includePackageJsonAutoImports: this.readIncludePackageJsonAutoImports(configuration),
			enableTsServerTracing: this.readEnableTsServerTracing(configuration),
		};
	}

	protected abstract extractGlobalTsdk(configuration: vscode.WorkspaceConfiguration): string | null;
	protected abstract extractLocalTsdk(configuration: vscode.WorkspaceConfiguration): string | null;

	protected readTsServerLogLevel(configuration: vscode.WorkspaceConfiguration): TsServerLogLevel {
		const setting = configuration.get<string>('typescript.tsserver.log', 'off');
		return TsServerLogLevel.fromString(setting);
	}

	protected readTsServerPluginPaths(configuration: vscode.WorkspaceConfiguration): string[] {
		return configuration.get<string[]>('typescript.tsserver.pluginPaths', []);
	}

	protected readNpmLocation(configuration: vscode.WorkspaceConfiguration): string | null {
		return configuration.get<string | null>('typescript.npm', null);
	}

	protected readDisableAutomaticTypeAcquisition(configuration: vscode.WorkspaceConfiguration): boolean {
		return configuration.get<boolean>('typescript.disableAutomaticTypeAcquisition', false);
	}

	protected extractLocale(configuration: vscode.WorkspaceConfiguration): string | null {
		return configuration.get<string | null>('typescript.locale', null);
	}

	protected readUseSyntaxServer(configuration: vscode.WorkspaceConfiguration): SyntaxServerConfiguration {
		const value = configuration.get<string>('typescript.tsserver.useSyntaxServer');
		switch (value) {
			case 'never': return SyntaxServerConfiguration.Never;
			case 'always': return SyntaxServerConfiguration.Always;
			case 'auto': return SyntaxServerConfiguration.Auto;
		}

		// Fallback to deprecated setting
		const deprecatedValue = configuration.get<boolean | string>('typescript.tsserver.useSeparateSyntaxServer', true);
		if (deprecatedValue === 'forAllRequests') { // Undocumented setting
			return SyntaxServerConfiguration.Always;
		}
		if (deprecatedValue === true) {
			return SyntaxServerConfiguration.Auto;
		}
		return SyntaxServerConfiguration.Never;
	}

	protected readEnableProjectDiagnostics(configuration: vscode.WorkspaceConfiguration): boolean {
		return configuration.get<boolean>('typescript.tsserver.experimental.enableProjectDiagnostics', false);
	}

	protected readWatchOptions(configuration: vscode.WorkspaceConfiguration): protocol.WatchOptions | undefined {
		return configuration.get<protocol.WatchOptions>('typescript.tsserver.watchOptions');
	}

	protected readIncludePackageJsonAutoImports(configuration: vscode.WorkspaceConfiguration): 'auto' | 'on' | 'off' | undefined {
		return configuration.get<'auto' | 'on' | 'off'>('typescript.preferences.includePackageJsonAutoImports');
	}

	protected readMaxTsServerMemory(configuration: vscode.WorkspaceConfiguration): number {
		const defaultMaxMemory = 3072;
		const minimumMaxMemory = 128;
		const memoryInMB = configuration.get<number>('typescript.tsserver.maxTsServerMemory', defaultMaxMemory);
		if (!Number.isSafeInteger(memoryInMB)) {
			return defaultMaxMemory;
		}
		return Math.max(memoryInMB, minimumMaxMemory);
	}

	protected readEnablePromptUseWorkspaceTsdk(configuration: vscode.WorkspaceConfiguration): boolean {
		return configuration.get<boolean>('typescript.enablePromptUseWorkspaceTsdk', false);
	}

	protected readEnableTsServerTracing(configuration: vscode.WorkspaceConfiguration): boolean {
		return configuration.get<boolean>('typescript.tsserver.enableTracing', false);
	}

}
