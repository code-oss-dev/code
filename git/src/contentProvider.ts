/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { workspace, Uri, Disposable, Event, EventEmitter } from 'vscode';
import { Model } from './model';

export class GitContentProvider {

	private disposables: Disposable[] = [];

	private onDidChangeEmitter = new EventEmitter<Uri>();
	get onDidChange(): Event<Uri> { return this.onDidChangeEmitter.event; }

	private uris = new Set<Uri>();

	constructor(private model: Model) {
		this.disposables.push(
			model.onDidChangeRepository(this.fireChangeEvents, this),
			workspace.registerTextDocumentContentProvider('git', this)
		);
	}

	private fireChangeEvents(arg): void {
		for (let uri of this.uris) {
			this.onDidChangeEmitter.fire(uri);
		}
	}

	async provideTextDocumentContent(uri: Uri): Promise<string> {
		let ref = uri.query;

		if (ref === '~') {
			const fileUri = uri.with({ scheme: 'file', query: '' });
			const uriString = fileUri.toString();
			const [indexStatus] = this.model.indexGroup.resources.filter(r => r.original.toString() === uriString);
			ref = indexStatus ? '' : 'HEAD';
		}

		try {
			const result = await this.model.show(ref, uri);
			this.uris.add(uri);
			return result;
		} catch (err) {
			this.uris.delete(uri);
			return '';
		}
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}