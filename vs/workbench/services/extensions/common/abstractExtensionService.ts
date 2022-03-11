/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { Barrier } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import * as perf from 'vs/base/common/performance';
import { isEqualOrParent } from 'vs/base/common/resources';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWebExtensionsScannerService, IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ActivationTimes, ExtensionPointContribution, IExtensionService, IExtensionsStatus, IMessage, IWillActivateEvent, IResponsiveStateChangeEvent, toExtension, IExtensionHost, ActivationKind, ExtensionHostKind, toExtensionDescription, ExtensionRunningLocation, extensionHostKindToString, ExtensionActivationReason, IInternalExtensionService, RemoteRunningLocation, LocalProcessRunningLocation, LocalWebWorkerRunningLocation } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionMessageCollector, ExtensionPoint, ExtensionsRegistry, IExtensionPoint, IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { ResponsiveState } from 'vs/workbench/services/extensions/common/rpcProtocol';
import { createExtensionHostManager, IExtensionHostManager } from 'vs/workbench/services/extensions/common/extensionHostManager';
import { ExtensionIdentifier, IExtensionDescription, IExtension, IExtensionContributions } from 'vs/platform/extensions/common/extensions';
import { ExtensionKind } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { parseExtensionDevOptions } from 'vs/workbench/services/extensions/common/extensionDevOptions';
import { IProductService } from 'vs/platform/product/common/productService';
import { IExtensionManagementService, InstallOperation } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionActivationHost as IWorkspaceContainsActivationHost, checkGlobFileExists, checkActivateWorkspaceContainsExtension } from 'vs/workbench/services/extensions/common/workspaceContains';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { IExtensionManifestPropertiesService } from 'vs/workbench/services/extensions/common/extensionManifestPropertiesService';
import { Logger } from 'vs/workbench/services/extensions/common/extensionPoints';
import { dedupExtensions } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { ApiProposalName, allApiProposals } from 'vs/workbench/services/extensions/common/extensionsApiProposals';
import { forEach } from 'vs/base/common/collections';
import { ILogService } from 'vs/platform/log/common/log';

const hasOwnProperty = Object.hasOwnProperty;
const NO_OP_VOID_PROMISE = Promise.resolve<void>(undefined);

class DeltaExtensionsQueueItem {
	constructor(
		public readonly toAdd: IExtension[],
		public readonly toRemove: string[] | IExtension[]
	) { }
}

export const enum ExtensionRunningPreference {
	None,
	Local,
	Remote
}

export function extensionRunningPreferenceToString(preference: ExtensionRunningPreference) {
	switch (preference) {
		case ExtensionRunningPreference.None:
			return 'None';
		case ExtensionRunningPreference.Local:
			return 'Local';
		case ExtensionRunningPreference.Remote:
			return 'Remote';
	}
}

class LockCustomer {
	public readonly promise: Promise<IDisposable>;
	private _resolve!: (value: IDisposable) => void;

	constructor(
		public readonly name: string
	) {
		this.promise = new Promise<IDisposable>((resolve, reject) => {
			this._resolve = resolve;
		});
	}

	resolve(value: IDisposable): void {
		this._resolve(value);
	}
}

class Lock {
	private readonly _pendingCustomers: LockCustomer[] = [];
	private _isLocked = false;

	public async acquire(customerName: string): Promise<IDisposable> {
		const customer = new LockCustomer(customerName);
		this._pendingCustomers.push(customer);
		this._advance();
		return customer.promise;
	}

	private _advance(): void {
		if (this._isLocked) {
			// cannot advance yet
			return;
		}
		if (this._pendingCustomers.length === 0) {
			// no more waiting customers
			return;
		}

		const customer = this._pendingCustomers.shift()!;

		this._isLocked = true;
		let customerHoldsLock = true;

		let logLongRunningCustomerTimeout = setTimeout(() => {
			if (customerHoldsLock) {
				console.warn(`The customer named ${customer.name} has been holding on to the lock for 30s. This might be a problem.`);
			}
		}, 30 * 1000 /* 30 seconds */);

		const releaseLock = () => {
			if (!customerHoldsLock) {
				return;
			}
			clearTimeout(logLongRunningCustomerTimeout);
			customerHoldsLock = false;
			this._isLocked = false;
			this._advance();
		};

		customer.resolve(toDisposable(releaseLock));
	}
}

export abstract class AbstractExtensionService extends Disposable implements IExtensionService {

	public _serviceBrand: undefined;

	protected readonly _onDidRegisterExtensions: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidRegisterExtensions = this._onDidRegisterExtensions.event;

	protected readonly _onDidChangeExtensionsStatus: Emitter<ExtensionIdentifier[]> = this._register(new Emitter<ExtensionIdentifier[]>());
	public readonly onDidChangeExtensionsStatus: Event<ExtensionIdentifier[]> = this._onDidChangeExtensionsStatus.event;

	protected readonly _onDidChangeExtensions: Emitter<void> = this._register(new Emitter<void>({ leakWarningThreshold: 400 }));
	public readonly onDidChangeExtensions: Event<void> = this._onDidChangeExtensions.event;

	protected readonly _onWillActivateByEvent = this._register(new Emitter<IWillActivateEvent>());
	public readonly onWillActivateByEvent: Event<IWillActivateEvent> = this._onWillActivateByEvent.event;

	protected readonly _onDidChangeResponsiveChange = this._register(new Emitter<IResponsiveStateChangeEvent>());
	public readonly onDidChangeResponsiveChange: Event<IResponsiveStateChangeEvent> = this._onDidChangeResponsiveChange.event;

	protected readonly _registry: ExtensionDescriptionRegistry;
	private readonly _registryLock: Lock;

	private readonly _installedExtensionsReady: Barrier;
	protected readonly _isDev: boolean;
	private readonly _extensionsMessages: Map<string, IMessage[]>;
	protected readonly _allRequestedActivateEvents = new Set<string>();
	private readonly _proposedApiController: ProposedApiController;
	private readonly _isExtensionDevHost: boolean;
	protected readonly _isExtensionDevTestFromCli: boolean;

	private _deltaExtensionsQueue: DeltaExtensionsQueueItem[];
	private _inHandleDeltaExtensions: boolean;

	protected _runningLocation: Map<string, ExtensionRunningLocation | null>;
	private _lastExtensionHostId: number = 0;

	// --- Members used per extension host process
	protected _extensionHostManagers: IExtensionHostManager[];
	protected _extensionHostActiveExtensions: Map<string, ExtensionIdentifier>;
	private _extensionHostActivationTimes: Map<string, ActivationTimes>;
	private _extensionHostExtensionRuntimeErrors: Map<string, Error[]>;

