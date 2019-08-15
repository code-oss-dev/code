/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createApiFactoryAndRegisterActors, IExtensionApiFactory } from 'vs/workbench/api/common/extHost.api.impl';
import { ExtensionActivationTimesBuilder } from 'vs/workbench/api/common/extHostExtensionActivator';
import { AbstractExtHostExtensionService } from 'vs/workbench/api/common/extHostExtensionService';
import { endsWith, startsWith } from 'vs/base/common/strings';
import { IExtensionDescription, ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { ExtHostConfigProvider } from 'vs/workbench/api/common/extHostConfiguration';
import * as vscode from 'vscode';
import { TernarySearchTree } from 'vs/base/common/map';
import { nullExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { joinPath } from 'vs/base/common/resources';

class ApiInstances {

	private readonly _apiInstances = new Map<string, typeof vscode>();

	constructor(
		private readonly _apiFactory: IExtensionApiFactory,
		private readonly _extensionPaths: TernarySearchTree<IExtensionDescription>,
		private readonly _extensionRegistry: ExtensionDescriptionRegistry,
		private readonly _configProvider: ExtHostConfigProvider,
	) {
		//
	}

	get(modulePath: string): typeof vscode {
		const extension = this._extensionPaths.findSubstr(modulePath) || nullExtensionDescription;
		const id = ExtensionIdentifier.toKey(extension.identifier);

		let apiInstance = this._apiInstances.get(id);
		if (!apiInstance) {
			apiInstance = this._apiFactory(extension, this._extensionRegistry, this._configProvider);
			this._apiInstances.set(id, apiInstance);
		}
		return apiInstance;
	}
}

class ExportsTrap {

	static readonly Instance = new ExportsTrap();

	private readonly _names: string[] = [];
	private readonly _exports = new Map<string, any>();

	private constructor() {

		const exportsProxy = new Proxy({}, {
			set: (target: any, p: PropertyKey, value: any, receiver: any) => {
				// store in target
				target[p] = value;
				// store in named-bucket
				const name = this._names[this._names.length - 1];
				this._exports.get(name)![p] = value;
				return true;
			}
		});


		const moduleProxy = new Proxy({}, {

			get: (target: any, p: PropertyKey) => {
				if (p === 'exports') {
					return exportsProxy;
				}

				return target[p];
			},

			set: (target: any, p: PropertyKey, value: any, receiver: any) => {
				// store in target
				target[p] = value;

				// override bucket
				if (p === 'exports') {
					const name = this._names[this._names.length - 1];
					this._exports.set(name, value);
				}
				return true;
			}
		});

		(<any>self).exports = exportsProxy;
		(<any>self).module = moduleProxy;
	}

	add(name: string) {
		this._exports.set(name, Object.create(null));
		this._names.push(name);

		return {
			claim: () => {
				const result = this._exports.get(name);
				this._exports.delete(name);
				this._names.pop();
				return result;
			}
		};
	}
}

export class ExtHostExtensionService extends AbstractExtHostExtensionService {

	private _apiInstances?: ApiInstances;

	protected async _beforeAlmostReadyToRunExtensions(): Promise<void> {
		// initialize API and register actors
		const apiFactory = this._instaService.invokeFunction(createApiFactoryAndRegisterActors);
		const configProvider = await this._extHostConfiguration.getConfigProvider();
		const extensionPath = await this.getExtensionPathIndex();
		this._apiInstances = new ApiInstances(apiFactory, extensionPath, this._registry, configProvider);
	}

	protected _loadCommonJSModule<T>(module: URI, activationTimesBuilder: ExtensionActivationTimesBuilder): Promise<T> {

		interface FakeCommonJSSelf {
			module?: object;
			exports?: object;
			require?: (module: string) => any;
			window?: object;
			__dirname: never;
			__filename: never;
		}

		// FAKE commonjs world that only collects exports
		const patchSelf: FakeCommonJSSelf = <any>self;
		patchSelf.window = self; // <- that's improper but might help extensions that aren't authored correctly

		// FAKE require function that only works for the vscode-module
		const moduleStack: URI[] = [];
		patchSelf.require = (mod: string) => {
			const parent = moduleStack[moduleStack.length - 1];
			if (mod === 'vscode') {
				return this._apiInstances!.get(parent.fsPath);
			}
			if (!startsWith(mod, '.')) {
				throw new Error(`Cannot load module '${mod}'`);
			}

			const next = joinPath(parent, '..', ensureSuffix(mod, '.js'));
			moduleStack.push(next);
			const trap = ExportsTrap.Instance.add(next.toString());
			importScripts(asDomUri(next).toString(true));
			moduleStack.pop();

			return trap.claim();
		};

		try {
			activationTimesBuilder.codeLoadingStart();
			module = module.with({ path: ensureSuffix(module.path, '.js') });
			moduleStack.push(module);
			const trap = ExportsTrap.Instance.add(module.toString());
			importScripts(asDomUri(module).toString(true));
			moduleStack.pop();
			return Promise.resolve<T>(trap.claim());

		} finally {
			activationTimesBuilder.codeLoadingStop();
		}
	}

	async $setRemoteEnvironment(_env: { [key: string]: string | null }): Promise<void> {
		throw new Error('Not supported');
	}
}

// todo@joh this is a copy of `dom.ts#asDomUri`
function asDomUri(uri: URI): URI {
	if (Schemas.vscodeRemote === uri.scheme) {
		// rewrite vscode-remote-uris to uris of the window location
		// so that they can be intercepted by the service worker
		return URI.parse(window.location.href).with({ path: '/vscode-remote', query: JSON.stringify(uri) });
	}
	return uri;
}

function ensureSuffix(path: string, suffix: string): string {
	return endsWith(path, suffix) ? path : path + suffix;
}
