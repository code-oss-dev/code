/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IStringDictionary } from 'vs/base/common/collections';
import { CancellationError, getErrorMessage, isCancellationError } from 'vs/base/common/errors';
import { getOrDefault } from 'vs/base/common/objects';
import { IPager } from 'vs/base/common/paging';
import { isWeb, platform } from 'vs/base/common/platform';
import { arch } from 'vs/base/common/process';
import { isBoolean } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { IHeaders, IRequestContext, IRequestOptions } from 'vs/base/parts/request/common/request';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { DefaultIconPath, getFallbackTargetPlarforms, getTargetPlatform, IExtensionGalleryService, IExtensionIdentifier, IExtensionIdentifierWithVersion, IGalleryExtension, IGalleryExtensionAsset, IGalleryExtensionAssets, IGalleryExtensionVersion, InstallOperation, IQueryOptions, IExtensionsControlManifest, isIExtensionIdentifier, isNotWebExtensionInWebTargetPlatform, isTargetPlatformCompatible, ITranslation, SortBy, SortOrder, StatisticType, TargetPlatform, toTargetPlatform, WEB_EXTENSION_TAG, IExtensionIdentifierWithPreRelease } from 'vs/platform/extensionManagement/common/extensionManagement';
import { adoptToGalleryExtensionId, areSameExtensions, getGalleryExtensionId, getGalleryExtensionTelemetryData } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IExtensionManifest } from 'vs/platform/extensions/common/extensions';
import { isEngineValid } from 'vs/platform/extensions/common/extensionValidator';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { IProductService } from 'vs/platform/product/common/productService';
import { asJson, asText, IRequestService, isSuccess } from 'vs/platform/request/common/request';
import { getServiceMachineId } from 'vs/platform/serviceMachineId/common/serviceMachineId';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService, TelemetryLevel } from 'vs/platform/telemetry/common/telemetry';
import { getTelemetryLevel, supportsTelemetry } from 'vs/platform/telemetry/common/telemetryUtils';

const CURRENT_TARGET_PLATFORM = isWeb ? TargetPlatform.WEB : getTargetPlatform(platform, arch);

interface IRawGalleryExtensionFile {
	readonly assetType: string;
	readonly source: string;
}

interface IRawGalleryExtensionProperty {
	readonly key: string;
	readonly value: string;
}

export interface IRawGalleryExtensionVersion {
	readonly version: string;
	readonly lastUpdated: string;
	readonly assetUri: string;
	readonly fallbackAssetUri: string;
	readonly files: IRawGalleryExtensionFile[];
	readonly properties?: IRawGalleryExtensionProperty[];
	readonly targetPlatform?: string;
}

interface IRawGalleryExtensionStatistics {
	readonly statisticName: string;
	readonly value: number;
}

interface IRawGalleryExtensionPublisher {
	readonly displayName: string;
	readonly publisherId: string;
	readonly publisherName: string;
	readonly domain?: string | null;
	readonly isDomainVerified?: boolean;
}

interface IRawGalleryExtension {
	readonly extensionId: string;
	readonly extensionName: string;
	readonly displayName: string;
	readonly shortDescription: string;
	readonly publisher: IRawGalleryExtensionPublisher;
	readonly versions: IRawGalleryExtensionVersion[];
	readonly statistics: IRawGalleryExtensionStatistics[];
	readonly tags: string[] | undefined;
	readonly releaseDate: string;
	readonly publishedDate: string;
	readonly lastUpdated: string;
	readonly categories: string[] | undefined;
	readonly flags: string;
}

interface IRawGalleryQueryResult {
	readonly results: {
		readonly extensions: IRawGalleryExtension[];
		readonly resultMetadata: {
			readonly metadataType: string;
			readonly metadataItems: {
				readonly name: string;
				readonly count: number;
			}[];
		}[];
	}[];
}

enum Flags {

	/**
	 * None is used to retrieve only the basic extension details.
	 */
	None = 0x0,

	/**
	 * IncludeVersions will return version information for extensions returned
	 */
	IncludeVersions = 0x1,

	/**
	 * IncludeFiles will return information about which files were found
	 * within the extension that were stored independent of the manifest.
	 * When asking for files, versions will be included as well since files
	 * are returned as a property of the versions.
	 * These files can be retrieved using the path to the file without
	 * requiring the entire manifest be downloaded.
	 */
	IncludeFiles = 0x2,

	/**
	 * Include the Categories and Tags that were added to the extension definition.
	 */
	IncludeCategoryAndTags = 0x4,

	/**
	 * Include the details about which accounts the extension has been shared
	 * with if the extension is a private extension.
	 */
	IncludeSharedAccounts = 0x8,

	/**
	 * Include properties associated with versions of the extension
	 */
	IncludeVersionProperties = 0x10,

	/**
	 * Excluding non-validated extensions will remove any extension versions that
	 * either are in the process of being validated or have failed validation.
	 */
	ExcludeNonValidated = 0x20,

	/**
	 * Include the set of installation targets the extension has requested.
	 */
	IncludeInstallationTargets = 0x40,

	/**
	 * Include the base uri for assets of this extension
	 */
	IncludeAssetUri = 0x80,

	/**
	 * Include the statistics associated with this extension
	 */
	IncludeStatistics = 0x100,

	/**
	 * When retrieving versions from a query, only include the latest
	 * version of the extensions that matched. This is useful when the
	 * caller doesn't need all the published versions. It will save a
	 * significant size in the returned payload.
	 */
	IncludeLatestVersionOnly = 0x200,

	/**
	 * This flag switches the asset uri to use GetAssetByName instead of CDN
	 * When this is used, values of base asset uri and base asset uri fallback are switched
	 * When this is used, source of asset files are pointed to Gallery service always even if CDN is available
	 */
	Unpublished = 0x1000,

	/**
	 * Include the details if an extension is in conflict list or not
	 */
	IncludeNameConflictInfo = 0x8000,
}

function flagsToString(...flags: Flags[]): string {
	return String(flags.reduce((r, f) => r | f, 0));
}

