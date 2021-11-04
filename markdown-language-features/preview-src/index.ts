/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActiveLineMarker } from './activeLineMarker';
import { onceDocumentLoaded } from './events';
import { createPosterForVsCode } from './messaging';
import { getEditorLineNumberForPageOffset, scrollToRevealSourceLine, getLineElementForFragment } from './scroll-sync';
import { SettingsManager, getData } from './settings';
import throttle = require('lodash.throttle');
import morphdom from 'morphdom';

let scrollDisabledCount = 0;

const marker = new ActiveLineMarker();
const settings = new SettingsManager();

let documentVersion = 0;
let documentResource = settings.settings.source;

const vscode = acquireVsCodeApi();

const originalState = vscode.getState();

const state = {
	...(typeof originalState === 'object' ? originalState : {}),
	...getData<any>('data-state')
};

// Make sure to sync VS Code state here
vscode.setState(state);

const messaging = createPosterForVsCode(vscode, settings);

window.cspAlerter.setPoster(messaging);
window.styleLoadingMonitor.setPoster(messaging);


function doAfterImagesLoaded(cb: () => void) {
	const imgElements = document.getElementsByTagName('img');
	if (imgElements.length > 0) {
		const ps = Array.from(imgElements, e => {
			if (e.complete) {
				return Promise.resolve();
			} else {
				return new Promise<void>((resolve) => {
					e.addEventListener('load', () => resolve());
					e.addEventListener('error', () => resolve());
				});
			}
		});
		Promise.all(ps).then(() => setTimeout(cb, 0));
	} else {
		setTimeout(cb, 0);
	}
}

onceDocumentLoaded(() => {
	const scrollProgress = state.scrollProgress;

	if (typeof scrollProgress === 'number' && !settings.settings.fragment) {
		doAfterImagesLoaded(() => {
			scrollDisabledCount += 1;
			window.scrollTo(0, scrollProgress * document.body.clientHeight);
		});
		return;
	}

	if (settings.settings.scrollPreviewWithEditor) {
		doAfterImagesLoaded(() => {
			// Try to scroll to fragment if available
			if (settings.settings.fragment) {
				state.fragment = undefined;
				vscode.setState(state);

				const element = getLineElementForFragment(settings.settings.fragment, documentVersion);
				if (element) {
					scrollDisabledCount += 1;
					scrollToRevealSourceLine(element.line, documentVersion, settings);
				}
			} else {
				if (!isNaN(settings.settings.line!)) {
					scrollDisabledCount += 1;
					scrollToRevealSourceLine(settings.settings.line!, documentVersion, settings);
				}
			}
		});
	}
});

const onUpdateView = (() => {
	const doScroll = throttle((line: number) => {
		scrollDisabledCount += 1;
		doAfterImagesLoaded(() => scrollToRevealSourceLine(line, documentVersion, settings));
	}, 50);

	return (line: number) => {
		if (!isNaN(line)) {
			state.line = line;

			doScroll(line);
		}
	};
})();

window.addEventListener('resize', () => {
	scrollDisabledCount += 1;
	updateScrollProgress();
}, true);

window.addEventListener('message', async event => {

	switch (event.data.type) {
		case 'onDidChangeTextEditorSelection':
			if (event.data.source === documentResource) {
				marker.onDidChangeTextEditorSelection(event.data.line, documentVersion);
			}
			return;

		case 'updateView':
			if (event.data.source === documentResource) {
				console.log('updateView', event.data.line);
				onUpdateView(event.data.line);
			}
			return;

		case 'updateContent':
			const root = document.querySelector('.markdown-body')!;

			const parser = new DOMParser();
			const newContent = parser.parseFromString(event.data.content, 'text/html');

			if (event.data.source !== documentResource) {
				root.replaceWith(newContent.querySelector('.markdown-body')!);
				documentResource = event.data.source;
			} else {
				const areEqual = (a: Element, b: Element): boolean => {
					if (a.isEqualNode(b)) {
						return true;
					}

					if (a.tagName !== b.tagName || a.textContent !== b.textContent) {
						return false;
					}

					const aChildren = Array.from(a.children);
					const bChildren = Array.from(b.children);

					return aChildren.length === bChildren.length && aChildren.every((x, i) => areEqual(x, bChildren[i]));
				};

				const newRoot = newContent.querySelector('.markdown-body')!;

				// Move styles to head
				// This prevents an ugly flash of unstyled content
				const styles = newRoot.querySelectorAll('link');

				for (const style of styles) {
					style.remove();
				}
				newRoot.prepend(...styles);

				morphdom(root, newRoot, {
					childrenOnly: true,
					onBeforeElUpdated: (fromEl, toEl) => {
						if (areEqual(fromEl, toEl)) {
							fromEl.setAttribute('data-line', toEl.getAttribute('data-line')!);
							return false;
						}

						return true;
					}
				});
			}

			++documentVersion;

			window.dispatchEvent(new CustomEvent('vscode.markdown.updateContent'));
			break;
	}
}, false);



document.addEventListener('dblclick', event => {
	if (!settings.settings.doubleClickToSwitchToEditor) {
		return;
	}

	// Ignore clicks on links
	for (let node = event.target as HTMLElement; node; node = node.parentNode as HTMLElement) {
		if (node.tagName === 'A') {
			return;
		}
	}

	const offset = event.pageY;
	const line = getEditorLineNumberForPageOffset(offset, documentVersion, settings);
	if (typeof line === 'number' && !isNaN(line)) {
		messaging.postMessage('didClick', { line: Math.floor(line) });
	}
});

const passThroughLinkSchemes = ['http:', 'https:', 'mailto:', 'vscode:', 'vscode-insiders:'];

document.addEventListener('click', event => {
	if (!event) {
		return;
	}

	let node: any = event.target;
	while (node) {
		if (node.tagName && node.tagName === 'A' && node.href) {
			if (node.getAttribute('href').startsWith('#')) {
				return;
			}

			let hrefText = node.getAttribute('data-href');
			if (!hrefText) {
				// Pass through known schemes
				if (passThroughLinkSchemes.some(scheme => node.href.startsWith(scheme))) {
					return;
				}
				hrefText = node.getAttribute('href');
			}

			// If original link doesn't look like a url, delegate back to VS Code to resolve
			if (!/^[a-z\-]+:/i.test(hrefText)) {
				messaging.postMessage('openLink', { href: hrefText });
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			return;
		}
		node = node.parentNode;
	}
}, true);

window.addEventListener('scroll', throttle(() => {
	updateScrollProgress();
	console.log('scroll');
	if (scrollDisabledCount > 0) {
		scrollDisabledCount -= 1;
	} else {
		const line = getEditorLineNumberForPageOffset(window.scrollY, documentVersion, settings);
		if (typeof line === 'number' && !isNaN(line)) {
			messaging.postMessage('revealLine', { line });
		}
	}
}, 50));

function updateScrollProgress() {
	state.scrollProgress = window.scrollY / document.body.clientHeight;
	vscode.setState(state);
}

