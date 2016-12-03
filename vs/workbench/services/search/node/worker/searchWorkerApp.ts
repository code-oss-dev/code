/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Server } from 'vs/base/parts/ipc/node/ipc.cp';
import { SearchWorkerChannel } from './searchWorkerIpc';
import { SearchWorkerManager } from './searchWorker';

const server = new Server();
const worker = new SearchWorkerManager();
const channel = new SearchWorkerChannel(worker);
server.registerChannel('searchWorker', channel);