enum FilterType {
	Tag = 1,
	ExtensionId = 4,
	Category = 5,
	ExtensionName = 7,
	Target = 8,
	Featured = 9,
	SearchText = 10,
	ExcludeWithFlags = 12
}

const AssetType = {
	Icon: 'Microsoft.VisualStudio.Services.Icons.Default',
	Details: 'Microsoft.VisualStudio.Services.Content.Details',
	Changelog: 'Microsoft.VisualStudio.Services.Content.Changelog',
	Manifest: 'Microsoft.VisualStudio.Code.Manifest',
	VSIX: 'Microsoft.VisualStudio.Services.VSIXPackage',
	License: 'Microsoft.VisualStudio.Services.Content.License',
	Repository: 'Microsoft.VisualStudio.Services.Links.Source'
};

const PropertyType = {
	Dependency: 'Microsoft.VisualStudio.Code.ExtensionDependencies',
	ExtensionPack: 'Microsoft.VisualStudio.Code.ExtensionPack',
	Engine: 'Microsoft.VisualStudio.Code.Engine',
	PreRelease: 'Microsoft.VisualStudio.Code.PreRelease',
	LocalizedLanguages: 'Microsoft.VisualStudio.Code.LocalizedLanguages',
	WebExtension: 'Microsoft.VisualStudio.Code.WebExtension'
};

interface ICriterium {
	readonly filterType: FilterType;
	readonly value?: string;
}

const DefaultPageSize = 10;

interface IQueryState {
	readonly pageNumber: number;
	readonly pageSize: number;
	readonly sortBy: SortBy;
	readonly sortOrder: SortOrder;
	readonly flags: Flags;
	readonly criteria: ICriterium[];
	readonly assetTypes: string[];
}

const DefaultQueryState: IQueryState = {
	pageNumber: 1,
	pageSize: DefaultPageSize,
	sortBy: SortBy.NoneOrRelevance,
	sortOrder: SortOrder.Default,
	flags: Flags.None,
	criteria: [],
	assetTypes: []
};

type GalleryServiceQueryClassification = {
	readonly filterTypes: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly flags: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly sortBy: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly sortOrder: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly duration: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', 'isMeasurement': true; };
	readonly success: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly requestBodySize: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly responseBodySize?: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly statusCode?: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly errorCode?: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
	readonly count?: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
};

type QueryTelemetryData = {
	readonly flags: number;
	readonly filterTypes: string[];
	readonly sortBy: string;
	readonly sortOrder: string;
};

type GalleryServiceQueryEvent = QueryTelemetryData & {
	readonly duration: number;
	readonly success: boolean;
	readonly requestBodySize: string;
	readonly responseBodySize?: string;
	readonly statusCode?: string;
	readonly errorCode?: string;
	readonly count?: string;
};

