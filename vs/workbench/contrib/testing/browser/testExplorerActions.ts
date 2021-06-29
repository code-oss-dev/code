/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { Iterable } from 'vs/base/common/iterator';
import { KeyChord, KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { isDefined } from 'vs/base/common/types';
import { Range } from 'vs/editor/common/core/range';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { localize } from 'vs/nls';
import { Action2, IAction2Options, MenuId } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ContextKeyAndExpr, ContextKeyEqualsExpr, ContextKeyFalseExpr, ContextKeyGreaterExpr, ContextKeyTrueExpr } from 'vs/platform/contextkey/common/contextkey';
import { IFileService } from 'vs/platform/files/common/files';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ViewAction } from 'vs/workbench/browser/parts/views/viewPane';
import { FocusedViewContext } from 'vs/workbench/common/views';
import { IExtensionsViewPaneContainer, VIEWLET_ID as EXTENSIONS_VIEWLET_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { REVEAL_IN_EXPLORER_COMMAND_ID } from 'vs/workbench/contrib/files/browser/fileCommands';
import { IActionableTestTreeElement, TestItemTreeElement } from 'vs/workbench/contrib/testing/browser/explorerProjections/index';
import * as icons from 'vs/workbench/contrib/testing/browser/icons';
import { ITestExplorerFilterState } from 'vs/workbench/contrib/testing/browser/testingExplorerFilter';
import { TestingExplorerView, TestingExplorerViewModel } from 'vs/workbench/contrib/testing/browser/testingExplorerView';
import { ITestingOutputTerminalService } from 'vs/workbench/contrib/testing/browser/testingOutputTerminalService';
import { TestExplorerViewMode, TestExplorerViewSorting, Testing } from 'vs/workbench/contrib/testing/common/constants';
import { identifyTest, InternalTestItem, ITestIdWithSrc, ITestItem, TestIdPath, TestRunConfigurationBitset } from 'vs/workbench/contrib/testing/common/testCollection';
import { ITestingAutoRun } from 'vs/workbench/contrib/testing/common/testingAutoRun';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { ITestingPeekOpener } from 'vs/workbench/contrib/testing/common/testingPeekOpener';
import { isFailedState } from 'vs/workbench/contrib/testing/common/testingStates';
import { getPathForTestInResult, ITestResult } from 'vs/workbench/contrib/testing/common/testResult';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { getTestByPath, IMainThreadTestCollection, ITestService, testsInFile } from 'vs/workbench/contrib/testing/common/testService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';

const category = localize('testing.category', 'Test');

const enum ActionOrder {
	// Navigation:
	Run = 10,
	Debug,
	Coverage,
	AutoRun,
	Collapse,

	// Submenu:
	DisplayMode,
	Sort,
	Refresh,
}

const hasAnyTestProvider = ContextKeyGreaterExpr.create(TestingContextKeys.providerCount.key, 0);

export class HideTestAction extends Action2 {
	public static readonly ID = 'testing.hideTest';
	constructor() {
		super({
			id: HideTestAction.ID,
			title: localize('hideTest', 'Hide Test'),
			menu: {
				id: MenuId.TestItem,
				when: TestingContextKeys.testItemIsHidden.isEqualTo(false)
			},
		});
	}

	public override run(accessor: ServicesAccessor, ...elements: IActionableTestTreeElement[]) {
		const service = accessor.get(ITestService);
		for (const element of elements) {
			if (element instanceof TestItemTreeElement) {
				service.excluded.toggle(identifyTest(element.test), true);
			}
		}
		return Promise.resolve();
	}
}

export class UnhideTestAction extends Action2 {
	public static readonly ID = 'testing.unhideTest';
	constructor() {
		super({
			id: UnhideTestAction.ID,
			title: localize('unhideTest', 'Unhide Test'),
			menu: {
				id: MenuId.TestItem,
				when: TestingContextKeys.testItemIsHidden.isEqualTo(true)
			},
		});
	}

	public override run(accessor: ServicesAccessor, ...elements: InternalTestItem[]) {
		const service = accessor.get(ITestService);
		for (const element of elements) {
			if (element instanceof TestItemTreeElement) {
				service.excluded.toggle(identifyTest(element.test), false);
			}
		}
		return Promise.resolve();
	}
}

export class DebugAction extends Action2 {
	public static readonly ID = 'testing.debug';
	constructor() {
		super({
			id: DebugAction.ID,
			title: localize('debug test', 'Debug Test'),
			icon: icons.testingDebugIcon,
			menu: {
				id: MenuId.TestItem,
				group: 'inline',
				order: ActionOrder.Debug,
				when: TestingContextKeys.hasDebuggableTests.isEqualTo(true),
			},
		});
	}

	public override run(acessor: ServicesAccessor, ...elements: IActionableTestTreeElement[]): Promise<any> {
		return acessor.get(ITestService).runTests({
			tests: [...Iterable.concatNested(elements.map(e => e.tests))],
			group: TestRunConfigurationBitset.Debug,
		});
	}
}


export class RunAction extends Action2 {
	public static readonly ID = 'testing.run';
	constructor() {
		super({
			id: RunAction.ID,
			title: localize('run test', 'Run Test'),
			icon: icons.testingRunIcon,
			menu: {
				id: MenuId.TestItem,
				group: 'inline',
				order: ActionOrder.Run,
				when: TestingContextKeys.hasRunnableTests.isEqualTo(true),
			},
		});
	}

	/**
	 * @override
	 */
	public override run(acessor: ServicesAccessor, ...elements: IActionableTestTreeElement[]): Promise<any> {
		return acessor.get(ITestService).runTests({
			tests: [...Iterable.concatNested(elements.map(e => e.tests))],
			group: TestRunConfigurationBitset.Run,
		});
	}
}

abstract class ExecuteSelectedAction extends ViewAction<TestingExplorerView> {
	constructor(id: string, title: string, icon: ThemeIcon, private readonly group: TestRunConfigurationBitset) {
		super({
			id,
			title,
			icon,
			viewId: Testing.ExplorerViewId,
			f1: true,
			category,
			precondition: FocusedViewContext.isEqualTo(Testing.ExplorerViewId),
		});
	}

	/**
	 * @override
	 */
	public runInView(accessor: ServicesAccessor, view: TestingExplorerView): Promise<ITestResult | undefined> {
		const tests = this.getActionableTests(accessor.get(ITestService), view.viewModel);
		if (!tests.length) {
			return Promise.resolve(undefined);
		}

		return accessor.get(ITestService).runTests({ tests, group: this.group });
	}

	private getActionableTests(testService: ITestService, viewModel: TestingExplorerViewModel) {
		const selected = viewModel.getSelectedTests();
		let tests: ITestIdWithSrc[];
		if (!selected.length) {
			tests = ([...testService.collection.rootItems].map(identifyTest));
		} else {
			tests = selected
				.map(treeElement => treeElement instanceof TestItemTreeElement ? treeElement.test : undefined)
				.filter(isDefined)
				.map(identifyTest);
		}

		return tests;
	}
}

export class RunSelectedAction extends ExecuteSelectedAction {
	public static readonly ID = 'testing.runSelected';

	constructor() {
		super(
			RunSelectedAction.ID,
			localize('runSelectedTests', 'Run Selected Tests'),
			icons.testingRunIcon,
			TestRunConfigurationBitset.Run,
		);
	}
}

export class DebugSelectedAction extends ExecuteSelectedAction {
	public static readonly ID = 'testing.debugSelected';
	constructor() {
		super(
			DebugSelectedAction.ID,
			localize('debugSelectedTests', 'Debug Selected Tests'),
			icons.testingDebugIcon,
			TestRunConfigurationBitset.Debug,
		);
	}
}

const showDiscoveringWhile = <R>(progress: IProgressService, task: Promise<R>): Promise<R> => {
	return progress.withProgress(
		{
			location: ProgressLocation.Window,
			title: localize('discoveringTests', 'Discovering Tests'),
		},
		() => task,
	);
};

abstract class RunOrDebugAllTestsAction extends Action2 {
	constructor(options: IAction2Options, private readonly group: TestRunConfigurationBitset, private noTestsFoundError: string) {
		super({
			...options,
			category,
			menu: [{
				id: MenuId.ViewTitle,
				order: group === TestRunConfigurationBitset.Run
					? ActionOrder.Run
					: group === TestRunConfigurationBitset.Debug
						? ActionOrder.Debug
						: ActionOrder.Coverage,
				group: 'navigation',
				when: ContextKeyAndExpr.create([
					ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId),
					TestingContextKeys.isRunning.isEqualTo(false),
					TestingContextKeys.capabilityToContextKey[group].isEqualTo(true),
				])
			}, {
				id: MenuId.CommandPalette,
				when: TestingContextKeys.capabilityToContextKey[group].isEqualTo(true),
			}]
		});
	}

	public async run(accessor: ServicesAccessor) {
		const testService = accessor.get(ITestService);
		const notifications = accessor.get(INotificationService);

		const roots = [...testService.collection.rootItems];
		if (!roots.length) {
			notifications.info(this.noTestsFoundError);
			return;
		}

		await testService.runTests({ tests: roots.map(identifyTest), group: this.group });
	}
}

