/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

export class NteractRenderer implements vscode.NotebookOutputRenderer {
	private nteractScript: vscode.Uri;

	get preloads(): vscode.Uri[] {
		return [this.nteractScript];
	}

	constructor(
		private _extensionPath: string
	) {
		const scriptPathOnDisk = vscode.Uri.file(
			path.join(this._extensionPath, 'nteract', 'nteract.js')
		);

		this.nteractScript = scriptPathOnDisk.with({ scheme: 'vscode-resource' });
	}

	// @ts-ignore
	render(document: vscode.NotebookDocument, cell: vscode.NotebookCell, output: vscode.CellOutput): string {
		let renderOutputs: string[] = [];
		let data = (output as vscode.CellDisplayOutput).data;

		renderOutputs.push(`
			<script type="application/vnd.nteract.view+json">
				${JSON.stringify(data)}
			</script>
			<script> if (window.nteract) { window.nteract.renderTags(); } </script>
		`);

		return renderOutputs.join('\n');
	}
}