type GalleryServiceAdditionalQueryClassification = {
	readonly duration: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', 'isMeasurement': true };
	readonly count: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

type GalleryServiceAdditionalQueryEvent = {
	readonly duration: number;
	readonly count: number;
};

interface IExtensionCriteria {
	readonly targetPlatform: TargetPlatform;
	readonly compatible: boolean;
	readonly preRelease: boolean | IExtensionIdentifierWithPreRelease[];
	readonly versions?: IExtensionIdentifierWithVersion[];
}

class Query {

	constructor(private state = DefaultQueryState) { }

	get pageNumber(): number { return this.state.pageNumber; }
	get pageSize(): number { return this.state.pageSize; }
	get sortBy(): number { return this.state.sortBy; }
	get sortOrder(): number { return this.state.sortOrder; }
	get flags(): number { return this.state.flags; }

	withPage(pageNumber: number, pageSize: number = this.state.pageSize): Query {
		return new Query({ ...this.state, pageNumber, pageSize });
	}

	withFilter(filterType: FilterType, ...values: string[]): Query {
		const criteria = [
			...this.state.criteria,
			...values.length ? values.map(value => ({ filterType, value })) : [{ filterType }]
		];

		return new Query({ ...this.state, criteria });
	}

	withSortBy(sortBy: SortBy): Query {
		return new Query({ ...this.state, sortBy });
	}

	withSortOrder(sortOrder: SortOrder): Query {
		return new Query({ ...this.state, sortOrder });
	}

	withFlags(...flags: Flags[]): Query {
		return new Query({ ...this.state, flags: flags.reduce<number>((r, f) => r | f, 0) });
	}

	withAssetTypes(...assetTypes: string[]): Query {
		return new Query({ ...this.state, assetTypes });
	}

	get raw(): any {
		const { criteria, pageNumber, pageSize, sortBy, sortOrder, flags, assetTypes } = this.state;
		const filters = [{ criteria, pageNumber, pageSize, sortBy, sortOrder }];
		return { filters, assetTypes, flags };
	}

	get searchText(): string {
		const criterium = this.state.criteria.filter(criterium => criterium.filterType === FilterType.SearchText)[0];
		return criterium && criterium.value ? criterium.value : '';
	}

	get telemetryData(): QueryTelemetryData {
		return {
			filterTypes: this.state.criteria.map(criterium => String(criterium.filterType)),
			flags: this.state.flags,
			sortBy: String(this.sortBy),
			sortOrder: String(this.sortOrder)
		};
	}
}

function getStatistic(statistics: IRawGalleryExtensionStatistics[], name: string): number {
	const result = (statistics || []).filter(s => s.statisticName === name)[0];
	return result ? result.value : 0;
}

function getCoreTranslationAssets(version: IRawGalleryExtensionVersion): [string, IGalleryExtensionAsset][] {
	const coreTranslationAssetPrefix = 'Microsoft.VisualStudio.Code.Translation.';
	const result = version.files.filter(f => f.assetType.indexOf(coreTranslationAssetPrefix) === 0);
	return result.reduce<[string, IGalleryExtensionAsset][]>((result, file) => {
		const asset = getVersionAsset(version, file.assetType);
		if (asset) {
			result.push([file.assetType.substring(coreTranslationAssetPrefix.length), asset]);
		}
		return result;
	}, []);
}

function getRepositoryAsset(version: IRawGalleryExtensionVersion): IGalleryExtensionAsset | null {
	if (version.properties) {
		const results = version.properties.filter(p => p.key === AssetType.Repository);
		const gitRegExp = new RegExp('((git|ssh|http(s)?)|(git@[\\w.]+))(:(//)?)([\\w.@:/\\-~]+)(.git)(/)?');

		const uri = results.filter(r => gitRegExp.test(r.value))[0];
		return uri ? { uri: uri.value, fallbackUri: uri.value } : null;
	}
	return getVersionAsset(version, AssetType.Repository);
}

function getDownloadAsset(version: IRawGalleryExtensionVersion): IGalleryExtensionAsset {
	return {
		uri: `${version.fallbackAssetUri}/${AssetType.VSIX}?redirect=true${version.targetPlatform ? `&targetPlatform=${version.targetPlatform}` : ''}`,
		fallbackUri: `${version.fallbackAssetUri}/${AssetType.VSIX}${version.targetPlatform ? `?targetPlatform=${version.targetPlatform}` : ''}`
	};
}

function getIconAsset(version: IRawGalleryExtensionVersion): IGalleryExtensionAsset {
	const asset = getVersionAsset(version, AssetType.Icon);
	if (asset) {
		return asset;
	}
	const uri = DefaultIconPath;
	return { uri, fallbackUri: uri };
}

function getVersionAsset(version: IRawGalleryExtensionVersion, type: string): IGalleryExtensionAsset | null {
	const result = version.files.filter(f => f.assetType === type)[0];
	return result ? {
		uri: `${version.assetUri}/${type}${version.targetPlatform ? `?targetPlatform=${version.targetPlatform}` : ''}`,
		fallbackUri: `${version.fallbackAssetUri}/${type}${version.targetPlatform ? `?targetPlatform=${version.targetPlatform}` : ''}`
	} : null;
}

function getExtensions(version: IRawGalleryExtensionVersion, property: string): string[] {
	const values = version.properties ? version.properties.filter(p => p.key === property) : [];
	const value = values.length > 0 && values[0].value;
	return value ? value.split(',').map(v => adoptToGalleryExtensionId(v)) : [];
}

function getEngine(version: IRawGalleryExtensionVersion): string {
	const values = version.properties ? version.properties.filter(p => p.key === PropertyType.Engine) : [];
	return (values.length > 0 && values[0].value) || '';
}

function isPreReleaseVersion(version: IRawGalleryExtensionVersion): boolean {
	const values = version.properties ? version.properties.filter(p => p.key === PropertyType.PreRelease) : [];
	return values.length > 0 && values[0].value === 'true';
}

function getLocalizedLanguages(version: IRawGalleryExtensionVersion): string[] {
	const values = version.properties ? version.properties.filter(p => p.key === PropertyType.LocalizedLanguages) : [];
	const value = (values.length > 0 && values[0].value) || '';
	return value ? value.split(',') : [];
}

function getIsPreview(flags: string): boolean {
	return flags.indexOf('preview') !== -1;
}

function getTargetPlatformForExtensionVersion(version: IRawGalleryExtensionVersion): TargetPlatform {
	return version.targetPlatform ? toTargetPlatform(version.targetPlatform) : TargetPlatform.UNDEFINED;
}

function getAllTargetPlatforms(rawGalleryExtension: IRawGalleryExtension): TargetPlatform[] {
	const allTargetPlatforms = distinct(rawGalleryExtension.versions.map(getTargetPlatformForExtensionVersion));

	// Is a web extension only if it has WEB_EXTENSION_TAG
	const isWebExtension = !!rawGalleryExtension.tags?.includes(WEB_EXTENSION_TAG);

	// Include Web Target Platform only if it is a web extension
	const webTargetPlatformIndex = allTargetPlatforms.indexOf(TargetPlatform.WEB);
	if (isWebExtension) {
		if (webTargetPlatformIndex === -1) {
			// Web extension but does not has web target platform -> add it
			allTargetPlatforms.push(TargetPlatform.WEB);
		}
	} else {
		if (webTargetPlatformIndex !== -1) {
			// Not a web extension but has web target platform -> remove it
			allTargetPlatforms.splice(webTargetPlatformIndex, 1);
		}
	}

	return allTargetPlatforms;
}

export function sortExtensionVersions(versions: IRawGalleryExtensionVersion[], preferredTargetPlatform: TargetPlatform): IRawGalleryExtensionVersion[] {
	/* It is expected that versions from Marketplace are sorted by version. So we are just sorting by preferred targetPlatform */
	const fallbackTargetPlatforms = getFallbackTargetPlarforms(preferredTargetPlatform);
	for (let index = 0; index < versions.length; index++) {
		const version = versions[index];
		if (version.version === versions[index - 1]?.version) {
			let insertionIndex = index;
			const versionTargetPlatform = getTargetPlatformForExtensionVersion(version);
			/* put it at the beginning */
			if (versionTargetPlatform === preferredTargetPlatform) {
				while (insertionIndex > 0 && versions[insertionIndex - 1].version === version.version) { insertionIndex--; }
			}
			/* put it after version with preferred targetPlatform or at the beginning */
			else if (fallbackTargetPlatforms.includes(versionTargetPlatform)) {
				while (insertionIndex > 0 && versions[insertionIndex - 1].version === version.version && getTargetPlatformForExtensionVersion(versions[insertionIndex - 1]) !== preferredTargetPlatform) { insertionIndex--; }
			}
			if (insertionIndex !== index) {
				versions.splice(index, 1);
				versions.splice(insertionIndex, 0, version);
			}
		}
	}
	return versions;
}

function toExtension(galleryExtension: IRawGalleryExtension, version: IRawGalleryExtensionVersion, allTargetPlatforms: TargetPlatform[]): IGalleryExtension {
	const latestVersion = galleryExtension.versions[0];
	const hasReleaseVersion = galleryExtension.versions.some(version => !isPreReleaseVersion(version));
	const assets = <IGalleryExtensionAssets>{
		manifest: getVersionAsset(version, AssetType.Manifest),
		readme: getVersionAsset(version, AssetType.Details),
		changelog: getVersionAsset(version, AssetType.Changelog),
		license: getVersionAsset(version, AssetType.License),
		repository: getRepositoryAsset(version),
		download: getDownloadAsset(version),
		icon: getIconAsset(version),
		coreTranslations: getCoreTranslationAssets(version)
	};

	return {
		identifier: {
			id: getGalleryExtensionId(galleryExtension.publisher.publisherName, galleryExtension.extensionName),
			uuid: galleryExtension.extensionId
		},
		name: galleryExtension.extensionName,
		version: version.version,
		displayName: galleryExtension.displayName,
		publisherId: galleryExtension.publisher.publisherId,
		publisher: galleryExtension.publisher.publisherName,
		publisherDisplayName: galleryExtension.publisher.displayName,
		publisherDomain: galleryExtension.publisher.domain ? { link: galleryExtension.publisher.domain, verified: !!galleryExtension.publisher.isDomainVerified } : undefined,
		description: galleryExtension.shortDescription || '',
		installCount: getStatistic(galleryExtension.statistics, 'install'),
		rating: getStatistic(galleryExtension.statistics, 'averagerating'),
		ratingCount: getStatistic(galleryExtension.statistics, 'ratingcount'),
		categories: galleryExtension.categories || [],
		tags: galleryExtension.tags || [],
		releaseDate: Date.parse(galleryExtension.releaseDate),
		lastUpdated: Date.parse(galleryExtension.lastUpdated),
		allTargetPlatforms,
		assets,
		properties: {
			dependencies: getExtensions(version, PropertyType.Dependency),
			extensionPack: getExtensions(version, PropertyType.ExtensionPack),
			engine: getEngine(version),
			localizedLanguages: getLocalizedLanguages(version),
			targetPlatform: getTargetPlatformForExtensionVersion(version),
			isPreReleaseVersion: isPreReleaseVersion(version)
		},
		hasPreReleaseVersion: isPreReleaseVersion(latestVersion),
		hasReleaseVersion,
		preview: getIsPreview(galleryExtension.flags),
	};
}

type PreReleaseMigrationInfo = { id: string, displayName: string, migrateStorage?: boolean, engine?: string };
interface IRawExtensionsControlManifest {
	malicious: string[];
	unsupported?: IStringDictionary<boolean | { preReleaseExtension: { id: string, displayName: string }; }>;
	migrateToPreRelease?: IStringDictionary<PreReleaseMigrationInfo>;
}

abstract class AbstractExtensionGalleryService implements IExtensionGalleryService {

	declare readonly _serviceBrand: undefined;

	private extensionsGalleryUrl: string | undefined;
	private extensionsControlUrl: string | undefined;

	private readonly commonHeadersPromise: Promise<{ [key: string]: string; }>;

	constructor(
		storageService: IStorageService | undefined,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IFileService private readonly fileService: IFileService,
		@IProductService private readonly productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		const config = productService.extensionsGallery;
		this.extensionsGalleryUrl = config && config.serviceUrl;
		this.extensionsControlUrl = config && config.controlUrl;
		this.commonHeadersPromise = resolveMarketplaceHeaders(productService.version, productService, this.environmentService, this.configurationService, this.fileService, storageService);
	}

	private api(path = ''): string {
		return `${this.extensionsGalleryUrl}${path}`;
	}

	isEnabled(): boolean {
		return !!this.extensionsGalleryUrl;
	}

	getExtensions(identifiers: ReadonlyArray<IExtensionIdentifier | IExtensionIdentifierWithVersion>, token: CancellationToken): Promise<IGalleryExtension[]>;
	getExtensions(identifiers: ReadonlyArray<IExtensionIdentifier | IExtensionIdentifierWithVersion>, includePreRelease: boolean, token: CancellationToken): Promise<IGalleryExtension[]>;
	async getExtensions(identifiers: ReadonlyArray<IExtensionIdentifier | IExtensionIdentifierWithVersion>, arg1: any, arg2?: any): Promise<IGalleryExtension[]> {
		const preRelease = isBoolean(arg1) ? arg1 : false;
		const token: CancellationToken = isBoolean(arg1) ? arg2 : arg1;
		const versions: IExtensionIdentifierWithVersion[] = (identifiers as ReadonlyArray<IExtensionIdentifierWithVersion>).filter(identifier => !!identifier.version);
		const query = new Query()
			.withPage(1, identifiers.length)
			.withFilter(FilterType.ExtensionName, ...identifiers.map(({ id }) => id.toLowerCase()));

		const { extensions } = await this.queryGalleryExtensions(query, { targetPlatform: CURRENT_TARGET_PLATFORM, preRelease, versions, compatible: false }, token);
		return extensions;
	}

	async getCompatibleExtensions(identifiers: ReadonlyArray<IExtensionIdentifierWithPreRelease>, targetPlatform: TargetPlatform): Promise<IGalleryExtension[]> {
		const names: string[] = []; const ids: string[] = [];
		for (const identifier of identifiers) {
			if (identifier.uuid) {
				ids.push(identifier.uuid);
			} else {
				names.push(identifier.id.toLowerCase());
			}
		}

		if (!ids.length && !names.length) {
			return [];
		}

		let query = new Query().withPage(1, identifiers.length);
		if (ids.length) {
			query = query.withFilter(FilterType.ExtensionId, ...ids);
		}
		if (names.length) {
			query = query.withFilter(FilterType.ExtensionName, ...names);
		}

		const { extensions } = await this.queryGalleryExtensions(query, { targetPlatform, compatible: true, preRelease: [...identifiers] }, CancellationToken.None);
		return extensions;
	}

	async getCompatibleExtension(arg1: IExtensionIdentifier | IGalleryExtension, includePreRelease: boolean, targetPlatform: TargetPlatform): Promise<IGalleryExtension | null> {
		const extension: IGalleryExtension | null = isIExtensionIdentifier(arg1) ? null : arg1;

		if (extension) {
			if (isNotWebExtensionInWebTargetPlatform(extension.allTargetPlatforms, targetPlatform)) {
				return null;
			}
			if (await this.isExtensionCompatible(extension, includePreRelease, targetPlatform)) {
				return extension;
			}
			const query = new Query()
				.withFlags(Flags.IncludeVersions)
				.withPage(1, 1)
				.withFilter(FilterType.ExtensionId, extension.identifier.uuid);
			const { extensions } = await this.queryGalleryExtensions(query, { targetPlatform, compatible: true, preRelease: includePreRelease }, CancellationToken.None);
			return extensions[0] || null;
		}

		const extensions = await this.getCompatibleExtensions([{ ...(<IExtensionIdentifier>arg1), preRelease: includePreRelease }], targetPlatform);
		return extensions[0] || null;
	}

	async isExtensionCompatible(extension: IGalleryExtension, includePreRelease: boolean, targetPlatform: TargetPlatform): Promise<boolean> {
		if (!isTargetPlatformCompatible(extension.properties.targetPlatform, extension.allTargetPlatforms, targetPlatform)) {
			return false;
		}

		if (!includePreRelease && extension.properties.isPreReleaseVersion) {
			return false;
		}

		let engine = extension.properties.engine;
		if (!engine) {
			const manifest = await this.getManifest(extension, CancellationToken.None);
			if (!manifest) {
				throw new Error('Manifest was not found');
			}
			engine = manifest.engines.vscode;
		}
		return isEngineValid(engine, this.productService.version, this.productService.date);
	}

	private async isValidVersion(rawGalleryExtensionVersion: IRawGalleryExtensionVersion, preRelease: boolean, compatible: boolean, allTargetPlatforms: TargetPlatform[], targetPlatform: TargetPlatform): Promise<boolean> {
		if (!isTargetPlatformCompatible(getTargetPlatformForExtensionVersion(rawGalleryExtensionVersion), allTargetPlatforms, targetPlatform)) {
			return false;
		}

		if (!preRelease && isPreReleaseVersion(rawGalleryExtensionVersion)) {
			return false;
		}

		if (compatible) {
			const engine = await this.getEngine(rawGalleryExtensionVersion);
			if (!isEngineValid(engine, this.productService.version, this.productService.date)) {
				return false;
			}
		}

		return true;
	}

	async query(options: IQueryOptions, token: CancellationToken): Promise<IPager<IGalleryExtension>> {
		if (!this.isEnabled()) {
			throw new Error('No extension gallery service configured.');
		}

		let text = options.text || '';
		const pageSize = getOrDefault(options, o => o.pageSize, 50);

		let query = new Query()
			.withPage(1, pageSize);

		if (text) {
			// Use category filter instead of "category:themes"
			text = text.replace(/\bcategory:("([^"]*)"|([^"]\S*))(\s+|\b|$)/g, (_, quotedCategory, category) => {
				query = query.withFilter(FilterType.Category, category || quotedCategory);
				return '';
			});

			// Use tag filter instead of "tag:debuggers"
			text = text.replace(/\btag:("([^"]*)"|([^"]\S*))(\s+|\b|$)/g, (_, quotedTag, tag) => {
				query = query.withFilter(FilterType.Tag, tag || quotedTag);
				return '';
			});

			// Use featured filter
			text = text.replace(/\bfeatured(\s+|\b|$)/g, () => {
				query = query.withFilter(FilterType.Featured);
				return '';
			});

			text = text.trim();

			if (text) {
				text = text.length < 200 ? text : text.substring(0, 200);
				query = query.withFilter(FilterType.SearchText, text);
			}

			query = query.withSortBy(SortBy.NoneOrRelevance);
		} else if (options.ids) {
			query = query.withFilter(FilterType.ExtensionId, ...options.ids);
		} else if (options.names) {
			query = query.withFilter(FilterType.ExtensionName, ...options.names);
		} else {
			query = query.withSortBy(SortBy.InstallCount);
		}

		if (typeof options.sortBy === 'number') {
			query = query.withSortBy(options.sortBy);
		}

		if (typeof options.sortOrder === 'number') {
			query = query.withSortOrder(options.sortOrder);
		}

		const runQuery = async (query: Query, token: CancellationToken) => {
			const { extensions, total } = await this.queryGalleryExtensions(query, { targetPlatform: CURRENT_TARGET_PLATFORM, compatible: false, preRelease: !!options.includePreRelease }, token);
			extensions.forEach((e, index) =>
				/* __GDPR__FRAGMENT__
				"GalleryExtensionTelemetryData2" : {
					"index" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
					"querySource": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
				*/
				e.telemetryData = { index: ((query.pageNumber - 1) * query.pageSize) + index, querySource: options.source });
			return { extensions, total };
		};
		const { extensions, total } = await runQuery(query, token);
		const getPage = async (pageIndex: number, ct: CancellationToken) => {
			if (ct.isCancellationRequested) {
				throw new CancellationError();
			}
			const { extensions } = await runQuery(query.withPage(pageIndex + 1), ct);
			return extensions;
		};

		return { firstPage: extensions, total, pageSize: query.pageSize, getPage } as IPager<IGalleryExtension>;
	}

	private async queryGalleryExtensions(query: Query, criteria: IExtensionCriteria, token: CancellationToken): Promise<{ extensions: IGalleryExtension[], total: number; }> {
		const flags = query.flags;

		/**
		 * If both version flags (IncludeLatestVersionOnly and IncludeVersions) are included, then only include latest versions (IncludeLatestVersionOnly) flag.
		 */
		if (!!(query.flags & Flags.IncludeLatestVersionOnly) && !!(query.flags & Flags.IncludeVersions)) {
			query = query.withFlags(query.flags & ~Flags.IncludeVersions, Flags.IncludeLatestVersionOnly);
		}

		/**
		 * If version flags (IncludeLatestVersionOnly and IncludeVersions) are not included, default is to query for latest versions (IncludeLatestVersionOnly).
		 */
		if (!(query.flags & Flags.IncludeLatestVersionOnly) && !(query.flags & Flags.IncludeVersions)) {
			query = query.withFlags(query.flags, Flags.IncludeLatestVersionOnly);
		}

		/**
		 * If versions criteria exist, then remove IncludeLatestVersionOnly flag and add IncludeVersions flag.
		 */
		if (criteria.versions?.length) {
			query = query.withFlags(query.flags & ~Flags.IncludeLatestVersionOnly, Flags.IncludeVersions);
		}

		/**
		 * Add necessary extension flags
		 */
		query = query.withFlags(query.flags, Flags.IncludeAssetUri, Flags.IncludeCategoryAndTags, Flags.IncludeFiles, Flags.IncludeStatistics, Flags.IncludeVersionProperties);
		const { galleryExtensions: rawGalleryExtensions, total } = await this.queryRawGalleryExtensions(query, token);

		const hasAllVersions: boolean = !(query.flags & Flags.IncludeLatestVersionOnly);
		if (hasAllVersions) {
			const extensions: IGalleryExtension[] = [];
			for (const rawGalleryExtension of rawGalleryExtensions) {
				const extension = await this.toGalleryExtensionWithCriteria(rawGalleryExtension, criteria, true);
				if (extension) {
					extensions.push(extension);
				}
			}
			return { extensions, total };
		}

		const result: [number, IGalleryExtension][] = [];
		const needAllVersions = new Map<string, number>();
		for (let index = 0; index < rawGalleryExtensions.length; index++) {
			const rawGalleryExtension = rawGalleryExtensions[index];
			let extension = await this.toGalleryExtensionWithCriteria(rawGalleryExtension, criteria, false);
			if (!extension
				/* Skip if it is a pre-release version. Need all versions to know if there is a release version */
				|| extension.properties.isPreReleaseVersion
				/**
				 * Skip if the extension is a release version with a different target platform than requested and also has a pre-release version
				 * Because, this is a platform specific extension and can have a newer release version supporting this platform.
				 * See https://github.com/microsoft/vscode/issues/139628
				*/
				|| (!extension.properties.isPreReleaseVersion && extension.properties.targetPlatform !== criteria.targetPlatform && extension.hasPreReleaseVersion)
			) {
				needAllVersions.set(rawGalleryExtension.extensionId, index);
			} else {
				result.push([index, extension]);
			}
		}

		if (needAllVersions.size) {
			const startTime = new Date().getTime();
			const query = new Query()
				.withFlags(flags & ~Flags.IncludeLatestVersionOnly, Flags.IncludeVersions)
				.withPage(1, needAllVersions.size)
				.withFilter(FilterType.ExtensionId, ...needAllVersions.keys());
			const { extensions } = await this.queryGalleryExtensions(query, criteria, token);
			this.telemetryService.publicLog2<GalleryServiceAdditionalQueryEvent, GalleryServiceAdditionalQueryClassification>('galleryService:additionalQuery', {
				duration: new Date().getTime() - startTime,
				count: needAllVersions.size
			});
			for (const extension of extensions) {
				const index = needAllVersions.get(extension.identifier.uuid)!;
				result.push([index, extension]);
			}
		}

		return { extensions: result.sort((a, b) => a[0] - b[0]).map(([, extension]) => extension), total };
	}

	private async toGalleryExtensionWithCriteria(rawGalleryExtension: IRawGalleryExtension, criteria: IExtensionCriteria, hasAllVersions: boolean): Promise<IGalleryExtension | null> {

		const extensionIdentifier = { id: getGalleryExtensionId(rawGalleryExtension.publisher.publisherName, rawGalleryExtension.extensionName), uuid: rawGalleryExtension.extensionId };
		const version = criteria.versions?.find(extensionIdentifierWithVersion => areSameExtensions(extensionIdentifierWithVersion, extensionIdentifier))?.version;
		const preRelease = isBoolean(criteria.preRelease) ? criteria.preRelease : !!criteria.preRelease.find(extensionIdentifierWithPreRelease => areSameExtensions(extensionIdentifierWithPreRelease, extensionIdentifier))?.preRelease;
		const allTargetPlatforms = getAllTargetPlatforms(rawGalleryExtension);
		const rawGalleryExtensionVersions = sortExtensionVersions(rawGalleryExtension.versions, criteria.targetPlatform);

		if (criteria.compatible && hasAllVersions && isNotWebExtensionInWebTargetPlatform(allTargetPlatforms, criteria.targetPlatform)) {
			return null;
		}

		for (let index = 0; index < rawGalleryExtensionVersions.length; index++) {
			const rawGalleryExtensionVersion = rawGalleryExtensionVersions[index];
			if (version && rawGalleryExtensionVersion.version !== version) {
				continue;
			}
			if (await this.isValidVersion(rawGalleryExtensionVersion, preRelease, criteria.compatible, allTargetPlatforms, criteria.targetPlatform)) {
				return toExtension(rawGalleryExtension, rawGalleryExtensionVersion, allTargetPlatforms);
			}
			if (version && rawGalleryExtensionVersion.version === version) {
				return null;
			}
		}

		if (version || criteria.compatible) {
			return null;
		}

		/**
		 * Fallback: Return the latest version
		 * This can happen when the extension does not have a release version or does not have a version compatible with the given target platform.
		 */
		return toExtension(rawGalleryExtension, rawGalleryExtension.versions[0], allTargetPlatforms);
	}

	private async queryRawGalleryExtensions(query: Query, token: CancellationToken): Promise<{ galleryExtensions: IRawGalleryExtension[], total: number; }> {
		if (!this.isEnabled()) {
			throw new Error('No extension gallery service configured.');
		}

		query = query
			/* Always exclude non validated extensions */
			.withFlags(query.flags, Flags.ExcludeNonValidated)
			.withFilter(FilterType.Target, 'Microsoft.VisualStudio.Code')
			/* Always exclude unpublished extensions */
			.withFilter(FilterType.ExcludeWithFlags, flagsToString(Flags.Unpublished));

		const commonHeaders = await this.commonHeadersPromise;
		const data = JSON.stringify(query.raw);
		const headers = {
			...commonHeaders,
			'Content-Type': 'application/json',
			'Accept': 'application/json;api-version=3.0-preview.1',
			'Accept-Encoding': 'gzip',
			'Content-Length': String(data.length)
		};

		const startTime = new Date().getTime();
		let context: IRequestContext | undefined, error: any, total: number = 0;

		try {
			context = await this.requestService.request({
				type: 'POST',
				url: this.api('/extensionquery'),
				data,
				headers
			}, token);

			if (context.res.statusCode && context.res.statusCode >= 400 && context.res.statusCode < 500) {
				return { galleryExtensions: [], total };
			}

			const result = await asJson<IRawGalleryQueryResult>(context);
			if (result) {
				const r = result.results[0];
				const galleryExtensions = r.extensions;
				const resultCount = r.resultMetadata && r.resultMetadata.filter(m => m.metadataType === 'ResultCount')[0];
				total = resultCount && resultCount.metadataItems.filter(i => i.name === 'TotalCount')[0].count || 0;

				return { galleryExtensions, total };
			}
			return { galleryExtensions: [], total };

		} catch (e) {
			error = e;
			throw e;
		} finally {
			this.telemetryService.publicLog2<GalleryServiceQueryEvent, GalleryServiceQueryClassification>('galleryService:query', {
				...query.telemetryData,
				requestBodySize: String(data.length),
				duration: new Date().getTime() - startTime,
				success: !!context && isSuccess(context),
				responseBodySize: context?.res.headers['Content-Length'],
				statusCode: context ? String(context.res.statusCode) : undefined,
				errorCode: error
					? isCancellationError(error) ? 'canceled' : getErrorMessage(error).startsWith('XHR timeout') ? 'timeout' : 'failed'
					: undefined,
				count: String(total)
			});
		}
	}

	async reportStatistic(publisher: string, name: string, version: string, type: StatisticType): Promise<void> {
		if (!this.isEnabled()) {
			return undefined;
		}

		const url = isWeb ? this.api(`/itemName/${publisher}.${name}/version/${version}/statType/${type === StatisticType.Install ? '1' : '3'}/vscodewebextension`) : this.api(`/publishers/${publisher}/extensions/${name}/${version}/stats?statType=${type}`);
		const Accept = isWeb ? 'api-version=6.1-preview.1' : '*/*;api-version=4.0-preview.1';

		const commonHeaders = await this.commonHeadersPromise;
		const headers = { ...commonHeaders, Accept };
		try {
			await this.requestService.request({
				type: 'POST',
				url,
				headers
			}, CancellationToken.None);
		} catch (error) { /* Ignore */ }
	}

	async download(extension: IGalleryExtension, location: URI, operation: InstallOperation): Promise<void> {
		this.logService.trace('ExtensionGalleryService#download', extension.identifier.id);
		const data = getGalleryExtensionTelemetryData(extension);
		const startTime = new Date().getTime();
		/* __GDPR__
			"galleryService:downloadVSIX" : {
				"duration": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"${include}": [
					"${GalleryExtensionTelemetryData}"
				]
			}
		*/
		const log = (duration: number) => this.telemetryService.publicLog('galleryService:downloadVSIX', { ...data, duration });

		const operationParam = operation === InstallOperation.Install ? 'install' : operation === InstallOperation.Update ? 'update' : '';
		const downloadAsset = operationParam ? {
			uri: `${extension.assets.download.uri}${URI.parse(extension.assets.download.uri).query ? '&' : '?'}${operationParam}=true`,
			fallbackUri: `${extension.assets.download.fallbackUri}${URI.parse(extension.assets.download.fallbackUri).query ? '&' : '?'}${operationParam}=true`
		} : extension.assets.download;

		const context = await this.getAsset(downloadAsset);
		await this.fileService.writeFile(location, context.stream);
		log(new Date().getTime() - startTime);
	}

	async getReadme(extension: IGalleryExtension, token: CancellationToken): Promise<string> {
		if (extension.assets.readme) {
			const context = await this.getAsset(extension.assets.readme, {}, token);
			const content = await asText(context);
			return content || '';
		}
		return '';
	}

	async getManifest(extension: IGalleryExtension, token: CancellationToken): Promise<IExtensionManifest | null> {
		if (extension.assets.manifest) {
			const context = await this.getAsset(extension.assets.manifest, {}, token);
			const text = await asText(context);
			return text ? JSON.parse(text) : null;
		}
		return null;
	}

	private async getManifestFromRawExtensionVersion(rawExtensionVersion: IRawGalleryExtensionVersion, token: CancellationToken): Promise<IExtensionManifest | null> {
		const manifestAsset = getVersionAsset(rawExtensionVersion, AssetType.Manifest);
		if (!manifestAsset) {
			throw new Error('Manifest was not found');
		}
		const headers = { 'Accept-Encoding': 'gzip' };
		const context = await this.getAsset(manifestAsset, { headers });
		return await asJson<IExtensionManifest>(context);
	}

	async getCoreTranslation(extension: IGalleryExtension, languageId: string): Promise<ITranslation | null> {
		const asset = extension.assets.coreTranslations.filter(t => t[0] === languageId.toUpperCase())[0];
		if (asset) {
			const context = await this.getAsset(asset[1]);
			const text = await asText(context);
			return text ? JSON.parse(text) : null;
		}
		return null;
	}

	async getChangelog(extension: IGalleryExtension, token: CancellationToken): Promise<string> {
		if (extension.assets.changelog) {
			const context = await this.getAsset(extension.assets.changelog, {}, token);
			const content = await asText(context);
			return content || '';
		}
		return '';
	}

	async getAllCompatibleVersions(extension: IGalleryExtension, includePreRelease: boolean, targetPlatform: TargetPlatform): Promise<IGalleryExtensionVersion[]> {
		let query = new Query()
			.withFlags(Flags.IncludeVersions, Flags.IncludeCategoryAndTags, Flags.IncludeFiles, Flags.IncludeVersionProperties)
			.withPage(1, 1);

		if (extension.identifier.uuid) {
			query = query.withFilter(FilterType.ExtensionId, extension.identifier.uuid);
		} else {
			query = query.withFilter(FilterType.ExtensionName, extension.identifier.id);
		}

		const { galleryExtensions } = await this.queryRawGalleryExtensions(query, CancellationToken.None);
		if (!galleryExtensions.length) {
			return [];
		}

		const allTargetPlatforms = getAllTargetPlatforms(galleryExtensions[0]);
		if (isNotWebExtensionInWebTargetPlatform(allTargetPlatforms, targetPlatform)) {
			return [];
		}

		const result: IGalleryExtensionVersion[] = [];
		for (const version of galleryExtensions[0].versions) {
			try {
				if (result[result.length - 1]?.version !== version.version && await this.isValidVersion(version, includePreRelease, true, allTargetPlatforms, targetPlatform)) {
					result.push({ version: version.version, date: version.lastUpdated, isPreReleaseVersion: isPreReleaseVersion(version) });
				}
			} catch (error) { /* Ignore error and skip version */ }
		}
		return result;
	}

	private async getAsset(asset: IGalleryExtensionAsset, options: IRequestOptions = {}, token: CancellationToken = CancellationToken.None): Promise<IRequestContext> {
		const commonHeaders = await this.commonHeadersPromise;
		const baseOptions = { type: 'GET' };
		const headers = { ...commonHeaders, ...(options.headers || {}) };
		options = { ...options, ...baseOptions, headers };

		const url = asset.uri;
		const fallbackUrl = asset.fallbackUri;
		const firstOptions = { ...options, url };

		try {
			const context = await this.requestService.request(firstOptions, token);
			if (context.res.statusCode === 200) {
				return context;
			}
			const message = await asText(context);
			throw new Error(`Expected 200, got back ${context.res.statusCode} instead.\n\n${message}`);
		} catch (err) {
			if (isCancellationError(err)) {
				throw err;
			}

			const message = getErrorMessage(err);
			type GalleryServiceCDNFallbackClassification = {
				url: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
				message: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			};
			type GalleryServiceCDNFallbackEvent = {
				url: string;
				message: string;
			};
			this.telemetryService.publicLog2<GalleryServiceCDNFallbackEvent, GalleryServiceCDNFallbackClassification>('galleryService:cdnFallback', { url, message });

			const fallbackOptions = { ...options, url: fallbackUrl };
			return this.requestService.request(fallbackOptions, token);
		}
	}

	private async getEngine(rawExtensionVersion: IRawGalleryExtensionVersion): Promise<string> {
		let engine = getEngine(rawExtensionVersion);
		if (!engine) {
			const manifest = await this.getManifestFromRawExtensionVersion(rawExtensionVersion, CancellationToken.None);
			if (!manifest) {
				throw new Error('Manifest was not found');
			}
			engine = manifest.engines.vscode;
		}
		return engine;
	}

	async getExtensionsControlManifest(): Promise<IExtensionsControlManifest> {
		if (!this.isEnabled()) {
			throw new Error('No extension gallery service configured.');
		}

		if (!this.extensionsControlUrl) {
			return { malicious: [] };
		}

		const context = await this.requestService.request({ type: 'GET', url: this.extensionsControlUrl }, CancellationToken.None);
		if (context.res.statusCode !== 200) {
			throw new Error('Could not get extensions report.');
		}

		const result = await asJson<IRawExtensionsControlManifest>(context);
		const malicious: IExtensionIdentifier[] = [];
		const unsupportedPreReleaseExtensions: IStringDictionary<{ id: string, displayName: string, migrateStorage?: boolean }> = {};

		if (result) {
			for (const id of result.malicious) {
				malicious.push({ id });
			}
			if (result.unsupported) {
				for (const extensionId of Object.keys(result.unsupported)) {
					const value = result.unsupported[extensionId];
					if (!isBoolean(value)) {
						unsupportedPreReleaseExtensions[extensionId.toLowerCase()] = value.preReleaseExtension;
					}
				}
			}
			if (result.migrateToPreRelease) {
				for (const [unsupportedPreReleaseExtensionId, preReleaseExtensionInfo] of Object.entries(result.migrateToPreRelease)) {
					if (!preReleaseExtensionInfo.engine || isEngineValid(preReleaseExtensionInfo.engine, this.productService.version, this.productService.date)) {
						unsupportedPreReleaseExtensions[unsupportedPreReleaseExtensionId.toLowerCase()] = preReleaseExtensionInfo;
					}
				}
			}
		}

		return { malicious, unsupportedPreReleaseExtensions };
	}
}

export class ExtensionGalleryService extends AbstractExtensionGalleryService {

	constructor(
		@IStorageService storageService: IStorageService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(storageService, requestService, logService, environmentService, telemetryService, fileService, productService, configurationService);
	}
}

export class ExtensionGalleryServiceWithNoStorageService extends AbstractExtensionGalleryService {

	constructor(
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(undefined, requestService, logService, environmentService, telemetryService, fileService, productService, configurationService);
	}
}

export async function resolveMarketplaceHeaders(version: string, productService: IProductService, environmentService: IEnvironmentService, configurationService: IConfigurationService, fileService: IFileService, storageService: IStorageService | undefined): Promise<{ [key: string]: string; }> {
	const headers: IHeaders = {
		'X-Market-Client-Id': `VSCode ${version}`,
		'User-Agent': `VSCode ${version} (${productService.nameShort})`
	};
	const uuid = await getServiceMachineId(environmentService, fileService, storageService);
	if (supportsTelemetry(productService, environmentService) && getTelemetryLevel(configurationService) === TelemetryLevel.USAGE) {
		headers['X-Market-User-Id'] = uuid;
	}
	return headers;
}
