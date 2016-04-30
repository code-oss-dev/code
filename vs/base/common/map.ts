/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

interface Entry<T> {
	next?: Entry<T>;
	prev?: Entry<T>;
	key: string;
	value: T;
}

/**
 * A simple Map<T> that optionally allows to set a limit of entries to store. Once the limit is hit,
 * the cache will remove the entry that was last recently added.
 */
export class LinkedMap<T> {
	protected map: { [key: string]: Entry<T> };
	private head: Entry<T>;
	private tail: Entry<T>;
	private _size: number;

	constructor(private limit = Number.MAX_VALUE) {
		this.map = Object.create(null);
		this._size = 0;
	}

	public get size(): number {
		return this._size;
	}

	public set(key: string, value: T): boolean {
		if (this.map[key]) {
			return false; // already present!
		}

		const entry: Entry<T> = { key, value };
		this.push(entry);

		if (this._size > this.limit) {
			this.trim();
		}

		return true;
	}

	public get(key: string): T {
		const entry = this.map[key];

		return entry ? entry.value : null;
	}

	public delete(key: string): T {
		const entry = this.map[key];

		if (entry) {
			this.map[key] = void 0;
			this._size--;

			if (entry.next) {
				entry.next.prev = entry.prev; // [A]<-[x]<-[C] = [A]<-[C]
			} else {
				this.head = entry.prev; // [A]-[x] = [A]
			}

			if (entry.prev) {
				entry.prev.next = entry.next; // [A]->[x]->[C] = [A]->[C]
			} else {
				this.tail = entry.next; // [x]-[A] = [A]
			}

			return entry.value;
		}

		return null;
	}

	public has(key: string): boolean {
		return !!this.map[key];
	}

	public clear(): void {
		this.map = Object.create(null);
		this._size = 0;
		this.head = null;
		this.tail = null;
	}

	protected push(entry: Entry<T>): void {
		if (this.head) {
			// [A]-[B] = [A]-[B]->[X]
			entry.prev = this.head;
			this.head.next = entry;
		}

		if (!this.tail) {
			this.tail = entry;
		}

		this.head = entry;

		this.map[entry.key] = entry;
		this._size++;
	}

	private trim(): void {
		if (this.tail) {
			this.map[this.tail.key] = void 0;
			this._size--;

			// [x]-[B] = [B]
			this.tail = this.tail.next;
			this.tail.prev = null;
		}
	}
}

/**
 * A subclass of Map<T> that makes an entry the MRU entry as soon
 * as it is being accessed. In combination with the limit for the
 * maximum number of elements in the cache, it helps to remove those
 * entries from the cache that are LRU.
 */
export class LRUCache<T> extends LinkedMap<T> {

	constructor(limit: number) {
		super(limit);
	}

	public get(key: string): T {

		// Upon access of an entry, make it the head of
		// the linked map so that it is the MRU element
		const entry = this.map[key];
		if (entry) {
			this.delete(key);
			this.push(entry);

			return entry.value;
		}


		return null;
	}
}