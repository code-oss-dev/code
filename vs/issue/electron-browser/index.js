/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const electron = require('electron');

const state = {
	issueType: 0
};

const render = (state) => {
	renderIssueType(state);
	renderBlocks(state);
};

const renderIssueType = ({ issueType }) => {
	const issueTypes = document.getElementById('issue-type').children;
	issueTypes[0].className = issueType === 0 ? 'active': '';
	issueTypes[1].className = issueType === 1 ? 'active': '';
	issueTypes[2].className = issueType === 2 ? 'active': '';
};

const renderBlocks = (state) => {
	// Depending on Issue Type, we render different blocks

	const systemBlock = document.querySelector('.block-system');
	const processBlock = document.querySelector('.block-process');
	const workspaceBlock = document.querySelector('.block-workspace');

	// 1 - Bug
	if (state.issueType === 0) {
		show(systemBlock);
		hide(processBlock);
		hide(workspaceBlock);
	}
	// 2 - Perf Issue
	else if (state.issueType === 1) {
		show(systemBlock);
		show(processBlock);
		show(workspaceBlock);
	}
	// 3 - Feature Request
	else {
		show(systemBlock);
		hide(processBlock);
		hide(workspaceBlock);
	}
};

function setup() {
	render(state);

	electron.ipcRenderer.on('issueInfoResponse', (event, arg) => {
		const { systemInfo, processInfo, workspaceInfo } = arg;
		state.systemInfo = systemInfo;
		state.processInfo = processInfo;
		state.workspaceInfo = workspaceInfo;

		updateAllBlocks(state);
	});

	// Initial get info
	electron.ipcRenderer.send('issueInfoRequest');

	// Get newest info every second
	// setInterval(() => {
	// 	electron.ipcRenderer.send('issueInfoRequest');
	// }, 4000);

	const children = Array.from(document.getElementById('issue-type').children);
	children.forEach((child, i) => {
		child.addEventListener('click', () => {
			state.issueType = i;
			render(state);
		});
	});
}
// window.renderExtensionsInfo = () => {
// 	electron.ipcRenderer.on('extensionInfoResponse', (event, arg) => {
// 		document.querySelector('.block-extensions .block-info-table').textContent = arg;
// 	});
// 	electron.ipcRenderer.send('extensionInfoRequest');
// };

/**
 * GitHub issue generation
 */

window.submit = () => {
	document.getElementById('github-submit-btn').classList.add('active');
	const issueTitle = document.querySelector('#issue-title input').value;
	const baseUrl = `https://github.com/microsoft/vscode/issues/new?title=${issueTitle}&body=`;
	const description = document.querySelector('.block-description .block-info-text textarea').value;

	let issueBody = '';

	issueBody += `
### Issue Type
`;

	if (state.issueType === 0) {
		issueBody += 'Bug\n';
	} else if (state.issueType === 1) {
		issueBody += 'Performance Issue\n';
	} else {
		issueBody += 'Feature Request';
	}

	issueBody += `
### Description

${description}
`;

	issueBody += `
### VS Code Info
`;

	issueBody += `<details>
<summary>System Info</summary>

${generateSystemInfoMd()}

</details>
`;

	// For perf issue, add process info and workspace info too
	if (state.issueType === 1) {

		issueBody += `<details>
<summary>Process Info</summary>

${generateProcessInfoMd()}

</details>
`;

		issueBody += `<details>
<summary>Workspace Info</summary>

\`\`\`
${state.workspaceInfo};
\`\`\`

</details>
`;
	}

	issueBody += '\n<!-- Generated by VS Code Issue Helper -->\n';

	electron.shell.openExternal(baseUrl + encodeURIComponent(issueBody));
};

function generateSystemInfoMd() {
	let md = `
|Item|Value|
|---|---|`;

	Object.keys(state.systemInfo).forEach(k => {
		md += `|${k}|${state.systemInfo[k]}|\n`;
	});

	return md;
}
function generateProcessInfoMd() {
	let md = `
|pid|CPU|Memory (MB)|Name|
|---|---|---|---|
`;

	state.processInfo.forEach(p => {
		md += `|${p.pid}|${p.cpu}|${p.memory}|${p.name}|\n`;
	});

	return md;
}

/**
 * Update blocks
 */

function updateAllBlocks(state) {
	updateSystemInfo(state);
	updateProcessInfo(state);
	updateWorkspaceInfo(state);
}

const updateSystemInfo = (state) => {
	const target = document.querySelector('.block-system .block-info');
	let tableHtml = '';
	Object.keys(state.systemInfo).forEach(k => {
		tableHtml += `
<tr>
	<td>${k}</td>
	<td>${state.systemInfo[k]}</td>
</tr>`;
	});
	target.innerHTML = `<table>${tableHtml}</table>`;
};
const updateProcessInfo = (state) => {
	const target = document.querySelector('.block-process .block-info');

	let tableHtml = `
<tr>
	<th>pid</th>
	<th>CPU %</th>
	<th>Memory (MB)</th>
	<th>Name</th>
</tr>
`;
	state.processInfo.forEach(p => {
		tableHtml += `
<tr>
	<td>${p.pid}</td>
	<td>${p.cpu}</td>
	<td>${p.memory}</td>
	<td>${p.name}</td>
</tr>`;
	});
	target.innerHTML = `<table>${tableHtml}</table>`;
};
const updateWorkspaceInfo = (state) => {
	document.querySelector('.block-workspace .block-info code').textContent = '\n' + state.workspaceInfo;
};

// helper functions

function hide(el) {
	el.classList.add('hidden');
}
function show(el) {
	el.classList.remove('hidden');
}

// go

setup();