export class RunAllAction extends RunOrDebugAllTestsAction {
	public static readonly ID = 'testing.runAll';
	constructor() {
		super(
			{
				id: RunAllAction.ID,
				title: localize('runAllTests', 'Run All Tests'),
				icon: icons.testingRunAllIcon,
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyCode.KEY_A),
				},
			},
			TestRunConfigurationBitset.Run,
			localize('noTestProvider', 'No tests found in this workspace. You may need to install a test provider extension'),
		);
	}
}

export class DebugAllAction extends RunOrDebugAllTestsAction {
	public static readonly ID = 'testing.debugAll';
	constructor() {
		super(
			{
				id: DebugAllAction.ID,
				title: localize('debugAllTests', 'Debug All Tests'),
				icon: icons.testingDebugIcon,
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyMod.CtrlCmd | KeyCode.KEY_A),
				},
			},
			TestRunConfigurationBitset.Debug,
			localize('noDebugTestProvider', 'No debuggable tests found in this workspace. You may need to install a test provider extension'),
		);
	}
}

export class CancelTestRunAction extends Action2 {
	public static readonly ID = 'testing.cancelRun';
	constructor() {
		super({
			id: CancelTestRunAction.ID,
			title: localize('testing.cancelRun', "Cancel Test Run"),
			icon: icons.testingCancelIcon,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyMod.CtrlCmd | KeyCode.KEY_X),
			},
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Run,
				group: 'navigation',
				when: ContextKeyAndExpr.create([
					ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId),
					ContextKeyEqualsExpr.create(TestingContextKeys.isRunning.serialize(), true),
				])
			}
		});
	}

	/**
	 * @override
	 */
	public async run(accessor: ServicesAccessor) {
		const resultService = accessor.get(ITestResultService);
		const testService = accessor.get(ITestService);
		for (const run of resultService.results) {
			if (!run.completedAt) {
				testService.cancelTestRun(run.id);
			}
		}
	}
}

