/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {EventEmitter} from 'vs/base/common/eventEmitter';
import {NullMode} from 'vs/editor/common/modes/nullMode';
import {TextualSuggestSupport} from 'vs/editor/common/modes/supports/suggestSupport';
import {AbstractModeWorker} from 'vs/editor/common/modes/abstractModeWorker';
import Modes = require('vs/editor/common/modes');
import EditorCommon = require('vs/editor/common/editorCommon');
import {IDisposable} from 'vs/base/common/lifecycle';
import {TPromise} from 'vs/base/common/winjs.base';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IThreadService} from 'vs/platform/thread/common/thread';
import {AsyncDescriptor2, createAsyncDescriptor2} from 'vs/platform/instantiation/common/descriptors';
import {IEditorWorkerService} from 'vs/editor/common/services/editorWorkerService';

export function createWordRegExp(allowInWords:string = ''): RegExp {
	return NullMode.createWordRegExp(allowInWords);
}

export abstract class AbstractMode<W extends AbstractModeWorker> implements Modes.IMode {

	_instantiationService:IInstantiationService;
	_threadService:IThreadService;
	private _descriptor:Modes.IModeDescriptor;

	private _workerPiecePromise:TPromise<W>;

	private _eventEmitter = new EventEmitter();
	private _simplifiedMode: Modes.IMode;

	constructor(
		descriptor:Modes.IModeDescriptor,
		instantiationService: IInstantiationService,
		threadService: IThreadService
	) {
		this._instantiationService = instantiationService;
		this._threadService = threadService;
		this._descriptor = descriptor;

		this._workerPiecePromise = null;
		this._simplifiedMode = null;
	}

	public getId(): string {
		return this._descriptor.id;
	}

	public toSimplifiedMode(): Modes.IMode {
		if (!this._simplifiedMode) {
			this._simplifiedMode = new SimplifiedMode(this);
		}
		return this._simplifiedMode;
	}

	private _getOrCreateWorker(): TPromise<W> {
		if (!this._workerPiecePromise) {
			var workerDescriptor: AsyncDescriptor2<string, Modes.IWorkerParticipant[], W> = this._getWorkerDescriptor();
			// First, load the code of the worker (without instantiating it)
			this._workerPiecePromise = AbstractMode._loadModule(workerDescriptor.moduleName).then(() => {
				// Then, load & instantiate all the participants
				var participants = this._descriptor.workerParticipants;
				return TPromise.join<Modes.IWorkerParticipant>(participants.map((participant) => {
					return this._instantiationService.createInstance(participant);
				}));
			}).then((participants:Modes.IWorkerParticipant[]) => {
				return this._instantiationService.createInstance<string, Modes.IWorkerParticipant[], W>(workerDescriptor, this.getId(), participants);
			});
		}

		return this._workerPiecePromise;
	}

	private static _loadModule(moduleName:string): TPromise<any> {
		return new TPromise((c, e, p) => {
			require([moduleName], c, e);
		}, () => {
			// Cannot cancel loading code
		});
	}

	protected _getWorkerDescriptor(): AsyncDescriptor2<string, Modes.IWorkerParticipant[], W> {
		return createAsyncDescriptor2('vs/editor/common/modes/nullWorker', 'NullWorker');
	}

	_worker<T>(runner:(worker:W)=>TPromise<T>): TPromise<T>;
	_worker<T>(runner:(worker:W)=>T): TPromise<T>;
	_worker<T>(runner:(worker:W)=>any): TPromise<T> {
		return this._getOrCreateWorker().then(runner);
	}

	// START mics interface implementations

	public addSupportChangedListener(callback: (e: EditorCommon.IModeSupportChangedEvent) => void) : IDisposable {
		return this._eventEmitter.addListener2('modeSupportChanged', callback);
	}

	public registerSupport<T>(support:string, callback:(mode:Modes.IMode) => T) : IDisposable {
		var supportImpl = callback(this);
		this[support] = supportImpl;
		this._eventEmitter.emit('modeSupportChanged', _createModeSupportChangedEvent(support));

		return {
			dispose: () => {
				if (this[support] === supportImpl) {
					delete this[support];
					this._eventEmitter.emit('modeSupportChanged', _createModeSupportChangedEvent(support));
				}
			}
		};
	}

	// END
}

class SimplifiedMode implements Modes.IMode {

	tokenizationSupport: Modes.ITokenizationSupport;
	richEditSupport: Modes.IRichEditSupport;

	private _sourceMode: Modes.IMode;
	private _eventEmitter: EventEmitter;
	private _id: string;

	constructor(sourceMode: Modes.IMode) {
		this._sourceMode = sourceMode;
		this._eventEmitter = new EventEmitter();
		this._id = 'vs.editor.modes.simplifiedMode:' + sourceMode.getId();
		this._assignSupports();

		if (this._sourceMode.addSupportChangedListener) {
			this._sourceMode.addSupportChangedListener((e) => {
				if (e.tokenizationSupport || e.richEditSupport) {
					this._assignSupports();
					let newEvent = SimplifiedMode._createModeSupportChangedEvent(e);
					this._eventEmitter.emit('modeSupportChanged', newEvent);
				}
			});
		}
	}

