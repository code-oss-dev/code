/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import {IDisposable} from 'vs/base/common/lifecycle';
import Severity from 'vs/base/common/severity';
import {TPromise} from 'vs/base/common/winjs.base';
import {IMessage, IExtensionDescription, IExtensionService, IExtensionsStatus} from 'vs/platform/extensions/common/extensions';
import {ExtensionsRegistry} from 'vs/platform/extensions/common/extensionsRegistry';

const hasOwnProperty = Object.hasOwnProperty;

export interface IPluginContext {
	subscriptions: IDisposable[];
	workspaceState: IPluginMemento;
	globalState: IPluginMemento;
	extensionPath: string;
	asAbsolutePath(relativePath: string): string;
}

export interface IPluginMemento {
	get<T>(key: string, defaultValue: T): T;
	update(key: string, value: any): Thenable<boolean>;
}

export abstract class ActivatedPlugin {
	activationFailed: boolean;

	constructor(activationFailed: boolean) {
		this.activationFailed = activationFailed;
	}
}

export interface IActivatedPluginMap<T extends ActivatedPlugin> {
	[extensionId: string]: T;
}

interface IActivatingPluginMap {
	[extensionId: string]: TPromise<void>;
}

export abstract class AbstractPluginService<T extends ActivatedPlugin> implements IExtensionService {
	public serviceId = IExtensionService;

	private activatingPlugins: IActivatingPluginMap;
	protected activatedPlugins: IActivatedPluginMap<T>;
	private _onReady: TPromise<boolean>;
	private _onReadyC: (v: boolean) => void;

	constructor(isReadyByDefault: boolean) {
		if (isReadyByDefault) {
			this._onReady = TPromise.as(true);
			this._onReadyC = (v: boolean) => { /*No-op*/ };
		} else {
			this._onReady = new TPromise<boolean>((c, e, p) => {
				this._onReadyC = c;
			}, () => {
				console.warn('You should really not try to cancel this ready promise!');
			});
		}
		this.activatingPlugins = {};
		this.activatedPlugins = {};
	}

	protected abstract _showMessage(severity: Severity, message: string): void;

	protected showMessage(severity: Severity, source: string, message: string): void {
		this._showMessage(severity, (source ? '[' + source + ']: ' : '') + message);
	}

	public registrationDone(messages: IMessage[]): void {
		messages.forEach((entry) => {
			this.showMessage(entry.type, entry.source, entry.message);
		});
		this._onReadyC(true);
	}

	public onReady(): TPromise<boolean> {
		return this._onReady;
	}


	public getExtensionsStatus(): { [id: string]: IExtensionsStatus } {
		return null;
	}

	public isActivated(extensionId: string): boolean {
		return hasOwnProperty.call(this.activatedPlugins, extensionId);
	}

	public activateByEvent(activationEvent: string): TPromise<void> {
		return this._onReady.then(() => {
			ExtensionsRegistry.triggerActivationEventListeners(activationEvent);
			let activatePlugins = ExtensionsRegistry.getExtensionDescriptionsForActivationEvent(activationEvent);
			return this._activatePlugins(activatePlugins, 0);
		});
	}

	public activateById(extensionId: string): TPromise<void> {
		return this._onReady.then(() => {
			let desc = ExtensionsRegistry.getExtensionDescription(extensionId);
			if (!desc) {
				throw new Error('Plugin `' + extensionId + '` is not known');
			}

			return this._activatePlugins([desc], 0);
		});
	}

