/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import 'mocha';
import * as path from 'path';
import * as fs from 'fs';

import * as assert from 'assert';
import { getLanguageModes } from '../modes/languageModes';
import { TextDocument, Range, FormattingOptions } from 'vscode-languageserver-types';

import { format } from '../modes/formatting';

suite('HTML Embedded Formatting', () => {

	function assertFormat(value: string, expected: string, options?: any, formatOptions?: FormattingOptions, message?: string): void {
		var languageModes = getLanguageModes({ css: true, javascript: true });
		if (options) {
			languageModes.getAllModes().forEach(m => m.configure!(options));
		}

		let rangeStartOffset = value.indexOf('|');
		let rangeEndOffset;
		if (rangeStartOffset !== -1) {
			value = value.substr(0, rangeStartOffset) + value.substr(rangeStartOffset + 1);

			rangeEndOffset = value.indexOf('|');
			value = value.substr(0, rangeEndOffset) + value.substr(rangeEndOffset + 1);
		} else {
			rangeStartOffset = 0;
			rangeEndOffset = value.length;
		}
		let document = TextDocument.create('test://test/test.html', 'html', 0, value);
		let range = Range.create(document.positionAt(rangeStartOffset), document.positionAt(rangeEndOffset));
		if (!formatOptions) {
			formatOptions = FormattingOptions.create(2, true);
		}

		let result = format(languageModes, document, range, formatOptions, void 0, { css: true, javascript: true });

		let actual = TextDocument.applyEdits(document, result);
		assert.equal(actual, expected, message);
	}

	function assertFormatWithFixture(fixtureName: string, expectedPath: string, options?: any, formatOptions?: FormattingOptions): void {
		let input = fs.readFileSync(path.join(__dirname, 'fixtures', 'inputs', fixtureName)).toString().replace(/\r\n/mg, '\n');
		let expected = fs.readFileSync(path.join(__dirname, 'fixtures', 'expected', expectedPath)).toString().replace(/\r\n/mg, '\n');
		assertFormat(input, expected, options, formatOptions, expectedPath);
	}

	test('HTML only', function (): any {
		assertFormat('<html><body><p>Hello</p></body></html>', '<html>\n\n<body>\n  <p>Hello</p>\n</body>\n\n</html>');
		assertFormat('|<html><body><p>Hello</p></body></html>|', '<html>\n\n<body>\n  <p>Hello</p>\n</body>\n\n</html>');
		assertFormat('<html>|<body><p>Hello</p></body>|</html>', '<html><body>\n  <p>Hello</p>\n</body></html>');
	});

	test('HTML & Scripts', function (): any {
		assertFormat('<html><head><script></script></head></html>', '<html>\n\n<head>\n  <script></script>\n</head>\n\n</html>');
		assertFormat('<html><head><script>var x=1;</script></head></html>', '<html>\n\n<head>\n  <script>var x = 1;</script>\n</head>\n\n</html>');
		assertFormat('<html><head><script>\nvar x=2;\n</script></head></html>', '<html>\n\n<head>\n  <script>\n    var x = 2;\n  </script>\n</head>\n\n</html>');
		assertFormat('<html><head>\n  <script>\nvar x=3;\n</script></head></html>', '<html>\n\n<head>\n  <script>\n    var x = 3;\n  </script>\n</head>\n\n</html>');
		assertFormat('<html><head>\n  <script>\nvar x=4;\nconsole.log("Hi");\n</script></head></html>', '<html>\n\n<head>\n  <script>\n    var x = 4;\n    console.log("Hi");\n  </script>\n</head>\n\n</html>');
		assertFormat('<html><head>\n  |<script>\nvar x=5;\n</script>|</head></html>', '<html><head>\n  <script>\n    var x = 5;\n  </script></head></html>');
	});

	test('HTLM & Scripts - Fixtures', function () {
		assertFormatWithFixture('19813.html', '19813.html');
		assertFormatWithFixture('19813.html', '19813-4spaces.html', void 0, FormattingOptions.create(4, true));
		assertFormatWithFixture('19813.html', '19813-tab.html', void 0, FormattingOptions.create(1, false));
		assertFormatWithFixture('21634.html', '21634.html');
	});

	test('Script end tag', function (): any {
		assertFormat('<html>\n<head>\n  <script>\nvar x  =  0;\n</script></head></html>', '<html>\n\n<head>\n  <script>\n    var x = 0;\n  </script>\n</head>\n\n</html>');
	});

	test('HTML & Multiple Scripts', function (): any {
		assertFormat('<html><head>\n<script>\nif(x){\nbar(); }\n</script><script>\nfunction(x){    }\n</script></head></html>', '<html>\n\n<head>\n  <script>\n    if (x) {\n      bar();\n    }\n  </script>\n  <script>\n    function(x) {}\n  </script>\n</head>\n\n</html>');
	});

	test('HTML & Styles', function (): any {
		assertFormat('<html><head>\n<style>\n.foo{display:none;}\n</style></head></html>', '<html>\n\n<head>\n  <style>\n    .foo {\n      display: none;\n    }\n  </style>\n</head>\n\n</html>');
	});

	test('EndWithNewline', function (): any {
		let options = {
			html: {
				format: {
					endWithNewline: true
				}
			}
		};
		assertFormat('<html><body><p>Hello</p></body></html>', '<html>\n\n<body>\n  <p>Hello</p>\n</body>\n\n</html>\n', options);
		assertFormat('<html>|<body><p>Hello</p></body>|</html>', '<html><body>\n  <p>Hello</p>\n</body></html>', options);
		assertFormat('<html><head><script>\nvar x=1;\n</script></head></html>', '<html>\n\n<head>\n  <script>\n    var x = 1;\n  </script>\n</head>\n\n</html>\n', options);
	});

	test('Inside script', function (): any {
		assertFormat('<html><head>\n  <script>\n|var x=6;|\n</script></head></html>', '<html><head>\n  <script>\n  var x = 6;\n</script></head></html>');
		assertFormat('<html><head>\n  <script>\n|var x=6;\nvar y=  9;|\n</script></head></html>', '<html><head>\n  <script>\n  var x = 6;\n  var y = 9;\n</script></head></html>');
	});

	test('Range after new line', function (): any {
		assertFormat('<html><head>\n  |<script>\nvar x=6;\n</script>\n|</head></html>', '<html><head>\n  <script>\n    var x = 6;\n  </script>\n</head></html>');
	});

	test('bug 36574', function (): any {
		assertFormat('<script src="/js/main.js"> </script>', '<script src="/js/main.js"> </script>');
	});

});