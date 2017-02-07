/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import nls = require('vs/nls');
import Event, { Emitter } from 'vs/base/common/event';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { Registry } from 'vs/platform/platform';
import objects = require('vs/base/common/objects');
import types = require('vs/base/common/types');
import { ExtensionsRegistry } from 'vs/platform/extensions/common/extensionsRegistry';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';

export const Extensions = {
	Configuration: 'base.contributions.configuration'
};

export interface IConfigurationRegistry {

	/**
	 * Register a configuration to the registry.
	 */
	registerConfiguration(configuration: IConfigurationNode): void;

	/**
	 * Register multiple configurations to the registry.
	 */
	registerConfigurations(configurations: IConfigurationNode[]): void;

	/**
	 * Event that fires whenver a configuratio has been
	 * registered.
	 */
	onDidRegisterConfiguration: Event<IConfigurationRegistry>;

	/**
	 * Returns all configuration nodes contributed to this registry.
	 */
	getConfigurations(): IConfigurationNode[];

	/**
	 * Returns all configurations settings of all configuration nodes contributed to this registry.
	 */
	getConfigurationProperties(): { [qualifiedKey: string]: IConfigurationPropertySchema };

	/**
	 * Register the identifiers for editor configurations
	 */
	registerOverrideIdentifiers(identifiers: string[]): void;
}

export interface IConfigurationPropertySchema extends IJSONSchema {
	overridable?: boolean;
	isExecutable?: boolean;
}

export interface IConfigurationNode {
	id?: string;
	order?: number;
	type?: string | string[];
	title?: string;
	description?: string;
	properties?: { [path: string]: IConfigurationPropertySchema; };
	allOf?: IConfigurationNode[];
	overridable?: boolean;
}

export interface IConfigurationExtension extends IConfigurationNode {
	defaults?: any;
}

const schemaId = 'vscode://schemas/settings';
const editorConfigurationSchemaId = 'vscode://schemas/settings/editor';
const contributionRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);

class ConfigurationRegistry implements IConfigurationRegistry {
	private configurationContributors: IConfigurationNode[];
	private configurationProperties: { [qualifiedKey: string]: IJSONSchema };
	private configurationSchema: IJSONSchema;
	private editorConfigurationSchema: IJSONSchema;
	private _onDidRegisterConfiguration: Emitter<IConfigurationRegistry>;
	private overrideIdentifiers: string[] = [];
	private overridePropertyPattern: string;

	constructor() {
		this.configurationContributors = [];
		this.configurationSchema = { properties: {}, patternProperties: {}, additionalProperties: false, errorMessage: 'Unknown configuration setting' };
		this.editorConfigurationSchema = { properties: {}, patternProperties: {}, additionalProperties: false, errorMessage: 'Unknown editor configuration setting' };
		this._onDidRegisterConfiguration = new Emitter<IConfigurationRegistry>();
		this.configurationProperties = {};
		this.computeOverridePropertyPattern();

		contributionRegistry.registerSchema(schemaId, this.configurationSchema);
		contributionRegistry.registerSchema(editorConfigurationSchemaId, this.editorConfigurationSchema);
	}

	public get onDidRegisterConfiguration() {
		return this._onDidRegisterConfiguration.event;
	}

	public registerConfiguration(configuration: IConfigurationNode): void {
		this.registerConfigurations([configuration]);
	}

	public registerConfigurations(configurations: IConfigurationNode[]): void {
		configurations.forEach(configuration => {
			this.registerDefaultOverrides(configuration); /// fills in default overrides
			this.registerProperties(configuration); // fills in defaults
			this.configurationContributors.push(configuration);
			this.registerJSONConfiguration(configuration);
			this.updateSchemaForOverrideSettingsConfiguration(configuration);
		});

		this._onDidRegisterConfiguration.fire(this);
	}

	public registerOverrideIdentifiers(overrideIdentifiers: string[]): void {
		this.overrideIdentifiers.push(...overrideIdentifiers);
		this.updateOverridePropertyPatternKey();
	}

	private registerDefaultOverrides(configurationNode: IConfigurationExtension): void {
		if (!configurationNode.defaults) {
			return;
		}

		for (const key in configurationNode.defaults) {
			if (OVERRIDE_PROPERTY_PATTERN.test(key)) {
				if (!configurationNode.properties) {
					configurationNode.properties = {};
				}
				configurationNode.properties[key] = {
					type: 'object',
					default: configurationNode.defaults[key],
					description: nls.localize('overrideSettings.description', "Configure editor settings to be overridden for {0} language.", key),
					$ref: editorConfigurationSchemaId
				};
			}
		}
	}

	private registerProperties(configuration: IConfigurationNode, overridable: boolean = false) {
		overridable = configuration.overridable || overridable;
		let properties = configuration.properties;
		if (properties) {
			for (let key in properties) {
				// fill in default values
				let property = properties[key];
				let defaultValue = property.default;
				if (types.isUndefined(defaultValue)) {
					property.default = getDefaultValue(property.type);
				}
				// Inherit overridable property from parent
				if (overridable) {
					property.overridable = true;
				}
				// add to properties map
				this.configurationProperties[key] = properties[key];
			}
		}
		let subNodes = configuration.allOf;
		if (subNodes) {
			for (let node of subNodes) {
				this.registerProperties(node, overridable);
			}
		}
	}

	getConfigurations(): IConfigurationNode[] {
		return this.configurationContributors;
	}

	getConfigurationProperties(): { [qualifiedKey: string]: IConfigurationPropertySchema } {
		return this.configurationProperties;
	}

