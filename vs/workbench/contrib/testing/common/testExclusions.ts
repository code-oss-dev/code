/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { Iterable } from 'vs/base/common/iterator';
import { Disposable } from 'vs/base/common/lifecycle';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { MutableObservableValue } from 'vs/workbench/contrib/testing/common/observableValue';
import { StoredValue } from 'vs/workbench/contrib/testing/common/storedValue';
import { ITestIdWithSrc } from 'vs/workbench/contrib/testing/common/testCollection';

export class TestExclusions extends Disposable {
	private readonly excluded = this._register(
		MutableObservableValue.stored(new StoredValue<ReadonlySet<string>>({
			key: 'excludedTestItems',
			scope: StorageScope.WORKSPACE,
			target: StorageTarget.USER,
			serialization: {
				deserialize: v => new Set(JSON.parse(v)),
				serialize: v => JSON.stringify([...v])
			},
		}, this.storageService), new Set())
	);

	constructor(@IStorageService private readonly storageService: IStorageService) {
		super();
	}

	/**
	 * Event that fires when the excluded tests change.
	 */
	public readonly onTestExclusionsChanged: Event<unknown> = this.excluded.onDidChange;

	/**
	 * Gets whether there's any excluded tests.
	 */
	public get hasAny() {
		return this.excluded.value.size > 0;
	}

	/**
	 * Gets all excluded tests.
	 */
	public get all() {
		return Iterable.map(this.excluded.value, v => {
			const [controllerId, testId] = JSON.parse(v);
			return { controllerId, testId };
		});
	}

	/**
	 * Sets whether a test is excluded.
	 */
	public toggle(test: ITestIdWithSrc, exclude?: boolean): void {
		const slug = this.identify(test);
		if (exclude !== true && this.excluded.value.has(slug)) {
			this.excluded.value = new Set(Iterable.filter(this.excluded.value, e => e !== slug));
		} else if (exclude !== false && !this.excluded.value.has(slug)) {
			this.excluded.value = new Set([...this.excluded.value, slug]);
		}
	}

	/**
	 * Gets whether a test is excluded.
	 */
	public contains(test: ITestIdWithSrc): boolean {
		return this.excluded.value.has(this.identify(test));
	}

	/**
	 * Removes all test exclusions.
	 */
	public clear(): void {
		this.excluded.value = new Set();
	}

	private identify(test: ITestIdWithSrc) {
		return JSON.stringify([test.controllerId, test.testId]);
	}
}