export class TestingViewAsListAction extends ViewAction<TestingExplorerView> {
	public static readonly ID = 'testing.viewAsList';
	constructor() {
		super({
			id: TestingViewAsListAction.ID,
			viewId: Testing.ExplorerViewId,
			title: localize('testing.viewAsList', "View as List"),
			toggled: TestingContextKeys.viewMode.isEqualTo(TestExplorerViewMode.List),
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.DisplayMode,
				group: 'viewAs',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.viewMode = TestExplorerViewMode.List;
	}
}

export class TestingViewAsTreeAction extends ViewAction<TestingExplorerView> {
	public static readonly ID = 'testing.viewAsTree';
	constructor() {
		super({
			id: TestingViewAsTreeAction.ID,
			viewId: Testing.ExplorerViewId,
			title: localize('testing.viewAsTree', "View as Tree"),
			toggled: TestingContextKeys.viewMode.isEqualTo(TestExplorerViewMode.Tree),
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.DisplayMode,
				group: 'viewAs',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.viewMode = TestExplorerViewMode.Tree;
	}
}


export class TestingSortByStatusAction extends ViewAction<TestingExplorerView> {
	public static readonly ID = 'testing.sortByStatus';
	constructor() {
		super({
			id: TestingSortByStatusAction.ID,
			viewId: Testing.ExplorerViewId,
			title: localize('testing.sortByStatus', "Sort by Status"),
			toggled: TestingContextKeys.viewSorting.isEqualTo(TestExplorerViewSorting.ByStatus),
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Sort,
				group: 'sortBy',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.viewSorting = TestExplorerViewSorting.ByStatus;
	}
}

export class TestingSortByLocationAction extends ViewAction<TestingExplorerView> {
	public static readonly ID = 'testing.sortByLocation';
	constructor() {
		super({
			id: TestingSortByLocationAction.ID,
			viewId: Testing.ExplorerViewId,
			title: localize('testing.sortByLocation', "Sort by Location"),
			toggled: TestingContextKeys.viewSorting.isEqualTo(TestExplorerViewSorting.ByLocation),
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Sort,
				group: 'sortBy',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.viewSorting = TestExplorerViewSorting.ByLocation;
	}
}

export class ShowMostRecentOutputAction extends Action2 {
	public static readonly ID = 'testing.showMostRecentOutput';
	constructor() {
		super({
			id: ShowMostRecentOutputAction.ID,
			title: localize('testing.showMostRecentOutput', "Show Output"),
			category,
			icon: Codicon.terminal,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyMod.CtrlCmd | KeyCode.KEY_O),
			},
			precondition: TestingContextKeys.hasAnyResults.isEqualTo(true),
			menu: [{
				id: MenuId.ViewTitle,
				order: ActionOrder.Collapse,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId),
			}, {
				id: MenuId.CommandPalette,
				when: TestingContextKeys.hasAnyResults.isEqualTo(true)
			}]
		});
	}

	public run(accessor: ServicesAccessor) {
		const result = accessor.get(ITestResultService).results[0];
		accessor.get(ITestingOutputTerminalService).open(result);
	}
}

export class CollapseAllAction extends ViewAction<TestingExplorerView> {
	public static readonly ID = 'testing.collapseAll';
	constructor() {
		super({
			id: CollapseAllAction.ID,
			viewId: Testing.ExplorerViewId,
			title: localize('testing.collapseAll', "Collapse All Tests"),
			icon: Codicon.collapseAll,
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.Collapse,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}
		});
	}

	/**
	 * @override
	 */
	public runInView(_accessor: ServicesAccessor, view: TestingExplorerView) {
		view.viewModel.collapseAll();
	}
}

export class RefreshTestsAction extends Action2 {
	public static readonly ID = 'testing.refreshTests';
	constructor() {
		super({
			id: RefreshTestsAction.ID,
			title: localize('testing.refresh', "Refresh Tests"),
			category,
			menu: [{
				id: MenuId.ViewTitle,
				order: ActionOrder.Refresh,
				group: 'refresh',
				when: ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId)
			}, {
				id: MenuId.CommandPalette,
				when: TestingContextKeys.providerCount.isEqualTo(true),
			}],
		});
	}

	/**
	 * @override
	 */
	public run(accessor: ServicesAccessor) {
		accessor.get(ITestService).resubscribeToAllTests();
	}
}

export class ClearTestResultsAction extends Action2 {
	public static readonly ID = 'testing.clearTestResults';
	constructor() {
		super({
			id: ClearTestResultsAction.ID,
			title: localize('testing.clearResults', "Clear All Results"),
			category,
			icon: Codicon.trash,
			menu: [{
				id: MenuId.TestPeekTitle,
			}, {
				id: MenuId.CommandPalette,
				when: TestingContextKeys.hasAnyResults.isEqualTo(true),
			},],
		});
	}

	/**
	 * @override
	 */
	public run(accessor: ServicesAccessor) {
		accessor.get(ITestResultService).clear();
	}
}

export class GoToTest extends Action2 {
	public static readonly ID = 'testing.editFocusedTest';
	constructor() {
		super({
			id: GoToTest.ID,
			title: localize('testing.editFocusedTest', "Go to Test"),
			menu: {
				id: MenuId.TestItem,
				when: TestingContextKeys.testItemHasUri.isEqualTo(true),
			},
			keybinding: {
				weight: KeybindingWeight.EditorContrib - 10,
				when: FocusedViewContext.isEqualTo(Testing.ExplorerViewId),
				primary: KeyCode.Enter | KeyMod.Alt,
			},
		});
	}

	public override async run(accessor: ServicesAccessor, element?: IActionableTestTreeElement, preserveFocus?: boolean) {
		if (!element || !(element instanceof TestItemTreeElement) || !element.test.item.uri) {
			return;
		}

		const commandService = accessor.get(ICommandService);
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);
		const { range, uri, extId } = element.test.item;

		accessor.get(ITestExplorerFilterState).reveal.value = [extId];
		accessor.get(ITestingPeekOpener).closeAllPeeks();

		let isFile = true;
		try {
			if (!(await fileService.resolve(uri)).isFile) {
				isFile = false;
			}
		} catch {
			// ignored
		}

		if (!isFile) {
			await commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, uri);
			return;
		}

		await editorService.openEditor({
			resource: uri,
			options: {
				selection: range
					? { startColumn: range.startColumn, startLineNumber: range.startLineNumber }
					: undefined,
				preserveFocus: preserveFocus === true,
			},
		});
	}

	/**
	 * @override
	 */
	public runInView(accessor: ServicesAccessor, view: TestingExplorerView) {
		const selected = view.viewModel.tree.getFocus().find(isDefined);
		if (selected instanceof TestItemTreeElement) {
			this.runForTest(accessor, selected.test.item, false);
		}
	}

	/**
	 * @override
	 */
	private async runForTest(accessor: ServicesAccessor, test: ITestItem, preserveFocus = true) {
		if (!test.uri) {
			return;
		}

		const commandService = accessor.get(ICommandService);
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);

		accessor.get(ITestExplorerFilterState).reveal.value = [test.extId];
		accessor.get(ITestingPeekOpener).closeAllPeeks();

		let isFile = true;
		try {
			if (!(await fileService.resolve(test.uri)).isFile) {
				isFile = false;
			}
		} catch {
			// ignored
		}

		if (!isFile) {
			await commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, test.uri);
			return;
		}