	private registerJSONConfiguration(configuration: IConfigurationNode) {
		let configurationSchema = this.configurationSchema;
		function register(configuration: IConfigurationNode) {
			let properties = configuration.properties;
			if (properties) {
				for (let key in properties) {
					configurationSchema.properties[key] = properties[key];
				}
			}
			let subNodes = configuration.allOf;
			if (subNodes) {
				subNodes.forEach(register);
			}
		};
		register(configuration);
		contributionRegistry.registerSchema(schemaId, configurationSchema);
	}

	private updateSchemaForOverrideSettingsConfiguration(configuration: IConfigurationNode): void {
		if (configuration.id !== SETTINGS_OVERRRIDE_NODE_ID) {
			this.update(configuration, this.editorConfigurationSchema);
			contributionRegistry.registerSchema(editorConfigurationSchemaId, this.editorConfigurationSchema);
		}
	}

	private updateOverridePropertyPatternKey(): void {
		let patternProperties: IJSONSchema = this.configurationSchema.patternProperties[this.overridePropertyPattern];
		if (!patternProperties) {
			patternProperties = {
				type: 'object',
				description: nls.localize('overrideSettings.defaultDescription', "Configure editor settings to be overridden for a language."),
				errorMessage: 'Unknown Identifier. Use language identifiers',
				$ref: editorConfigurationSchemaId
			};
		}
		delete this.configurationSchema.patternProperties[this.overridePropertyPattern];
		this.computeOverridePropertyPattern();
		this.configurationSchema.patternProperties[this.overridePropertyPattern] = patternProperties;
		contributionRegistry.registerSchema(schemaId, this.configurationSchema);
	}

	private update(configuration: IConfigurationNode, overridePropertiesSchema: IJSONSchema): void {
		let properties = configuration.properties;
		if (properties) {
			for (let key in properties) {
				if (properties[key].overridable) {
					overridePropertiesSchema.properties[key] = this.getConfigurationProperties()[key];
				}
			}
		}
		let subNodes = configuration.allOf;
		if (subNodes) {
			subNodes.forEach(subNode => this.update(subNode, overridePropertiesSchema));
		}
	}

	private computeOverridePropertyPattern(): void {
		this.overridePropertyPattern = this.overrideIdentifiers.length ? OVERRIDE_PATTERN_WITH_SUBSTITUTION.replace('${0}', this.overrideIdentifiers.join('|')) : OVERRIDE_PROPERTY;
	}
}

const SETTINGS_OVERRRIDE_NODE_ID = 'override';
const OVERRIDE_PROPERTY = '\\[.*\\]$';
const OVERRIDE_PATTERN_WITH_SUBSTITUTION = '\\[(${0})\\]$';
export const OVERRIDE_PROPERTY_PATTERN = new RegExp(OVERRIDE_PROPERTY);

function getDefaultValue(type: string | string[]): any {
	const t = Array.isArray(type) ? (<string[]>type)[0] : <string>type;
	switch (t) {
		case 'boolean':
			return false;
		case 'integer':
		case 'number':
			return 0;
		case 'string':
			return '';
		case 'array':
			return [];
		case 'object':
			return {};
		default:
			return null;
	}
}


const configurationRegistry = new ConfigurationRegistry();
Registry.add(Extensions.Configuration, configurationRegistry);

const configurationExtPoint = ExtensionsRegistry.registerExtensionPoint<IConfigurationNode>('configuration', [], {
	description: nls.localize('vscode.extension.contributes.configuration', 'Contributes configuration settings.'),
	type: 'object',
	defaultSnippets: [{ body: { title: '', properties: {} } }],
	properties: {
		title: {
			description: nls.localize('vscode.extension.contributes.configuration.title', 'A summary of the settings. This label will be used in the settings file as separating comment.'),
			type: 'string'
		},
		properties: {
			description: nls.localize('vscode.extension.contributes.configuration.properties', 'Description of the configuration properties.'),
			type: 'object',
			additionalProperties: {
				anyOf: [
					{ $ref: 'http://json-schema.org/draft-04/schema#' },
					{
						type: 'object',
						properties: {
							isExecutable: {
								type: 'boolean'
							}
						}
					}
				]
			}
		},
		defaults: {
			description: nls.localize('vscode.extension.contributes.configuration.defaults', 'Override default editor settings for a language'),
			type: 'object',
			patternProperties: {
				'\\[.*\\]$': {
					type: 'object',
					default: {},
					$ref: editorConfigurationSchemaId,
				}
			}
		}
	}
});

configurationExtPoint.setHandler(extensions => {
	const configurations: IConfigurationExtension[] = [];

	for (let i = 0; i < extensions.length; i++) {
		const configuration = <IConfigurationExtension>extensions[i].value;
		const collector = extensions[i].collector;

		if (configuration.type && configuration.type !== 'object') {
			collector.warn(nls.localize('invalid.type', "if set, 'configuration.type' must be set to 'object"));
		} else {
			configuration.type = 'object';
		}

		if (configuration.title && (typeof configuration.title !== 'string')) {
			collector.error(nls.localize('invalid.title', "'configuration.title' must be a string"));
		}

		if (configuration.properties && (typeof configuration.properties !== 'object')) {
			collector.error(nls.localize('invalid.properties', "'configuration.properties' must be an object"));
			return;
		}

		if (configuration.defaults && typeof configuration.defaults !== 'object') {
			collector.error(nls.localize('invalid.defaults', "'configuration.defaults' must be an object"));
			return;
		}

		const clonedConfiguration = objects.clone(configuration);
		clonedConfiguration.id = extensions[i].description.id;
		configurations.push(clonedConfiguration);
	}

	configurationRegistry.registerConfigurations(configurations);
});