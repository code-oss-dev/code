/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as net from 'net';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { assertIsDefined } from 'vs/base/common/types';

interface Deferred<T> {
	resolve: (result: T | Promise<T>) => void;
	reject: (reason: any) => void;
}

export function createTerminateServer(server: http.Server) {
	const sockets: Record<number, net.Socket> = {};
	let socketCount = 0;
	server.on('connection', socket => {
		const id = socketCount++;
		sockets[id] = socket;
		socket.on('close', () => {
			delete sockets[id];
		});
	});
	return async () => {
		const result = new Promise<Error | undefined>(resolve => server.close(resolve));
		for (const id in sockets) {
			sockets[id].destroy();
		}
		return result;
	};
}

export async function startServer(server: http.Server): Promise<string> {
	let portTimer: NodeJS.Timer;

	function cancelPortTimer() {
		clearTimeout(portTimer);
	}

	const port = new Promise<string>((resolve, reject) => {
		portTimer = setTimeout(() => {
			reject(new Error('Timeout waiting for port'));
		}, 5000);

		server.on('listening', () => {
			const address = server.address();
			if (typeof address === 'string') {
				resolve(address);
			} else {
				resolve(assertIsDefined(address).port.toString());
			}
		});

		server.on('error', err => {
			reject(err);
		});

		server.on('close', () => {
			reject(new Error('Closed'));
		});

		server.listen(0);
	});

	port.then(cancelPortTimer, cancelPortTimer);
	return port;
}

function sendFile(res: http.ServerResponse, filepath: string, contentType: string) {
	fs.readFile(filepath, (err, body) => {
		if (err) {
			console.error(err);
			res.writeHead(404);
			res.end();
		} else {
			res.writeHead(200, {
				'Content-Length': body.length,
				'Content-Type': contentType
			});
			res.end(body);
		}
	});
}

async function callback(nonce: string, reqUrl: url.Url): Promise<string> {
	const query = reqUrl.query;
	if (!query || typeof query === 'string') {
		throw new Error('No query received.');
	}

	let error = query.error_description || query.error;

	if (!error) {
		const state = (query.state as string) || '';
		const receivedNonce = (state.split(',')[1] || '').replace(/ /g, '+');
		if (receivedNonce !== nonce) {
			error = 'Nonce does not match.';
		}
	}

	const code = query.code as string;
	if (!error && code) {
		return code;
	}

	throw new Error((error as string) || 'No code received.');
}

export function createServer(nonce: string) {
	type RedirectResult = { req: http.IncomingMessage; res: http.ServerResponse; } | { err: any; res: http.ServerResponse; };
	let deferredRedirect: Deferred<RedirectResult>;
	const redirectPromise = new Promise<RedirectResult>((resolve, reject) => deferredRedirect = { resolve, reject });

	type CodeResult = { code: string; res: http.ServerResponse; } | { err: any; res: http.ServerResponse; };
	let deferredCode: Deferred<CodeResult>;
	const codePromise = new Promise<CodeResult>((resolve, reject) => deferredCode = { resolve, reject });

	const codeTimer = setTimeout(() => {
		deferredCode.reject(new Error('Timeout waiting for code'));
	}, 5 * 60 * 1000);

	function cancelCodeTimer() {
		clearTimeout(codeTimer);
	}

	const server = http.createServer(function (req, res) {
		const reqUrl = url.parse(req.url!, /* parseQueryString */ true);
		switch (reqUrl.pathname) {
			case '/signin':
				const receivedNonce = ((reqUrl.query.nonce as string) || '').replace(/ /g, '+');
				if (receivedNonce === nonce) {
					deferredRedirect.resolve({ req, res });
				} else {
					const err = new Error('Nonce does not match.');
					deferredRedirect.resolve({ err, res });
				}
				break;
			case '/':
				sendFile(res, getPathFromAmdModule(require, '../common/auth.html'), 'text/html; charset=utf-8');
				break;
			case '/auth.css':
				sendFile(res, getPathFromAmdModule(require, '../common/auth.css'), 'text/css; charset=utf-8');
				break;
			case '/callback':
				deferredCode.resolve(callback(nonce, reqUrl)
					.then(code => ({ code, res }), err => ({ err, res })));
				break;
			default:
				res.writeHead(404);
				res.end();
				break;
		}
	});

	codePromise.then(cancelCodeTimer, cancelCodeTimer);
	return {
		server,
		redirectPromise,
		codePromise
	};
}
