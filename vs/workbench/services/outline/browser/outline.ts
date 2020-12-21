/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IIdentityProvider, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IDataSource, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Event } from 'vs/base/common/event';
import { FuzzyScore } from 'vs/base/common/filters';
import { IDisposable } from 'vs/base/common/lifecycle';
import { SymbolKind } from 'vs/editor/common/modes';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IWorkbenchDataTreeOptions } from 'vs/platform/list/browser/listService';
import { IEditorPane } from 'vs/workbench/common/editor';

export const IOutlineService = createDecorator<IOutlineService>('IOutlineService');

export interface IOutlineService {
	_serviceBrand: undefined;
	onDidChange: Event<void>;
	canCreateOutline(editor: IEditorPane): boolean;
	createOutline(editor: IEditorPane, token: CancellationToken): Promise<IOutline<any> | undefined>;
	registerOutlineCreator(creator: IOutlineCreator<any, any>): IDisposable;
}

export interface IOutlineCreator<P extends IEditorPane, E> {
	matches(candidate: IEditorPane): candidate is P;
	createOutline(editor: P, token: CancellationToken): Promise<IOutline<E> | undefined>;
}

export interface IBreadcrumbsDataSource<E> {
	getBreadcrumbElements(element: E): Iterable<E>;
}

export interface IQuickPickDataSource<E> {
	getQuickPickElements(): Iterable<{ element: E, kind?: SymbolKind, label: string, ariaLabel?: string, description?: string }>;
}

export class OutlineTreeConfiguration<E> {
	constructor(
		readonly breadcrumbsDataSource: IBreadcrumbsDataSource<E>,
		readonly quickPickDataSource: IQuickPickDataSource<E>,
		readonly treeDataSource: IDataSource<IOutline<E>, E>,
		readonly delegate: IListVirtualDelegate<E>,
		readonly renderers: ITreeRenderer<E, FuzzyScore, any>[],
		readonly identProvider: IIdentityProvider<E>,
		readonly options: IWorkbenchDataTreeOptions<E, FuzzyScore>,
	) { }
}

export interface IOutline<E> {

	dispose(): void;

	readonly treeConfig: OutlineTreeConfiguration<E>

	readonly onDidChange: Event<this>;

	readonly isEmpty: boolean;
	readonly activeEntry: E | undefined;
	readonly onDidChangeActiveEntry: Event<this>

	revealInEditor(entry: E, options: IEditorOptions, sideBySide: boolean): Promise<void> | void;
	previewInEditor(entry: E): IDisposable;
}