	constructor(
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@INotificationService protected readonly _notificationService: INotificationService,
		@IWorkbenchEnvironmentService protected readonly _environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService protected readonly _telemetryService: ITelemetryService,
		@IWorkbenchExtensionEnablementService protected readonly _extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IFileService protected readonly _fileService: IFileService,
		@IProductService protected readonly _productService: IProductService,
		@IExtensionManagementService protected readonly _extensionManagementService: IExtensionManagementService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
		@IExtensionManifestPropertiesService protected readonly _extensionManifestPropertiesService: IExtensionManifestPropertiesService,
		@IWebExtensionsScannerService protected readonly _webExtensionsScannerService: IWebExtensionsScannerService,
		@ILogService protected readonly _logService: ILogService,
	) {
		super();

		// help the file service to activate providers by activating extensions by file system event
		this._register(this._fileService.onWillActivateFileSystemProvider(e => {
			if (e.scheme !== Schemas.vscodeRemote) {
				e.join(this.activateByEvent(`onFileSystem:${e.scheme}`));
			}
		}));

		this._registry = new ExtensionDescriptionRegistry([]);
		this._registryLock = new Lock();

		this._installedExtensionsReady = new Barrier();
		this._isDev = !this._environmentService.isBuilt || this._environmentService.isExtensionDevelopment;
		this._extensionsMessages = new Map<string, IMessage[]>();
		this._proposedApiController = _instantiationService.createInstance(ProposedApiController);

		this._extensionHostManagers = [];
		this._extensionHostActiveExtensions = new Map<string, ExtensionIdentifier>();
		this._extensionHostActivationTimes = new Map<string, ActivationTimes>();
		this._extensionHostExtensionRuntimeErrors = new Map<string, Error[]>();

		const devOpts = parseExtensionDevOptions(this._environmentService);
		this._isExtensionDevHost = devOpts.isExtensionDevHost;
		this._isExtensionDevTestFromCli = devOpts.isExtensionDevTestFromCli;

		this._deltaExtensionsQueue = [];
		this._inHandleDeltaExtensions = false;

		this._runningLocation = new Map<string, ExtensionRunningLocation>();

		this._register(this._extensionEnablementService.onEnablementChanged((extensions) => {
			let toAdd: IExtension[] = [];
			let toRemove: IExtension[] = [];
			for (const extension of extensions) {
				if (this._safeInvokeIsEnabled(extension)) {
					// an extension has been enabled
					toAdd.push(extension);
				} else {
					// an extension has been disabled
					toRemove.push(extension);
				}
			}
			this._handleDeltaExtensions(new DeltaExtensionsQueueItem(toAdd, toRemove));
		}));

		this._register(this._extensionManagementService.onDidInstallExtensions((result) => {
			const extensions: IExtension[] = [];
			for (const { local, operation } of result) {
				if (local && operation !== InstallOperation.Migrate && this._safeInvokeIsEnabled(local)) {
					extensions.push(local);
				}
			}
			if (extensions.length) {
				this._handleDeltaExtensions(new DeltaExtensionsQueueItem(extensions, []));
			}
		}));

		this._register(this._extensionManagementService.onDidUninstallExtension((event) => {
			if (!event.error) {
				// an extension has been uninstalled
				this._handleDeltaExtensions(new DeltaExtensionsQueueItem([], [event.identifier.id]));
			}
		}));
	}

	private _getExtensionKind(extensionDescription: IExtensionDescription): ExtensionKind[] {
		if (extensionDescription.isUnderDevelopment && this._environmentService.extensionDevelopmentKind) {
			return this._environmentService.extensionDevelopmentKind;
		}

		return this._extensionManifestPropertiesService.getExtensionKind(extensionDescription);
	}

	protected abstract _pickExtensionHostKind(extensionId: ExtensionIdentifier, extensionKinds: ExtensionKind[], isInstalledLocally: boolean, isInstalledRemotely: boolean, preference: ExtensionRunningPreference): ExtensionHostKind | null;

	protected _getExtensionHostManagers(kind: ExtensionHostKind): IExtensionHostManager[] {
		return this._extensionHostManagers.filter(extHostManager => extHostManager.kind === kind);
	}

	protected _getExtensionHostManagerByRunningLocation(runningLocation: ExtensionRunningLocation): IExtensionHostManager | null {
		for (const extensionHostManager of this._extensionHostManagers) {
			if (extensionHostManager.representsRunningLocation(runningLocation)) {
				return extensionHostManager;
			}
		}
		return null;
	}

	//#region running location

	private _computeAffinity(inputExtensions: IExtensionDescription[], extensionHostKind: ExtensionHostKind, isInitialAllocation: boolean): { affinities: Map<string, number>; maxAffinity: number } {
		// Only analyze extensions that can execute
		const extensions = new Map<string, IExtensionDescription>();
		for (const extension of inputExtensions) {
			if (extension.main || extension.browser) {
				extensions.set(ExtensionIdentifier.toKey(extension.identifier), extension);
			}
		}
		// Also add existing extensions of the same kind that can execute
		for (const extension of this._registry.getAllExtensionDescriptions()) {
			if (extension.main || extension.browser) {
				const runningLocation = this._runningLocation.get(ExtensionIdentifier.toKey(extension.identifier));
				if (runningLocation && runningLocation.kind === extensionHostKind) {
					extensions.set(ExtensionIdentifier.toKey(extension.identifier), extension);
				}
			}
		}

		// Initially, each extension belongs to its own group
		const groups = new Map<string, number>();
		let groupNumber = 0;
		for (const [_, extension] of extensions) {
			groups.set(ExtensionIdentifier.toKey(extension.identifier), ++groupNumber);
		}

		const changeGroup = (from: number, to: number) => {
			for (const [key, group] of groups) {
				if (group === from) {
					groups.set(key, to);
				}
			}
		};

		// We will group things together when there are dependencies
		for (const [_, extension] of extensions) {
			if (!extension.extensionDependencies) {
				continue;
			}
			const myGroup = groups.get(ExtensionIdentifier.toKey(extension.identifier))!;
			for (const depId of extension.extensionDependencies) {
				const depGroup = groups.get(ExtensionIdentifier.toKey(depId));
				if (!depGroup) {
					// probably can't execute, so it has no impact
					continue;
				}

				if (depGroup === myGroup) {
					// already in the same group
					continue;
				}

				changeGroup(depGroup, myGroup);
			}
		}

		// Initialize with existing affinities
		const resultingAffinities = new Map<number, number>();
		let lastAffinity = 0;
		for (const [_, extension] of extensions) {
			const runningLocation = this._runningLocation.get(ExtensionIdentifier.toKey(extension.identifier));
			if (runningLocation) {
				const group = groups.get(ExtensionIdentifier.toKey(extension.identifier))!;
				resultingAffinities.set(group, runningLocation.affinity);
				lastAffinity = Math.max(lastAffinity, runningLocation.affinity);
			}
		}

		// Go through each configured affinity and try to accomodate it
		const configuredAffinities = this._configurationService.getValue<{ [extensionId: string]: number } | undefined>('extensions.experimental.affinity') || {};
		const configuredExtensionIds = Object.keys(configuredAffinities);
		const configuredAffinityToResultingAffinity = new Map<number, number>();
		for (const extensionId of configuredExtensionIds) {
			const configuredAffinity = configuredAffinities[extensionId];
			if (typeof configuredAffinity !== 'number' || configuredAffinity <= 0 || Math.floor(configuredAffinity) !== configuredAffinity) {
				this._logService.info(`Ignoring configured affinity for '${extensionId}' because the value is not a positive integer.`);
				continue;
			}
			const group = groups.get(ExtensionIdentifier.toKey(extensionId));
			if (!group) {
				this._logService.info(`Ignoring configured affinity for '${extensionId}' because the extension is unknown or cannot execute.`);
				continue;
			}

			const affinity1 = resultingAffinities.get(group);
			if (affinity1) {
				// Affinity for this group is already established
				configuredAffinityToResultingAffinity.set(configuredAffinity, affinity1);
				continue;
			}

			const affinity2 = configuredAffinityToResultingAffinity.get(configuredAffinity);
			if (affinity2) {
				// Affinity for this configuration is already established
				resultingAffinities.set(group, affinity2);
				continue;
			}

			if (!isInitialAllocation) {
				this._logService.info(`Ignoring configured affinity for '${extensionId}' because extension host(s) are already running. Reload window.`);
				continue;
			}

			const affinity3 = ++lastAffinity;
			configuredAffinityToResultingAffinity.set(configuredAffinity, affinity3);
			resultingAffinities.set(group, affinity3);
		}

		const result = new Map<string, number>();
		for (const extension of inputExtensions) {
			const group = groups.get(ExtensionIdentifier.toKey(extension.identifier)) || 0;
			const affinity = resultingAffinities.get(group) || 0;
			result.set(ExtensionIdentifier.toKey(extension.identifier), affinity);
		}

		if (lastAffinity > 0 && isInitialAllocation) {
			for (let affinity = 1; affinity <= lastAffinity; affinity++) {
				const extensionIds: ExtensionIdentifier[] = [];
				for (const extension of inputExtensions) {
					if (result.get(ExtensionIdentifier.toKey(extension.identifier)) === affinity) {
						extensionIds.push(extension.identifier);
					}
				}
				this._logService.info(`Placing extension(s) ${extensionIds.map(e => e.value).join(', ')} on a separate extension host.`);
			}
		}

		return { affinities: result, maxAffinity: lastAffinity };
	}

