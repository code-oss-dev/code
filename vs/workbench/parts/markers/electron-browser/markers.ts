/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { MarkersModel, compareMarkersByUri } from './markersModel';
import { Disposable } from 'vs/base/common/lifecycle';
import { IMarkerService, MarkerSeverity, IMarker } from 'vs/platform/markers/common/markers';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { localize } from 'vs/nls';
import Constants from './constants';
import { URI } from 'vs/base/common/uri';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { groupBy } from 'vs/base/common/arrays';

export const IMarkersWorkbenchService = createDecorator<IMarkersWorkbenchService>('markersWorkbenchService');

export interface IFilter {
	filterText: string;
	useFilesExclude: boolean;
}

export interface IMarkersWorkbenchService {
	_serviceBrand: any;

	readonly markersModel: MarkersModel;

	// filter(filter: IFilter): void;
}

export class MarkersWorkbenchService extends Disposable implements IMarkersWorkbenchService {
	_serviceBrand: any;

	readonly markersModel: MarkersModel;

	// private useFilesExclude: boolean = false;

	constructor(
		@IMarkerService private markerService: IMarkerService,
		// @IConfigurationService private configurationService: IConfigurationService,
		// @IWorkspaceContextService private workspaceContextService: IWorkspaceContextService,
		@IActivityService private activityService: IActivityService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.markersModel = this._register(instantiationService.createInstance(MarkersModel, this.readMarkers()));

		for (const group of groupBy(this.readMarkers(), compareMarkersByUri)) {
			this.markersModel.setResourceMarkers(group[0].resource, group);
		}

		this._register(markerService.onMarkerChanged(resources => this.onMarkerChanged(resources)));
		// TODO@joao
		// this._register(configurationService.onDidChangeConfiguration(e => {
		// 	if (this.useFilesExclude && e.affectsConfiguration('files.exclude')) {
		// 		this.doFilter(this.markersModel.filterOptions.filter, this.getExcludeExpression());
		// 	}
		// }));
	}

	// filter(filter: IFilter): void {
	// 	this.useFilesExclude = filter.useFilesExclude;
	// 	this.doFilter(filter.filterText, this.getExcludeExpression());
	// }

	private onMarkerChanged(resources: URI[]): void {
		for (const resource of resources) {
			this.markersModel.setResourceMarkers(resource, this.readMarkers(resource));
		}

		this.refreshBadge();
	}

	private readMarkers(resource?: URI): IMarker[] {
		return this.markerService.read({ resource, severities: MarkerSeverity.Error | MarkerSeverity.Warning | MarkerSeverity.Info });
	}

	// private getExcludeExpression(): IExpression {
	// 	if (this.useFilesExclude) {
	// 		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
	// 		if (workspaceFolders.length) {
	// 			const result = getEmptyExpression();
	// 			for (const workspaceFolder of workspaceFolders) {
	// 				mixin(result, this.getExcludesForFolder(workspaceFolder));
	// 			}
	// 			return result;
	// 		} else {
	// 			return this.getFilesExclude();
	// 		}
	// 	}
	// 	return {};
	// }

	// private doFilter(filterText: string, filesExclude: IExpression): void {
	// 	console.warn('marker filter not implemented');
	// 	this.refreshBadge();
	// 	this._onDidChange.fire([]);
	// }

	private refreshBadge(): void {
		const { total } = this.markersModel.stats();
		const message = localize('totalProblems', 'Total {0} Problems', total);
		this.activityService.showActivity(Constants.MARKERS_PANEL_ID, new NumberBadge(total, () => message));
	}

	// private getExcludesForFolder(workspaceFolder: IWorkspaceFolder): IExpression {
	// 	const expression = this.getFilesExclude(workspaceFolder.uri);
	// 	return this.getAbsoluteExpression(expression, workspaceFolder.uri.fsPath);
	// }

	// private getFilesExclude(resource?: URI): IExpression {
	// 	return deepClone(this.configurationService.getValue('files.exclude', { resource })) || {};
	// }

	// private getAbsoluteExpression(expr: IExpression, root: string): IExpression {
	// 	return Object.keys(expr)
	// 		.reduce((absExpr: IExpression, key: string) => {
	// 			if (expr[key] && !isAbsolute(key)) {
	// 				const absPattern = join(root, key);
	// 				absExpr[absPattern] = expr[key];
	// 			}

	// 			return absExpr;
	// 		}, Object.create(null));
	// }
}

registerSingleton(IMarkersWorkbenchService, MarkersWorkbenchService);