	/**
	 * Handle semantics related to dependencies for `currentPlugin`.
	 * semantics: `redExtensions` must wait for `greenExtensions`.
	 */
	private _handleActivateRequest(currentPlugin: IExtensionDescription, greenExtensions: { [id: string]: IExtensionDescription; }, redExtensions: IExtensionDescription[]): void {
		let depIds = (typeof currentPlugin.extensionDependencies === 'undefined' ? [] : currentPlugin.extensionDependencies);
		let currentPluginGetsGreenLight = true;

		for (let j = 0, lenJ = depIds.length; j < lenJ; j++) {
			let depId = depIds[j];
			let depDesc = ExtensionsRegistry.getExtensionDescription(depId);

			if (!depDesc) {
				// Error condition 1: unknown dependency
				this._showMessage(Severity.Error, nls.localize('unknownDep', "Extension `{1}` failed to activate. Reason: unknown dependency `{0}`.", depId, currentPlugin.id));
				this.activatedPlugins[currentPlugin.id] = this._createFailedPlugin();
				return;
			}

			if (hasOwnProperty.call(this.activatedPlugins, depId)) {
				let dep = this.activatedPlugins[depId];
				if (dep.activationFailed) {
					// Error condition 2: a dependency has already failed activation
					this._showMessage(Severity.Error, nls.localize('failedDep1', "Extension `{1}` failed to activate. Reason: dependency `{0}` failed to activate.", depId, currentPlugin.id));
					this.activatedPlugins[currentPlugin.id] = this._createFailedPlugin();
					return;
				}
			} else {
				// must first wait for the dependency to activate
				currentPluginGetsGreenLight = false;
				greenExtensions[depId] = depDesc;
			}
		}

		if (currentPluginGetsGreenLight) {
			greenExtensions[currentPlugin.id] = currentPlugin;
		} else {
			redExtensions.push(currentPlugin);
		}
	}

	private _activatePlugins(extensionDescriptions: IExtensionDescription[], recursionLevel: number): TPromise<void> {
		// console.log(recursionLevel, '_activatePlugins: ', extensionDescriptions.map(p => p.id));
		if (extensionDescriptions.length === 0) {
			return TPromise.as(void 0);
		}

		extensionDescriptions = extensionDescriptions.filter((p) => !hasOwnProperty.call(this.activatedPlugins, p.id));
		if (extensionDescriptions.length === 0) {
			return TPromise.as(void 0);
		}

		if (recursionLevel > 10) {
			// More than 10 dependencies deep => most likely a dependency loop
			for (let i = 0, len = extensionDescriptions.length; i < len; i++) {
				// Error condition 3: dependency loop
				this._showMessage(Severity.Error, nls.localize('failedDep2', "Extension `{0}` failed to activate. Reason: more than 10 levels of dependencies (most likely a dependency loop).", extensionDescriptions[i].id));
				this.activatedPlugins[extensionDescriptions[i].id] = this._createFailedPlugin();
			}
			return TPromise.as(void 0);
		}

		let greenMap: { [id: string]: IExtensionDescription; } = Object.create(null),
			red: IExtensionDescription[] = [];

		for (let i = 0, len = extensionDescriptions.length; i < len; i++) {
			this._handleActivateRequest(extensionDescriptions[i], greenMap, red);
		}

		// Make sure no red is also green
		for (let i = 0, len = red.length; i < len; i++) {
			if (greenMap[red[i].id]) {
				delete greenMap[red[i].id];
			}
		}

		let green = Object.keys(greenMap).map(id => greenMap[id]);

		// console.log('greenExtensions: ', green.map(p => p.id));
		// console.log('redExtensions: ', red.map(p => p.id));

		if (red.length === 0) {
			// Finally reached only leafs!
			return TPromise.join(green.map((p) => this._activatePlugin(p))).then(_ => void 0);
		}

		return this._activatePlugins(green, recursionLevel + 1).then(_ => {
			return this._activatePlugins(red, recursionLevel + 1);
		});
	}

	protected _activatePlugin(extensionDescription: IExtensionDescription): TPromise<void> {
		if (hasOwnProperty.call(this.activatedPlugins, extensionDescription.id)) {
			return TPromise.as(void 0);
		}

		if (hasOwnProperty.call(this.activatingPlugins, extensionDescription.id)) {
			return this.activatingPlugins[extensionDescription.id];
		}

		this.activatingPlugins[extensionDescription.id] = this._actualActivatePlugin(extensionDescription).then(null, (err) => {
			this._showMessage(Severity.Error, nls.localize('activationError', "Activating extension `{0}` failed: {1}.", extensionDescription.id, err.message));
			console.error('Activating extension `' + extensionDescription.id + '` failed: ', err.message);
			console.log('Here is the error stack: ', err.stack);
			// Treat the plugin as being empty
			return this._createFailedPlugin();
		}).then((x: T) => {
			this.activatedPlugins[extensionDescription.id] = x;
			delete this.activatingPlugins[extensionDescription.id];
		});

		return this.activatingPlugins[extensionDescription.id];
	}

	protected abstract _createFailedPlugin(): T;

	protected abstract _actualActivatePlugin(extensionDescription: IExtensionDescription): TPromise<T>;
}
