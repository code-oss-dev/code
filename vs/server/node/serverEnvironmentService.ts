/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

import { NativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { OPTIONS, OptionDescriptions } from 'vs/platform/environment/node/argv';
import { refineServiceDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IEnvironmentService, INativeEnvironmentService } from 'vs/platform/environment/common/environment';

export const serverOptions: OptionDescriptions<ServerParsedArgs> = {

	/* ----- server setup ----- */

	'host': { type: 'string', cat: 'o', args: 'ip-address', description: nls.localize('host', 'The host name or IP address the server should listen to. If not set, defaults to `localhost`.') },
	'port': { type: 'string', cat: 'o', args: 'port | port range', description: nls.localize('port', 'The port the server should listen to. If 0 is passed a random free port is picked. If a range in the format num-num is passed, a free port from the range is selected.') },
	'pick-port': { type: 'string', deprecationMessage: 'Use the range notation in `port` instead.' },
	'socket-path': { type: 'string', cat: 'o', args: 'path', description: nls.localize('socket-path', 'The path to a socket file for the server to listen to.') },
	'connection-token': { type: 'string', cat: 'o', args: 'token', deprecates: ['connectionToken'], description: nls.localize('connection-token', "A secret that must be included with all requests.") },
	'connection-token-file': { type: 'string', cat: 'o', args: 'path', deprecates: ['connection-secret', 'connectionTokenFile'], description: nls.localize('connection-token-file', "Path to a file that contains the connection token. This will require that all incoming connections know the secret.") },
	'without-connection-token': { type: 'boolean', cat: 'o', description: nls.localize('without-connection-token', "Run without a connection token. Only use this if the connection is protected by other means.") },
	'disable-websocket-compression': { type: 'boolean' },
	'print-startup-performance': { type: 'boolean' },
	'print-ip-address': { type: 'boolean' },
	'accept-server-license-terms': { type: 'boolean', cat: 'o', description: nls.localize('acceptLicenseTerms', 'If set, the user accepts the server license terms and the server will be started without a user prompt.') },
	'server-data-dir': { type: 'string', cat: 'o', description: nls.localize('serverDataDir', 'Specifies the directory that server data is kept in.') },
	'telemetry-level': { type: 'string', cat: 'o', args: 'off | crash | error | all', description: nls.localize('telemetry-level', 'Sets the initial telemetry level. If not specified, the server will await a connection before sending any telemetry. Setting this to off is equivalent to --disable-telemetry') },

	/* ----- vs code options ----- */

	'user-data-dir': OPTIONS['user-data-dir'],
	'driver': OPTIONS['driver'],
	'disable-telemetry': OPTIONS['disable-telemetry'],
	'file-watcher-polling': { type: 'string', deprecates: ['fileWatcherPolling'] },
	'log': OPTIONS['log'],
	'logsPath': OPTIONS['logsPath'],
	'force-disable-user-env': OPTIONS['force-disable-user-env'],

	/* ----- vs code web options ----- */

	'folder': { type: 'string', deprecationMessage: 'No longer supported. Folder needs to be provided in the browser URL.' },
	'workspace': { type: 'string', deprecationMessage: 'No longer supported. Workspace needs to be provided in the browser URL.' },

	'enable-sync': { type: 'boolean' },
	'github-auth': { type: 'string' },

	/* ----- extension management ----- */

	'extensions-dir': OPTIONS['extensions-dir'],
	'extensions-download-dir': OPTIONS['extensions-download-dir'],
	'builtin-extensions-dir': OPTIONS['builtin-extensions-dir'],
	'install-extension': OPTIONS['install-extension'],
	'install-builtin-extension': OPTIONS['install-builtin-extension'],
	'uninstall-extension': OPTIONS['uninstall-extension'],
	'list-extensions': OPTIONS['list-extensions'],
	'locate-extension': OPTIONS['locate-extension'],

	'show-versions': OPTIONS['show-versions'],
	'category': OPTIONS['category'],
	'force': OPTIONS['force'],
	'do-not-sync': OPTIONS['do-not-sync'],
	'pre-release': OPTIONS['pre-release'],
	'start-server': { type: 'boolean', cat: 'e', description: nls.localize('start-server', 'Start the server when installing or uninstalling extensions. To be used in combination with `install-extension`, `install-builtin-extension` and `uninstall-extension`.') },


	/* ----- remote development options ----- */

	'enable-remote-auto-shutdown': { type: 'boolean' },
	'remote-auto-shutdown-without-delay': { type: 'boolean' },

	'use-host-proxy': { type: 'boolean' },
	'without-browser-env-var': { type: 'boolean' },

	/* ----- server cli ----- */

	'help': OPTIONS['help'],
	'version': OPTIONS['version'],

	'compatibility': { type: 'string' },

	_: OPTIONS['_']
};

export interface ServerParsedArgs {

	/* ----- server setup ----- */

	host?: string;
	port?: string;
	'pick-port'?: string;
	'socket-path'?: string;

	/**
	 * A secret token that must be provided by the web client with all requests.
	 * Use only `[0-9A-Za-z\-]`.
	 *
	 * By default, a UUID will be generated every time the server starts up.
	 *
	 * If the server is running on a multi-user system, then consider
	 * using `--connection-token-file` which has the advantage that the token cannot
	 * be seen by other users using `ps` or similar commands.
	 */
	'connection-token'?: string;
	/**
	 * A path to a filename which will be read on startup.
	 * Consider placing this file in a folder readable only by the same user (a `chmod 0700` directory).
	 *
	 * The contents of the file will be used as the connection token. Use only `[0-9A-Z\-]` as contents in the file.
	 * The file can optionally end in a `\n` which will be ignored.
	 *
	 * This secret must be communicated to any vscode instance via the resolver or embedder API.
	 */
	'connection-token-file'?: string;

	/**
	 * Run the server without a connection token
	 */
	'without-connection-token'?: boolean;

	'disable-websocket-compression'?: boolean;

	'print-startup-performance'?: boolean;
	'print-ip-address'?: boolean;

	'accept-server-license-terms': boolean;

	'server-data-dir'?: string;

	'telemetry-level'?: string;

	/* ----- vs code options ----- */

	'user-data-dir'?: string;

	driver?: string;

	'disable-telemetry'?: boolean;
	'file-watcher-polling'?: string;

	'log'?: string;
	'logsPath'?: string;

	'force-disable-user-env'?: boolean;

	/* ----- vs code web options ----- */
	/** @deprecated */
	workspace: string;
	/** @deprecated */
	folder: string;
	'enable-sync'?: boolean;
	'github-auth'?: string;

	/* ----- extension management ----- */

	'extensions-dir'?: string;
	'extensions-download-dir'?: string;
	'builtin-extensions-dir'?: string;
	'install-extension'?: string[];
	'install-builtin-extension'?: string[];
	'uninstall-extension'?: string[];
	'list-extensions'?: boolean;
	'locate-extension'?: string[];
	'show-versions'?: boolean;
	'category'?: string;
	force?: boolean; // used by install-extension
	'do-not-sync'?: boolean; // used by install-extension
	'pre-release'?: boolean; // used by install-extension

	'start-server'?: boolean;

	/* ----- remote development options ----- */

	'enable-remote-auto-shutdown'?: boolean;
	'remote-auto-shutdown-without-delay'?: boolean;

	'use-host-proxy'?: boolean;
	'without-browser-env-var'?: boolean;

	/* ----- server cli ----- */
	help: boolean;
	version: boolean;

	compatibility: string

	_: string[];
}

export const IServerEnvironmentService = refineServiceDecorator<IEnvironmentService, IServerEnvironmentService>(IEnvironmentService);

export interface IServerEnvironmentService extends INativeEnvironmentService {
	readonly args: ServerParsedArgs;
}

export class ServerEnvironmentService extends NativeEnvironmentService implements IServerEnvironmentService {
	override get args(): ServerParsedArgs { return super.args as ServerParsedArgs; }
}
