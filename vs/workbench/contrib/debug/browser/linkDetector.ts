/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import * as osPath from 'vs/base/common/path';
import * as platform from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';

const CONTROL_CODES = '\\u0000-\\u0020\\u007f-\\u009f';
const WEB_LINK_REGEX = new RegExp('(?:[a-zA-Z][a-zA-Z0-9+.-]{2,}:\\/\\/|data:|www\\.)[^\\s' + CONTROL_CODES + '"]{2,}[^\\s' + CONTROL_CODES + '"\')}\\],:;.!?]', 'ug');

const WIN_ABSOLUTE_PATH = /(?:[a-zA-Z]:(?:(?:\\|\/)[\w\.-]*)+)/;
const WIN_RELATIVE_PATH = /(?:(?:\~|\.)(?:(?:\\|\/)[\w\.-]*)+)/;
const WIN_PATH = new RegExp(`(${WIN_ABSOLUTE_PATH.source}|${WIN_RELATIVE_PATH.source})`);
const POSIX_PATH = /((?:\~|\.)?(?:\/[\w\.-]*)+)/;
const LINE_COLUMN = /(?:\:([\d]+))?(?:\:([\d]+))?/;
const PATH_LINK_REGEX = new RegExp(`${platform.isWindows ? WIN_PATH.source : POSIX_PATH.source}${LINE_COLUMN.source}`, 'g');

const MAX_LENGTH = 2000;

type LinkKind = 'web' | 'path' | 'text';
type LinkPart = {
	kind: LinkKind;
	value: string;
	captures: string[];
};

