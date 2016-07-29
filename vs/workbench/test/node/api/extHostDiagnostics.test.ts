/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import URI from 'vs/base/common/uri';
import {DiagnosticCollection} from 'vs/workbench/api/node/extHostDiagnostics';
import {Diagnostic, Range} from 'vs/workbench/api/node/extHostTypes';
import {MainThreadDiagnosticsShape} from 'vs/workbench/api/node/extHost.protocol';
import {TPromise} from 'vs/base/common/winjs.base';
import {IMarkerData} from 'vs/platform/markers/common/markers';

suite('ExtHostDiagnostics', () => {

	class DiagnosticsShape extends MainThreadDiagnosticsShape {
		$changeMany(owner: string, entries: [URI, IMarkerData[]][]): TPromise<any> {
			return TPromise.as(null);
		}
		$clear(owner: string): TPromise<any> {
			return TPromise.as(null);
		}
	};

	test('disposeCheck', function () {

		const collection = new DiagnosticCollection('test', new DiagnosticsShape());

		collection.dispose();
		collection.dispose(); // that's OK
		assert.throws(() => collection.name);
		assert.throws(() => collection.clear());
		assert.throws(() => collection.delete(URI.parse('aa:bb')));
		assert.throws(() => collection.forEach(() => { ; }));
		assert.throws(() => collection.get(URI.parse('aa:bb')));
		assert.throws(() => collection.has(URI.parse('aa:bb')));
		assert.throws(() => collection.set(URI.parse('aa:bb'), []));
		assert.throws(() => collection.set(URI.parse('aa:bb'), undefined));
	});


	test('diagnostic collection, forEach, clear, has', function () {
		let collection = new DiagnosticCollection('test', new DiagnosticsShape());
		assert.equal(collection.name, 'test');
		collection.dispose();
		assert.throws(() => collection.name);

		let c = 0;
		collection = new DiagnosticCollection('test', new DiagnosticsShape());
		collection.forEach(() => c++);
		assert.equal(c, 0);

		collection.set(URI.parse('foo:bar'), [
			new Diagnostic(new Range(0, 0, 1, 1), 'message-1'),
			new Diagnostic(new Range(0, 0, 1, 1), 'message-2')
		]);
		collection.forEach(() => c++);
		assert.equal(c, 1);

		c = 0;
		collection.clear();
		collection.forEach(() => c++);
		assert.equal(c, 0);

		collection.set(URI.parse('foo:bar1'), [
			new Diagnostic(new Range(0, 0, 1, 1), 'message-1'),
			new Diagnostic(new Range(0, 0, 1, 1), 'message-2')
		]);
		collection.set(URI.parse('foo:bar2'), [
			new Diagnostic(new Range(0, 0, 1, 1), 'message-1'),
			new Diagnostic(new Range(0, 0, 1, 1), 'message-2')
		]);
		collection.forEach(() => c++);
		assert.equal(c, 2);

		assert.ok(collection.has(URI.parse('foo:bar1')));
		assert.ok(collection.has(URI.parse('foo:bar2')));
		assert.ok(!collection.has(URI.parse('foo:bar3')));
		collection.delete(URI.parse('foo:bar1'));
		assert.ok(!collection.has(URI.parse('foo:bar1')));

		collection.dispose();
	});

	test('diagnostic collection, immutable read', function () {
		let collection = new DiagnosticCollection('test', new DiagnosticsShape());
		collection.set(URI.parse('foo:bar'), [
			new Diagnostic(new Range(0, 0, 1, 1), 'message-1'),
			new Diagnostic(new Range(0, 0, 1, 1), 'message-2')
		]);

		let array = collection.get(URI.parse('foo:bar'));
		assert.throws(() => array.length = 0);
		assert.throws(() => array.pop());
		assert.throws(() => array[0] = new Diagnostic(new Range(0, 0, 0, 0), 'evil'));

		collection.forEach((uri, array) => {
			assert.throws(() => array.length = 0);
			assert.throws(() => array.pop());
			assert.throws(() => array[0] = new Diagnostic(new Range(0, 0, 0, 0), 'evil'));
		});

		array = collection.get(URI.parse('foo:bar'));
		assert.equal(array.length, 2);

		collection.dispose();
	});


	test('diagnostics collection, set with dupliclated tuples', function () {
		let collection = new DiagnosticCollection('test', new DiagnosticsShape());
		let uri = URI.parse('sc:hightower');
		collection.set([
			[uri, [new Diagnostic(new Range(0, 0, 0, 1), 'message-1')]],
			[URI.parse('some:thing'), [new Diagnostic(new Range(0, 0, 1, 1), 'something')]],
			[uri, [new Diagnostic(new Range(0, 0, 0, 1), 'message-2')]],
		]);

		let array = collection.get(uri);
		assert.equal(array.length, 2);
		let [first, second] = array;
		assert.equal(first.message, 'message-1');
		assert.equal(second.message, 'message-2');

		// clear
		collection.delete(uri);
		assert.ok(!collection.has(uri));

		// bad tuple clears 1/2
		collection.set([
			[uri, [new Diagnostic(new Range(0, 0, 0, 1), 'message-1')]],
			[URI.parse('some:thing'), [new Diagnostic(new Range(0, 0, 1, 1), 'something')]],
			[uri, undefined]
		]);
		assert.ok(!collection.has(uri));

		// clear
		collection.delete(uri);
		assert.ok(!collection.has(uri));

		// bad tuple clears 2/2
		collection.set([
			[uri, [new Diagnostic(new Range(0, 0, 0, 1), 'message-1')]],
			[URI.parse('some:thing'), [new Diagnostic(new Range(0, 0, 1, 1), 'something')]],
			[uri, undefined],
			[uri, [new Diagnostic(new Range(0, 0, 0, 1), 'message-2')]],
			[uri, [new Diagnostic(new Range(0, 0, 0, 1), 'message-3')]],
		]);

		array = collection.get(uri);
		assert.equal(array.length, 2);
		[first, second] = array;
		assert.equal(first.message, 'message-2');
		assert.equal(second.message, 'message-3');

		collection.dispose();
	});


	test('diagnostic capping', function () {

		let lastEntries: [URI, IMarkerData[]][];
		let collection = new DiagnosticCollection('test', new class extends DiagnosticsShape {
			$changeMany(owner: string, entries: [URI, IMarkerData[]][]): TPromise<any> {
				lastEntries = entries;
				return super.$changeMany(owner, entries);
			}
		});
		let uri = URI.parse('aa:bb');

		collection.set(uri, new Array(500).map((value, i) => new Diagnostic(new Range(i, 0, i + 1, 0), `error#${i}`)));
		assert.equal(collection.get(uri).length, 500);
		assert.equal(lastEntries.length, 1);
		assert.equal(lastEntries[0][1].length, 250);
	});
});