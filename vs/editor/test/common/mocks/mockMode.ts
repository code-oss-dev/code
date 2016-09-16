/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {IMode, IState, IStream, ITokenizationResult, ITokenizationSupport, TokenizationRegistry} from 'vs/editor/common/modes';
import {AbstractState} from 'vs/editor/common/modes/abstractState';
import {TokenizationSupport} from 'vs/editor/common/modes/supports/tokenizationSupport';

let instanceCount = 0;
export function generateMockModeId(): string {
	return 'mockMode' + (++instanceCount);
}

export class MockMode implements IMode {
	private _id:string;

	constructor(id?:string) {
		if (typeof id === 'undefined') {
			id = generateMockModeId();
		}
		this._id = id;
	}

	public getId():string {
		return this._id;
	}
}

export class StateForMockTokenizingMode extends AbstractState {

	private _tokenType: string;

	constructor(modeId:string, tokenType:string) {
		super(modeId);
		this._tokenType = tokenType;
	}

	public makeClone():StateForMockTokenizingMode {
		return this;
	}

	public equals(other:IState):boolean {
		return true;
	}

	public tokenize(stream:IStream):ITokenizationResult {
		stream.advanceToEOS();
		return { type: this._tokenType };
	}
}

export class MockTokenizingMode extends MockMode {

	constructor(tokenType:string) {
		super();

		TokenizationRegistry.register(this.getId(), new TokenizationSupport(null, this.getId(), {
			getInitialState: () => new StateForMockTokenizingMode(this.getId(), tokenType)
		}, false));
	}
}