	protected _computeRunningLocation(localExtensions: IExtensionDescription[], remoteExtensions: IExtensionDescription[], isInitialAllocation: boolean): Map<string, ExtensionRunningLocation | null> {
		const extensionHostKinds = ExtensionHostKindClassifier.determineExtensionHostKinds(
			localExtensions,
			remoteExtensions,
			(extension) => this._getExtensionKind(extension),
			(extensionId, extensionKinds, isInstalledLocally, isInstalledRemotely, preference) => this._pickExtensionHostKind(extensionId, extensionKinds, isInstalledLocally, isInstalledRemotely, preference)
		);

		const extensions = new Map<string, IExtensionDescription>();
		for (const extension of localExtensions) {
			extensions.set(ExtensionIdentifier.toKey(extension.identifier), extension);
		}
		for (const extension of remoteExtensions) {
			extensions.set(ExtensionIdentifier.toKey(extension.identifier), extension);
		}

		const result = new Map<string, ExtensionRunningLocation | null>();
		const localProcessExtensions: IExtensionDescription[] = [];
		for (const [extensionIdKey, extensionHostKind] of extensionHostKinds) {
			let runningLocation: ExtensionRunningLocation | null = null;
			if (extensionHostKind === ExtensionHostKind.LocalProcess) {
				const extensionDescription = extensions.get(ExtensionIdentifier.toKey(extensionIdKey));
				if (extensionDescription) {
					localProcessExtensions.push(extensionDescription);
				}
			} else if (extensionHostKind === ExtensionHostKind.LocalWebWorker) {
				runningLocation = new LocalWebWorkerRunningLocation();
			} else if (extensionHostKind === ExtensionHostKind.Remote) {
				runningLocation = new RemoteRunningLocation();
			}
			result.set(extensionIdKey, runningLocation);
		}

		const { affinities } = this._computeAffinity(localProcessExtensions, ExtensionHostKind.LocalProcess, isInitialAllocation);
		for (const extension of localProcessExtensions) {
			const affinity = affinities.get(ExtensionIdentifier.toKey(extension.identifier)) || 0;
			result.set(ExtensionIdentifier.toKey(extension.identifier), new LocalProcessRunningLocation(affinity));
		}

		return result;
	}

	/**
	 * Update `this._runningLocation` with running locations for newly enabled/installed extensions.
	 */
	private _updateRunningLocationForAddedExtensions(toAdd: IExtensionDescription[]): void {
		// Determine new running location
		const localProcessExtensions: IExtensionDescription[] = [];
		for (const extension of toAdd) {
			const extensionKind = this._getExtensionKind(extension);
			const isRemote = extension.extensionLocation.scheme === Schemas.vscodeRemote;
			const extensionHostKind = this._pickExtensionHostKind(extension.identifier, extensionKind, !isRemote, isRemote, ExtensionRunningPreference.None);
			let runningLocation: ExtensionRunningLocation | null = null;
			if (extensionHostKind === ExtensionHostKind.LocalProcess) {
				localProcessExtensions.push(extension);
			} else if (extensionHostKind === ExtensionHostKind.LocalWebWorker) {
				runningLocation = new LocalWebWorkerRunningLocation();
			} else if (extensionHostKind === ExtensionHostKind.Remote) {
				runningLocation = new RemoteRunningLocation();
			}
			this._runningLocation.set(ExtensionIdentifier.toKey(extension.identifier), runningLocation);
		}

		const { affinities } = this._computeAffinity(localProcessExtensions, ExtensionHostKind.LocalProcess, false);
		for (const extension of localProcessExtensions) {
			const affinity = affinities.get(ExtensionIdentifier.toKey(extension.identifier)) || 0;
			this._runningLocation.set(ExtensionIdentifier.toKey(extension.identifier), new LocalProcessRunningLocation(affinity));
		}
	}

	//#endregion

	//#region deltaExtensions

	private async _handleDeltaExtensions(item: DeltaExtensionsQueueItem): Promise<void> {
		this._deltaExtensionsQueue.push(item);
		if (this._inHandleDeltaExtensions) {
			// Let the current item finish, the new one will be picked up
			return;
		}

		let lock: IDisposable | null = null;
		try {
			this._inHandleDeltaExtensions = true;

			// wait for _initialize to finish before hanlding any delta extension events
			await this._installedExtensionsReady.wait();

			lock = await this._registryLock.acquire('handleDeltaExtensions');
			while (this._deltaExtensionsQueue.length > 0) {
				const item = this._deltaExtensionsQueue.shift()!;
				await this._deltaExtensions(item.toAdd, item.toRemove);
			}
		} finally {
			this._inHandleDeltaExtensions = false;
			if (lock) {
				lock.dispose();
			}
		}
	}

	private async _deltaExtensions(_toAdd: IExtension[], _toRemove: string[] | IExtension[]): Promise<void> {
		let toAdd: IExtensionDescription[] = [];
		for (let i = 0, len = _toAdd.length; i < len; i++) {
			const extension = _toAdd[i];

			const extensionDescription = await this._scanSingleExtension(extension);
			if (!extensionDescription) {
				// could not scan extension...
				continue;
			}

			if (!this.canAddExtension(extensionDescription)) {
				continue;
			}

			toAdd.push(extensionDescription);
		}

		let toRemove: IExtensionDescription[] = [];
		for (let i = 0, len = _toRemove.length; i < len; i++) {
			const extensionOrId = _toRemove[i];
			const extensionId = (typeof extensionOrId === 'string' ? extensionOrId : extensionOrId.identifier.id);
			const extension = (typeof extensionOrId === 'string' ? null : extensionOrId);
			const extensionDescription = this._registry.getExtensionDescription(extensionId);
			if (!extensionDescription) {
				// ignore disabling/uninstalling an extension which is not running
				continue;
			}

			if (extension && extensionDescription.extensionLocation.scheme !== extension.location.scheme) {
				// this event is for a different extension than mine (maybe for the local extension, while I have the remote extension)
				continue;
			}

			if (!this.canRemoveExtension(extensionDescription)) {
				// uses non-dynamic extension point or is activated
				continue;
			}

			toRemove.push(extensionDescription);
		}

		if (toAdd.length === 0 && toRemove.length === 0) {
			return;
		}

		// Update the local registry
		const result = this._registry.deltaExtensions(toAdd, toRemove.map(e => e.identifier));
		this._onDidChangeExtensions.fire(undefined);

		toRemove = toRemove.concat(result.removedDueToLooping);
		if (result.removedDueToLooping.length > 0) {
			this._logOrShowMessage(Severity.Error, nls.localize('looping', "The following extensions contain dependency loops and have been disabled: {0}", result.removedDueToLooping.map(e => `'${e.identifier.value}'`).join(', ')));
		}

		// enable or disable proposed API per extension
		this._checkEnableProposedApi(toAdd);

		// Update extension points
		this._doHandleExtensionPoints((<IExtensionDescription[]>[]).concat(toAdd).concat(toRemove));

		// Update the extension host
		await this._updateExtensionsOnExtHosts(toAdd, toRemove.map(e => e.identifier));

		for (let i = 0; i < toAdd.length; i++) {
			this._activateAddedExtensionIfNeeded(toAdd[i]);
		}
	}

