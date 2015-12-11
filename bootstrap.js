/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Will be defined if we got forked from another node process
// In that case we override console.log/warn/error to be able
// to send loading issues to the main side for logging.
if (!!process.send && process.env.PIPE_LOGGING === 'true') {
	var MAX_LENGTH = 100000;

	// Prevent circular stringify
	function safeStringify(args) {
		var seen = [];
		var res;

		// Massage some arguments with special treatment
		if (args.length) {
			for (var i = 0; i < args.length; i++) {

				// Any argument of type 'undefined' needs to be specially treated because
				// JSON.stringify will simply ignore those. We replace them with the string
				// 'undefined' which is not 100% right, but good enough to be logged to console
				if (typeof args[i] === 'undefined') {
					args[i] = 'undefined';
				}

				// Any argument that is an Error will be changed to be just the error stack/message
				// itself because currently cannot serialize the error over entirely.
				else if (args[i] instanceof Error) {
					var errorObj = args[i];
					if (errorObj.stack) {
						args[i] = errorObj.stack;
					} else {
						args[i] = errorObj.toString();
					}
				}
			}
		}

		try {
			res = JSON.stringify(args, function (key, value) {

				// Objects get special treatment to prevent circles
				if (value && Object.prototype.toString.call(value) === '[object Object]') {
					if (seen.indexOf(value) !== -1) {
						return Object.create(null); // prevent circular references!
					}

					seen.push(value);
				}

				return value;
			});
		} catch (error) {
			return 'Output omitted for an object that cannot be inspected (' + error.toString() + ')';
		}

		if (res && res.length > MAX_LENGTH) {
			return 'Output omitted for a large object that exceeds the limits';
		}

		return res;
	}

	function safeSend(arg) {
		try {
			process.send(arg);
		} catch (error) {
			// Can happen if the parent channel is closed meanwhile
		}
	}

	// Pass console logging to the outside so that we have it in the main side if told so
	if (process.env.VERBOSE_LOGGING === 'true') {
		console.log = function () { safeSend({ type: '__$console', severity: 'log', arguments: safeStringify(arguments) }); };
		console.warn = function () { safeSend({ type: '__$console', severity: 'warn', arguments: safeStringify(arguments) }); };
	} else {
		console.log = function () { /* ignore */ };
		console.warn = function () { /* ignore */ };
	}

	console.error = function () { safeSend({ type: '__$console', severity: 'error', arguments: safeStringify(arguments) }); };

	// Let stdout, stderr and stdin be no-op streams. This prevents an issue where we would get an EBADF
	// error when we are inside a forked process and this process tries to access those channels.
	var stream = require('stream');
	var writable = new stream.Writable({
		write: function (chunk, encoding, next) { /* No OP */ }
	});
	process.__defineGetter__('stdout', function() { return writable; });
	process.__defineGetter__('stderr', function() { return writable; });
	process.__defineGetter__('stdin', function() { return writable; });
}

// Handle uncaught exceptions
process.on('uncaughtException', function (err) {
	console.error('Uncaught Exception: ', err.toString());
	if (err.stack) {
		console.error(err.stack);
	}
});

var path = require('path');
var loader = require('./vs/loader');

// TODO: Duplicated in:
// * src\bootstrap.js
// * src\vs\workbench\electron-main\bootstrap.js
// * src\vs\platform\plugins\common\nativePluginService.ts
function uriFromPath(_path) {
	var pathName = path.resolve(_path).replace(/\\/g, '/');

	if (pathName.length > 0 && pathName.charAt(0) !== '/') {
		pathName = '/' + pathName;
	}

	return encodeURI('file://' + pathName);
}

loader.config({
	baseUrl: uriFromPath(path.join(__dirname)),
	catchError: true,
	nodeRequire: require,
	nodeMain: __filename
});

var entrypoint = process.env.AMD_ENTRYPOINT;
if (entrypoint) {
	loader([entrypoint], function () { }, function (err) { console.error(err); });
}