		await editorService.openEditor({
			resource: test.uri,
			options: {
				selection: test.range
					? { startColumn: test.range.startColumn, startLineNumber: test.range.startLineNumber }
					: undefined,
				preserveFocus,
			},
		});
	}
}

abstract class ToggleAutoRun extends Action2 {
	public static readonly ID = 'testing.toggleautoRun';

	constructor(title: string, whenToggleIs: boolean) {
		super({
			id: ToggleAutoRun.ID,
			title,
			icon: icons.testingAutorunIcon,
			toggled: whenToggleIs === true ? ContextKeyTrueExpr.INSTANCE : ContextKeyFalseExpr.INSTANCE,
			menu: {
				id: MenuId.ViewTitle,
				order: ActionOrder.AutoRun,
				group: 'navigation',
				when: ContextKeyAndExpr.create([
					ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId),
					TestingContextKeys.autoRun.isEqualTo(whenToggleIs)
				])
			}
		});
	}

	/**
	 * @override
	 */
	public run(accessor: ServicesAccessor) {
		accessor.get(ITestingAutoRun).toggle();
	}
}

export class AutoRunOnAction extends ToggleAutoRun {
	constructor() {
		super(localize('testing.turnOnAutoRun', "Turn On Auto Run"), false);
	}
}

export class AutoRunOffAction extends ToggleAutoRun {
	constructor() {
		super(localize('testing.turnOffAutoRun', "Turn Off Auto Run"), true);
	}
}


