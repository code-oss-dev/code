/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import Severity from 'vs/base/common/severity';
import Event, { Emitter, debounceEvent, any } from 'vs/base/common/event';
import { IResourceDecorationsService, IResourceDecoration, IResourceDecorationChangeEvent, IDecorationsProvider } from './decorations';
import { TernarySearchTree } from 'vs/base/common/map';
import { IDisposable } from 'vs/base/common/lifecycle';
import { isThenable } from 'vs/base/common/async';
import { LinkedList } from 'vs/base/common/linkedList';

class FileDecorationChangeEvent implements IResourceDecorationChangeEvent {

	private readonly _data = TernarySearchTree.forPaths<boolean>();

	affectsResource(uri: URI): boolean {
		return this._data.get(uri.toString()) || this._data.findSuperstr(uri.toString()) !== undefined;
	}

	static debouncer(last: FileDecorationChangeEvent, current: URI | URI[]) {
		if (!last) {
			last = new FileDecorationChangeEvent();
		}
		if (Array.isArray(current)) {
			// many
			for (const uri of current) {
				last._data.set(uri.toString(), true);
			}
		} else {
			// one
			last._data.set(current.toString(), true);
		}

		return last;
	}
}

class DecorationProviderWrapper {

	private readonly _data = TernarySearchTree.forPaths<Thenable<void> | IResourceDecoration>();
	private readonly _dispoable: IDisposable;

	constructor(
		private readonly _provider: IDecorationsProvider,
		private readonly _emitter: Emitter<URI | URI[]>
	) {
		this._dispoable = this._provider.onDidChange(uris => {
			for (const uri of uris) {
				this._data.delete(uri.toString());
				this._fetchData(uri);
			}
		});
	}

	dispose(): void {
		this._dispoable.dispose();
		this._data.clear();
	}

	knowsAbout(uri: URI): boolean {
		return Boolean(this._data.get(uri.toString())) || Boolean(this._data.findSuperstr(uri.toString()));
	}

	getOrRetrieve(uri: URI, includeChildren: boolean, callback: (data: IResourceDecoration, isChild: boolean) => void): void {
		const key = uri.toString();
		let item = this._data.get(key);

		if (isThenable<void>(item)) {
			// pending -> still waiting
			return;
		}

		if (item === undefined && !includeChildren) {
			// unknown, a leaf node -> trigger request
			item = this._fetchData(uri);
		}

		if (item) {
			// leaf node
			callback(item, false);
		}
		if (includeChildren) {
			// (resolved) children
			const childTree = this._data.findSuperstr(key);
			if (childTree) {
				childTree.forEach(([, value]) => {
					if (value && !isThenable<void>(value) && !value.leafOnly) {
						callback(value, true);
					}
				});
			}
		}
	}

	private _fetchData(uri: URI): IResourceDecoration {

		const decoOrThenable = this._provider.provideDecorations(uri);
		if (!isThenable(decoOrThenable)) {
			// sync -> we have a result now
			this._data.set(uri.toString(), decoOrThenable || null);
			this._emitter.fire(uri);
			return decoOrThenable;

		} else {
			// async -> we have a result soon
			const request = Promise.resolve(decoOrThenable)
				.then(data => {
					this._data.set(uri.toString(), data || null);
					this._emitter.fire(uri);
				})
				.catch(_ => this._data.delete(uri.toString()));

			this._data.set(uri.toString(), request);
			return undefined;
		}
	}
}

export class FileDecorationsService implements IResourceDecorationsService {

	_serviceBrand: any;

	private readonly _data = new LinkedList<DecorationProviderWrapper>();
	private readonly _onDidChangeDecorationsDelayed = new Emitter<URI | URI[]>();
	private readonly _onDidChangeDecorations = new Emitter<IResourceDecorationChangeEvent>();

	readonly onDidChangeDecorations: Event<IResourceDecorationChangeEvent> = any(
		this._onDidChangeDecorations.event,
		debounceEvent<URI | URI[], FileDecorationChangeEvent>(
			this._onDidChangeDecorationsDelayed.event,
			FileDecorationChangeEvent.debouncer
		)
	);

	registerDecortionsProvider(provider: IDecorationsProvider): IDisposable {

		const wrapper = new DecorationProviderWrapper(provider, this._onDidChangeDecorationsDelayed);
		const remove = this._data.push(wrapper);
		return {
			dispose: () => {
				// fire event that says 'yes' for any resource
				// known to this provider. then dispose and remove it.
				remove();
				this._onDidChangeDecorations.fire({ affectsResource: uri => wrapper.knowsAbout(uri) });
				wrapper.dispose();
			}
		};
	}

	getTopDecoration(uri: URI, includeChildren: boolean): IResourceDecoration {
		let top: IResourceDecoration;
		for (let iter = this._data.iterator(), next = iter.next(); !next.done; next = iter.next()) {
			next.value.getOrRetrieve(uri, includeChildren, (candidate, isChild) => {
				top = FileDecorationsService._pickBest(top, candidate);
				if (isChild && top === candidate) {
					// only bubble up color
					top = {
						severity: top.severity,
						color: top.color
					};
				}
			});
		}
		return top;
	}

	private static _pickBest(a: IResourceDecoration, b: IResourceDecoration): IResourceDecoration {
		if (!a) {
			return b;
		} else if (!b) {
			return a;
		} else if (Severity.compare(a.severity, b.severity) < 0) {
			return a;
		} else {
			return b;
		}
	}
}
