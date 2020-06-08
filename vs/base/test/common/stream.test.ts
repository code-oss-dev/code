/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isReadableStream, newWriteableStream, Readable, consumeReadable, consumeReadableWithLimit, consumeStream, ReadableStream, toStream, toReadable, transform, consumeStreamWithLimit } from 'vs/base/common/stream';
import { timeout } from 'vs/base/common/async';

suite('Stream', () => {

	test('isReadableStream', () => {
		assert.ok(!isReadableStream(Object.create(null)));
		assert.ok(isReadableStream(newWriteableStream(d => d)));
	});

	test('WriteableStream - basics', () => {
		const stream = newWriteableStream<string>(strings => strings.join());

		let error = false;
		stream.on('error', e => {
			error = true;
		});

		let end = false;
		stream.on('end', () => {
			end = true;
		});

		stream.write('Hello');

		const chunks: string[] = [];
		stream.on('data', data => {
			chunks.push(data);
		});

		assert.equal(chunks[0], 'Hello');

		stream.write('World');
		assert.equal(chunks[1], 'World');

		assert.equal(error, false);
		assert.equal(end, false);

		stream.pause();
		stream.write('1');
		stream.write('2');
		stream.write('3');

		assert.equal(chunks.length, 2);

		stream.resume();

		assert.equal(chunks.length, 3);
		assert.equal(chunks[2], '1,2,3');

		stream.error(new Error());
		assert.equal(error, true);

		stream.end('Final Bit');
		assert.equal(chunks.length, 4);
		assert.equal(chunks[3], 'Final Bit');

		stream.destroy();

		stream.write('Unexpected');
		assert.equal(chunks.length, 4);
	});

	test('WriteableStream - removeListener', () => {
		const stream = newWriteableStream<string>(strings => strings.join());

		let error = false;
		const errorListener = (e: Error) => {
			error = true;
		};
		stream.on('error', errorListener);

		let end = false;
		const endListener = () => {
			end = true;
		};
		stream.on('end', endListener);

		let data = false;
		const dataListener = () => {
			data = true;
		};
		stream.on('data', dataListener);

		stream.write('Hello');
		assert.equal(data, true);

		data = false;
		stream.removeListener('data', dataListener);

		stream.write('World');
		assert.equal(data, false);

		stream.error(new Error());
		assert.equal(error, true);

		error = false;
		stream.removeListener('error', errorListener);

		stream.error(new Error());
		assert.equal(error, false);
	});

	test('WriteableStream - highWaterMark', async () => {
		const stream = newWriteableStream<string>(strings => strings.join(), { highWaterMark: 3 });

		let res = stream.write('1');
		assert.ok(!res);

		res = stream.write('2');
		assert.ok(!res);

		res = stream.write('3');
		assert.ok(!res);

		let promise1 = stream.write('4');
		assert.ok(promise1 instanceof Promise);

		let promise2 = stream.write('5');
		assert.ok(promise2 instanceof Promise);

		let drained1 = false;
		(async () => {
			await promise1;
			drained1 = true;
		})();

		let drained2 = false;
		(async () => {
			await promise2;
			drained2 = true;
		})();

		let data: string | undefined = undefined;
		stream.on('data', chunk => {
			data = chunk;
		});
		assert.ok(data);

		await timeout(0);
		assert.equal(drained1, true);
		assert.equal(drained2, true);
	});

	test('consumeReadable', () => {
		const readable = arrayToReadable(['1', '2', '3', '4', '5']);
		const consumed = consumeReadable(readable, strings => strings.join());
		assert.equal(consumed, '1,2,3,4,5');
	});

	test('consumeReadableWithLimit', () => {
		for (let i = 0; i < 5; i++) {
			const readable = arrayToReadable(['1', '2', '3', '4', '5']);

			const consumedOrReadable = consumeReadableWithLimit(readable, strings => strings.join(), i);
			if (typeof consumedOrReadable === 'string') {
				assert.fail('Unexpected result');
			} else {
				const consumed = consumeReadable(consumedOrReadable, strings => strings.join());
				assert.equal(consumed, '1,2,3,4,5');
			}
		}

		let readable = arrayToReadable(['1', '2', '3', '4', '5']);
		let consumedOrReadable = consumeReadableWithLimit(readable, strings => strings.join(), 5);
		assert.equal(consumedOrReadable, '1,2,3,4,5');

		readable = arrayToReadable(['1', '2', '3', '4', '5']);
		consumedOrReadable = consumeReadableWithLimit(readable, strings => strings.join(), 6);
		assert.equal(consumedOrReadable, '1,2,3,4,5');
	});

	function arrayToReadable<T>(array: T[]): Readable<T> {
		return {
			read: () => array.shift() || null
		};
	}

	function readableToStream(readable: Readable<string>): ReadableStream<string> {
		const stream = newWriteableStream<string>(strings => strings.join());

		// Simulate async behavior
		setTimeout(() => {
			let chunk: string | null = null;
			while ((chunk = readable.read()) !== null) {
				stream.write(chunk);
			}

			stream.end();
		}, 0);

		return stream;
	}

	test('consumeStream', async () => {
		const stream = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));
		const consumed = await consumeStream(stream, strings => strings.join());
		assert.equal(consumed, '1,2,3,4,5');
	});

	test('consumeStreamWithLimit', async () => {
		for (let i = 0; i < 5; i++) {
			const readable = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));

			const consumedOrStream = await consumeStreamWithLimit(readable, strings => strings.join(), i);
			if (typeof consumedOrStream === 'string') {
				assert.fail('Unexpected result');
			} else {
				const consumed = await consumeStream(consumedOrStream, strings => strings.join());
				assert.equal(consumed, '1,2,3,4,5');
			}
		}

		let stream = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));
		let consumedOrStream = await consumeStreamWithLimit(stream, strings => strings.join(), 5);
		assert.equal(consumedOrStream, '1,2,3,4,5');

		stream = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));
		consumedOrStream = await consumeStreamWithLimit(stream, strings => strings.join(), 6);
		assert.equal(consumedOrStream, '1,2,3,4,5');
	});

	test('toStream', async () => {
		const stream = toStream('1,2,3,4,5', strings => strings.join());
		const consumed = await consumeStream(stream, strings => strings.join());
		assert.equal(consumed, '1,2,3,4,5');
	});

	test('toReadable', async () => {
		const readable = toReadable('1,2,3,4,5');
		const consumed = await consumeReadable(readable, strings => strings.join());
		assert.equal(consumed, '1,2,3,4,5');
	});

	test('transform', async () => {
		const source = newWriteableStream<string>(strings => strings.join());

		const result = transform(source, { data: string => string + string }, strings => strings.join());

		// Simulate async behavior
		setTimeout(() => {
			source.write('1');
			source.write('2');
			source.write('3');
			source.write('4');
			source.end('5');
		}, 0);

		const consumed = await consumeStream(result, strings => strings.join());
		assert.equal(consumed, '11,22,33,44,55');
	});
});