	private async _updateExtensionsOnExtHosts(toAdd: IExtensionDescription[], toRemove: ExtensionIdentifier[]): Promise<void> {

		// Remove old running location
		const removedRunningLocation = new Map<string, ExtensionRunningLocation | null>();
		for (const extensionId of toRemove) {
			const extensionKey = ExtensionIdentifier.toKey(extensionId);
			removedRunningLocation.set(extensionKey, this._runningLocation.get(extensionKey) || null);
			this._runningLocation.delete(extensionKey);
		}

		// Determine new running location
		this._updateRunningLocationForAddedExtensions(toAdd);

		const promises = this._extensionHostManagers.map(
			extHostManager => this._updateExtensionsOnExtHost(extHostManager, toAdd, toRemove, removedRunningLocation)
		);
		await Promise.all(promises);
	}

	private async _updateExtensionsOnExtHost(extensionHostManager: IExtensionHostManager, _toAdd: IExtensionDescription[], _toRemove: ExtensionIdentifier[], removedRunningLocation: Map<string, ExtensionRunningLocation | null>): Promise<void> {
		const toAdd = filterByExtensionHostManager(_toAdd, this._runningLocation, extensionHostManager);
		const toRemove = _filterByExtensionHostManager(_toRemove, extId => extId, removedRunningLocation, extensionHostManager);
		if (toRemove.length > 0 || toAdd.length > 0) {
			await extensionHostManager.deltaExtensions(toAdd, toRemove);
		}
	}

	public canAddExtension(extension: IExtensionDescription): boolean {
		const existing = this._registry.getExtensionDescription(extension.identifier);
		if (existing) {
			// this extension is already running (most likely at a different version)
			return false;
		}

		// Check if extension is renamed
		if (extension.uuid && this._registry.getAllExtensionDescriptions().some(e => e.uuid === extension.uuid)) {
			return false;
		}

		const extensionKind = this._getExtensionKind(extension);
		const isRemote = extension.extensionLocation.scheme === Schemas.vscodeRemote;
		const extensionHostKind = this._pickExtensionHostKind(extension.identifier, extensionKind, !isRemote, isRemote, ExtensionRunningPreference.None);
		if (extensionHostKind === null) {
			return false;
		}

		return true;
	}

	public canRemoveExtension(extension: IExtensionDescription): boolean {
		const extensionDescription = this._registry.getExtensionDescription(extension.identifier);
		if (!extensionDescription) {
			// ignore removing an extension which is not running
			return false;
		}

		if (this._extensionHostActiveExtensions.has(ExtensionIdentifier.toKey(extensionDescription.identifier))) {
			// Extension is running, cannot remove it safely
			return false;
		}

		return true;
	}

	private async _activateAddedExtensionIfNeeded(extensionDescription: IExtensionDescription): Promise<void> {
		let shouldActivate = false;
		let shouldActivateReason: string | null = null;
		let hasWorkspaceContains = false;
		if (Array.isArray(extensionDescription.activationEvents)) {
			for (let activationEvent of extensionDescription.activationEvents) {
				// TODO@joao: there's no easy way to contribute this
				if (activationEvent === 'onUri') {
					activationEvent = `onUri:${ExtensionIdentifier.toKey(extensionDescription.identifier)}`;
				}

				if (this._allRequestedActivateEvents.has(activationEvent)) {
					// This activation event was fired before the extension was added
					shouldActivate = true;
					shouldActivateReason = activationEvent;
					break;
				}

				if (activationEvent === '*') {
					shouldActivate = true;
					shouldActivateReason = activationEvent;
					break;
				}

				if (/^workspaceContains/.test(activationEvent)) {
					hasWorkspaceContains = true;
				}

				if (activationEvent === 'onStartupFinished') {
					shouldActivate = true;
					shouldActivateReason = activationEvent;
					break;
				}
			}
		}

		if (shouldActivate) {
			await Promise.all(
				this._extensionHostManagers.map(extHostManager => extHostManager.activate(extensionDescription.identifier, { startup: false, extensionId: extensionDescription.identifier, activationEvent: shouldActivateReason! }))
			).then(() => { });
		} else if (hasWorkspaceContains) {
			const workspace = await this._contextService.getCompleteWorkspace();
			const forceUsingSearch = !!this._environmentService.remoteAuthority;
			const host: IWorkspaceContainsActivationHost = {
				logService: this._logService,
				folders: workspace.folders.map(folder => folder.uri),
				forceUsingSearch: forceUsingSearch,
				exists: (uri) => this._fileService.exists(uri),
				checkExists: (folders, includes, token) => this._instantiationService.invokeFunction((accessor) => checkGlobFileExists(accessor, folders, includes, token))
			};

			const result = await checkActivateWorkspaceContainsExtension(host, extensionDescription);
			if (!result) {
				return;
			}

			await Promise.all(
				this._extensionHostManagers.map(extHostManager => extHostManager.activate(extensionDescription.identifier, { startup: false, extensionId: extensionDescription.identifier, activationEvent: result.activationEvent }))
			).then(() => { });
		}
	}

	//#endregion

	protected async _initialize(): Promise<void> {
		perf.mark('code/willLoadExtensions');
		this._startExtensionHosts(true, []);

		const lock = await this._registryLock.acquire('_initialize');
		try {
			await this._scanAndHandleExtensions();
		} finally {
			lock.dispose();
		}

		this._releaseBarrier();
		perf.mark('code/didLoadExtensions');
		await this._handleExtensionTests();
	}

	private async _handleExtensionTests(): Promise<void> {
		if (!this._environmentService.isExtensionDevelopment || !this._environmentService.extensionTestsLocationURI) {
			return;
		}

		const extensionHostManager = this.findTestExtensionHost(this._environmentService.extensionTestsLocationURI);
		if (!extensionHostManager) {
			const msg = nls.localize('extensionTestError', "No extension host found that can launch the test runner at {0}.", this._environmentService.extensionTestsLocationURI.toString());
			console.error(msg);
			this._notificationService.error(msg);
			return;
		}


		let exitCode: number;
		try {
			exitCode = await extensionHostManager.extensionTestsExecute();
		} catch (err) {
			console.error(err);
			exitCode = 1 /* ERROR */;
		}

		await extensionHostManager.extensionTestsSendExit(exitCode);
		this._onExtensionHostExit(exitCode);
	}

