/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { Iterable } from 'vs/base/common/iterator';
import { joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { INotebookRendererInfo, ContributedNotebookRendererEntrypoint, NotebookRendererMatch, RendererMessagingSpec, NotebookRendererEntrypoint } from 'vs/workbench/contrib/notebook/common/notebookCommon';

class DependencyList {
	private readonly value: ReadonlySet<string>;
	public readonly defined: boolean;

	constructor(value: Iterable<string>) {
		this.value = new Set(value);
		this.defined = this.value.size > 0;
	}

	/** Gets whether any of the 'available' dependencies match the ones in this list */
	public matches(available: ReadonlyArray<string>) {
		// For now this is simple, but this may expand to support globs later
		// @see https://github.com/microsoft/vscode/issues/119899
		return available.some(v => this.value.has(v));
	}
}

export class NotebookOutputRendererInfo implements INotebookRendererInfo {

	readonly id: string;
	readonly entrypoint: NotebookRendererEntrypoint;
	readonly displayName: string;
	readonly extensionLocation: URI;
	readonly extensionId: ExtensionIdentifier;
	readonly hardDependencies: DependencyList;
	readonly optionalDependencies: DependencyList;
	readonly messaging: RendererMessagingSpec;

	readonly mimeTypes: readonly string[];
	private readonly mimeTypeGlobs: glob.ParsedPattern[];

	readonly isBuiltin: boolean;

	constructor(descriptor: {
		readonly id: string;
		readonly displayName: string;
		readonly entrypoint: ContributedNotebookRendererEntrypoint;
		readonly mimeTypes: readonly string[];
		readonly extension: IExtensionDescription;
		readonly dependencies: readonly string[] | undefined;
		readonly optionalDependencies: readonly string[] | undefined;
		readonly requiresMessaging: RendererMessagingSpec | undefined;
	}) {
		this.id = descriptor.id;
		this.extensionId = descriptor.extension.identifier;
		this.extensionLocation = descriptor.extension.extensionLocation;
		this.isBuiltin = descriptor.extension.isBuiltin;

		if (typeof descriptor.entrypoint === 'string') {
			this.entrypoint = {
				extends: undefined,
				path: joinPath(this.extensionLocation, descriptor.entrypoint)
			};
		} else {
			this.entrypoint = {
				extends: descriptor.entrypoint.extends,
				path: joinPath(this.extensionLocation, descriptor.entrypoint.path)
			};
		}

		this.displayName = descriptor.displayName;
		this.mimeTypes = descriptor.mimeTypes;
		this.mimeTypeGlobs = this.mimeTypes.map(pattern => glob.parse(pattern));
		this.hardDependencies = new DependencyList(descriptor.dependencies ?? Iterable.empty());
		this.optionalDependencies = new DependencyList(descriptor.optionalDependencies ?? Iterable.empty());
		this.messaging = descriptor.requiresMessaging ?? RendererMessagingSpec.Never;
	}

	public matchesWithoutKernel(mimeType: string) {
		if (!this.matchesMimeTypeOnly(mimeType)) {
			return NotebookRendererMatch.Never;
		}

		if (this.hardDependencies.defined) {
			return NotebookRendererMatch.WithHardKernelDependency;
		}

		if (this.optionalDependencies.defined) {
			return NotebookRendererMatch.WithOptionalKernelDependency;
		}

		return NotebookRendererMatch.Pure;
	}

	public matches(mimeType: string, kernelProvides: ReadonlyArray<string>) {
		if (!this.matchesMimeTypeOnly(mimeType)) {
			return NotebookRendererMatch.Never;
		}

		if (this.hardDependencies.defined) {
			return this.hardDependencies.matches(kernelProvides)
				? NotebookRendererMatch.WithHardKernelDependency
				: NotebookRendererMatch.Never;
		}

		return this.optionalDependencies.matches(kernelProvides)
			? NotebookRendererMatch.WithOptionalKernelDependency
			: NotebookRendererMatch.Pure;
	}

	private matchesMimeTypeOnly(mimeType: string) {
		if (!URI.isUri(this.entrypoint)) { // We're extending another renderer
			return false;
		}

		return this.mimeTypeGlobs.some(pattern => pattern(mimeType)) || this.mimeTypes.some(pattern => pattern === mimeType);
	}
}
