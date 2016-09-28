/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { ICommandLineArguments, IProcessEnvironment } from 'vs/code/electron-main/env';
import { IWindowsService } from 'vs/code/electron-main/windows';
import { VSCodeWindow } from 'vs/code/electron-main/window';
import { TPromise } from 'vs/base/common/winjs.base';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { ILogService } from 'vs/code/electron-main/log';
import { IURLService } from 'vs/platform/url/common/url';

export interface IStartArguments {
	args: ICommandLineArguments;
	userEnv: IProcessEnvironment;
}

export interface ILaunchService {
	start(args: ICommandLineArguments, userEnv: IProcessEnvironment): TPromise<void>;
}

export interface ILaunchChannel extends IChannel {
	call(command: 'start', arg: IStartArguments): TPromise<void>;
	call(command: string, arg: any): TPromise<any>;
}

export class LaunchChannel implements ILaunchChannel {

	constructor(private service: ILaunchService) { }

	call(command: string, arg: any): TPromise<any> {
		const { args, userEnv } = arg as IStartArguments;

		switch (command) {
			case 'start': return this.service.start(args, userEnv);
		}
	}
}

export class LaunchChannelClient implements ILaunchService {

	constructor(private channel: ILaunchChannel) { }

	start(args: ICommandLineArguments, userEnv: IProcessEnvironment): TPromise<void> {
		return this.channel.call('start', { args, userEnv });
	}
}

export class LaunchService implements ILaunchService {

	constructor(
		@ILogService private logService: ILogService,
		@IWindowsService private windowsService: IWindowsService,
		@IURLService private urlService: IURLService
	) {}

	start(args: ICommandLineArguments, userEnv: IProcessEnvironment): TPromise<void> {
		this.logService.log('Received data from other instance: ', args, userEnv);

		const openUrlArg = args['open-url'] || [];
		const openUrl = typeof openUrlArg === 'string' ? [openUrlArg] : openUrlArg;

		if (openUrl.length > 0) {
			openUrl.forEach(url => this.urlService.open(url));
			return TPromise.as(null);
		}

		// Otherwise handle in windows service
		let usedWindows: VSCodeWindow[];
		if (!!args.extensionDevelopmentPath) {
			this.windowsService.openPluginDevelopmentHostWindow({ cli: args, userEnv });
		} else if (args.paths.length === 0 && args['new-window']) {
			usedWindows = this.windowsService.open({ cli: args, userEnv, forceNewWindow: true, forceEmpty: true });
		} else if (args.paths.length === 0) {
			usedWindows = [this.windowsService.focusLastActive(args)];
		} else {
			usedWindows = this.windowsService.open({
				cli: args,
				userEnv,
				forceNewWindow: args.wait || args['new-window'],
				preferNewWindow: !args['reuse-window'],
				diffMode: args.diff
			});
		}

		// If the other instance is waiting to be killed, we hook up a window listener if one window
		// is being used and only then resolve the startup promise which will kill this second instance
		if (args.wait && usedWindows && usedWindows.length === 1 && usedWindows[0]) {
			const windowId = usedWindows[0].id;

			return new TPromise<void>((c, e) => {

				const unbind = this.windowsService.onClose(id => {
					if (id === windowId) {
						unbind();
						c(null);
					}
				});
			});
		}

		return TPromise.as(null);
	}
}