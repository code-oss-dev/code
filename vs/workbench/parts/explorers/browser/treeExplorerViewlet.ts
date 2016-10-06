import { TPromise } from 'vs/base/common/winjs.base';
import { Builder, Dimension } from 'vs/base/browser/builder';
import { SplitView, Orientation } from 'vs/base/browser/ui/splitview/splitview';

import { IViewletView, Viewlet } from 'vs/workbench/browser/viewlet';

import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

import { TreeExplorerView } from 'vs/workbench/parts/explorers/browser/views/treeExplorerView';
import { TreeExplorerViewletState } from 'vs/workbench/parts/explorers/browser/views/treeExplorerViewer';

const TREE_NAME = 'pineTree'; // For now

export const CUSTOM_VIEWLET_ID_ROOT = 'workbench.view.treeExplorerViewlet.';
const ID = 'workbench.view.customTreeExplorerViewlet.' + TREE_NAME;

export class TreeExplorerViewlet extends Viewlet {
	private static _idCounter = 1;

	private viewletContainer: Builder;
	private view: IViewletView;

	private viewletState: TreeExplorerViewletState;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super(ID, telemetryService);

		this.viewletState = new TreeExplorerViewletState();

		TreeExplorerViewlet._idCounter++;
	}

	create(parent: Builder): TPromise<void> {
		super.create(parent);

		this.viewletContainer = parent.div().addClass('custom-tree-explorer-viewlet');
		this.addTreeView(TREE_NAME);

		const settings = this.configurationService.getConfiguration<ICustomViewletConfiguration>();
		return this.onConfigurationUpdated(settings);
	}

	layout(dimension: Dimension): void {
		this.view.layout(dimension.height, Orientation.VERTICAL);
	}

	setVisible(visible: boolean): TPromise<void> {
		return super.setVisible(visible).then(() => {
			this.view.setVisible(visible).done();
		})
	}

	private onConfigurationUpdated(config: ICustomViewletConfiguration): TPromise<void> {
		return TPromise.as(null);
	}

	private addTreeView(treeName: string): void {
		// 0 for now, add back header later if needed
		const headerSize = 0;

		this.view = this.instantiationService.createInstance(TreeExplorerView, this.viewletState, treeName, this.getActionRunner(), headerSize);
		this.view.render(this.viewletContainer.getHTMLElement(), Orientation.VERTICAL);
	}

	dispose(): void {
		this.view = null;
	}
}


export interface ICustomViewletConfiguration {
	viewlet: {

	}
}