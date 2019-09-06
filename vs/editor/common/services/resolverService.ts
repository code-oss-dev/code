/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, IReference } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ITextModel, ITextSnapshot } from 'vs/editor/common/model';
import { IEditorModel } from 'vs/platform/editor/common/editor';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const ITextModelService = createDecorator<ITextModelService>('textModelService');

export interface ITextModelService {
	_serviceBrand: undefined;

	/**
	 * Provided a resource URI, it will return a model reference
	 * which should be disposed once not needed anymore.
	 */
	createModelReference(resource: URI): Promise<IReference<IResolvedTextEditorModel>>;

	/**
	 * Registers a specific `scheme` content provider.
	 */
	registerTextModelContentProvider(scheme: string, provider: ITextModelContentProvider): IDisposable;

	/**
	 * Check if a provider for the given `scheme` exists
	 */
	hasTextModelContentProvider(scheme: string): boolean;
}

export interface ITextModelContentProvider {

	/**
	 * Given a resource, return the content of the resource as `ITextModel`.
	 */
	provideTextContent(resource: URI): Promise<ITextModel | null> | null;
}

export interface ITextEditorModel extends IEditorModel {

	/**
	 * Provides access to the underlying `ITextModel`.
	 */
	readonly textEditorModel: ITextModel | null;

	/**
	 * Creates a snapshot of the model's contents.
	 */
	createSnapshot(this: IResolvedTextEditorModel): ITextSnapshot;
	createSnapshot(this: ITextEditorModel): ITextSnapshot | null;

	isReadonly(): boolean;
}

export interface IResolvedTextEditorModel extends ITextEditorModel {

	/**
	 * Same as ITextEditorModel#textEditorModel, but never null.
	 */
	readonly textEditorModel: ITextModel;
}