	private findTestExtensionHost(testLocation: URI): IExtensionHostManager | null {
		let runningLocation: ExtensionRunningLocation | null = null;

		for (const extension of this._registry.getAllExtensionDescriptions()) {
			if (isEqualOrParent(testLocation, extension.extensionLocation)) {
				runningLocation = this._runningLocation.get(ExtensionIdentifier.toKey(extension.identifier)) || null;
				break;
			}
		}
		if (runningLocation === null) {
			// not sure if we should support that, but it was possible to have an test outside an extension

			if (testLocation.scheme === Schemas.vscodeRemote) {
				runningLocation = new RemoteRunningLocation();
			} else {
				// When a debugger attaches to the extension host, it will surface all console.log messages from the extension host,
				// but not necessarily from the window. So it would be best if any errors get printed to the console of the extension host.
				// That is why here we use the local process extension host even for non-file URIs
				runningLocation = new LocalProcessRunningLocation(0);
			}
		}
		if (runningLocation !== null) {
			return this._getExtensionHostManagerByRunningLocation(runningLocation);
		}
		return null;
	}

	private _releaseBarrier(): void {
		this._installedExtensionsReady.open();
		this._onDidRegisterExtensions.fire(undefined);
		this._onDidChangeExtensionsStatus.fire(this._registry.getAllExtensionDescriptions().map(e => e.identifier));
	}

	//#region Stopping / Starting / Restarting

	public stopExtensionHosts(): void {
		let previouslyActivatedExtensionIds: ExtensionIdentifier[] = [];
		this._extensionHostActiveExtensions.forEach((value) => {
			previouslyActivatedExtensionIds.push(value);
		});

		for (const manager of this._extensionHostManagers) {
			manager.dispose();
		}
		this._extensionHostManagers = [];
		this._extensionHostActiveExtensions = new Map<string, ExtensionIdentifier>();
		this._extensionHostActivationTimes = new Map<string, ActivationTimes>();
		this._extensionHostExtensionRuntimeErrors = new Map<string, Error[]>();

		if (previouslyActivatedExtensionIds.length > 0) {
			this._onDidChangeExtensionsStatus.fire(previouslyActivatedExtensionIds);
		}
	}

	private _startExtensionHosts(isInitialStart: boolean, initialActivationEvents: string[]): void {
		const extensionHosts = this._createExtensionHosts(isInitialStart);
		extensionHosts.forEach((extensionHost) => {
			const extensionHostId = String(++this._lastExtensionHostId);
			const processManager: IExtensionHostManager = createExtensionHostManager(this._instantiationService, extensionHostId, extensionHost, isInitialStart, initialActivationEvents, this._acquireInternalAPI());
			processManager.onDidExit(([code, signal]) => this._onExtensionHostCrashOrExit(processManager, code, signal));
			processManager.onDidChangeResponsiveState((responsiveState) => {
				this._onDidChangeResponsiveChange.fire({
					extensionHostId: extensionHostId,
					extensionHostKind: processManager.kind,
					isResponsive: responsiveState === ResponsiveState.Responsive
				});
			});
			this._extensionHostManagers.push(processManager);
		});
	}

	private _onExtensionHostCrashOrExit(extensionHost: IExtensionHostManager, code: number, signal: string | null): void {

		// Unexpected termination
		if (!this._isExtensionDevHost) {
			this._onExtensionHostCrashed(extensionHost, code, signal);
			return;
		}

		this._onExtensionHostExit(code);
	}

	protected _onExtensionHostCrashed(extensionHost: IExtensionHostManager, code: number, signal: string | null): void {
		console.error(`Extension host (${extensionHostKindToString(extensionHost.kind)}) terminated unexpectedly. Code: ${code}, Signal: ${signal}`);
		if (extensionHost.kind === ExtensionHostKind.LocalProcess) {
			this.stopExtensionHosts();
		} else if (extensionHost.kind === ExtensionHostKind.Remote) {
			for (let i = 0; i < this._extensionHostManagers.length; i++) {
				if (this._extensionHostManagers[i] === extensionHost) {
					this._extensionHostManagers[i].dispose();
					this._extensionHostManagers.splice(i, 1);
					break;
				}
			}
		}
	}

	public async startExtensionHosts(): Promise<void> {
		this.stopExtensionHosts();

		const lock = await this._registryLock.acquire('startExtensionHosts');
		try {
			this._startExtensionHosts(false, Array.from(this._allRequestedActivateEvents.keys()));

			const localProcessExtensionHosts = this._getExtensionHostManagers(ExtensionHostKind.LocalProcess);
			await Promise.all(localProcessExtensionHosts.map(extHost => extHost.ready()));
		} finally {
			lock.dispose();
		}
	}

	public async restartExtensionHost(): Promise<void> {
		this.stopExtensionHosts();
		await this.startExtensionHosts();
	}

	//#endregion

	//#region IExtensionService

	public activateByEvent(activationEvent: string, activationKind: ActivationKind = ActivationKind.Normal): Promise<void> {
		if (this._installedExtensionsReady.isOpen()) {
			// Extensions have been scanned and interpreted

			// Record the fact that this activationEvent was requested (in case of a restart)
			this._allRequestedActivateEvents.add(activationEvent);

			if (!this._registry.containsActivationEvent(activationEvent)) {
				// There is no extension that is interested in this activation event
				return NO_OP_VOID_PROMISE;
			}

			return this._activateByEvent(activationEvent, activationKind);
		} else {
			// Extensions have not been scanned yet.

			// Record the fact that this activationEvent was requested (in case of a restart)
			this._allRequestedActivateEvents.add(activationEvent);

			if (activationKind === ActivationKind.Immediate) {
				// Do not wait for the normal start-up of the extension host(s)
				return this._activateByEvent(activationEvent, activationKind);
			}

			return this._installedExtensionsReady.wait().then(() => this._activateByEvent(activationEvent, activationKind));
		}
	}

	private _activateByEvent(activationEvent: string, activationKind: ActivationKind): Promise<void> {
		const result = Promise.all(
			this._extensionHostManagers.map(extHostManager => extHostManager.activateByEvent(activationEvent, activationKind))
		).then(() => { });
		this._onWillActivateByEvent.fire({
			event: activationEvent,
			activation: result
		});
		return result;
	}

	public activationEventIsDone(activationEvent: string): boolean {
		if (!this._installedExtensionsReady.isOpen()) {
			return false;
		}
		if (!this._registry.containsActivationEvent(activationEvent)) {
			// There is no extension that is interested in this activation event
			return true;
		}
		return this._extensionHostManagers.every(manager => manager.activationEventIsDone(activationEvent));
	}

	public whenInstalledExtensionsRegistered(): Promise<boolean> {
		return this._installedExtensionsReady.wait();
	}

	public getExtensions(): Promise<IExtensionDescription[]> {
		return this._installedExtensionsReady.wait().then(() => {
			return this._registry.getAllExtensionDescriptions();
		});
	}

	public getExtension(id: string): Promise<IExtensionDescription | undefined> {
		return this._installedExtensionsReady.wait().then(() => {
			return this._registry.getExtensionDescription(id);
		});
	}

	public readExtensionPointContributions<T extends IExtensionContributions[keyof IExtensionContributions]>(extPoint: IExtensionPoint<T>): Promise<ExtensionPointContribution<T>[]> {
		return this._installedExtensionsReady.wait().then(() => {
			const availableExtensions = this._registry.getAllExtensionDescriptions();

			const result: ExtensionPointContribution<T>[] = [];
			for (const desc of availableExtensions) {
				if (desc.contributes && hasOwnProperty.call(desc.contributes, extPoint.name)) {
					result.push(new ExtensionPointContribution<T>(desc, desc.contributes[extPoint.name as keyof typeof desc.contributes] as T));
				}
			}

			return result;
		});
	}