abstract class ExecuteTestAtCursor extends Action2 {
	constructor(options: IAction2Options, protected readonly group: TestRunConfigurationBitset) {
		super({
			...options,
			menu: {
				id: MenuId.CommandPalette,
				when: hasAnyTestProvider,
			},
		});
	}

	/**
	 * @override
	 */
	public async run(accessor: ServicesAccessor) {
		const control = accessor.get(IEditorService).activeTextEditorControl;
		const position = control?.getPosition();
		const model = control?.getModel();
		if (!position || !model || !('uri' in model)) {
			return;
		}

		const testService = accessor.get(ITestService);
		let bestNode: InternalTestItem | undefined;

		await showDiscoveringWhile(accessor.get(IProgressService), (async () => {
			for await (const test of testsInFile(testService.collection, model.uri)) {
				if (test.item.range && Range.containsPosition(test.item.range, position)) {
					bestNode = test;
				}
			}
		})());


		if (bestNode) {
			await testService.runTests({
				group: this.group,
				tests: [identifyTest(bestNode)],
			});
		}
	}
}

export class RunAtCursor extends ExecuteTestAtCursor {
	public static readonly ID = 'testing.runAtCursor';
	constructor() {
		super({
			id: RunAtCursor.ID,
			title: localize('testing.runAtCursor', "Run Test at Cursor"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyCode.KEY_C),
			},
		}, TestRunConfigurationBitset.Run);
	}
}

export class DebugAtCursor extends ExecuteTestAtCursor {
	public static readonly ID = 'testing.debugAtCursor';
	constructor() {
		super({
			id: DebugAtCursor.ID,
			title: localize('testing.debugAtCursor', "Debug Test at Cursor"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyMod.CtrlCmd | KeyCode.KEY_C),
			},
		}, TestRunConfigurationBitset.Debug);
	}
}

