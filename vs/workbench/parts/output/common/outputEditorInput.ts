/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import nls = require('vs/nls');
import {TPromise} from 'vs/base/common/winjs.base';
import {RunOnceScheduler} from 'vs/base/common/async';
import {EditorModel} from 'vs/workbench/common/editor';
import {StringEditorInput} from 'vs/workbench/common/editor/stringEditorInput';
import {OUTPUT_EDITOR_INPUT_ID, OUTPUT_PANEL_ID, IOutputEvent, OUTPUT_MIME, IOutputService} from 'vs/workbench/parts/output/common/output';
import {OutputPanel} from 'vs/workbench/parts/output/browser/outputPanel';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IPanelService} from 'vs/workbench/services/panel/common/panelService';

/**
 * Output Editor Input
 */
export class OutputEditorInput extends StringEditorInput {

	private static OUTPUT_DELAY = 300; // delay in ms to accumulate output before emitting an event about it
	private static instances: { [channel: string]: OutputEditorInput; } = Object.create(null);
	private static MAX_OUTPUT_LINES = 10000; // Max. number of output lines to show in output

	private outputSet: boolean;
	private channel: string;
	private toUnbind: { (): void; }[];
	private bufferedOutput: string;
	private appendOutputScheduler: RunOnceScheduler;

	public static getInstances(): OutputEditorInput[] {
		return Object.keys(OutputEditorInput.instances).map((key) => OutputEditorInput.instances[key]);
	}

	public static getInstance(instantiationService: IInstantiationService, channel: string): OutputEditorInput {
		if (OutputEditorInput.instances[channel]) {
			return OutputEditorInput.instances[channel];
		}

		OutputEditorInput.instances[channel] = instantiationService.createInstance(OutputEditorInput, channel);

		return OutputEditorInput.instances[channel];
	}

	constructor(
		channel: string,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOutputService private outputService: IOutputService,
		@IPanelService private panelService: IPanelService
	) {
		super(nls.localize('output', "Output"), channel ? nls.localize('outputChannel', "for '{0}'", channel) : '', '', OUTPUT_MIME, true, instantiationService);

		this.channel = channel;
		this.bufferedOutput = '';
		this.toUnbind = [];
		const listenerUnbind = this.outputService.onOutput(this.onOutputReceived, this);
		this.toUnbind.push(() => listenerUnbind.dispose());

		this.appendOutputScheduler = new RunOnceScheduler(() => {
			this.append(this.bufferedOutput);
			this.trim(OutputEditorInput.MAX_OUTPUT_LINES);
			this.bufferedOutput = '';

			const panel = this.panelService.getActivePanel();
			if (panel && panel.getId() === OUTPUT_PANEL_ID && this.outputService.getActiveChannel() === this.channel) {
				(<OutputPanel>panel).revealLastLine();
			}
		}, OutputEditorInput.OUTPUT_DELAY);
	}

	private onOutputReceived(e: IOutputEvent): void {
		if (this.outputSet && e.channel === this.channel) {
			if (e.output) {
				this.bufferedOutput += e.output;
				if (!this.appendOutputScheduler.isScheduled()) {
					this.appendOutputScheduler.schedule();
				}
			} else if (e.output === null) {
				this.clearValue(); // special output indicates we should clear
			}
		}
	}

	public getId(): string {
		return OUTPUT_EDITOR_INPUT_ID;
	}

	public resolve(refresh?: boolean): TPromise<EditorModel> {
		return super.resolve(refresh).then(model => {

			// Just return model if output already set
			if (this.outputSet) {
				return model;
			}

			this.setValue(this.outputService.getOutput(this.channel));
			this.outputSet = true;

			return model;
		});
	}

	public getChannel(): string {
		return this.channel;
	}

	public matches(otherInput: any): boolean {
		if (otherInput instanceof OutputEditorInput) {
			let otherOutputEditorInput = <OutputEditorInput>otherInput;
			if (otherOutputEditorInput.getChannel() === this.channel) {
				return super.matches(otherInput);
			}
		}

		return false;
	}

	public dispose(): void {
		while (this.toUnbind.length) {
			this.toUnbind.pop()();
		}

		super.dispose();
	}
}