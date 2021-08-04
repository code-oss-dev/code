/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogService, ConsoleLogger, MultiplexLogService, ILogger, LogLevel, ILogService } from 'vs/platform/log/common/log';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { LogLevelChannelClient, FollowerLogService, LoggerChannelClient } from 'vs/platform/log/common/logIpc';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

export class NativeLogService extends LogService {

	constructor(name: string, logLevel: LogLevel, loggerService: LoggerChannelClient, loggerClient: LogLevelChannelClient, environmentService: INativeWorkbenchEnvironmentService) {

		const disposables = new DisposableStore();

		// Extension development test CLI: forward everything to main side
		const loggers: ILogger[] = [];
		if (environmentService.isExtensionDevelopment && !!environmentService.extensionTestsLocationURI) {
			loggers.push(loggerService.createConsoleMainLogger());
		}

		// Normal logger: spdylog and console
		else {
			loggers.push(
				disposables.add(new ConsoleLogger(logLevel)),
				disposables.add(loggerService.createLogger(environmentService.logFile, { name }))
			);
		}

		const multiplexLogger = disposables.add(new MultiplexLogService(loggers));
		const followerLogger = disposables.add(new FollowerLogService(loggerClient, multiplexLogger));
		super(followerLogger);

		this._register(disposables);
	}
}

// --- Internal commands to improve extension test runs

CommandsRegistry.registerCommand('_extensionTests.setLogLevel', function (accessor: ServicesAccessor, level: number) {
	const logService = accessor.get(ILogService);
	const environmentService = accessor.get(IEnvironmentService);

	if (environmentService.isExtensionDevelopment && !!environmentService.extensionTestsLocationURI) {
		logService.setLevel(level);
	}
});

CommandsRegistry.registerCommand('_extensionTests.getLogLevel', function (accessor: ServicesAccessor) {
	const logService = accessor.get(ILogService);

	return logService.getLevel();
});
