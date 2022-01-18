/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { TSESTree } from '@typescript-eslint/experimental-utils';
import * as path from 'path';
import * as minimatch from 'minimatch';
import { createImportRuleListener } from './utils';

const REPO_ROOT = path.normalize(path.join(__dirname, '../../../'));

interface RawImportPatternsConfig {
	target: string;
	restrictions: string | string[];
}

interface ImportPatternsConfig {
	target: string;
	restrictions: string[];
}

export = new class implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			badImport: 'Imports violates \'{{restrictions}}\' restrictions. See https://github.com/microsoft/vscode/wiki/Source-Code-Organization',
			badFilename: 'Missing definition in `code-import-patterns` for this file. Define rules at https://github.com/microsoft/vscode/blob/main/.eslintrc.json'
		},
		docs: {
			url: 'https://github.com/microsoft/vscode/wiki/Source-Code-Organization'
		}
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		const options = <RawImportPatternsConfig[]>context.options;
		const { configs, warnings } = this._processOptions(options);
		const relativeFilename = getRelativeFilename(context);

		if (warnings.length > 0) {
			// configuration warnings
			context.report({
				loc: { line: 1, column: 0 },
				message: warnings.join('\n')
			});
			return {};
		}

		for (const config of configs) {
			if (minimatch(relativeFilename, config.target)) {
				return createImportRuleListener((node, value) => this._checkImport(context, config, node, value));
			}
		}

		context.report({
			loc: { line: 1, column: 0 },
			messageId: 'badFilename'
		});

		return {};
	}

	private _optionsCache = new WeakMap<RawImportPatternsConfig[], { configs: ImportPatternsConfig[]; warnings: string[]; }>();

	private _processOptions(options: RawImportPatternsConfig[]): { configs: ImportPatternsConfig[]; warnings: string[]; } {
		if (this._optionsCache.has(options)) {
			return this._optionsCache.get(options)!;
		}
		const configs: ImportPatternsConfig[] = [];
		const warnings: string[] = [];
		for (const option of options) {
			const target = option.target;
			const restrictions = (typeof option.restrictions === 'string' ? [option.restrictions] : option.restrictions.slice(0));
			if (/^src\/vs\/.*\/\*\*/.test(target)) {
				const amdTarget = target.substring('src/'.length);
				// Allow importing itself
				if (restrictions.includes(amdTarget)) {
					warnings.push(`target ${target}: '${amdTarget}' is automatically included in restrictions.`);
				}
				restrictions.push(amdTarget);
			}
			configs.push({ target, restrictions });
		}
		const result = { configs, warnings };
		this._optionsCache.set(options, result);
		return result;
	}

	private _checkImport(context: eslint.Rule.RuleContext, config: ImportPatternsConfig, node: TSESTree.Node, importPath: string) {

		// resolve relative paths
		if (importPath[0] === '.') {
			const relativeFilename = getRelativeFilename(context);
			importPath = path.join(path.dirname(relativeFilename), importPath);
			if (/^src\/vs\//.test(importPath)) {
				// resolve using AMD base url
				importPath = importPath.substring('src/'.length);
			}
		}

		const restrictions = config.restrictions;

		let matched = false;
		for (const pattern of restrictions) {
			if (minimatch(importPath, pattern)) {
				matched = true;
				break;
			}
		}

		if (!matched) {
			// None of the restrictions matched
			context.report({
				loc: node.loc,
				messageId: 'badImport',
				data: {
					restrictions: restrictions.join(' or ')
				}
			});
		}
	}
};

/**
 * Returns the filename relative to the project root and using `/` as separators
 */
function getRelativeFilename(context: eslint.Rule.RuleContext): string {
	const filename = path.normalize(context.getFilename());
	return filename.substring(REPO_ROOT.length).replace(/\\/g, '/');
}
