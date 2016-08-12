/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import {KbCtxKey, IContextKeyService, IKeybindingContextKey} from 'vs/platform/contextkey/common/contextkey';
import {IModeService} from 'vs/editor/common/services/modeService';

export class ResourceContextKey implements IKeybindingContextKey<URI> {


	static Scheme = new KbCtxKey<string>('resourceScheme', undefined);
	static LangId = new KbCtxKey<string>('resourceLangId', undefined);
	static Resource = new KbCtxKey<URI>('resource', undefined);

	private _resourceKey: IKeybindingContextKey<URI>;
	private _schemeKey: IKeybindingContextKey<string>;
	private _langIdKey: IKeybindingContextKey<string>;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IModeService private _modeService: IModeService
	) {
		this._schemeKey = ResourceContextKey.Scheme.bindTo(contextKeyService);
		this._langIdKey = ResourceContextKey.LangId.bindTo(contextKeyService);
		this._resourceKey = ResourceContextKey.Resource.bindTo(contextKeyService);
	}

	set(value: URI) {
		this._resourceKey.set(value);
		this._schemeKey.set(value && value.scheme);
		this._langIdKey.set(value && this._modeService.getModeIdByFilenameOrFirstLine(value.fsPath));
	}

	reset(): void {
		this._schemeKey.reset();
		this._langIdKey.reset();
		this._resourceKey.reset();
	}

	public get(): URI {
		return this._resourceKey.get();
	}
}