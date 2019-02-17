/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';

import { URI, UriComponents } from 'vs/base/common/uri';
import * as Objects from 'vs/base/common/objects';
import { asPromise } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';
import { win32 } from 'vs/base/node/processes';

import { IExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';

import { MainContext, MainThreadTaskShape, ExtHostTaskShape, IMainContext } from 'vs/workbench/api/node/extHost.protocol';

import * as types from 'vs/workbench/api/node/extHostTypes';
import { ExtHostWorkspace, ExtHostWorkspaceProvider } from 'vs/workbench/api/node/extHostWorkspace';
import * as vscode from 'vscode';
import {
	TaskDefinitionDTO, TaskExecutionDTO, TaskPresentationOptionsDTO,
	ProcessExecutionOptionsDTO, ProcessExecutionDTO,
	ShellExecutionOptionsDTO, ShellExecutionDTO,
	CustomTaskExecutionDTO,
	TaskDTO, TaskHandleDTO, TaskFilterDTO, TaskProcessStartedDTO, TaskProcessEndedDTO, TaskSystemInfoDTO, TaskSetDTO
} from '../shared/tasks';
import { ExtHostVariableResolverService } from 'vs/workbench/api/node/extHostDebugService';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/node/extHostDocumentsAndEditors';
import { ExtHostConfiguration } from 'vs/workbench/api/node/extHostConfiguration';
import { ExtHostTerminalService, ExtHostTerminal } from 'vs/workbench/api/node/extHostTerminalService';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';

namespace TaskDefinitionDTO {
	export function from(value: vscode.TaskDefinition): TaskDefinitionDTO {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: TaskDefinitionDTO): vscode.TaskDefinition {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
}

namespace TaskPresentationOptionsDTO {
	export function from(value: vscode.TaskPresentationOptions): TaskPresentationOptionsDTO {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: TaskPresentationOptionsDTO): vscode.TaskPresentationOptions {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
}

namespace ProcessExecutionOptionsDTO {
	export function from(value: vscode.ProcessExecutionOptions): ProcessExecutionOptionsDTO {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: ProcessExecutionOptionsDTO): vscode.ProcessExecutionOptions {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
}

namespace ProcessExecutionDTO {
	export function is(value: ShellExecutionDTO | ProcessExecutionDTO | CustomTaskExecutionDTO): value is ProcessExecutionDTO {
		let candidate = value as ProcessExecutionDTO;
		return candidate && !!candidate.process;
	}
	export function from(value: vscode.ProcessExecution): ProcessExecutionDTO {
		if (value === undefined || value === null) {
			return undefined;
		}
		let result: ProcessExecutionDTO = {
			process: value.process,
			args: value.args
		};
		if (value.options) {
			result.options = ProcessExecutionOptionsDTO.from(value.options);
		}
		return result;
	}
	export function to(value: ProcessExecutionDTO): types.ProcessExecution {
		if (value === undefined || value === null) {
			return undefined;
		}
		return new types.ProcessExecution(value.process, value.args, value.options);
	}
}

namespace ShellExecutionOptionsDTO {
	export function from(value: vscode.ShellExecutionOptions): ShellExecutionOptionsDTO {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: ShellExecutionOptionsDTO): vscode.ShellExecutionOptions {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
}

namespace ShellExecutionDTO {
	export function is(value: ShellExecutionDTO | ProcessExecutionDTO | CustomTaskExecutionDTO): value is ShellExecutionDTO {
		let candidate = value as ShellExecutionDTO;
		return candidate && (!!candidate.commandLine || !!candidate.command);
	}
	export function from(value: vscode.ShellExecution): ShellExecutionDTO {
		if (value === undefined || value === null) {
			return undefined;
		}
		let result: ShellExecutionDTO = {
		};
		if (value.commandLine !== undefined) {
			result.commandLine = value.commandLine;
		} else {
			result.command = value.command;
			result.args = value.args;
		}
		if (value.options) {
			result.options = ShellExecutionOptionsDTO.from(value.options);
		}
		return result;
	}
	export function to(value: ShellExecutionDTO): types.ShellExecution {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (value.commandLine) {
			return new types.ShellExecution(value.commandLine, value.options);
		} else {
			return new types.ShellExecution(value.command, value.args ? value.args : [], value.options);
		}
	}
}

namespace CustomTaskExecutionDTO {
	export function is(value: ShellExecutionDTO | ProcessExecutionDTO | CustomTaskExecutionDTO): value is CustomTaskExecutionDTO {
		let candidate = value as CustomTaskExecutionDTO;
		return candidate && candidate.customTaskExecution === 'customTaskExecution';
	}

	export function from(value: vscode.CustomTaskExecution): CustomTaskExecutionDTO {
		return {
			customTaskExecution: 'customTaskExecution'
		};
	}
}

namespace TaskHandleDTO {
	export function from(value: types.Task): TaskHandleDTO {
		let folder: UriComponents;
		if (value.scope !== undefined && typeof value.scope !== 'number') {
			folder = value.scope.uri;
		}
		return {
			id: value._id,
			workspaceFolder: folder
		};
	}
}

namespace TaskDTO {

	export function fromMany(tasks: vscode.Task[], extension: IExtensionDescription): TaskDTO[] {
		if (tasks === undefined || tasks === null) {
			return [];
		}
		let result: TaskDTO[] = [];
		for (let task of tasks) {
			let converted = from(task, extension);
			if (converted) {
				result.push(converted);
			}
		}
		return result;
	}

	export function from(value: vscode.Task, extension: IExtensionDescription): TaskDTO {
		if (value === undefined || value === null) {
			return undefined;
		}
		let execution: ShellExecutionDTO | ProcessExecutionDTO | CustomTaskExecutionDTO;
		if (value.execution instanceof types.ProcessExecution) {
			execution = ProcessExecutionDTO.from(value.execution);
		} else if (value.execution instanceof types.ShellExecution) {
			execution = ShellExecutionDTO.from(value.execution);
		} else if ((<vscode.TaskWithCustomTaskExecution>value).executionWithExtensionCallback && (<vscode.TaskWithCustomTaskExecution>value).executionWithExtensionCallback instanceof types.CustomTaskExecution) {
			execution = CustomTaskExecutionDTO.from(<types.CustomTaskExecution>(<vscode.TaskWithCustomTaskExecution>value).executionWithExtensionCallback);
		}

		let definition: TaskDefinitionDTO = TaskDefinitionDTO.from(value.definition);
		let scope: number | UriComponents;
		if (value.scope) {
			if (typeof value.scope === 'number') {
				scope = value.scope;
			} else {
				scope = value.scope.uri;
			}
		} else {
			// To continue to support the deprecated task constructor that doesn't take a scope, we must add a scope here:
			scope = types.TaskScope.Workspace;
		}
		if (!definition || !scope) {
			return undefined;
		}
		let group = (value.group as types.TaskGroup) ? (value.group as types.TaskGroup).id : undefined;
		let result: TaskDTO = {
			_id: (value as types.Task)._id,
			definition,
			name: value.name,
			source: {
				extensionId: extension.identifier.value,
				label: value.source,
				scope: scope
			},
			execution,
			isBackground: value.isBackground,
			group: group,
			presentationOptions: TaskPresentationOptionsDTO.from(value.presentationOptions),
			problemMatchers: value.problemMatchers,
			hasDefinedMatchers: (value as types.Task).hasDefinedMatchers,
			runOptions: (<vscode.Task>value).runOptions ? (<vscode.Task>value).runOptions : { reevaluateOnRerun: true },
		};
		return result;
	}
	export function to(value: TaskDTO, workspace: ExtHostWorkspaceProvider): types.Task {
		if (value === undefined || value === null) {
			return undefined;
		}
		let execution: types.ShellExecution | types.ProcessExecution;
		if (ProcessExecutionDTO.is(value.execution)) {
			execution = ProcessExecutionDTO.to(value.execution);
		} else if (ShellExecutionDTO.is(value.execution)) {
			execution = ShellExecutionDTO.to(value.execution);
		}
		let definition: vscode.TaskDefinition = TaskDefinitionDTO.to(value.definition);
		let scope: vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder;
		if (value.source) {
			if (value.source.scope !== undefined) {
				if (typeof value.source.scope === 'number') {
					scope = value.source.scope;
				} else {
					scope = workspace.resolveWorkspaceFolder(URI.revive(value.source.scope));
				}
			} else {
				scope = types.TaskScope.Workspace;
			}
		}
		if (!definition || !scope) {
			return undefined;
		}
		let result = new types.Task(definition, scope, value.name, value.source.label, execution, value.problemMatchers);
		if (value.isBackground !== undefined) {
			result.isBackground = value.isBackground;
		}
		if (value.group !== undefined) {
			result.group = types.TaskGroup.from(value.group);
		}
		if (value.presentationOptions) {
			result.presentationOptions = TaskPresentationOptionsDTO.to(value.presentationOptions);
		}
		if (value._id) {
			result._id = value._id;
		}
		return result;
	}
}

namespace TaskFilterDTO {
	export function from(value: vscode.TaskFilter): TaskFilterDTO {
		return value;
	}

	export function to(value: TaskFilterDTO): vscode.TaskFilter {
		if (!value) {
			return undefined;
		}
		return Objects.assign(Object.create(null), value);
	}
}

class TaskExecutionImpl implements vscode.TaskExecution {

	constructor(private readonly _tasks: ExtHostTask, readonly _id: string, private readonly _task: vscode.Task) {
	}

	public get task(): vscode.Task {
		return this._task;
	}

	public terminate(): void {
		this._tasks.terminateTask(this);
	}

	public fireDidStartProcess(value: TaskProcessStartedDTO): void {
	}

	public fireDidEndProcess(value: TaskProcessEndedDTO): void {
	}
}

namespace TaskExecutionDTO {
	export function to(value: TaskExecutionDTO, tasks: ExtHostTask, workspaceProvider: ExtHostWorkspaceProvider): vscode.TaskExecution {
		return new TaskExecutionImpl(tasks, value.id, TaskDTO.to(value.task, workspaceProvider));
	}
	export function from(value: vscode.TaskExecution): TaskExecutionDTO {
		return {
			id: (value as TaskExecutionImpl)._id,
			task: undefined
		};
	}
}

interface HandlerData {
	provider: vscode.TaskProvider;
	extension: IExtensionDescription;
}

class CustomTaskExecutionData implements IDisposable {
	private _cancellationSource?: CancellationTokenSource;
	private readonly _onTaskExecutionComplete: Emitter<CustomTaskExecutionData> = new Emitter<CustomTaskExecutionData>();
	private readonly _disposables: IDisposable[] = [];
	private terminal?: vscode.Terminal;
	private terminalId?: number;
	public result: number | undefined;

	constructor(
		private readonly callbackData: vscode.CustomTaskExecution,
		private readonly terminalService: ExtHostTerminalService) {
	}

	public dispose(): void {
		dispose(this._disposables);
	}

	public get onTaskExecutionComplete(): Event<CustomTaskExecutionData> {
		return this._onTaskExecutionComplete.event;
	}

	private onDidCloseTerminal(terminal: vscode.Terminal): void {
		if (this.terminal === terminal) {
			this._cancellationSource.cancel();
		}
	}

	private onDidOpenTerminal(terminal: vscode.Terminal): void {
		if (!(terminal instanceof ExtHostTerminal)) {
			throw new Error('How could this not be a extension host terminal?');
		}

		if (this.terminalId && terminal._id === this.terminalId) {
			this.startCallback(this.terminalId);
		}
	}

	public async startCallback(terminalId: number): Promise<void> {
		this.terminalId = terminalId;

		// If we have already started the extension task callback, then
		// do not start it again.
		// It is completely valid for multiple terminals to be opened
		// before the one for our task.
		if (this._cancellationSource) {
			return undefined;
		}

		const callbackTerminals: vscode.Terminal[] = this.terminalService.terminals.filter((terminal) => terminal._id === terminalId);

		if (!callbackTerminals || callbackTerminals.length === 0) {
			this._disposables.push(this.terminalService.onDidOpenTerminal(this.onDidOpenTerminal.bind(this)));
			return;
		}

		if (callbackTerminals.length !== 1) {
			throw new Error(`Expected to only have one terminal at this point`);
		}

		this.terminal = callbackTerminals[0];
		const terminalRenderer: vscode.TerminalRenderer = await this.terminalService.createTerminalRendererForTerminal(this.terminal);

		this._cancellationSource = new CancellationTokenSource();
		this._disposables.push(this._cancellationSource);

		this._disposables.push(this.terminalService.onDidCloseTerminal(this.onDidCloseTerminal.bind(this)));

		// Regardless of how the task completes, we are done with this custom execution task.
		this.callbackData.callback(terminalRenderer, this._cancellationSource.token).then(
			(success) => {
				this.result = success;
				this._onTaskExecutionComplete.fire(this);
			}, (rejected) => {
				this._onTaskExecutionComplete.fire(this);
			});
	}
}

export class ExtHostTask implements ExtHostTaskShape {

	private _proxy: MainThreadTaskShape;
	private _workspaceService: ExtHostWorkspace;
	private _editorService: ExtHostDocumentsAndEditors;
	private _configurationService: ExtHostConfiguration;
	private _terminalService: ExtHostTerminalService;
	private _handleCounter: number;
	private _handlers: Map<number, HandlerData>;
	private _taskExecutions: Map<string, TaskExecutionImpl>;
	private _providedCustomTaskExecutions: Map<string, CustomTaskExecutionData>;
	private _activeCustomTaskExecutions: Map<string, CustomTaskExecutionData>;

	private readonly _onDidExecuteTask: Emitter<vscode.TaskStartEvent> = new Emitter<vscode.TaskStartEvent>();
	private readonly _onDidTerminateTask: Emitter<vscode.TaskEndEvent> = new Emitter<vscode.TaskEndEvent>();

	private readonly _onDidTaskProcessStarted: Emitter<vscode.TaskProcessStartEvent> = new Emitter<vscode.TaskProcessStartEvent>();
	private readonly _onDidTaskProcessEnded: Emitter<vscode.TaskProcessEndEvent> = new Emitter<vscode.TaskProcessEndEvent>();

	constructor(
		mainContext: IMainContext,
		workspaceService: ExtHostWorkspace,
		editorService: ExtHostDocumentsAndEditors,
		configurationService: ExtHostConfiguration,
		extHostTerminalService: ExtHostTerminalService) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadTask);
		this._workspaceService = workspaceService;
		this._editorService = editorService;
		this._configurationService = configurationService;
		this._terminalService = extHostTerminalService;
		this._handleCounter = 0;
		this._handlers = new Map<number, HandlerData>();
		this._taskExecutions = new Map<string, TaskExecutionImpl>();
		this._providedCustomTaskExecutions = new Map<string, CustomTaskExecutionData>();
		this._activeCustomTaskExecutions = new Map<string, CustomTaskExecutionData>();
	}

	public registerTaskProvider(extension: IExtensionDescription, provider: vscode.TaskProvider): vscode.Disposable {
		if (!provider) {
			return new types.Disposable(() => { });
		}
		let handle = this.nextHandle();
		this._handlers.set(handle, { provider, extension });
		this._proxy.$registerTaskProvider(handle);
		return new types.Disposable(() => {
			this._handlers.delete(handle);
			this._proxy.$unregisterTaskProvider(handle);
		});
	}

	public registerTaskSystem(scheme: string, info: TaskSystemInfoDTO): void {
		this._proxy.$registerTaskSystem(scheme, info);
	}

	public fetchTasks(filter?: vscode.TaskFilter): Promise<vscode.Task[]> {
		return this._proxy.$fetchTasks(TaskFilterDTO.from(filter)).then(async (values) => {
			let result: vscode.Task[] = [];
			const workspaceProvider = await this._workspaceService.getWorkspaceProvider();
			for (let value of values) {
				let task = TaskDTO.to(value, workspaceProvider);
				if (task) {
					result.push(task);
				}
			}
			return result;
		});
	}

	public async executeTask(extension: IExtensionDescription, task: vscode.Task): Promise<vscode.TaskExecution> {
		const workspaceProvider = await this._workspaceService.getWorkspaceProvider();
		let tTask = (task as types.Task);
		// We have a preserved ID. So the task didn't change.
		if (tTask._id !== undefined) {
			return this._proxy.$executeTask(TaskHandleDTO.from(tTask)).then(value => this.getTaskExecution(value, workspaceProvider, task));
		} else {
			let dto = TaskDTO.from(task, extension);
			if (dto === undefined) {
				return Promise.reject(new Error('Task is not valid'));
			}
			return this._proxy.$executeTask(dto).then(value => this.getTaskExecution(value, workspaceProvider, task));
		}
	}

	public get taskExecutions(): vscode.TaskExecution[] {
		let result: vscode.TaskExecution[] = [];
		this._taskExecutions.forEach(value => result.push(value));
		return result;
	}

	public terminateTask(execution: vscode.TaskExecution): Promise<void> {
		if (!(execution instanceof TaskExecutionImpl)) {
			throw new Error('No valid task execution provided');
		}
		return this._proxy.$terminateTask((execution as TaskExecutionImpl)._id);
	}

	public get onDidStartTask(): Event<vscode.TaskStartEvent> {
		return this._onDidExecuteTask.event;
	}

	public async $onDidStartTask(execution: TaskExecutionDTO, terminalId: number): Promise<void> {
		// Once a terminal is spun up for the custom execution task this event will be fired.
		// At that point, we need to actually start the callback, but
		// only if it hasn't already begun.
		const extensionCallback: CustomTaskExecutionData | undefined = this._providedCustomTaskExecutions.get(execution.id);
		if (extensionCallback) {
			if (this._activeCustomTaskExecutions.get(execution.id) !== undefined) {
				throw new Error('We should not be trying to start the same custom task executions twice.');
			}

			this._activeCustomTaskExecutions.set(execution.id, extensionCallback);

			const taskExecutionComplete: IDisposable = extensionCallback.onTaskExecutionComplete(() => {
				this.customTaskExecutionComplete(execution);
				taskExecutionComplete.dispose();
			});

			extensionCallback.startCallback(terminalId);
		}

		const workspaceProvider = await this._workspaceService.getWorkspaceProvider();
		this._onDidExecuteTask.fire({
			execution: this.getTaskExecution(execution, workspaceProvider)
		});
	}

	public get onDidEndTask(): Event<vscode.TaskEndEvent> {
		return this._onDidTerminateTask.event;
	}

	public async $OnDidEndTask(execution: TaskExecutionDTO): Promise<void> {
		const workspaceProvider = await this._workspaceService.getWorkspaceProvider();
		const _execution = this.getTaskExecution(execution, workspaceProvider);
		this._taskExecutions.delete(execution.id);
		this.customTaskExecutionComplete(execution);
		this._onDidTerminateTask.fire({
			execution: _execution
		});
	}

	public get onDidStartTaskProcess(): Event<vscode.TaskProcessStartEvent> {
		return this._onDidTaskProcessStarted.event;
	}

	public async $onDidStartTaskProcess(value: TaskProcessStartedDTO): Promise<void> {
		const workspaceProvider = await this._workspaceService.getWorkspaceProvider();
		const execution = this.getTaskExecution(value.id, workspaceProvider);
		if (execution) {
			this._onDidTaskProcessStarted.fire({
				execution: execution,
				processId: value.processId
			});
		}
	}

	public get onDidEndTaskProcess(): Event<vscode.TaskProcessEndEvent> {
		return this._onDidTaskProcessEnded.event;
	}

	public async $onDidEndTaskProcess(value: TaskProcessEndedDTO): Promise<void> {
		const workspaceProvider = await this._workspaceService.getWorkspaceProvider();
		const execution = this.getTaskExecution(value.id, workspaceProvider);
		if (execution) {
			this._onDidTaskProcessEnded.fire({
				execution: execution,
				exitCode: value.exitCode
			});
		}
	}

	public $provideTasks(handle: number, validTypes: { [key: string]: boolean; }): Thenable<TaskSetDTO> {
		let handler = this._handlers.get(handle);
		if (!handler) {
			return Promise.reject(new Error('no handler found'));
		}

		// For custom execution tasks, we need to store the execution objects locally
		// since we obviously cannot send callback functions through the proxy.
		// So, clear out any existing ones.
		this._providedCustomTaskExecutions.clear();

		// Set up a list of task ID promises that we can wait on
		// before returning the provided tasks. The ensures that
		// our task IDs are calculated for any custom execution tasks.
		// Knowing this ID ahead of time is needed because when a task
		// start event is fired this is when the custom execution is called.
		// The task start event is also the first time we see the ID from the main
		// thread, which is too late for us because we need to save an map
		// from an ID to the custom execution function. (Kind of a cart before the horse problem).
		let taskIdPromises: Promise<void>[] = [];
		let fetchPromise = asPromise(() => handler.provider.provideTasks(CancellationToken.None)).then(value => {
			const taskDTOs: TaskDTO[] = [];
			for (let task of value) {
				if (!task.definition || !validTypes[task.definition.type]) {
					console.warn(`The task [${task.source}, ${task.name}] uses an undefined task type. The task will be ignored in the future.`);
				}

				const taskDTO: TaskDTO = TaskDTO.from(task, handler.extension);
				taskDTOs.push(taskDTO);

				if (CustomTaskExecutionDTO.is(taskDTO.execution)) {
					taskIdPromises.push(new Promise((resolve) => {
						// The ID is calculated on the main thread task side, so, let's call into it here.
						// We need the task id's pre-computed for custom task executions because when OnDidStartTask
						// is invoked, we have to be able to map it back to our data.
						this._proxy.$createTaskId(taskDTO).then((taskId) => {
							this._providedCustomTaskExecutions.set(taskId, new CustomTaskExecutionData(<vscode.CustomTaskExecution>(<vscode.TaskWithCustomTaskExecution>task).executionWithExtensionCallback, this._terminalService));
							resolve();
						});
					}));
				}
			}

			return {
				tasks: taskDTOs,
				extension: handler.extension
			};
		});

		return new Promise((resolve) => {
			fetchPromise.then((result) => {
				Promise.all(taskIdPromises).then(() => {
					resolve(result);
				});
			});
		});
	}

	public async $resolveVariables(uriComponents: UriComponents, toResolve: { process?: { name: string; cwd?: string; path?: string }, variables: string[] }): Promise<{ process?: string, variables: { [key: string]: string; } }> {
		const configProvider = await this._configurationService.getConfigProvider();
		const workspaceProvider = await this._workspaceService.getWorkspaceProvider();
		let uri: URI = URI.revive(uriComponents);
		let result = {
			process: undefined as string,
			variables: Object.create(null)
		};
		let workspaceFolder = workspaceProvider.resolveWorkspaceFolder(uri);
		let resolver = new ExtHostVariableResolverService(workspaceProvider, this._editorService, configProvider);
		let ws: IWorkspaceFolder = {
			uri: workspaceFolder.uri,
			name: workspaceFolder.name,
			index: workspaceFolder.index,
			toResource: () => {
				throw new Error('Not implemented');
			}
		};
		for (let variable of toResolve.variables) {
			result.variables[variable] = resolver.resolve(ws, variable);
		}
		if (toResolve.process !== undefined) {
			let paths: string[] | undefined = undefined;
			if (toResolve.process.path !== undefined) {
				paths = toResolve.process.path.split(path.delimiter);
				for (let i = 0; i < paths.length; i++) {
					paths[i] = resolver.resolve(ws, paths[i]);
				}
			}
			result.process = win32.findExecutable(
				resolver.resolve(ws, toResolve.process.name),
				toResolve.process.cwd !== undefined ? resolver.resolve(ws, toResolve.process.cwd) : undefined,
				paths
			);
		}
		return result;
	}

	private nextHandle(): number {
		return this._handleCounter++;
	}

	private getTaskExecution(execution: TaskExecutionDTO | string, workspaceProvider: ExtHostWorkspaceProvider, task?: vscode.Task): TaskExecutionImpl {
		if (typeof execution === 'string') {
			return this._taskExecutions.get(execution);
		}

		let result: TaskExecutionImpl = this._taskExecutions.get(execution.id);
		if (result) {
			return result;
		}
		result = new TaskExecutionImpl(this, execution.id, task ? task : TaskDTO.to(execution.task, workspaceProvider));
		this._taskExecutions.set(execution.id, result);
		return result;
	}

	private customTaskExecutionComplete(execution: TaskExecutionDTO): void {
		const extensionCallback: CustomTaskExecutionData | undefined = this._activeCustomTaskExecutions.get(execution.id);
		if (extensionCallback) {
			this._activeCustomTaskExecutions.delete(execution.id);
			this._proxy.$customTaskExecutionComplete(execution.id, extensionCallback.result);
			extensionCallback.dispose();
		}
	}
}
