/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// https://github.com/Microsoft/vscode/issues/15178

	// TODO@API remove
	export enum TabKind {
		Singular = 0,
		Diff = 1,
		SidebySide = 2
	}

	// TODO@API names
	export class TextTabInput {
		readonly uri: Uri;
		constructor(uri: Uri);
	}

	// TODO@API names
	export class TextDiffTabInput {
		readonly original: Uri;
		readonly modified: Uri;
		constructor(original: Uri, modified: Uri);
	}

	export class CustomEditorTabInput {
		readonly uri: Uri;
		readonly viewType: string;
		constructor(uri: Uri, viewType: string);
	}

	export class NotebookEditorTabInput {
		readonly uri: Uri;
		readonly notebookType: string;
		constructor(uri: Uri, notebookType: string);
	}

	export class NotebookEditorDiffTabInput {
		readonly original: Uri;
		readonly modified: Uri;
		readonly notebookType: string;
		constructor(original: Uri, modified: Uri, notebookType: string);
	}

	/**
	 * Represents a tab within the window
	 */
	export interface Tab {
		/**
		 * The text displayed on the tab
		 */
		readonly label: string;

		/**
		 * The column which the tab belongs to
		 */
		// TODO@API point to TabGroup instead?
		readonly viewColumn: ViewColumn;


		// TODO@API NAME: optional
		readonly input: TextTabInput | TextDiffTabInput | unknown;

		/**
		 * The resource represented by the tab if available.
		 * Note: Not all tabs have a resource associated with them.
		 */
		// TODO@API remove
		readonly resource: Uri | undefined;

		/**
		 * The type of view contained in the tab
		 * This is equivalent to `viewType` for custom editors and `notebookType` for notebooks.
		 * The built-in text editor has an id of 'default' for all configurations.
		 */
		// TODO@API remove
		readonly viewType: string | undefined;

		/**
		 * All the resources and viewIds represented by a tab
		 * {@link Tab.resource resource} and {@link Tab.viewType viewType} will
		 * always be at index 0.
		 */
		// TODO@API remove
		readonly additionalResourcesAndViewTypes: readonly {
			readonly resource: Uri | undefined;
			readonly viewType: string | undefined;
		}[];

		/**
		 * Whether or not the tab is currently active
		 * Dictated by being the selected tab in the group
		 */
		readonly isActive: boolean;

		/**
		 * Whether or not the dirty indicator is present on the tab
		 */
		readonly isDirty: boolean;

		/**
		 * Whether or not the tab is pinned
		 */
		readonly isPinned: boolean;

		/**
		 * Indicates the type of tab it is.
		 */
		// TODO@API remove
		readonly kind: TabKind;

		/**
		 * Moves a tab to the given index within the column.
		 * If the index is out of range, the tab will be moved to the end of the column.
		 * If the column is out of range, a new one will be created after the last existing column.
		 * @param index The index to move the tab to
		 * @param viewColumn The column to move the tab into
		 */
		// TODO@API move into TabGroups
		move(index: number, viewColumn: ViewColumn): Thenable<void>;
	}

	export namespace window {
		/**
		 * Represents the grid widget within the main editor area
		 */
		export const tabGroups: TabGroups;
	}

	export interface TabGroup {
		/**
		 * Whether or not the group is currently active
		 */
		readonly isActive: boolean;

		/**
		 * The view column of the groups
		 */
		readonly viewColumn: ViewColumn;

		/**
		 * The active tab within the group
		 */
		readonly activeTab: Tab | undefined;

		/**
		 * The list of tabs contained within the group
		 */
		readonly tabs: Tab[];
	}

	export interface TabGroups {
		/**
		 * All the groups within the group container
		 */
		readonly groups: readonly TabGroup[];

		/**
		 * The currently active group
		 */
		readonly activeTabGroup: TabGroup | undefined;

		/**
		 * An {@link Event} which fires when a group changes.
		 */
		readonly onDidChangeTabGroup: Event<void>;

		/**
		 * An {@link Event} which fires when the active group changes.
		 * Whether it be which group is active.
		 */
		readonly onDidChangeActiveTabGroup: Event<TabGroup | undefined>;

		/**
		 * Closes the tab. This makes the tab object invalid and the tab
		 * should no longer be used for further actions.
		 * @param tab The tab to close, must be reference equal to a tab given by the API
		 * @param preserveFocus When `true` focus will remain in its current position. If `false` it will jump to the next tab.
		 */
		close(tab: Tab[], preserveFocus?: boolean): Thenable<void>;
		close(tab: Tab, preserveFocus?: boolean): Thenable<void>;
	}
}
