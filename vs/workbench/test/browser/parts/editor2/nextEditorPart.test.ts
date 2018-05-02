/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import { NextEditorPart } from 'vs/workbench/browser/parts/editor2/nextEditorPart';
import { workbenchInstantiationService } from 'vs/workbench/test/workbenchTestServices';
import { Direction } from 'vs/workbench/services/editor/common/nextEditorGroupsService';
import { Dimension } from 'vs/base/browser/dom';

suite('editor2 tests', () => {

	test('Groups basics', function () {
		const instantiationService = workbenchInstantiationService();

		const part = instantiationService.createInstance(NextEditorPart, 'id');
		part.create(document.createElement('div'));
		part.layout(new Dimension(400, 300));

		let activeGroupChangeCounter = 0;
		const activeGroupChangeListener = part.onDidActiveGroupChange(() => {
			activeGroupChangeCounter++;
		});

		// always a root group
		const rootGroup = part.groups[0];
		assert.equal(part.groups.length, 1);
		assert.ok(rootGroup.isActive);

		const rightGroup = part.addGroup(rootGroup, Direction.RIGHT);
		assert.equal(part.groups.length, 2);
		assert.ok(rootGroup.isActive);

		assert.equal(activeGroupChangeCounter, 0);

		part.activateGroup(rightGroup);
		assert.ok(rightGroup.isActive);
		assert.equal(activeGroupChangeCounter, 1);

		const downGroup = part.addGroup(rightGroup, Direction.DOWN);
		assert.equal(part.groups.length, 3);
		assert.ok(rightGroup.isActive);
		assert.ok(!downGroup.activeControl);

		part.removeGroup(downGroup);
		assert.equal(part.groups.length, 2);
		assert.ok(rightGroup.isActive);

		part.removeGroup(rightGroup);
		assert.equal(part.groups.length, 1);
		assert.ok(rootGroup.isActive);

		part.removeGroup(rootGroup); // cannot remove root group
		assert.equal(part.groups.length, 1);
		assert.ok(rootGroup.isActive);

		activeGroupChangeListener.dispose();
	});
});