	public getExtensionsStatus(): { [id: string]: IExtensionsStatus } {
		let result: { [id: string]: IExtensionsStatus } = Object.create(null);
		if (this._registry) {
			const extensions = this._registry.getAllExtensionDescriptions();
			for (const extension of extensions) {
				const extensionKey = ExtensionIdentifier.toKey(extension.identifier);
				result[extension.identifier.value] = {
					messages: this._extensionsMessages.get(extensionKey) || [],
					activationTimes: this._extensionHostActivationTimes.get(extensionKey),
					runtimeErrors: this._extensionHostExtensionRuntimeErrors.get(extensionKey) || [],
					runningLocation: this._runningLocation.get(extensionKey) || null,
				};
			}
		}
		return result;
	}

	public async getInspectPort(extensionHostId: string, tryEnableInspector: boolean): Promise<number> {
		for (const extHostManager of this._extensionHostManagers) {
			if (extHostManager.extensionHostId === extensionHostId) {
				return extHostManager.getInspectPort(tryEnableInspector);
			}
		}
		return 0;
	}

	public async getInspectPorts(extensionHostKind: ExtensionHostKind, tryEnableInspector: boolean): Promise<number[]> {
		const result = await Promise.all(
			this._getExtensionHostManagers(extensionHostKind).map(extHost => extHost.getInspectPort(tryEnableInspector))
		);
		// remove 0s:
		return result.filter(element => Boolean(element));
	}

	public async setRemoteEnvironment(env: { [key: string]: string | null }): Promise<void> {
		await this._extensionHostManagers
			.map(manager => manager.setRemoteEnvironment(env));
	}

	//#endregion

	// --- impl

	protected _checkEnableProposedApi(extensions: IExtensionDescription[]): void {
		for (let extension of extensions) {
			this._proposedApiController.updateEnabledApiProposals(extension);
		}
	}

	/**
	 * @argument extensions The extensions to be checked.
	 * @argument ignoreWorkspaceTrust Do not take workspace trust into account.
	 */
	protected _checkEnabledAndProposedAPI(extensions: IExtensionDescription[], ignoreWorkspaceTrust: boolean): IExtensionDescription[] {
		// enable or disable proposed API per extension
		this._checkEnableProposedApi(extensions);

		// keep only enabled extensions
		return this._filterEnabledExtensions(extensions, ignoreWorkspaceTrust);
	}

	/**
	 * @argument extension The extension to be checked.
	 * @argument ignoreWorkspaceTrust Do not take workspace trust into account.
	 */
	protected _isEnabled(extension: IExtensionDescription, ignoreWorkspaceTrust: boolean): boolean {
		return this._filterEnabledExtensions([extension], ignoreWorkspaceTrust).includes(extension);
	}

	protected _safeInvokeIsEnabled(extension: IExtension): boolean {
		try {
			return this._extensionEnablementService.isEnabled(extension);
		} catch (err) {
			return false;
		}
	}

	private _filterEnabledExtensions(extensions: IExtensionDescription[], ignoreWorkspaceTrust: boolean): IExtensionDescription[] {
		const enabledExtensions: IExtensionDescription[] = [], extensionsToCheck: IExtensionDescription[] = [], mappedExtensions: IExtension[] = [];
		for (const extension of extensions) {
			if (extension.isUnderDevelopment) {
				// Never disable extensions under development
				enabledExtensions.push(extension);
			}
			else {
				extensionsToCheck.push(extension);
				mappedExtensions.push(toExtension(extension));
			}
		}

		const enablementStates = this._extensionEnablementService.getEnablementStates(mappedExtensions, ignoreWorkspaceTrust ? { trusted: true } : undefined);
		for (let index = 0; index < enablementStates.length; index++) {
			if (this._extensionEnablementService.isEnabledEnablementState(enablementStates[index])) {
				enabledExtensions.push(extensionsToCheck[index]);
			}
		}

		return enabledExtensions;
	}

	protected _doHandleExtensionPoints(affectedExtensions: IExtensionDescription[]): void {
		const affectedExtensionPoints: { [extPointName: string]: boolean } = Object.create(null);
		for (let extensionDescription of affectedExtensions) {
			if (extensionDescription.contributes) {
				for (let extPointName in extensionDescription.contributes) {
					if (hasOwnProperty.call(extensionDescription.contributes, extPointName)) {
						affectedExtensionPoints[extPointName] = true;
					}
				}
			}
		}

		const messageHandler = (msg: IMessage) => this._handleExtensionPointMessage(msg);
		const availableExtensions = this._registry.getAllExtensionDescriptions();
		const extensionPoints = ExtensionsRegistry.getExtensionPoints();
		perf.mark('code/willHandleExtensionPoints');
		for (const extensionPoint of extensionPoints) {
			if (affectedExtensionPoints[extensionPoint.name]) {
				AbstractExtensionService._handleExtensionPoint(extensionPoint, availableExtensions, messageHandler);
			}
		}
		perf.mark('code/didHandleExtensionPoints');
	}

