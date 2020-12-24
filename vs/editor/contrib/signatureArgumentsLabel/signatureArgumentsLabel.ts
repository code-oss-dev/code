/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, TimeoutTimer, createCancelablePromise } from 'vs/base/common/async';
import { onUnexpectedError } from 'vs/base/common/errors';
import { hash } from 'vs/base/common/hash';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { IModelDeltaDecoration, ITextModel } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { SignatureArgumentsLabelProvider, SignatureArgumentsLabelProviderRegistry, SignautreArgumentsLabel } from 'vs/editor/common/modes';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { flatten } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';

const MAX_DECORATORS = 500;

export interface SignatureArgumentsLabelData {
	list: SignautreArgumentsLabel[];
	provider: SignatureArgumentsLabelProvider;
}

export function getSignatures(model: ITextModel, token: CancellationToken): Promise<SignatureArgumentsLabelData[]> {
	const datas: SignatureArgumentsLabelData[] = [];
	const providers = SignatureArgumentsLabelProviderRegistry.ordered(model).reverse();
	const promises = providers.map(provider => Promise.resolve(provider.provideSignatureArgumentsLabels(model, token)).then(result => {
		if (result) {
			datas.push({ list: result, provider });

		}
	}));

	return Promise.all(promises).then(() => datas);
}

export class SignatureArgumentsLabelDetector extends Disposable implements IEditorContribution {

	public static readonly ID: string = 'editor.contrib.signatureArgumentsLabel';

	static readonly RECOMPUTE_TIME = 1000; // ms

	private readonly _localToDispose = this._register(new DisposableStore());
	private _computePromise: CancelablePromise<SignatureArgumentsLabelData[]> | null;
	private _timeoutTimer: TimeoutTimer | null;

	private _decorationsIds: string[] = [];
	private _labelDatas = new Map<string, SignatureArgumentsLabelData>();

	private _labelDecoratorIds: string[] = [];
	private readonly _decorationsTypes = new Set<string>();

	private _isEnabled: boolean;

	constructor(private readonly _editor: ICodeEditor,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService
	) {
		super();
		this._register(_editor.onDidChangeModel(() => {
			this._isEnabled = this.isEnabled();
			this.onModelChanged();
		}));
		this._register(_editor.onDidChangeModelLanguage(() => this.onModelChanged()));
		this._register(SignatureArgumentsLabelProviderRegistry.onDidChange(() => this.onModelChanged()));
		this._register(_editor.onDidChangeConfiguration(() => {
			let prevIsEnabled = this._isEnabled;
			this._isEnabled = this.isEnabled();
			if (prevIsEnabled !== this._isEnabled) {
				if (this._isEnabled) {
					this.onModelChanged();
				} else {
					this.removeAllDecorations();
				}
			}
		}));

		this._timeoutTimer = null;
		this._computePromise = null;
		this._isEnabled = this.isEnabled();
		this.onModelChanged();
	}

	isEnabled(): boolean {
		const model = this._editor.getModel();
		if (!model) {
			return false;
		}

		return this._editor.getOption(EditorOption.showSignatureArgumentsLabel);
	}

	static get(editor: ICodeEditor): SignatureArgumentsLabelDetector {
		return editor.getContribution<SignatureArgumentsLabelDetector>(this.ID);
	}

	dispose(): void {
		this.stop();
		this.removeAllDecorations();
		super.dispose();
	}

	private onModelChanged(): void {
		this.stop();

		if (!this._isEnabled) {
			return;
		}
		const model = this._editor.getModel();

		if (!model || !SignatureArgumentsLabelProviderRegistry.has(model)) {
			return;
		}

		this._localToDispose.add(this._editor.onDidChangeModelContent(() => {
			if (!this._timeoutTimer) {
				this._timeoutTimer = new TimeoutTimer();
				this._timeoutTimer.cancelAndSet(() => {
					this._timeoutTimer = null;

					this.beginCompute();
				}, SignatureArgumentsLabelDetector.RECOMPUTE_TIME);
			}
		}));
		this.beginCompute();
	}

	private beginCompute(): void {
		this._computePromise = createCancelablePromise(token => {
			const model = this._editor.getModel();
			if (!model) {
				return Promise.resolve([]);
			}
			return getSignatures(model, token);
		});
		this._computePromise.then((labelData) => {
			this.updateDecorations(labelData);
			this.updateLabelDecorators(labelData);
			this._computePromise = null;
		}, onUnexpectedError);
	}

	private stop(): void {
		if (this._timeoutTimer) {
			this._timeoutTimer.cancel();
			this._timeoutTimer = null;
		}
		if (this._computePromise) {
			this._computePromise.cancel();
			this._computePromise = null;
		}
		this._localToDispose.clear();
	}

	private updateDecorations(labelData: SignatureArgumentsLabelData[]): void {
		const decorations = flatten(labelData.map(labels => labels.list.map(label => {
			return {
				range: {
					startLineNumber: label.position.lineNumber,
					startColumn: label.position.column,
					endLineNumber: label.position.lineNumber,
					endColumn: label.position.column
				},
				options: ModelDecorationOptions.EMPTY
			};
		})));

		this._decorationsIds = this._editor.deltaDecorations(this._decorationsIds, decorations);

		this._labelDatas = new Map<string, SignatureArgumentsLabelData>();
		this._decorationsIds.forEach((id, i) => this._labelDatas.set(id, labelData[i]));
	}

	private updateLabelDecorators(labelData: SignatureArgumentsLabelData[]): void {
		let decorations: IModelDeltaDecoration[] = [];
		let newDecorationsTypes: { [key: string]: boolean } = {};

		for (let i = 0; i < labelData.length; i++) {
			const label = labelData[i].list;
			for (let j = 0; j < label.length && decorations.length < MAX_DECORATORS; j++) {
				const { name, position } = label[j];

				const subKey = hash(name).toString(16);
				let key = 'signatureArgumentsLabel-' + subKey;

				if (!this._decorationsTypes.has(key) && !newDecorationsTypes[key]) {
					this._codeEditorService.registerDecorationType(key, {
						before: {
							contentText: `${name}:`,
							border: 'solid 1px gray',
							backgroundColor: '#333',
							margin: '1px',
							color: 'white'
						}
					}, undefined, this._editor);
				}

				newDecorationsTypes[key] = true;
				decorations.push({
					range: {
						startLineNumber: position.lineNumber,
						startColumn: position.column,
						endLineNumber: position.lineNumber,
						endColumn: position.column
					},
					options: this._codeEditorService.resolveDecorationOptions(key, true)
				});
			}
		}

		this._decorationsTypes.forEach(subType => {
			if (!newDecorationsTypes[subType]) {
				this._codeEditorService.removeDecorationType(subType);
			}
		});

		this._labelDecoratorIds = this._editor.deltaDecorations(this._labelDecoratorIds, decorations);
	}

	private removeAllDecorations(): void {
		this._decorationsIds = this._editor.deltaDecorations(this._decorationsIds, []);
		this._labelDecoratorIds = this._editor.deltaDecorations(this._labelDecoratorIds, []);

		this._decorationsTypes.forEach(subType => {
			this._codeEditorService.removeDecorationType(subType);
		});
	}
}

registerEditorContribution(SignatureArgumentsLabelDetector.ID, SignatureArgumentsLabelDetector);
