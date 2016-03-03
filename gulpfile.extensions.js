/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Increase max listeners for event emitters
require('events').EventEmitter.defaultMaxListeners = 100;

var gulp = require('gulp');
var path = require('path');
var tsb = require('gulp-tsb');
var es = require('event-stream');
var cp = require('child_process');
var filter = require('gulp-filter');
var rename = require('gulp-rename');
var rimraf = require('rimraf');
var util = require('./lib/util');
var watcher = require('./lib/watch');
var createReporter = require('./lib/reporter');
var glob = require('glob');
var fs = require('fs');
var JSONC = require('json-comments');

var sourcemaps = require('gulp-sourcemaps');
var nlsDev = require('vscode-nls-dev');

var quiet = !!process.env['VSCODE_BUILD_QUIET'];
var extensionsPath = path.join(path.dirname(__dirname), 'extensions');

function getTSConfig(plugin) {
	var script = (plugin.desc && plugin.desc.scripts && plugin.desc.scripts['vscode:prepublish']) || '';
	var match = /^node \.\.\/\.\.\/node\_modules\/gulp\/bin\/gulp\.js \-\-gulpfile \.\.\/\.\.\/build\/gulpfile\.extensions\.js compile-extension:([^ ]+) ?(.*tsconfig\.json)/.exec(script);

	if (!match) {
		return;
	}

	var pluginRoot = path.join(extensionsPath, plugin.desc.name);
	var options = require(path.join(pluginRoot, match[2])).compilerOptions;
	options.verbose = !quiet;
	return options;
}

function readAllPlugins() {
	var PLUGINS_FOLDER = path.join(extensionsPath);

	var extensions = glob.sync('*/package.json', {
		cwd: PLUGINS_FOLDER
	});

	var result = [];

	extensions.forEach(function (relativeJSONPath) {
		var relativePath = path.dirname(relativeJSONPath);
		var fullJSONPath = path.join(PLUGINS_FOLDER, relativeJSONPath);
		var contents = fs.readFileSync(fullJSONPath).toString();
		var desc = JSONC.parse(contents);

		result.push({
			relativePath: relativePath,
			desc: desc
		});
	});

	return result;
}

var tasks = readAllPlugins()
	.map(function (plugin) {
		var options = getTSConfig(plugin);

		if (!options) {
			return null;
		}

		var name = plugin.desc.name;
		var pluginRoot = path.join(extensionsPath, name);
		var clean = 'clean-extension:' + name;
		var compile = 'compile-extension:' + name;
		var compileBuild = 'compile-build-extension:' + name;
		var watch = 'watch-extension:' + name;

		var sources = 'extensions/' + name + '/src/**';
		var deps = [
			'src/vs/vscode.d.ts',
			'src/typings/mocha.d.ts',
			'extensions/declares.d.ts',
			'extensions/node.d.ts',
			'extensions/lib.core.d.ts'
		];

		var pipeline = (function () {
			var reporter = quiet ? null : createReporter();
			var compilation = tsb.create(options, null, null, quiet ? null : function (err) { reporter(err.toString()); });

			return function (build) {
				var input = es.through();
				var tsFilter = filter(['**/*.ts', '!**/lib/lib*.d.ts'], { restore: true });
				var output;
				if (build) {
					output = input
						.pipe(tsFilter)
						.pipe(sourcemaps.init())
							.pipe(compilation())
							.pipe(nlsDev.rewriteLocalizeCalls())
						.pipe(sourcemaps.write('.', {
							addComment: false,
							includeContent: false
						}))
						.pipe(tsFilter.restore)
						.pipe(quiet ? es.through() : reporter.end());

				} else {
					output = input
						.pipe(tsFilter)
						.pipe(compilation())
						.pipe(tsFilter.restore)
						.pipe(quiet ? es.through() : reporter.end());
				}

				return es.duplex(input, output);
			};
		})();

		var sourcesRoot = path.join(pluginRoot, 'src');
		var sourcesOpts = { cwd: path.dirname(__dirname), base: sourcesRoot };
		var depsOpts = { cwd: path.dirname(__dirname)	};

		gulp.task(clean, function (cb) {
			rimraf(path.join(pluginRoot, 'out'), cb);
		});

		gulp.task(compile, [clean], function () {
			var src = es.merge(gulp.src(sources, sourcesOpts), gulp.src(deps, depsOpts));

			return src
				.pipe(pipeline(false))
				.pipe(gulp.dest('extensions/' + name + '/out'));
		});

		gulp.task(compileBuild, [clean], function () {
			var src = es.merge(gulp.src(sources, sourcesOpts), gulp.src(deps, depsOpts));

			return src
				.pipe(pipeline(true))
				.pipe(gulp.dest('extensions/' + name + '/out'));
		});

		gulp.task(watch, [clean], function () {
			var src = es.merge(gulp.src(sources, sourcesOpts), gulp.src(deps, depsOpts));
			var watchSrc = es.merge(watcher(sources, sourcesOpts), watcher(deps, depsOpts));

			return watchSrc
				.pipe(util.incremental(pipeline, src))
				.pipe(gulp.dest('extensions/' + name + '/out'));
		});

		return {
			clean: clean,
			compile: compile,
			compileBuild: compileBuild,
			watch: watch
		};
	})
	.filter(function(task) { return !!task; });

gulp.task('clean-extensions', tasks.map(function (t) { return t.clean; }));
gulp.task('compile-extensions', tasks.map(function (t) { return t.compile; }));
gulp.task('compile-build-extensions', tasks.map(function (t) { return t.compileBuild; }));
gulp.task('watch-extensions', tasks.map(function (t) { return t.watch; }));