/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { asWinJsPromise } from 'vs/base/common/async';
import { IPickOptions, IInputOptions, IQuickInputService, IQuickInput } from 'vs/platform/quickinput/common/quickInput';
import { InputBoxOptions } from 'vscode';
import { ExtHostContext, MainThreadQuickOpenShape, ExtHostQuickOpenShape, TransferQuickPickItems, MainContext, IExtHostContext, TransferQuickInput, TransferQuickInputButton } from 'vs/workbench/api/node/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/electron-browser/extHostCustomers';
import { URI } from 'vs/base/common/uri';
import { CancellationToken } from 'vs/base/common/cancellation';

interface QuickInputSession {
	input: IQuickInput;
	handlesToItems: Map<number, TransferQuickPickItems>;
}

@extHostNamedCustomer(MainContext.MainThreadQuickOpen)
export class MainThreadQuickOpen implements MainThreadQuickOpenShape {

	private _proxy: ExtHostQuickOpenShape;
	private _quickInputService: IQuickInputService;
	private _doSetItems: (items: TransferQuickPickItems[]) => any;
	private _doSetError: (error: Error) => any;
	private _contents: TPromise<TransferQuickPickItems[]>;
	private _token: number = 0;

	constructor(
		extHostContext: IExtHostContext,
		@IQuickInputService quickInputService: IQuickInputService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostQuickOpen);
		this._quickInputService = quickInputService;
	}

	public dispose(): void {
	}

	$show(options: IPickOptions<TransferQuickPickItems>, token: CancellationToken): Thenable<number | number[]> {
		const myToken = ++this._token;

		this._contents = new TPromise<TransferQuickPickItems[]>((c, e) => {
			this._doSetItems = (items) => {
				if (myToken === this._token) {
					c(items);
				}
			};

			this._doSetError = (error) => {
				if (myToken === this._token) {
					e(error);
				}
			};
		});

		options = {
			...options,
			onDidFocus: el => {
				if (el) {
					this._proxy.$onItemSelected((<TransferQuickPickItems>el).handle);
				}
			}
		};

		if (options.canPickMany) {
			return this._quickInputService.pick(this._contents, options as { canPickMany: true }, token).then(items => {
				if (items) {
					return items.map(item => item.handle);
				}
				return undefined;
			});
		} else {
			return this._quickInputService.pick(this._contents, options, token).then(item => {
				if (item) {
					return item.handle;
				}
				return undefined;
			});
		}
	}

	$setItems(items: TransferQuickPickItems[]): Thenable<void> {
		if (this._doSetItems) {
			this._doSetItems(items);
		}
		return undefined;
	}

	$setError(error: Error): Thenable<void> {
		if (this._doSetError) {
			this._doSetError(error);
		}
		return undefined;
	}

	// ---- input

	$input(options: InputBoxOptions, validateInput: boolean): TPromise<string> {
		const inputOptions: IInputOptions = Object.create(null);

		if (options) {
			inputOptions.password = options.password;
			inputOptions.placeHolder = options.placeHolder;
			inputOptions.valueSelection = options.valueSelection;
			inputOptions.prompt = options.prompt;
			inputOptions.value = options.value;
			inputOptions.ignoreFocusLost = options.ignoreFocusOut;
		}

		if (validateInput) {
			inputOptions.validateInput = (value) => {
				return this._proxy.$validateInput(value);
			};
		}

		return asWinJsPromise(token => this._quickInputService.input(inputOptions, token));
	}

	// ---- QuickInput

	private sessions = new Map<number, QuickInputSession>();

	$createOrUpdate(params: TransferQuickInput): Thenable<void> {
		const sessionId = params.id;
		let session = this.sessions.get(sessionId);
		if (!session) {
			if (params.type === 'quickPick') {
				const input = this._quickInputService.createQuickPick();
				input.onDidAccept(() => {
					this._proxy.$onDidAccept(sessionId);
				});
				input.onDidChangeActive(items => {
					this._proxy.$onDidChangeActive(sessionId, items.map(item => (item as TransferQuickPickItems).handle));
				});
				input.onDidChangeSelection(items => {
					this._proxy.$onDidChangeSelection(sessionId, items.map(item => (item as TransferQuickPickItems).handle));
				});
				input.onDidTriggerButton(button => {
					this._proxy.$onDidTriggerButton(sessionId, (button as TransferQuickInputButton).handle);
				});
				input.onDidChangeValue(value => {
					this._proxy.$onDidChangeValue(sessionId, value);
				});
				input.onDidHide(() => {
					this._proxy.$onDidHide(sessionId);
				});
				session = {
					input,
					handlesToItems: new Map()
				};
			} else {
				const input = this._quickInputService.createInputBox();
				input.onDidAccept(() => {
					this._proxy.$onDidAccept(sessionId);
				});
				input.onDidTriggerButton(button => {
					this._proxy.$onDidTriggerButton(sessionId, (button as TransferQuickInputButton).handle);
				});
				input.onDidChangeValue(value => {
					this._proxy.$onDidChangeValue(sessionId, value);
				});
				input.onDidHide(() => {
					this._proxy.$onDidHide(sessionId);
				});
				session = {
					input,
					handlesToItems: new Map()
				};
			}
			this.sessions.set(sessionId, session);
		}
		const { input, handlesToItems } = session;
		for (const param in params) {
			if (param === 'id' || param === 'type') {
				continue;
			}
			if (param === 'visible') {
				if (params.visible) {
					input.show();
				} else {
					input.hide();
				}
			} else if (param === 'items') {
				handlesToItems.clear();
				params[param].forEach(item => {
					handlesToItems.set(item.handle, item);
				});
				input[param] = params[param];
			} else if (param === 'activeItems' || param === 'selectedItems') {
				input[param] = params[param]
					.filter(handle => handlesToItems.has(handle))
					.map(handle => handlesToItems.get(handle));
			} else if (param === 'buttons') {
				input[param] = params.buttons.map(button => {
					if (button.handle === -1) {
						return this._quickInputService.backButton;
					}
					const { iconPath, tooltip, handle } = button;
					return {
						iconPath: {
							dark: URI.revive(iconPath.dark),
							light: iconPath.light && URI.revive(iconPath.light)
						},
						tooltip,
						handle
					};
				});
			} else {
				input[param] = params[param];
			}
		}
		return TPromise.as(undefined);
	}

	$dispose(sessionId: number): Thenable<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.input.dispose();
			this.sessions.delete(sessionId);
		}
		return TPromise.as(undefined);
	}
}