	public getId(): string {
		return this._id;
	}

	public toSimplifiedMode(): Modes.IMode {
		return this;
	}

	private _assignSupports(): void {
		this.tokenizationSupport = this._sourceMode.tokenizationSupport;
		this.richEditSupport = this._sourceMode.richEditSupport;
	}

	private static _createModeSupportChangedEvent(originalModeEvent:EditorCommon.IModeSupportChangedEvent): EditorCommon.IModeSupportChangedEvent {
		var event:EditorCommon.IModeSupportChangedEvent = {
			codeLensSupport: false,
			tokenizationSupport: originalModeEvent.tokenizationSupport,
			occurrencesSupport:false,
			declarationSupport:false,
			typeDeclarationSupport:false,
			navigateTypesSupport:false,
			referenceSupport:false,
			suggestSupport:false,
			parameterHintsSupport:false,
			extraInfoSupport:false,
			outlineSupport:false,
			logicalSelectionSupport:false,
			formattingSupport:false,
			inplaceReplaceSupport:false,
			emitOutputSupport:false,
			linkSupport:false,
			configSupport:false,
			quickFixSupport:false,
			richEditSupport: originalModeEvent.richEditSupport,
		};
		return event;
	}
}

export var isDigit:(character:string, base:number)=>boolean = (function () {

	var _0 = '0'.charCodeAt(0),
		_1 = '1'.charCodeAt(0),
		_2 = '2'.charCodeAt(0),
		_3 = '3'.charCodeAt(0),
		_4 = '4'.charCodeAt(0),
		_5 = '5'.charCodeAt(0),
		_6 = '6'.charCodeAt(0),
		_7 = '7'.charCodeAt(0),
		_8 = '8'.charCodeAt(0),
		_9 = '9'.charCodeAt(0),
		_a = 'a'.charCodeAt(0),
		_b = 'b'.charCodeAt(0),
		_c = 'c'.charCodeAt(0),
		_d = 'd'.charCodeAt(0),
		_e = 'e'.charCodeAt(0),
		_f = 'f'.charCodeAt(0),
		_A = 'A'.charCodeAt(0),
		_B = 'B'.charCodeAt(0),
		_C = 'C'.charCodeAt(0),
		_D = 'D'.charCodeAt(0),
		_E = 'E'.charCodeAt(0),
		_F = 'F'.charCodeAt(0);

	return function isDigit(character:string, base:number):boolean {
		var c = character.charCodeAt(0);
		switch (base) {
			case 1:
				return c === _0;
			case 2:
				return c >= _0 && c <= _1;
			case 3:
				return c >= _0 && c <= _2;
			case 4:
				return c >= _0 && c <= _3;
			case 5:
				return c >= _0 && c <= _4;
			case 6:
				return c >= _0 && c <= _5;
			case 7:
				return c >= _0 && c <= _6;
			case 8:
				return c >= _0 && c <= _7;
			case 9:
				return c >= _0 && c <= _8;
			case 10:
				return c >= _0 && c <= _9;
			case 11:
				return (c >= _0 && c <= _9) || (c === _a) || (c === _A);
			case 12:
				return (c >= _0 && c <= _9) || (c >= _a && c <= _b) || (c >= _A && c <= _B);
			case 13:
				return (c >= _0 && c <= _9) || (c >= _a && c <= _c) || (c >= _A && c <= _C);
			case 14:
				return (c >= _0 && c <= _9) || (c >= _a && c <= _d) || (c >= _A && c <= _D);
			case 15:
				return (c >= _0 && c <= _9) || (c >= _a && c <= _e) || (c >= _A && c <= _E);
			default:
				return (c >= _0 && c <= _9) || (c >= _a && c <= _f) || (c >= _A && c <= _F);
		}
	};
})();

export class FrankensteinMode extends AbstractMode<AbstractModeWorker> {

	public suggestSupport:Modes.ISuggestSupport;

	constructor(
		descriptor:Modes.IModeDescriptor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThreadService threadService: IThreadService,
		@IEditorWorkerService editorWorkerService: IEditorWorkerService
	) {
		super(descriptor, instantiationService, threadService);

		this.suggestSupport = new TextualSuggestSupport(this.getId(), editorWorkerService);
	}
}

function _createModeSupportChangedEvent(...changedSupports: string[]): EditorCommon.IModeSupportChangedEvent {
	var event:EditorCommon.IModeSupportChangedEvent = {
		codeLensSupport: false,
		tokenizationSupport:false,
		occurrencesSupport:false,
		declarationSupport:false,
		typeDeclarationSupport:false,
		navigateTypesSupport:false,
		referenceSupport:false,
		suggestSupport:false,
		parameterHintsSupport:false,
		extraInfoSupport:false,
		outlineSupport:false,
		logicalSelectionSupport:false,
		formattingSupport:false,
		inplaceReplaceSupport:false,
		emitOutputSupport:false,
		linkSupport:false,
		configSupport:false,
		quickFixSupport:false,
		richEditSupport: false
	};
	changedSupports.forEach(support => event[support] = true);
	return event;
}