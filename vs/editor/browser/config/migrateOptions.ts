/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { forEach } from 'vs/base/common/collections';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';

export interface ISettingsWriter {
	(key: string, value: any): void;
}

export class EditorSettingMigration {

	public static items: EditorSettingMigration[] = [];

	constructor(
		public readonly key: string,
		public readonly migrate: (value: any, write: ISettingsWriter) => void
	) { }

	apply(options: any): void {
		const value = EditorSettingMigration._read(options, this.key);
		const write = (key: string, value: any): void => {
			EditorSettingMigration._write(options, key, value);
		};
		this.migrate(value, write);
	}

	private static _read(source: any, key: string): any {
		if (typeof source === 'undefined') {
			return undefined;
		}

		const firstDotIndex = key.indexOf('.');
		if (firstDotIndex >= 0) {
			const firstSegment = key.substring(0, firstDotIndex);
			return this._read(source[firstSegment], key.substring(firstDotIndex + 1));
		}
		return source[key];
	}

	private static _write(target: any, key: string, value: any): void {
		const firstDotIndex = key.indexOf('.');
		if (firstDotIndex >= 0) {
			const firstSegment = key.substring(0, firstDotIndex);
			target[firstSegment] = target[firstSegment] || {};
			this._write(target[firstSegment], key.substring(firstDotIndex + 1), value);
			return;
		}
		target[key] = value;
	}
}

function registerEditorSettingMigration(key: string, migrate: (value: any, write: ISettingsWriter) => void): void {
	EditorSettingMigration.items.push(new EditorSettingMigration(key, migrate));
}

function registerSimpleEditorSettingMigration(key: string, values: [any, any][]): void {
	registerEditorSettingMigration(key, (value, write) => {
		if (typeof value !== 'undefined') {
			for (const [oldValue, newValue] of values) {
				if (value === oldValue) {
					write(key, newValue);
					return;
				}
			}
		}
	});
}

/**
 * Compatibility with old options
 */
export function migrateOptions(options: IEditorOptions): void {
	EditorSettingMigration.items.forEach(migration => migration.apply(options));
}

registerSimpleEditorSettingMigration('wordWrap', [[true, 'on'], [false, 'off']]);
registerSimpleEditorSettingMigration('lineNumbers', [[true, 'on'], [false, 'off']]);
registerSimpleEditorSettingMigration('cursorBlinking', [['visible', 'solid']]);
registerSimpleEditorSettingMigration('renderWhitespace', [[true, 'boundary'], [false, 'none']]);
registerSimpleEditorSettingMigration('renderLineHighlight', [[true, 'line'], [false, 'none']]);
registerSimpleEditorSettingMigration('acceptSuggestionOnEnter', [[true, 'on'], [false, 'off']]);
registerSimpleEditorSettingMigration('tabCompletion', [[false, 'off'], [true, 'onlySnippets']]);
registerSimpleEditorSettingMigration('hover', [[true, { enabled: true }], [false, { enabled: false }]]);
registerSimpleEditorSettingMigration('parameterHints', [[true, { enabled: true }], [false, { enabled: false }]]);
registerSimpleEditorSettingMigration('autoIndent', [[false, 'advanced'], [true, 'full']]);
registerSimpleEditorSettingMigration('matchBrackets', [[true, 'always'], [false, 'never']]);

registerEditorSettingMigration('autoClosingBrackets', (value, write) => {
	if (value === false) {
		write('autoClosingBrackets', 'never');
		write('autoClosingQuotes', 'never');
		write('autoSurround', 'never');
	}
});

registerEditorSettingMigration('renderIndentGuides', (value, write) => {
	if (typeof value !== 'undefined') {
		write('renderIndentGuides', undefined);
		write('guides.indentation', !!value);
	}
});

registerEditorSettingMigration('highlightActiveIndentGuide', (value, write) => {
	if (typeof value !== 'undefined') {
		write('highlightActiveIndentGuide', undefined);
		write('guides.highlightActiveIndentation', !!value);
	}
});

const suggestFilteredTypesMapping: Record<string, string> = {
	method: 'showMethods',
	function: 'showFunctions',
	constructor: 'showConstructors',
	deprecated: 'showDeprecated',
	field: 'showFields',
	variable: 'showVariables',
	class: 'showClasses',
	struct: 'showStructs',
	interface: 'showInterfaces',
	module: 'showModules',
	property: 'showProperties',
	event: 'showEvents',
	operator: 'showOperators',
	unit: 'showUnits',
	value: 'showValues',
	constant: 'showConstants',
	enum: 'showEnums',
	enumMember: 'showEnumMembers',
	keyword: 'showKeywords',
	text: 'showWords',
	color: 'showColors',
	file: 'showFiles',
	reference: 'showReferences',
	folder: 'showFolders',
	typeParameter: 'showTypeParameters',
	snippet: 'showSnippets',
};

registerEditorSettingMigration('suggest.filteredTypes', (value, write) => {
	if (value && typeof value === 'object') {
		forEach(suggestFilteredTypesMapping, entry => {
			const v = value[entry.key];
			if (v === false) {
				write(`suggest.${entry.value}`, false);
			}
		});
		write('suggest.filteredTypes', undefined);
	}
});