	private _handleExtensionPointMessage(msg: IMessage) {
		const extensionKey = ExtensionIdentifier.toKey(msg.extensionId);

		if (!this._extensionsMessages.has(extensionKey)) {
			this._extensionsMessages.set(extensionKey, []);
		}
		this._extensionsMessages.get(extensionKey)!.push(msg);

		const extension = this._registry.getExtensionDescription(msg.extensionId);
		const strMsg = `[${msg.extensionId.value}]: ${msg.message}`;
		if (extension && extension.isUnderDevelopment) {
			// This message is about the extension currently being developed
			this._showMessageToUser(msg.type, strMsg);
		} else {
			this._logMessageInConsole(msg.type, strMsg);
		}

		if (!this._isDev && msg.extensionId) {
			const { type, extensionId, extensionPointId, message } = msg;
			type ExtensionsMessageClassification = {
				type: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true };
				extensionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
				extensionPointId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
				message: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
			};
			type ExtensionsMessageEvent = {
				type: Severity;
				extensionId: string;
				extensionPointId: string;
				message: string;
			};
			this._telemetryService.publicLog2<ExtensionsMessageEvent, ExtensionsMessageClassification>('extensionsMessage', {
				type, extensionId: extensionId.value, extensionPointId, message
			});
		}
	}

	private static _handleExtensionPoint<T extends IExtensionContributions[keyof IExtensionContributions]>(extensionPoint: ExtensionPoint<T>, availableExtensions: IExtensionDescription[], messageHandler: (msg: IMessage) => void): void {
		const users: IExtensionPointUser<T>[] = [];
		for (const desc of availableExtensions) {
			if (desc.contributes && hasOwnProperty.call(desc.contributes, extensionPoint.name)) {
				users.push({
					description: desc,
					value: desc.contributes[extensionPoint.name as keyof typeof desc.contributes] as T,
					collector: new ExtensionMessageCollector(messageHandler, desc, extensionPoint.name)
				});
			}
		}
		extensionPoint.acceptUsers(users);
	}

	private _showMessageToUser(severity: Severity, msg: string): void {
		if (severity === Severity.Error || severity === Severity.Warning) {
			this._notificationService.notify({ severity, message: msg });
		} else {
			this._logMessageInConsole(severity, msg);
		}
	}

	private _logMessageInConsole(severity: Severity, msg: string): void {
		if (severity === Severity.Error) {
			console.error(msg);
		} else if (severity === Severity.Warning) {
			console.warn(msg);
		} else {
			console.log(msg);
		}
	}

	//#region Called by extension host

	protected createLogger(): Logger {
		return new Logger((severity, source, message) => {
			if (source) {
				this._logOrShowMessage(severity, `[${source}]: ${message}`);
			} else {
				this._logOrShowMessage(severity, message);
			}
		});
	}

	protected _logOrShowMessage(severity: Severity, msg: string): void {
		if (this._isDev) {
			this._showMessageToUser(severity, msg);
		}
		this._logMessageInConsole(severity, msg);
	}

	private _acquireInternalAPI(): IInternalExtensionService {
		return {
			_activateById: (extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void> => {
				return this._activateById(extensionId, reason);
			},
			_onWillActivateExtension: (extensionId: ExtensionIdentifier): void => {
				return this._onWillActivateExtension(extensionId);
			},
			_onDidActivateExtension: (extensionId: ExtensionIdentifier, codeLoadingTime: number, activateCallTime: number, activateResolvedTime: number, activationReason: ExtensionActivationReason): void => {
				return this._onDidActivateExtension(extensionId, codeLoadingTime, activateCallTime, activateResolvedTime, activationReason);
			},
			_onDidActivateExtensionError: (extensionId: ExtensionIdentifier, error: Error): void => {
				return this._onDidActivateExtensionError(extensionId, error);
			},
			_onExtensionRuntimeError: (extensionId: ExtensionIdentifier, err: Error): void => {
				return this._onExtensionRuntimeError(extensionId, err);
			}
		};
	}

	public async _activateById(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void> {
		const results = await Promise.all(
			this._extensionHostManagers.map(manager => manager.activate(extensionId, reason))
		);
		const activated = results.some(e => e);
		if (!activated) {
			throw new Error(`Unknown extension ${extensionId.value}`);
		}
	}

	private _onWillActivateExtension(extensionId: ExtensionIdentifier): void {
		this._extensionHostActiveExtensions.set(ExtensionIdentifier.toKey(extensionId), extensionId);
	}

	private _onDidActivateExtension(extensionId: ExtensionIdentifier, codeLoadingTime: number, activateCallTime: number, activateResolvedTime: number, activationReason: ExtensionActivationReason): void {
		this._extensionHostActivationTimes.set(ExtensionIdentifier.toKey(extensionId), new ActivationTimes(codeLoadingTime, activateCallTime, activateResolvedTime, activationReason));
		this._onDidChangeExtensionsStatus.fire([extensionId]);
	}

	private _onDidActivateExtensionError(extensionId: ExtensionIdentifier, error: Error): void {
		type ExtensionActivationErrorClassification = {
			extensionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
			error: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth' };
		};
		type ExtensionActivationErrorEvent = {
			extensionId: string;
			error: string;
		};
		this._telemetryService.publicLog2<ExtensionActivationErrorEvent, ExtensionActivationErrorClassification>('extensionActivationError', {
			extensionId: extensionId.value,
			error: error.message
		});
	}

	private _onExtensionRuntimeError(extensionId: ExtensionIdentifier, err: Error): void {
		const extensionKey = ExtensionIdentifier.toKey(extensionId);
		if (!this._extensionHostExtensionRuntimeErrors.has(extensionKey)) {
			this._extensionHostExtensionRuntimeErrors.set(extensionKey, []);
		}
		this._extensionHostExtensionRuntimeErrors.get(extensionKey)!.push(err);
		this._onDidChangeExtensionsStatus.fire([extensionId]);
	}

	protected async _scanWebExtensions(): Promise<IExtensionDescription[]> {
		const log = this.createLogger();
		const system: IExtensionDescription[] = [], user: IExtensionDescription[] = [], development: IExtensionDescription[] = [];
		try {
			await Promise.all([
				this._webExtensionsScannerService.scanSystemExtensions().then(extensions => system.push(...extensions.map(e => toExtensionDescription(e)))),
				this._webExtensionsScannerService.scanUserExtensions().then(extensions => user.push(...extensions.map(e => toExtensionDescription(e)))),
				this._webExtensionsScannerService.scanExtensionsUnderDevelopment().then(extensions => development.push(...extensions.map(e => toExtensionDescription(e, true))))
			]);
		} catch (error) {
			log.error('', error);
		}
		return dedupExtensions(system, user, development, log);
	}

	//#endregion

	protected abstract _createExtensionHosts(isInitialStart: boolean): IExtensionHost[];
	protected abstract _scanAndHandleExtensions(): Promise<void>;
	protected abstract _scanSingleExtension(extension: IExtension): Promise<IExtensionDescription | null>;
	public abstract _onExtensionHostExit(code: number): void;
}

class ExtensionWithKind {

	constructor(
		public readonly desc: IExtensionDescription,
		public readonly kind: ExtensionKind[]
	) { }

	public get key(): string {
		return ExtensionIdentifier.toKey(this.desc.identifier);
	}

	public get isUnderDevelopment(): boolean {
		return this.desc.isUnderDevelopment;
	}
}

class ExtensionInfo {

	constructor(
		public readonly local: ExtensionWithKind | null,
		public readonly remote: ExtensionWithKind | null,
	) { }

	public get key(): string {
		if (this.local) {
			return this.local.key;
		}
		return this.remote!.key;
	}

	public get identifier(): ExtensionIdentifier {
		if (this.local) {
			return this.local.desc.identifier;
		}
		return this.remote!.desc.identifier;
	}

	public get kind(): ExtensionKind[] {
		// in case of disagreements between extension kinds, it is always
		// better to pick the local extension because it has a much higher
		// chance of being up-to-date
		if (this.local) {
			return this.local.kind;
		}
		return this.remote!.kind;
	}
}

class ExtensionHostKindClassifier {

	private static _toExtensionWithKind(
		extensions: IExtensionDescription[],
		getExtensionKind: (extensionDescription: IExtensionDescription) => ExtensionKind[]
	): Map<string, ExtensionWithKind> {
		const result = new Map<string, ExtensionWithKind>();
		extensions.forEach((desc) => {
			const ext = new ExtensionWithKind(desc, getExtensionKind(desc));
			result.set(ext.key, ext);
		});
		return result;
	}

	public static determineExtensionHostKinds(
		_localExtensions: IExtensionDescription[],
		_remoteExtensions: IExtensionDescription[],
		getExtensionKind: (extensionDescription: IExtensionDescription) => ExtensionKind[],
		pickExtensionHostKind: (extensionId: ExtensionIdentifier, extensionKinds: ExtensionKind[], isInstalledLocally: boolean, isInstalledRemotely: boolean, preference: ExtensionRunningPreference) => ExtensionHostKind | null
	): Map<string, ExtensionHostKind | null> {
		const localExtensions = this._toExtensionWithKind(_localExtensions, getExtensionKind);
		const remoteExtensions = this._toExtensionWithKind(_remoteExtensions, getExtensionKind);

		const allExtensions = new Map<string, ExtensionInfo>();
		const collectExtension = (ext: ExtensionWithKind) => {
			if (allExtensions.has(ext.key)) {
				return;
			}
			const local = localExtensions.get(ext.key) || null;
			const remote = remoteExtensions.get(ext.key) || null;
			const info = new ExtensionInfo(local, remote);
			allExtensions.set(info.key, info);
		};
		localExtensions.forEach((ext) => collectExtension(ext));
		remoteExtensions.forEach((ext) => collectExtension(ext));

		const extensionHostKinds = new Map<string, ExtensionHostKind | null>();
		allExtensions.forEach((ext) => {
			const isInstalledLocally = Boolean(ext.local);
			const isInstalledRemotely = Boolean(ext.remote);

			const isLocallyUnderDevelopment = Boolean(ext.local && ext.local.isUnderDevelopment);
			const isRemotelyUnderDevelopment = Boolean(ext.remote && ext.remote.isUnderDevelopment);

			let preference = ExtensionRunningPreference.None;
			if (isLocallyUnderDevelopment && !isRemotelyUnderDevelopment) {
				preference = ExtensionRunningPreference.Local;
			} else if (isRemotelyUnderDevelopment && !isLocallyUnderDevelopment) {
				preference = ExtensionRunningPreference.Remote;
			}

			extensionHostKinds.set(ext.key, pickExtensionHostKind(ext.identifier, ext.kind, isInstalledLocally, isInstalledRemotely, preference));
		});

		return extensionHostKinds;
	}
}

class ProposedApiController {

	private readonly _envEnablesProposedApiForAll: boolean;
	private readonly _envEnabledExtensions: Set<string>;
	private readonly _productEnabledExtensions: Map<string, string[]>;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IProductService productService: IProductService
	) {

		this._envEnabledExtensions = new Set((_environmentService.extensionEnabledProposedApi ?? []).map(id => ExtensionIdentifier.toKey(id)));

		this._envEnablesProposedApiForAll =
			!_environmentService.isBuilt || // always allow proposed API when running out of sources
			(_environmentService.isExtensionDevelopment && productService.quality !== 'stable') || // do not allow proposed API against stable builds when developing an extension
			(this._envEnabledExtensions.size === 0 && Array.isArray(_environmentService.extensionEnabledProposedApi)); // always allow proposed API if --enable-proposed-api is provided without extension ID

		this._productEnabledExtensions = new Map<string, ApiProposalName[]>();


		// NEW world - product.json spells out what proposals each extension can use
		if (productService.extensionEnabledApiProposals) {
			forEach(productService.extensionEnabledApiProposals, entry => {
				const key = ExtensionIdentifier.toKey(entry.key);
				const proposalNames = entry.value.filter(name => {
					if (!allApiProposals[<ApiProposalName>name]) {
						_logService.warn(`Via 'product.json#extensionEnabledApiProposals' extension '${key}' wants API proposal '${name}' but that proposal DOES NOT EXIST. Likely, the proposal has been finalized (check 'vscode.d.ts') or was abandoned.`);
						return false;
					}
					return true;
				});
				this._productEnabledExtensions.set(key, proposalNames);
			});
		}
	}

	updateEnabledApiProposals(_extension: IExtensionDescription): void {

		// this is a trick to make the extension description writeable...
		type Writeable<T> = { -readonly [P in keyof T]: Writeable<T[P]> };
		const extension = <Writeable<IExtensionDescription>>_extension;
		const key = ExtensionIdentifier.toKey(_extension.identifier);

		// warn about invalid proposal and remove them from the list
		if (isNonEmptyArray(extension.enabledApiProposals)) {
			extension.enabledApiProposals = extension.enabledApiProposals.filter(name => {
				const result = Boolean(allApiProposals[<ApiProposalName>name]);
				if (!result) {
					this._logService.critical(`Extension '${key}' wants API proposal '${name}' but that proposal DOES NOT EXIST. Likely, the proposal has been finalized (check 'vscode.d.ts') or was abandoned.`);
				}
				return result;
			});
		}


		if (this._productEnabledExtensions.has(key)) {
			// NOTE that proposals that are listed in product.json override whatever is declared in the extension
			// itself. This is needed for us to know what proposals are used "in the wild". Merging product.json-proposals
			// and extension-proposals would break that.

			const productEnabledProposals = this._productEnabledExtensions.get(key)!;

			// check for difference between product.json-declaration and package.json-declaration
			const productSet = new Set(productEnabledProposals);
			const extensionSet = new Set(extension.enabledApiProposals);
			const diff = new Set([...extensionSet].filter(a => !productSet.has(a)));
			if (diff.size > 0) {
				this._logService.critical(`Extension '${key}' appears in product.json but enables LESS API proposals than the extension wants.\npackage.json (LOSES): ${[...extensionSet].join(', ')}\nproduct.json (WINS): ${[...productSet].join(', ')}`);

				if (this._environmentService.isExtensionDevelopment) {
					this._logService.critical(`Proceeding with EXTRA proposals (${[...diff].join(', ')}) because extension is in development mode. Still, this EXTENSION WILL BE BROKEN unless product.json is updated.`);
					productEnabledProposals.push(...diff);
				}
			}

			extension.enabledApiProposals = productEnabledProposals;
			return;
		}

		if (this._envEnablesProposedApiForAll || this._envEnabledExtensions.has(key)) {
			// proposed API usage is not restricted and allowed just like the extension
			// has declared it
			return;
		}

		if (!extension.isBuiltin && isNonEmptyArray(extension.enabledApiProposals)) {
			// restrictive: extension cannot use proposed API in this context and its declaration is nulled
			this._logService.critical(`Extension '${extension.identifier.value} CANNOT USE these API proposals '${extension.enabledApiProposals?.join(', ') || '*'}'. You MUST start in extension development mode or use the --enable-proposed-api command line flag`);
			extension.enabledApiProposals = [];
		}
	}
}