abstract class ExecuteTestsInCurrentFile extends Action2 {
	constructor(options: IAction2Options, protected readonly group: TestRunConfigurationBitset) {
		super({
			...options,
			menu: {
				id: MenuId.CommandPalette,
				when: TestingContextKeys.capabilityToContextKey[group].isEqualTo(true),
			},
		});
	}

	/**
	 * @override
	 */
	public run(accessor: ServicesAccessor) {
		const control = accessor.get(IEditorService).activeTextEditorControl;
		const position = control?.getPosition();
		const model = control?.getModel();
		if (!position || !model || !('uri' in model)) {
			return;
		}

		const testService = accessor.get(ITestService);

		const demandedUri = model.uri.toString();
		for (const test of testService.collection.all) {
			if (test.item.uri?.toString() === demandedUri) {
				return testService.runTests({
					tests: [identifyTest(test)],
					group: this.group,
				});
			}
		}

		return undefined;
	}
}

export class RunCurrentFile extends ExecuteTestsInCurrentFile {
	public static readonly ID = 'testing.runCurrentFile';

	constructor() {
		super({
			id: RunCurrentFile.ID,
			title: localize('testing.runCurrentFile', "Run Tests in Current File"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyCode.KEY_F),
			},
		}, TestRunConfigurationBitset.Run);
	}
}

export class DebugCurrentFile extends ExecuteTestsInCurrentFile {
	public static readonly ID = 'testing.debugCurrentFile';

	constructor() {
		super({
			id: DebugCurrentFile.ID,
			title: localize('testing.debugCurrentFile', "Debug Tests in Current File"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyMod.CtrlCmd | KeyCode.KEY_F),
			},
		}, TestRunConfigurationBitset.Debug);
	}
}

export const runTestsByPath = async (
	collection: IMainThreadTestCollection,
	progress: IProgressService,
	paths: ReadonlyArray<TestIdPath>,
	runTests: (tests: ReadonlyArray<InternalTestItem>) => Promise<ITestResult>,
): Promise<ITestResult | undefined> => {
	const todo = Promise.all(paths.map(p => getTestByPath(collection, p)));
	const tests = (await showDiscoveringWhile(progress, todo)).filter(isDefined);
	return tests.length ? await runTests(tests) : undefined;
};

abstract class RunOrDebugExtsByPath extends Action2 {
	/**
	 * @override
	 */
	public async run(accessor: ServicesAccessor, ...args: unknown[]) {
		const testService = accessor.get(ITestService);
		await runTestsByPath(
			accessor.get(ITestService).collection,
			accessor.get(IProgressService),
			[...this.getTestExtIdsToRun(accessor, ...args)],
			tests => this.runTest(testService, tests),
		);
	}

	protected abstract getTestExtIdsToRun(accessor: ServicesAccessor, ...args: unknown[]): Iterable<TestIdPath>;

	protected abstract runTest(service: ITestService, node: readonly InternalTestItem[]): Promise<ITestResult>;
}

abstract class RunOrDebugFailedTests extends RunOrDebugExtsByPath {
	constructor(options: IAction2Options) {
		super({
			...options,
			menu: {
				id: MenuId.CommandPalette,
				when: hasAnyTestProvider,
			},
		});
	}
	/**
	 * @inheritdoc
	 */
	protected getTestExtIdsToRun(accessor: ServicesAccessor): Iterable<TestIdPath> {
		const { results } = accessor.get(ITestResultService);
		const paths = new Map<string /* id */, string /* path */>();
		const sep = '$$TEST SEP$$';
		for (let i = results.length - 1; i >= 0; i--) {
			const resultSet = results[i];
			for (const test of resultSet.tests) {
				const path = getPathForTestInResult(test, resultSet).join(sep);
				if (isFailedState(test.ownComputedState)) {
					paths.set(test.item.extId, path);
				} else {
					paths.delete(test.item.extId);
				}
			}
		}

		return Iterable.map(paths.values(), p => p.split(sep));
	}
}

abstract class RunOrDebugLastRun extends RunOrDebugExtsByPath {
	constructor(options: IAction2Options) {
		super({
			...options,
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([
					hasAnyTestProvider,
					TestingContextKeys.hasAnyResults.isEqualTo(true),
				]),
			},
		});
	}

	/**
	 * @inheritdoc
	 */
	protected *getTestExtIdsToRun(accessor: ServicesAccessor, runId?: string): Iterable<TestIdPath> {
		const resultService = accessor.get(ITestResultService);
		const lastResult = runId ? resultService.results.find(r => r.id === runId) : resultService.results[0];
		if (!lastResult) {
			return;
		}

		for (const test of lastResult.request.targets) {
			for (const testId of test.testIds) {
				const test = lastResult.getStateById(testId);
				if (test) {
					yield getPathForTestInResult(test, lastResult);
				}
			}
		}
	}
}

