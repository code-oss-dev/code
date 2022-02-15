/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { localize } from 'vs/nls';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { AudioCue, IAudioCueService } from 'vs/workbench/contrib/audioCues/browser/audioCueService';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';

export class ShowAudioCueHelp extends Action2 {
	static readonly ID = 'audioCues.help';

	constructor() {
		super({
			id: ShowAudioCueHelp.ID,
			title: {
				value: localize('closeWindow', "Audio Cues Help"),
				original: 'Audio Cues Help'
			},
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const audioCueService = accessor.get(IAudioCueService);
		const quickPickService = accessor!.get(IQuickInputService);
		const preferencesService = accessor!.get(IPreferencesService);

		const quickPick = quickPickService.pick<IQuickPickItem & { audioCue: AudioCue }>(
			AudioCue.allAudioCues.map((cue, idx) => ({
				label: `${audioCueService.isEnabled(cue).get() ? '$(check)' : '     '} ${cue.name}`,
				audioCue: cue,
				buttons: [{
					iconClass: Codicon.settingsGear.classNames,
					tooltip: localize('showAudioCueHelp.settings', 'Enable/Disable Audio Cue'),
				}],
			})),
			{
				onDidFocus: (item) => {
					audioCueService.playAudioCue(item.audioCue);
				},
				onDidTriggerItemButton: (context) => {
					preferencesService.openSettings({ query: context.item.audioCue.settingsKey });
				},
				placeHolder: localize('showAudioCueHelp.placeholder', 'Select an audio cue to play'),
			}
		);

		await quickPick;
	}
}