export function filterByRunningLocation(extensions: IExtensionDescription[], runningLocation: Map<string, ExtensionRunningLocation | null>, desiredRunningLocation: ExtensionRunningLocation): IExtensionDescription[] {
	return _filterByRunningLocation(extensions, ext => ext.identifier, runningLocation, desiredRunningLocation);
}

function _filterByRunningLocation<T>(extensions: T[], extId: (item: T) => ExtensionIdentifier, runningLocation: Map<string, ExtensionRunningLocation | null>, desiredRunningLocation: ExtensionRunningLocation): T[] {
	return _filterExtensions(extensions, extId, runningLocation, extRunningLocation => desiredRunningLocation.equals(extRunningLocation));
}

export function filterByExtensionHostKind(extensions: IExtensionDescription[], runningLocation: Map<string, ExtensionRunningLocation | null>, desiredExtensionHostKind: ExtensionHostKind): IExtensionDescription[] {
	return _filterExtensions(extensions, ext => ext.identifier, runningLocation, extRunningLocation => extRunningLocation.kind === desiredExtensionHostKind);
}

export function filterByExtensionHostManager(extensions: IExtensionDescription[], runningLocation: Map<string, ExtensionRunningLocation | null>, extensionHostManager: IExtensionHostManager): IExtensionDescription[] {
	return _filterByExtensionHostManager(extensions, ext => ext.identifier, runningLocation, extensionHostManager);
}

function _filterByExtensionHostManager<T>(extensions: T[], extId: (item: T) => ExtensionIdentifier, runningLocation: Map<string, ExtensionRunningLocation | null>, extensionHostManager: IExtensionHostManager): T[] {
	return _filterExtensions(extensions, extId, runningLocation, extRunningLocation => extensionHostManager.representsRunningLocation(extRunningLocation));
}

function _filterExtensions<T>(extensions: T[], extId: (item: T) => ExtensionIdentifier, runningLocation: Map<string, ExtensionRunningLocation | null>, predicate: (extRunningLocation: ExtensionRunningLocation) => boolean): T[] {
	return extensions.filter((ext) => {
		const extRunningLocation = runningLocation.get(ExtensionIdentifier.toKey(extId(ext)));
		return extRunningLocation && predicate(extRunningLocation);
	});
}
