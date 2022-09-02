/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { deepClone } from 'vs/base/common/objects';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { localizeManifest } from 'vs/platform/extensionManagement/common/extensionNls';
import { IExtensionManifest, IConfiguration } from 'vs/platform/extensions/common/extensions';

const manifest: IExtensionManifest = {
	name: 'test',
	publisher: 'test',
	version: '1.0.0',
	engines: {
		vscode: '*'
	},
	contributes: {
		commands: [
			{
				command: 'test.command',
				title: '%test.command.title%',
				category: '%test.command.category%'
			},
		],
		authentication: [
			{
				id: 'test.authentication',
				label: '%test.authentication.label%',
			}
		],
		configuration: {
			// to ensure we test another "title" property
			title: '%test.configuration.title%',
			properties: {
				'test.configuration': {
					type: 'string',
					description: 'not important',
				}
			}
		}
	}
};

suite('Localize Manifest', () => {
	test('replaces template strings', function () {
		const localizedManifest = localizeManifest(
			deepClone(manifest),
			{
				'test.command.title': 'Test Command',
				'test.command.category': 'Test Category',
				'test.authentication.label': 'Test Authentication',
				'test.configuration.title': 'Test Configuration',
			}
		);

		assert.strictEqual(localizedManifest.contributes?.commands?.[0].title, 'Test Command');
		assert.strictEqual(localizedManifest.contributes?.commands?.[0].category, 'Test Category');
		assert.strictEqual(localizedManifest.contributes?.authentication?.[0].label, 'Test Authentication');
		assert.strictEqual((localizedManifest.contributes?.configuration as IConfiguration).title, 'Test Configuration');
	});

	test('replaces template strings with fallback if not found in translations', function () {
		const localizedManifest = localizeManifest(
			deepClone(manifest),
			{},
			{
				'test.command.title': 'Test Command',
				'test.command.category': 'Test Category',
				'test.authentication.label': 'Test Authentication',
				'test.configuration.title': 'Test Configuration',
			}
		);

		assert.strictEqual(localizedManifest.contributes?.commands?.[0].title, 'Test Command');
		assert.strictEqual(localizedManifest.contributes?.commands?.[0].category, 'Test Category');
		assert.strictEqual(localizedManifest.contributes?.authentication?.[0].label, 'Test Authentication');
		assert.strictEqual((localizedManifest.contributes?.configuration as IConfiguration).title, 'Test Configuration');
	});

	test('replaces template strings - command title & categories become ILocalizedString', function () {
		const localizedManifest = localizeManifest(
			deepClone(manifest),
			{
				'test.command.title': 'Befehl test',
				'test.command.category': 'Testkategorie',
				'test.authentication.label': 'Testauthentifizierung',
				'test.configuration.title': 'Testkonfiguration',
			},
			{
				'test.command.title': 'Test Command',
				'test.command.category': 'Test Category',
				'test.authentication.label': 'Test Authentication',
				'test.configuration.title': 'Test Configuration',
			}
		);

		const title = localizedManifest.contributes?.commands?.[0].title as ILocalizedString;
		const category = localizedManifest.contributes?.commands?.[0].category as ILocalizedString;
		assert.strictEqual(title.value, 'Befehl test');
		assert.strictEqual(title.original, 'Test Command');
		assert.strictEqual(category.value, 'Testkategorie');
		assert.strictEqual(category.original, 'Test Category');

		// Everything else stays as a string.
		assert.strictEqual(localizedManifest.contributes?.authentication?.[0].label, 'Testauthentifizierung');
		assert.strictEqual((localizedManifest.contributes?.configuration as IConfiguration).title, 'Testkonfiguration');
	});
});
