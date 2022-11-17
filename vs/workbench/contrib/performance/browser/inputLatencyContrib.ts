/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inputLatency } from 'vs/base/browser/performance';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Event } from 'vs/base/common/event';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export class InputLatencyContrib extends Disposable implements IWorkbenchContribution {
	private readonly _listener = this._register(new MutableDisposable());
	private readonly _scheduler: RunOnceScheduler;

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService
	) {
		super();

		// The current sampling strategy is when the active editor changes, start sampling and
		// report the results after 60 seconds. It's done this way as we don't want to sample
		// everything, just somewhat randomly, and using an interval would utilize CPU when the
		// application is inactive.
		this._scheduler = this._register(new RunOnceScheduler(() => {
			this._logSamples();
			this._setupListener();
		}, 60000));

		this._setupListener();
	}

	private _setupListener(): void {
		this._listener.value = Event.once(this._editorService.onDidActiveEditorChange)(() => this._scheduler.schedule());
	}

	private _logSamples(): void {
		const measurements = inputLatency.getAndClearMeasurements();
		if (!measurements) {
			return;
		}

		type PerformanceInputLatencyClassification = {
			owner: 'tyriar';
			comment: 'This is a set of samples of the time (in milliseconds) that various events took when typing in the editor';
			'keydown.average': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The min time it took for the keydown event to execute.' };
			'keydown.max': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The max time it took for the keydown event to execute.' };
			'keydown.min': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The average time it took for the keydown event to execute.' };
			'input.average': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The min time it took for the input event to execute.' };
			'input.max': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The max time it took for the input event to execute.' };
			'input.min': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The average time it took for the input event to execute.' };
			'render.average': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The min time it took for the render animation frame to execute.' };
			'render.max': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The max time it took for the render animation frame to execute.' };
			'render.min': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The average time it took for the render animation frame to execute.' };
			'total.average': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The min input latency.' };
			'total.max': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The max input latency.' };
			'total.min': { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The average input latency.' };
			sampleCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The number of samples measured.' };
		};

		type PerformanceInputLatencyEvent = {
			'keydown.average': number;
			'keydown.max': number;
			'keydown.min': number;
			'input.average': number;
			'input.max': number;
			'input.min': number;
			'render.average': number;
			'render.max': number;
			'render.min': number;
			'total.average': number;
			'total.max': number;
			'total.min': number;
			sampleCount: number;
		};

		this._telemetryService.publicLog2<PerformanceInputLatencyEvent, PerformanceInputLatencyClassification>('performance.inputLatency', {
			'keydown.average': measurements.keydown.average,
			'keydown.max': measurements.keydown.max,
			'keydown.min': measurements.keydown.min,
			'input.average': measurements.input.average,
			'input.max': measurements.input.max,
			'input.min': measurements.input.min,
			'render.average': measurements.render.average,
			'render.max': measurements.render.max,
			'render.min': measurements.render.min,
			'total.average': measurements.total.average,
			'total.max': measurements.total.max,
			'total.min': measurements.total.min,
			sampleCount: measurements.sampleCount
		});
	}
}