export class ReRunFailedTests extends RunOrDebugFailedTests {
	public static readonly ID = 'testing.reRunFailTests';
	constructor() {
		super({
			id: ReRunFailedTests.ID,
			title: localize('testing.reRunFailTests', "Rerun Failed Tests"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyCode.KEY_E),
			},
		});
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			group: TestRunConfigurationBitset.Run,
			tests: internalTests.map(identifyTest),
		});
	}
}

export class DebugFailedTests extends RunOrDebugFailedTests {
	public static readonly ID = 'testing.debugFailTests';
	constructor() {
		super({
			id: DebugFailedTests.ID,
			title: localize('testing.debugFailTests', "Debug Failed Tests"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyMod.CtrlCmd | KeyCode.KEY_E),
			},
		});
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			group: TestRunConfigurationBitset.Debug,
			tests: internalTests.map(identifyTest),
		});
	}
}

export class ReRunLastRun extends RunOrDebugLastRun {
	public static readonly ID = 'testing.reRunLastRun';
	constructor() {
		super({
			id: ReRunLastRun.ID,
			title: localize('testing.reRunLastRun', "Rerun Last Run"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyCode.KEY_L),
			},
		});
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			group: TestRunConfigurationBitset.Debug,
			tests: internalTests.map(identifyTest),
		});
	}
}

export class DebugLastRun extends RunOrDebugLastRun {
	public static readonly ID = 'testing.debugLastRun';
	constructor() {
		super({
			id: DebugLastRun.ID,
			title: localize('testing.debugLastRun', "Debug Last Run"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyMod.CtrlCmd | KeyCode.KEY_L),
			},
		});
	}

	protected runTest(service: ITestService, internalTests: InternalTestItem[]): Promise<ITestResult> {
		return service.runTests({
			group: TestRunConfigurationBitset.Debug,
			tests: internalTests.map(identifyTest),
		});
	}
}

export class SearchForTestExtension extends Action2 {
	public static readonly ID = 'testing.searchForTestExtension';
	constructor() {
		super({
			id: SearchForTestExtension.ID,
			title: localize('testing.searchForTestExtension', "Search for Test Extension"),
		});
	}

	public async run(accessor: ServicesAccessor) {
		const viewletService = accessor.get(IViewletService);
		const viewlet = (await viewletService.openViewlet(EXTENSIONS_VIEWLET_ID, true))?.getViewPaneContainer() as IExtensionsViewPaneContainer;
		viewlet.search('tag:testing @sort:installs');
		viewlet.focus();
	}
}

export class OpenOutputPeek extends Action2 {
	public static readonly ID = 'testing.openOutputPeek';
	constructor() {
		super({
			id: OpenOutputPeek.ID,
			title: localize('testing.openOutputPeek', "Peek Output"),
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.US_SEMICOLON, KeyCode.KEY_M),
			},
			menu: {
				id: MenuId.CommandPalette,
				when: TestingContextKeys.hasAnyResults.isEqualTo(true),
			},
		});
	}

	public async run(accessor: ServicesAccessor) {
		accessor.get(ITestingPeekOpener).open();
	}
}

export const allTestActions = [
	AutoRunOffAction,
	AutoRunOnAction,
	CancelTestRunAction,
	ClearTestResultsAction,
	CollapseAllAction,
	DebugAction,
	DebugAllAction,
	DebugAtCursor,
	DebugCurrentFile,
	DebugFailedTests,
	DebugLastRun,
	DebugSelectedAction,
	GoToTest,
	HideTestAction,
	OpenOutputPeek,
	RefreshTestsAction,
	ReRunFailedTests,
	ReRunLastRun,
	RunAction,
	RunAllAction,
	RunAtCursor,
	RunCurrentFile,
	RunSelectedAction,
	SearchForTestExtension,
	ShowMostRecentOutputAction,
	TestingSortByLocationAction,
	TestingSortByStatusAction,
	TestingViewAsListAction,
	TestingViewAsTreeAction,
	UnhideTestAction,
];
