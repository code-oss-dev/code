/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import * as json from 'vs/base/common/json';
import * as encoding from 'vs/base/node/encoding';
import * as pfs from 'vs/base/node/pfs';
import {getConfigurationKeys} from 'vs/platform/configuration/common/model';
import {IWorkbenchEditorService} from 'vs/workbench/services/editor/common/editorService';
import {setProperty} from 'vs/base/common/jsonEdit';
import {applyEdits} from 'vs/base/common/jsonFormatter';
import {IWorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import {IEnvironmentService} from 'vs/platform/environment/common/environment';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {WORKSPACE_CONFIG_DEFAULT_PATH} from 'vs/workbench/services/configuration/common/configuration';
import {IConfigurationEditingService, ConfigurationEditingResult, ConfigurationTarget, IConfigurationValue} from 'vs/workbench/services/configuration/common/configurationEditing';

interface IValidationResult {
	result: ConfigurationEditingResult;
	exists?: boolean;
	contents?: string;
}

export class ConfigurationEditingService implements IConfigurationEditingService {

	public _serviceBrand: any;

	constructor(
		@IConfigurationService private configurationService: IConfigurationService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IEnvironmentService private environmentService: IEnvironmentService,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService
	) {
	}

	public writeConfiguration(target: ConfigurationTarget, values: IConfigurationValue[]): TPromise<ConfigurationEditingResult> {

		// First validate before making any edits
		return this.validate(target, values).then(validation => {
			if (validation.result !== ConfigurationEditingResult.OK) {
				return validation.result;
			}

			// Create configuration file if missing
			const resource = this.getConfigurationResource(target);
			let ensureConfigurationFile = TPromise.as(null);
			let contents: string;
			if (!validation.exists) {
				contents = '{}';
				ensureConfigurationFile = pfs.writeFile(resource.fsPath, contents, encoding.UTF8);
			} else {
				contents = validation.contents;
			}

			return ensureConfigurationFile.then(() => {

				// Apply all edits to the configuration file
				const result = this.applyEdits(contents, values);

				return pfs.writeFile(resource.fsPath, result, encoding.UTF8).then(() => ConfigurationEditingResult.OK);
			});
		});
	}

	private applyEdits(content: string, values: IConfigurationValue[]): string {
		const {tabSize, insertSpaces} = this.configurationService.getConfiguration<{ tabSize: number; insertSpaces: boolean }>('editor');
		const {eol} = this.configurationService.getConfiguration<{ eol: string }>('files');

		while (values.length > 0) {
			const {key, value} = values.pop();

			const edits = setProperty(content, [key], value, { tabSize, insertSpaces, eol });
			content = applyEdits(content, edits);
		}

		return content;
	}

	private validate(target: ConfigurationTarget, values: IConfigurationValue[]): TPromise<IValidationResult> {

		// 1.) Any key must be a known setting from the registry
		const validKeys = getConfigurationKeys();
		if (values.some(v => validKeys.indexOf(v.key) < 0)) {
			return TPromise.as({ result: ConfigurationEditingResult.ERROR_UNKNOWN_KEY });
		}

		// 2.) Target cannot be workspace if no workspace opened
		if (target === ConfigurationTarget.WORKSPACE && !this.contextService.getWorkspace()) {
			return TPromise.as({ result: ConfigurationEditingResult.ERROR_NO_WORKSPACE_OPENED });
		}

		// 3.) Target cannot be dirty
		const resource = this.getConfigurationResource(target);
		return this.editorService.createInput({ resource }).then(typedInput => {
			if (typedInput.isDirty()) {
				return { result: ConfigurationEditingResult.ERROR_CONFIGURATION_FILE_DIRTY };
			}

			// 4.) Target cannot contain JSON errors
			return pfs.exists(resource.fsPath).then(exists => {
				if (!exists) {
					return { result: ConfigurationEditingResult.OK, exists };
				}

				return pfs.readFile(resource.fsPath).then(contentsRaw => {
					const contents = contentsRaw.toString(encoding.UTF8);
					const parseErrors = [];
					json.parse(contents, parseErrors);

					if (parseErrors.length > 0) {
						return { result: ConfigurationEditingResult.ERROR_INVALID_CONFIGURATION };
					}

					return { result: ConfigurationEditingResult.OK, exists, contents };
				});
			});
		});
	}

	private getConfigurationResource(target: ConfigurationTarget): URI {
		if (target === ConfigurationTarget.USER) {
			return URI.file(this.environmentService.appSettingsPath);
		}

		return this.contextService.toResource(WORKSPACE_CONFIG_DEFAULT_PATH);
	}
}