export class LinkDetector {
	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IPathService private readonly pathService: IPathService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService
	) {
		// noop
	}

	/**
	 * Matches and handles web urls, absolute and relative file links in the string provided.
	 * Returns <span/> element that wraps the processed string, where matched links are replaced by <a/>.
	 * 'onclick' event is attached to all anchored links that opens them in the editor.
	 * When splitLines is true, each line of the text, even if it contains no links, is wrapped in a <span>
	 * and added as a child of the returned <span>.
	 */
	linkify(text: string, splitLines?: boolean, workspaceFolder?: IWorkspaceFolder): HTMLElement {
		if (splitLines) {
			const lines = text.split('\n');
			for (let i = 0; i < lines.length - 1; i++) {
				lines[i] = lines[i] + '\n';
			}
			if (!lines[lines.length - 1]) {
				// Remove the last element ('') that split added.
				lines.pop();
			}
			const elements = lines.map(line => this.linkify(line, false, workspaceFolder));
			if (elements.length === 1) {
				// Do not wrap single line with extra span.
				return elements[0];
			}
			const container = document.createElement('span');
			elements.forEach(e => container.appendChild(e));
			return container;
		}

		const container = document.createElement('span');
		for (const part of this.detectLinks(text)) {
			try {
				switch (part.kind) {
					case 'text':
						container.appendChild(document.createTextNode(part.value));
						break;
					case 'web':
						container.appendChild(this.createWebLink(part.value));
						break;
					case 'path':
						const path = part.captures[0];
						const lineNumber = part.captures[1] ? Number(part.captures[1]) : 0;
						const columnNumber = part.captures[2] ? Number(part.captures[2]) : 0;
						container.appendChild(this.createPathLink(part.value, path, lineNumber, columnNumber, workspaceFolder));
						break;
				}
			} catch (e) {
				container.appendChild(document.createTextNode(part.value));
			}
		}
		return container;
	}

	private createWebLink(url: string): Node {
		const link = this.createLink(url);

		this.decorateLink(link, async () => {
			const uri = URI.parse(url);

			if (uri.scheme === Schemas.file) {
				// Just using fsPath here is unsafe: https://github.com/microsoft/vscode/issues/109076
				const fsPath = uri.fsPath;
				const path = await this.pathService.path;
				const fileUrl = osPath.normalize(((path.sep === osPath.posix.sep) && platform.isWindows) ? fsPath.replace(/\\/g, osPath.posix.sep) : fsPath);

				const resolvedLink = await this.fileService.resolve(URI.parse(fileUrl));
				if (!resolvedLink) {
					return;
				}

				await this.editorService.openEditor({ resource: resolvedLink.resource, options: { pinned: true } });
				return;
			}

			this.openerService.open(url, { allowTunneling: !!this.environmentService.remoteAuthority });
		});

		return link;
	}

	private createPathLink(text: string, path: string, lineNumber: number, columnNumber: number, workspaceFolder: IWorkspaceFolder | undefined): Node {
		if (path[0] === '/' && path[1] === '/') {
			// Most likely a url part which did not match, for example ftp://path.
			return document.createTextNode(text);
		}

		const options = { selection: { startLineNumber: lineNumber, startColumn: columnNumber } };
		if (path[0] === '.') {
			if (!workspaceFolder) {
				return document.createTextNode(text);
			}
			const uri = workspaceFolder.toResource(path);
			const link = this.createLink(text);
			this.decorateLink(link, (preserveFocus: boolean) => this.editorService.openEditor({ resource: uri, options: { ...options, preserveFocus } }));
			return link;
		}

		if (path[0] === '~') {
			const userHome = this.pathService.resolvedUserHome;
			if (userHome) {
				path = osPath.join(userHome.fsPath, path.substring(1));
			}
		}

		const link = this.createLink(text);
		link.tabIndex = 0;
		const uri = URI.file(osPath.normalize(path));
		this.fileService.resolve(uri).then(stat => {
			if (stat.isDirectory) {
				return;
			}
			this.decorateLink(link, (preserveFocus: boolean) => this.editorService.openEditor({ resource: uri, options: { ...options, preserveFocus } }));
		}).catch(() => {
			// If the uri can not be resolved we should not spam the console with error, remain quite #86587
		});
		return link;
	}

	private createLink(text: string): HTMLElement {
		const link = document.createElement('a');
		link.textContent = text;
		return link;
	}

	private decorateLink(link: HTMLElement, onClick: (preserveFocus: boolean) => void) {
		link.classList.add('link');
		link.onmousemove = (event) => { link.classList.toggle('pointer', platform.isMacintosh ? event.metaKey : event.ctrlKey); };
		link.onmouseleave = () => link.classList.remove('pointer');
		link.onclick = (event) => {
			const selection = window.getSelection();
			if (!selection || selection.type === 'Range') {
				return; // do not navigate when user is selecting
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			onClick(false);
		};
		link.onkeydown = e => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Enter || event.keyCode === KeyCode.Space) {
				event.preventDefault();
				event.stopPropagation();
				onClick(event.keyCode === KeyCode.Space);
			}
		};
	}

	private detectLinks(text: string): LinkPart[] {
		if (text.length > MAX_LENGTH) {
			return [{ kind: 'text', value: text, captures: [] }];
		}

		const regexes: RegExp[] = [WEB_LINK_REGEX, PATH_LINK_REGEX];
		const kinds: LinkKind[] = ['web', 'path'];
		const result: LinkPart[] = [];

		const splitOne = (text: string, regexIndex: number) => {
			if (regexIndex >= regexes.length) {
				result.push({ value: text, kind: 'text', captures: [] });
				return;
			}
			const regex = regexes[regexIndex];
			let currentIndex = 0;
			let match;
			regex.lastIndex = 0;
			while ((match = regex.exec(text)) !== null) {
				const stringBeforeMatch = text.substring(currentIndex, match.index);
				if (stringBeforeMatch) {
					splitOne(stringBeforeMatch, regexIndex + 1);
				}
				const value = match[0];
				result.push({
					value: value,
					kind: kinds[regexIndex],
					captures: match.slice(1)
				});
				currentIndex = match.index + value.length;
			}
			const stringAfterMatches = text.substring(currentIndex);
			if (stringAfterMatches) {
				splitOne(stringAfterMatches, regexIndex + 1);
			}
		};

		splitOne(text, 0);
		return result;
	}
}
