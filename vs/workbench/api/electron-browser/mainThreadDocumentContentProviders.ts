/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { onUnexpectedError } from 'vs/base/common/errors';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { extHostNamedCustomer } from 'vs/workbench/api/electron-browser/extHostCustomers';
import { ExtHostContext, ExtHostDocumentContentProvidersShape, IExtHostContext, MainContext, MainThreadDocumentContentProvidersShape } from '../node/extHost.protocol';

@extHostNamedCustomer(MainContext.MainThreadDocumentContentProviders)
export class MainThreadDocumentContentProviders implements MainThreadDocumentContentProvidersShape {

	private _resourceContentProvider: { [handle: number]: IDisposable } = Object.create(null);
	private readonly _proxy: ExtHostDocumentContentProvidersShape;

	constructor(
		extHostContext: IExtHostContext,
		@ITextModelService private readonly _textModelResolverService: ITextModelService,
		@IModeService private readonly _modeService: IModeService,
		@IModelService private readonly _modelService: IModelService,
		@IEditorWorkerService private readonly _editorWorkerService: IEditorWorkerService,
		@ICodeEditorService codeEditorService: ICodeEditorService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostDocumentContentProviders);
	}

	public dispose(): void {
		for (let handle in this._resourceContentProvider) {
			this._resourceContentProvider[handle].dispose();
		}
	}

	$registerTextContentProvider(handle: number, scheme: string): void {
		this._resourceContentProvider[handle] = this._textModelResolverService.registerTextModelContentProvider(scheme, {
			provideTextContent: (uri: URI): Thenable<ITextModel> => {
				return this._proxy.$provideTextDocumentContent(handle, uri).then(value => {
					if (typeof value === 'string') {
						const firstLineText = value.substr(0, 1 + value.search(/\r?\n/));
						const mode = this._modeService.getOrCreateModeByFilepathOrFirstLine(uri.fsPath, firstLineText);
						return this._modelService.createModel(value, mode, uri);
					}
					return undefined;
				});
			}
		});
	}

	$unregisterTextContentProvider(handle: number): void {
		const registration = this._resourceContentProvider[handle];
		if (registration) {
			registration.dispose();
			delete this._resourceContentProvider[handle];
		}
	}

	$onVirtualDocumentChange(uri: UriComponents, value: string): void {
		const model = this._modelService.getModel(URI.revive(uri));
		if (!model) {
			return;
		}

		this._editorWorkerService.computeMoreMinimalEdits(model.uri, [{ text: value, range: model.getFullModelRange() }]).then(edits => {
			if (edits.length > 0) {
				// use the evil-edit as these models show in readonly-editor only
				model.applyEdits(edits.map(edit => EditOperation.replace(Range.lift(edit.range), edit.text)));
			}
		}, onUnexpectedError);
	}
}
