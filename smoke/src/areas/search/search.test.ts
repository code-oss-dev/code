/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SpectronApplication } from '../../spectron/application';

describe('Search', () => {
	it('searches for body & checks for correct result number', async function () {
		const app = this.app as SpectronApplication;
		await app.workbench.search.openSearchViewlet();
		await app.workbench.search.searchFor('body');

		await app.workbench.search.waitForResultText('7 results in 4 files');
	});

	it('searches only for *.js files & checks for correct result number', async function () {
		const app = this.app as SpectronApplication;
		await app.workbench.search.searchFor('body');
		await app.workbench.search.showQueryDetails();
		await app.workbench.search.setFilesToIncludeText('*.js');
		await app.workbench.search.submitSearch();

		await app.workbench.search.waitForResultText('4 results in 1 file');
		await app.workbench.search.setFilesToIncludeText('');
		await app.workbench.search.hideQueryDetails();
	});

	it('dismisses result & checks for correct result number', async function () {
		const app = this.app as SpectronApplication;
		await app.workbench.search.searchFor('body');
		await app.workbench.search.removeFileMatch(1);
		await app.workbench.search.waitForResultText('3 results in 3 files');
	});

	it('replaces first search result with a replace term', async function () {
		const app = this.app as SpectronApplication;

		await app.workbench.search.searchFor('body');
		await app.workbench.search.expandReplace();
		await app.workbench.search.setReplaceText('ydob');
		await app.workbench.search.replaceFileMatch(1);
		await app.workbench.saveOpenedFile();

		await app.workbench.search.waitForResultText('3 results in 3 files');

		await app.workbench.search.searchFor('ydob');
		await app.workbench.search.setReplaceText('body');
		await app.workbench.search.replaceFileMatch(1);
		await app.workbench.saveOpenedFile();
	});
});