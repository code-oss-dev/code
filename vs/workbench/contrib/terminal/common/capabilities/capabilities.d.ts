/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { TerminalCapability } from 'vs/platform/terminal/common/terminal';
import { CwdDetectionCapability } from 'vs/workbench/contrib/terminal/common/capabilities/cwdDetectionCapability';
import { NaiveCwdDetectionCapability } from 'vs/workbench/contrib/terminal/common/capabilities/naiveCwdDetectionCapability';
import { PartialCommandDetectionCapability } from 'vs/workbench/contrib/terminal/browser/capabilities/partialCommandDetectionCapability';
import { ITerminalCommand } from 'vs/workbench/contrib/terminal/common/terminal';

/**
 * An object that keeps track of additional capabilities and their implementations for features that
 * are not available for all terminals.
 */
export interface ITerminalCapabilityStore {
	/**
	 * An iterable of all capabilities in the store.
	 */
	readonly items: IterableIterator<TerminalCapability>;

	/**
	 * Fired when a capability is added.
	 */
	readonly onDidAddCapability: Event<TerminalCapability>;

	/**
	 * Fired when a capability is removed.
	 */
	readonly onDidRemoveCapability: Event<TerminalCapability>;

	/**
	 * Gets whether the capability exists in the store.
	 */
	has(capability: TerminalCapability): boolean;

	/**
	 * Gets the implementation of a capability if it has been added to the store.
	 */
	get<T extends TerminalCapability>(capability: T): ITerminalCapabilityImplMap[T] | undefined;
}

/**
 * Maps capability types to their implementation, enabling strongly typed fetching of
 * implementations.
 */
export interface ITerminalCapabilityImplMap {
	[TerminalCapability.CwdDetection]: InstanceType<typeof CwdDetectionCapability>;
	[TerminalCapability.CommandDetection]: ICommandDetectionCapability;
	[TerminalCapability.NaiveCwdDetection]: InstanceType<typeof NaiveCwdDetectionCapability>;
	[TerminalCapability.PartialCommandDetection]: InstanceType<typeof PartialCommandDetectionCapability>;
}

export interface ICommandDetectionCapability {
	readonly type: TerminalCapability.CommandDetection;
	readonly commands: readonly ITerminalCommand[];
	readonly onCommandFinished: Event<ITerminalCommand>;
	setCwd(value: string): void;
	/**
	 * Gets the working directory for a line, this will return undefined if it's unknown in which
	 * case the terminal's initial cwd should be used.
	 */
	getCwdForLine(line: number): string | undefined;
	handlePromptStart(): void;
	handleCommandStart(): void;
	handleCommandExecuted(): void;
	handleCommandFinished(exitCode: number): void;
	/**
	 * Set the command line explicitly.
	 */
	setCommandLine(commandLine: string): void;
}
