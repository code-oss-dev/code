/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import URI from 'vs/base/common/uri';
import {TPromise} from 'vs/base/common/winjs.base';
import {ExtHostDocuments} from 'vs/workbench/api/node/extHostDocuments';
import {TextEdit, Position} from 'vs/workbench/api/node/extHostTypes';
import {MainThreadWorkspaceShape} from 'vs/workbench/api/node/extHost.protocol';
import {ExtHostDocumentSaveParticipant, TextDocumentWillSaveEvent} from 'vs/workbench/api/node/extHostDocumentSaveParticipant';
import {OneGetThreadService} from './testThreadService';
import * as EditorCommon from 'vs/editor/common/editorCommon';
import {IResourceEdit} from 'vs/editor/common/services/bulkEdit';

suite('ExtHostDocumentSaveParticipant', () => {

	let resource = URI.parse('foo:bar');
	let workspace = new class extends MainThreadWorkspaceShape { };
	let documents: ExtHostDocuments;

	setup(() => {

		documents = new ExtHostDocuments(OneGetThreadService(null));
		documents.$acceptModelAdd({
			isDirty: false,
			modeId: 'foo',
			url: resource,
			versionId: 1,
			value: {
				EOL: '\n',
				lines: ['foo'],
				BOM: '',
				length: -1,
				options: {
					tabSize: 4,
					insertSpaces: true,
					trimAutoWhitespace: true,
					defaultEOL: EditorCommon.DefaultEndOfLine.LF
				}
			}
		});
	});

	test('no listeners, no problem', () => {
		const participant = new ExtHostDocumentSaveParticipant(documents, workspace);
		return participant.$participateInSave(resource).then(() => assert.ok(true));
	});

	test('event delivery', () => {
		const participant = new ExtHostDocumentSaveParticipant(documents, workspace);

		let event: TextDocumentWillSaveEvent;
		let sub = participant.onWillSaveTextDocumentEvent(function (e) {
			event = e;
		});

		return participant.$participateInSave(resource).then(() => {
			sub.dispose();

			assert.ok(event);
			assert.equal(typeof event.waitUntil, 'function');
		});
	});

	test('event delivery, immutable', () => {
		const participant = new ExtHostDocumentSaveParticipant(documents, workspace);

		let event: TextDocumentWillSaveEvent;
		let sub = participant.onWillSaveTextDocumentEvent(function (e) {
			event = e;
		});

		return participant.$participateInSave(resource).then(() => {
			sub.dispose();

			assert.ok(event);
			assert.throws(() => event.document = null);
		});
	});

	test('event delivery, in subscriber order', () => {
		const participant = new ExtHostDocumentSaveParticipant(documents, workspace);

		let counter = 0;
		let sub1 = participant.onWillSaveTextDocumentEvent(function (event) {
			assert.equal(counter++, 0);
		});

		let sub2 = participant.onWillSaveTextDocumentEvent(function (event) {
			assert.equal(counter++, 1);
		});

		return participant.$participateInSave(resource).then(() => {
			sub1.dispose();
			sub2.dispose();
		});
	});

	test('event delivery, waitUntil', () => {
		const participant = new ExtHostDocumentSaveParticipant(documents, workspace);

		let sub = participant.onWillSaveTextDocumentEvent(function (event) {

			event.waitUntil(TPromise.timeout(10));
			event.waitUntil(TPromise.timeout(10));
			event.waitUntil(TPromise.timeout(10));
		});

		return participant.$participateInSave(resource).then(() => {
			sub.dispose();
		});

	});

	test('event delivery, waitUntil must be called sync', () => {
		const participant = new ExtHostDocumentSaveParticipant(documents, workspace);

		let sub = participant.onWillSaveTextDocumentEvent(function (event) {

			event.waitUntil(new TPromise((resolve, reject) => {
				setTimeout(() => {
					try {
						assert.throws(() => event.waitUntil(TPromise.timeout(10)));
						resolve(void 0);
					} catch (e) {
						reject(e);
					}

				}, 10);
			}));
		});

		return participant.$participateInSave(resource).then(() => {
			sub.dispose();
		});
	});

	test('event delivery, waitUntil failure handling', () => {
		const participant = new ExtHostDocumentSaveParticipant(documents, workspace);

		let sub1 = participant.onWillSaveTextDocumentEvent(function (e) {
			e.waitUntil(TPromise.wrapError('dddd'));
		});

		let event: TextDocumentWillSaveEvent;
		let sub2 = participant.onWillSaveTextDocumentEvent(function (e) {
			event = e;
		});

		return participant.$participateInSave(resource).then(() => {
			assert.ok(event);
			sub1.dispose();
			sub2.dispose();
		});
	});

	test('event delivery, pushEdits sync', () => {

		let edits: IResourceEdit[];
		const participant = new ExtHostDocumentSaveParticipant(documents, new class extends MainThreadWorkspaceShape {
			$applyWorkspaceEdit(_edits) {
				edits = _edits;
				return TPromise.as(true);
			}
		});

		let sub = participant.onWillSaveTextDocumentEvent(function (e) {
			e.waitUntil(TPromise.as([TextEdit.insert(new Position(0, 0), 'bar')]));
		});

		return participant.$participateInSave(resource).then(() => {
			sub.dispose();

			assert.equal(edits.length, 1);
		});
	});

	test('event delivery, concurrent change', () => {

		let edits: IResourceEdit[];
		const participant = new ExtHostDocumentSaveParticipant(documents, new class extends MainThreadWorkspaceShape {
			$applyWorkspaceEdit(_edits) {
				edits = _edits;
				return TPromise.as(true);
			}
		});

		let sub = participant.onWillSaveTextDocumentEvent(function (e) {

			// concurrent change from somewhere
			documents.$acceptModelChanged(resource.toString(), [{
				versionId: 2,
				range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
				text: 'bar',
				rangeLength: undefined, eol: undefined, isRedoing: undefined, isUndoing: undefined,
			}]);

			e.waitUntil(TPromise.as([TextEdit.insert(new Position(0, 0), 'bar')]));
		});

		return participant.$participateInSave(resource).then(values => {
			sub.dispose();

			assert.equal(edits, undefined);
			assert.ok((<Error>values[0]).message);
		});

	});

	test('event delivery, two listeners -> two document states', () => {

		const participant = new ExtHostDocumentSaveParticipant(documents, new class extends MainThreadWorkspaceShape {
			$applyWorkspaceEdit(_edits: IResourceEdit[]) {

				for (const {resource, newText, range} of _edits) {
					documents.$acceptModelChanged(resource.toString(), [{
						range,
						text: newText,
						versionId: documents.getDocumentData(resource).version + 1,
						rangeLength: undefined, eol: undefined, isRedoing: undefined, isUndoing: undefined,
					}]);
				}
				return TPromise.as(true);
			}
		});

		const document = documents.getDocumentData(resource).document;

		let sub1 = participant.onWillSaveTextDocumentEvent(function (e) {
			// the document state we started with
			assert.equal(document.version, 1);
			assert.equal(document.getText(), 'foo');

			e.waitUntil(TPromise.as([TextEdit.insert(new Position(0, 0), 'bar')]));
		});

		let sub2 = participant.onWillSaveTextDocumentEvent(function (e) {
			// the document state AFTER the first listener kicked in
			assert.equal(document.version, 2);
			assert.equal(document.getText(), 'barfoo');

			e.waitUntil(TPromise.as([TextEdit.insert(new Position(0, 0), 'bar')]));
		});

		return participant.$participateInSave(resource).then(values => {
			sub1.dispose();
			sub2.dispose();

			// the document state AFTER eventing is done
			assert.equal(document.version, 3);
			assert.equal(document.getText(), 'barbarfoo');
		});

	});
});
