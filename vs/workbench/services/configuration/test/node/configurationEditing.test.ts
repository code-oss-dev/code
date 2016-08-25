/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import assert = require('assert');
import os = require('os');
import path = require('path');
import fs = require('fs');
import * as json from 'vs/base/common/json';
import {TPromise} from 'vs/base/common/winjs.base';
import {Registry} from 'vs/platform/platform';
import {ParsedArgs} from 'vs/code/node/argv';
import {WorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import {EnvironmentService} from 'vs/platform/environment/node/environmentService';
import {parseArgs} from 'vs/code/node/argv';
import extfs = require('vs/base/node/extfs');
import {TestEventService, TestEditorService} from 'vs/test/utils/servicesTestUtils';
import uuid = require('vs/base/common/uuid');
import {IConfigurationRegistry, Extensions as ConfigurationExtensions} from 'vs/platform/configuration/common/configurationRegistry';
import {WorkspaceConfigurationService} from 'vs/workbench/services/configuration/node/configurationService';
import URI from 'vs/base/common/uri';
import {ConfigurationEditingService} from 'vs/workbench/services/configuration/node/configurationEditingService';
import {ConfigurationEditingResult, ConfigurationTarget} from 'vs/workbench/services/configuration/common/configurationEditing';
import {IResourceInput} from 'vs/platform/editor/common/editor';

class SettingsTestEnvironmentService extends EnvironmentService {

	constructor(args: ParsedArgs, _execPath: string, private customAppSettingsHome) {
		super(args, _execPath);
	}

	get appSettingsPath(): string { return this.customAppSettingsHome; }
}

class TestWorkbenchEditorService extends TestEditorService {

	constructor(private dirty: boolean) {
		super();
	}

	public createInput(input: IResourceInput): TPromise<any> {
		return TPromise.as({
			getName: () => 'name',
			getDescription: () => 'description',
			isDirty: () => this.dirty,
			matches: () => false
		});
	}
}

suite('WorkspaceConfigurationEditingService - Node', () => {

	function createWorkspace(callback: (workspaceDir: string, globalSettingsFile: string, cleanUp: (callback: () => void) => void) => void): void {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const workspaceDir = path.join(parentDir, 'workspaceconfig', id);
		const workspaceSettingsDir = path.join(workspaceDir, '.vscode');
		const globalSettingsFile = path.join(workspaceDir, 'config.json');

		extfs.mkdirp(workspaceSettingsDir, 493, (error) => {
			callback(workspaceDir, globalSettingsFile, (callback) => extfs.del(parentDir, os.tmpdir(), () => { }, callback));
		});
	}

	function createService(workspaceDir: string, globalSettingsFile: string, dirty?: boolean, noWorkspace?: boolean): TPromise<ConfigurationEditingService> {
		const workspaceContextService = new WorkspaceContextService(noWorkspace ? null : { resource: URI.file(workspaceDir) });
		const environmentService = new SettingsTestEnvironmentService(parseArgs(process.argv), process.execPath, globalSettingsFile);
		const configurationService = new WorkspaceConfigurationService(workspaceContextService, new TestEventService(), environmentService);
		const editorService = new TestWorkbenchEditorService(dirty);

		return configurationService.initialize().then(() => {
			return new ConfigurationEditingService(configurationService, workspaceContextService, environmentService, editorService);
		});
	}

	interface IConfigurationEditingTestSetting {
		configurationEditing: {
			service: {
				testSetting: string;
				testSettingTwo: string;
				testSettingThree: string;
			}
		};
	}

	const configurationRegistry = <IConfigurationRegistry>Registry.as(ConfigurationExtensions.Configuration);
	configurationRegistry.registerConfiguration({
		'id': '_test',
		'type': 'object',
		'properties': {
			'configurationEditing.service.testSetting': {
				'type': 'string',
				'default': 'isSet'
			},
			'configurationEditing.service.testSettingTwo': {
				'type': 'string',
				'default': 'isSet'
			},
			'configurationEditing.service.testSettingThree': {
				'type': 'string',
				'default': 'isSet'
			}
		}
	});

	test('errors cases - invalid key', (done: () => void) => {
		createWorkspace((workspaceDir, globalSettingsFile, cleanUp) => {
			return createService(workspaceDir, globalSettingsFile, false, true /* no workspace */).then(service => {
				return service.writeConfiguration(ConfigurationTarget.WORKSPACE, [{ key: 'unknown.key', value: 'value' }]).then(res => {
					assert.equal(res, ConfigurationEditingResult.ERROR_UNKNOWN_KEY);
					cleanUp(done);
				});
			});
		});
	});

	test('errors cases - no workspace', (done: () => void) => {
		createWorkspace((workspaceDir, globalSettingsFile, cleanUp) => {
			return createService(workspaceDir, globalSettingsFile, false, true /* no workspace */).then(service => {
				return service.writeConfiguration(ConfigurationTarget.WORKSPACE, [{ key: 'configurationEditing.service.testSetting', value: 'value' }]).then(res => {
					assert.equal(res, ConfigurationEditingResult.ERROR_NO_WORKSPACE_OPENED);
					cleanUp(done);
				});
			});
		});
	});

	test('errors cases - invalid configuration', (done: () => void) => {
		createWorkspace((workspaceDir, globalSettingsFile, cleanUp) => {
			return createService(workspaceDir, globalSettingsFile).then(service => {
				fs.writeFileSync(globalSettingsFile, ',,,,,,,,,,,,,,');

				return service.writeConfiguration(ConfigurationTarget.USER, [{ key: 'configurationEditing.service.testSetting', value: 'value' }]).then(res => {
					assert.equal(res, ConfigurationEditingResult.ERROR_INVALID_CONFIGURATION);
					cleanUp(done);
				});
			});
		});
	});

	test('errors cases - dirty', (done: () => void) => {
		createWorkspace((workspaceDir, globalSettingsFile, cleanUp) => {
			return createService(workspaceDir, globalSettingsFile, true).then(service => {
				return service.writeConfiguration(ConfigurationTarget.USER, [{ key: 'configurationEditing.service.testSetting', value: 'value' }]).then(res => {
					assert.equal(res, ConfigurationEditingResult.ERROR_CONFIGURATION_FILE_DIRTY);
					cleanUp(done);
				});
			});
		});
	});

	test('write one setting - empty file', (done: () => void) => {
		createWorkspace((workspaceDir, globalSettingsFile, cleanUp) => {
			return createService(workspaceDir, globalSettingsFile).then(service => {
				return service.writeConfiguration(ConfigurationTarget.USER, [{ key: 'configurationEditing.service.testSetting', value: 'value' }]).then(res => {
					assert.equal(res, ConfigurationEditingResult.OK);

					const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
					const parsed = json.parse(contents);
					assert.equal(parsed['configurationEditing.service.testSetting'], 'value');

					cleanUp(done);
				});
			});
		});
	});

	test('write one setting - existing file', (done: () => void) => {
		createWorkspace((workspaceDir, globalSettingsFile, cleanUp) => {
			return createService(workspaceDir, globalSettingsFile).then(service => {
				fs.writeFileSync(globalSettingsFile, '{ "my.super.setting": "my.super.value" }');

				return service.writeConfiguration(ConfigurationTarget.USER, [{ key: 'configurationEditing.service.testSetting', value: 'value' }]).then(res => {
					assert.equal(res, ConfigurationEditingResult.OK);

					const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
					const parsed = json.parse(contents);
					assert.equal(parsed['configurationEditing.service.testSetting'], 'value');
					assert.equal(parsed['my.super.setting'], 'my.super.value');

					cleanUp(done);
				});
			});
		});
	});

	test('write multiple settings - empty file', (done: () => void) => {
		createWorkspace((workspaceDir, globalSettingsFile, cleanUp) => {
			return createService(workspaceDir, globalSettingsFile).then(service => {
				return service.writeConfiguration(ConfigurationTarget.USER, [
					{ key: 'configurationEditing.service.testSetting', value: 'value' },
					{ key: 'configurationEditing.service.testSettingTwo', value: { complex: { value: true } } },
					{ key: 'configurationEditing.service.testSettingThree', value: 55 }
				]).then(res => {
					assert.equal(res, ConfigurationEditingResult.OK);

					const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
					const parsed = json.parse(contents);
					assert.equal(parsed['configurationEditing.service.testSetting'], 'value');
					assert.equal(parsed['configurationEditing.service.testSettingTwo'].complex.value, true);
					assert.equal(parsed['configurationEditing.service.testSettingThree'], 55);

					cleanUp(done);
				});
			});
		});
	});

	test('write multiple settings - existing file', (done: () => void) => {
		createWorkspace((workspaceDir, globalSettingsFile, cleanUp) => {
			return createService(workspaceDir, globalSettingsFile).then(service => {
				fs.writeFileSync(globalSettingsFile, '// some comment from me\n{ "my.super.setting": "my.super.value" }\n\n// more comments');

				return service.writeConfiguration(ConfigurationTarget.USER, [
					{ key: 'configurationEditing.service.testSetting', value: 'value' },
					{ key: 'configurationEditing.service.testSettingTwo', value: { complex: { value: true } } },
					{ key: 'configurationEditing.service.testSettingThree', value: 55 }
				]).then(res => {
					assert.equal(res, ConfigurationEditingResult.OK);

					const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
					const parsed = json.parse(contents);
					assert.equal(parsed['configurationEditing.service.testSetting'], 'value');
					assert.equal(parsed['configurationEditing.service.testSettingTwo'].complex.value, true);
					assert.equal(parsed['configurationEditing.service.testSettingThree'], 55);

					assert.equal(parsed['my.super.setting'], 'my.super.value');

					cleanUp(done);
				});
			});
		});
	});
});