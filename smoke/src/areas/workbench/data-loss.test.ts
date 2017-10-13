/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SpectronApplication } from '../../spectron/application';

describe('Dataloss', () => {
	let app: SpectronApplication;
	before(() => { app = new SpectronApplication(); return app.start('Dataloss'); });
	after(async () => {
		const log = await app.client.spectron.client.execute(() => {
			return (window as any).myLog as string[];
		});

		console.log(log.value.join('\n'));

		await app.stop();

	});

	it(`verifies that 'hot exit' works for dirty files`, async function () {
		await app.workbench.newUntitledFile();

		const untitled = 'Untitled-1';
		const textToTypeInUntitled = 'Hello, Unitled Code alexandru dimaaaaa joao moreno';
		await app.workbench.editor.waitForTypeInEditor(untitled, textToTypeInUntitled);
		await app.screenCapturer.capture('Untitled file before reload');
		await app.workbench.editor.waitForEditorContents(untitled, c => c.indexOf(textToTypeInUntitled) > -1);

		const readmeMd = 'readme.md';
		const textToType = 'Hello, Code alexandru dimaaaaa joao moreno';
		await app.workbench.explorer.openFile(readmeMd);
		await app.workbench.editor.waitForTypeInEditor(readmeMd, textToType);
		await app.screenCapturer.capture(`${readmeMd} before reload`);
		await app.workbench.editor.waitForEditorContents(readmeMd, c => c.indexOf(textToType) > -1);

		// await app.reload();
		// await app.screenCapturer.capture('After reload');

		// await app.workbench.waitForActiveTab(readmeMd, true);
		// await app.screenCapturer.capture(`${readmeMd} after reload`);

		// await app.workbench.waitForTab(untitled, true);
		// await app.workbench.selectTab(untitled, true);
		// await app.screenCapturer.capture('Untitled file after reload');
	});
});