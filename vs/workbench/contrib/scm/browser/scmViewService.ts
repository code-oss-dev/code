/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { ISCMViewService, ISCMRepository, ISCMService, ISCMViewVisibleRepositoryChangeEvent, ISCMMenus } from 'vs/workbench/contrib/scm/common/scm';
import { Iterable } from 'vs/base/common/iterator';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { SCMMenus } from 'vs/workbench/contrib/scm/browser/menus';

export class SCMViewService implements ISCMViewService {

	declare readonly _serviceBrand: undefined;

	readonly menus: ISCMMenus;

	private disposables = new DisposableStore();

	private _visibleRepositoriesSet = new Set<ISCMRepository>();
	private _visibleRepositories: ISCMRepository[] = [];

	get visibleRepositories(): ISCMRepository[] {
		return this._visibleRepositories;
	}

	set visibleRepositories(visibleRepositories: ISCMRepository[]) {
		const set = new Set(visibleRepositories);
		const added = new Set<ISCMRepository>();
		const removed = new Set<ISCMRepository>();

		for (const repository of visibleRepositories) {
			if (!this._visibleRepositoriesSet.has(repository)) {
				added.add(repository);
			}
		}

		for (const repository of this._visibleRepositories) {
			if (!set.has(repository)) {
				removed.add(repository);
			}
		}

		if (added.size === 0 && removed.size === 0) {
			return;
		}

		this._visibleRepositories = visibleRepositories;
		this._visibleRepositoriesSet = set;
		this._onDidChangeVisibleRepositories.fire({ added, removed });
	}

	get repositories(): ISCMRepository[] { return this.scmService.repositories; }

	private _onDidAddRepository = new Emitter<ISCMRepository>();
	readonly onDidAddRepository = this._onDidAddRepository.event;

	private _onDidRemoveRepository = new Emitter<ISCMRepository>();
	readonly onDidRemoveRepository = this._onDidRemoveRepository.event;

	private _onDidChangeVisibleRepositories = new Emitter<ISCMViewVisibleRepositoryChangeEvent>();
	readonly onDidChangeVisibleRepositories = this._onDidChangeVisibleRepositories.event;

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		this.menus = instantiationService.createInstance(SCMMenus);

		scmService.onDidAddRepository(this.onDidAddServiceRepository, this, this.disposables);
		scmService.onDidRemoveRepository(this.onDidRemoveServiceRepository, this, this.disposables);

		for (const repository of scmService.repositories) {
			this.onDidAddServiceRepository(repository);
		}
	}

	private onDidAddServiceRepository(repository: ISCMRepository): void {
		this._visibleRepositories.push(repository);
		this._visibleRepositoriesSet.add(repository);

		this._onDidAddRepository.fire(repository);
		this._onDidChangeVisibleRepositories.fire({ added: [repository], removed: Iterable.empty() });
	}

	private onDidRemoveServiceRepository(repository: ISCMRepository): void {
		const index = this._visibleRepositories.indexOf(repository);

		if (index > -1) {
			this._visibleRepositories.splice(index, 1);
			this._visibleRepositoriesSet.delete(repository);
			this._onDidRemoveRepository.fire(repository);
			this._onDidChangeVisibleRepositories.fire({ added: Iterable.empty(), removed: [repository] });
		}
	}

	dispose(): void {
		this.disposables.dispose();
		this._onDidChangeVisibleRepositories.dispose();
	}
}
