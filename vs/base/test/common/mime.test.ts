/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { guessMimeTypes, registerTextMime } from 'vs/base/common/mime';

suite('Mime', () => {
	test('Dynamically Register Text Mime', () => {
		let guess = guessMimeTypes('foo.monaco');
		assert.deepEqual(guess, ['application/unknown']);

		registerTextMime({ id: 'monaco', extension: '.monaco', mime: 'text/monaco' });
		guess = guessMimeTypes('foo.monaco');
		assert.deepEqual(guess, ['text/monaco', 'text/plain']);

		guess = guessMimeTypes('.monaco');
		assert.deepEqual(guess, ['text/monaco', 'text/plain']);

		registerTextMime({ id: 'codefile', filename: 'Codefile', mime: 'text/code' });
		guess = guessMimeTypes('Codefile');
		assert.deepEqual(guess, ['text/code', 'text/plain']);

		guess = guessMimeTypes('foo.Codefile');
		assert.deepEqual(guess, ['application/unknown']);

		registerTextMime({ id: 'docker', filepattern: 'Docker*', mime: 'text/docker' });
		guess = guessMimeTypes('Docker-debug');
		assert.deepEqual(guess, ['text/docker', 'text/plain']);

		guess = guessMimeTypes('docker-PROD');
		assert.deepEqual(guess, ['text/docker', 'text/plain']);

		registerTextMime({ id: 'niceregex', mime: 'text/nice-regex', firstline: /RegexesAreNice/ });
		guess = guessMimeTypes('Randomfile.noregistration', 'RegexesAreNice');
		assert.deepEqual(guess, ['text/nice-regex', 'text/plain']);

		guess = guessMimeTypes('Randomfile.noregistration', 'RegexesAreNotNice');
		assert.deepEqual(guess, ['application/unknown']);

		guess = guessMimeTypes('Codefile', 'RegexesAreNice');
		assert.deepEqual(guess, ['text/code', 'text/plain']);
	});

	test('Mimes Priority', () => {
		registerTextMime({ id: 'monaco', extension: '.monaco', mime: 'text/monaco' });
		registerTextMime({ id: 'foobar', mime: 'text/foobar', firstline: /foobar/ });

		let guess = guessMimeTypes('foo.monaco');
		assert.deepEqual(guess, ['text/monaco', 'text/plain']);

		guess = guessMimeTypes('foo.monaco', 'foobar');
		assert.deepEqual(guess, ['text/monaco', 'text/plain']);

		registerTextMime({ id: 'docker', filename: 'dockerfile', mime: 'text/winner' });
		registerTextMime({ id: 'docker', filepattern: 'dockerfile*', mime: 'text/looser' });
		guess = guessMimeTypes('dockerfile');
		assert.deepEqual(guess, ['text/winner', 'text/plain']);
	});

	test('Specificity priority 1', () => {
		registerTextMime({ id: 'monaco2', extension: '.monaco2', mime: 'text/monaco2' });
		registerTextMime({ id: 'monaco2', filename: 'specific.monaco2', mime: 'text/specific-monaco2' });

		assert.deepEqual(guessMimeTypes('specific.monaco2'), ['text/specific-monaco2', 'text/plain']);
		assert.deepEqual(guessMimeTypes('foo.monaco2'), ['text/monaco2', 'text/plain']);
	});

	test('Specificity priority 2', () => {
		registerTextMime({ id: 'monaco3', filename: 'specific.monaco3', mime: 'text/specific-monaco3' });
		registerTextMime({ id: 'monaco3', extension: '.monaco3', mime: 'text/monaco3' });

		assert.deepEqual(guessMimeTypes('specific.monaco3'), ['text/specific-monaco3', 'text/plain']);
		assert.deepEqual(guessMimeTypes('foo.monaco3'), ['text/monaco3', 'text/plain']);
	});

	test('Mimes Priority - Longest Extension wins', () => {
		registerTextMime({ id: 'monaco', extension: '.monaco', mime: 'text/monaco' });
		registerTextMime({ id: 'monaco', extension: '.monaco.xml', mime: 'text/monaco-xml' });
		registerTextMime({ id: 'monaco', extension: '.monaco.xml.build', mime: 'text/monaco-xml-build' });

		let guess = guessMimeTypes('foo.monaco');
		assert.deepEqual(guess, ['text/monaco', 'text/plain']);

		guess = guessMimeTypes('foo.monaco.xml');
		assert.deepEqual(guess, ['text/monaco-xml', 'text/plain']);

		guess = guessMimeTypes('foo.monaco.xml.build');
		assert.deepEqual(guess, ['text/monaco-xml-build', 'text/plain']);
	});

	test('Mimes Priority - User configured wins', () => {
		registerTextMime({ id: 'monaco', extension: '.monaco.xnl', mime: 'text/monaco', userConfigured: true });
		registerTextMime({ id: 'monaco', extension: '.monaco.xml', mime: 'text/monaco-xml' });

		let guess = guessMimeTypes('foo.monaco.xnl');
		assert.deepEqual(guess, ['text/monaco', 'text/plain']);
	});

	test('Mimes Priority - Pattern matches on path if specified', () => {
		registerTextMime({ id: 'monaco', filepattern: '**/dot.monaco.xml', mime: 'text/monaco' });
		registerTextMime({ id: 'other', filepattern: '*ot.other.xml', mime: 'text/other' });

		let guess = guessMimeTypes('/some/path/dot.monaco.xml');
		assert.deepEqual(guess, ['text/monaco', 'text/plain']);
	});

	test('Mimes Priority - Last registered mime wins', () => {
		registerTextMime({ id: 'monaco', filepattern: '**/dot.monaco.xml', mime: 'text/monaco' });
		registerTextMime({ id: 'other', filepattern: '**/dot.monaco.xml', mime: 'text/other' });

		let guess = guessMimeTypes('/some/path/dot.monaco.xml');
		assert.deepEqual(guess, ['text/other', 'text/plain']);
	});
});
