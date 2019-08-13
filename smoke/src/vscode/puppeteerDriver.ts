/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as puppeteer from 'puppeteer';
import { ChildProcess, spawn } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdir } from 'fs';
import { promisify } from 'util';

const width = 1200;
const height = 800;

const vscodeToPuppeteerKey = {
	cmd: 'Meta',
	ctrl: 'Control',
	shift: 'Shift',
	enter: 'Enter',
	escape: 'Escape',
	right: 'ArrowRight',
	up: 'ArrowUp',
	down: 'ArrowDown',
	left: 'ArrowLeft',
	home: 'Home'
};

function buildDriver(browser: puppeteer.Browser, page: puppeteer.Page): IDriver {
	return {
		_serviceBrand: undefined,
		getWindowIds: () => {
			return Promise.resolve([1]);
		},
		capturePage: () => Promise.resolve(''),
		reloadWindow: (windowId) => Promise.resolve(),
		exitApplication: () => browser.close(),
		dispatchKeybinding: async (windowId, keybinding) => {
			const chords = keybinding.split(' ');
			chords.forEach(async (chord, index) => {
				if (index > 0) {
					await timeout(100);
				}
				const keys = chord.split('+');
				const keysDown: string[] = [];
				for (let i = 0; i < keys.length; i++) {
					if (keys[i] in vscodeToPuppeteerKey) {
						keys[i] = vscodeToPuppeteerKey[keys[i]];
					}
					await page.keyboard.down(keys[i]);
					keysDown.push(keys[i]);
				}
				while (keysDown.length > 0) {
					await page.keyboard.up(keysDown.pop()!);
				}
			});

			await timeout(100);
		},
		click: async (windowId, selector, xoffset, yoffset) => {
			const { x, y } = await page.evaluate(`
				(function() {
					function convertToPixels(element, value) {
						return parseFloat(value) || 0;
					}
					function getDimension(element, cssPropertyName, jsPropertyName) {
						let computedStyle = getComputedStyle(element);
						let value = '0';
						if (computedStyle) {
							if (computedStyle.getPropertyValue) {
								value = computedStyle.getPropertyValue(cssPropertyName);
							} else {
								// IE8
								value = (computedStyle).getAttribute(jsPropertyName);
							}
						}
						return convertToPixels(element, value);
					}
					function getBorderLeftWidth(element) {
						return getDimension(element, 'border-left-width', 'borderLeftWidth');
					}
					function getBorderRightWidth(element) {
						return getDimension(element, 'border-right-width', 'borderRightWidth');
					}
					function getBorderTopWidth(element) {
						return getDimension(element, 'border-top-width', 'borderTopWidth');
					}
					function getBorderBottomWidth(element) {
						return getDimension(element, 'border-bottom-width', 'borderBottomWidth');
					}
					function getClientArea(element) {
						// Try with DOM clientWidth / clientHeight
						if (element !== document.body) {
							return { width: element.clientWidth, height: element.clientHeight };
						}

						// Try innerWidth / innerHeight
						if (window.innerWidth && window.innerHeight) {
							return { width: window.innerWidth, height: window.innerHeight };
						}

						// Try with document.body.clientWidth / document.body.clientHeight
						if (document.body && document.body.clientWidth && document.body.clientHeight) {
							return { width: document.body.clientWidth, height: document.body.clientHeight };
						}

						// Try with document.documentElement.clientWidth / document.documentElement.clientHeight
						if (document.documentElement && document.documentElement.clientWidth && document.documentElement.clientHeight) {
							return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
						}

						throw new Error('Unable to figure out browser width and height');
					}
					function getTopLeftOffset(element) {
						// Adapted from WinJS.Utilities.getPosition
						// and added borders to the mix

						let offsetParent = element.offsetParent, top = element.offsetTop, left = element.offsetLeft;

						while ((element = element.parentNode) !== null && element !== document.body && element !== document.documentElement) {
							top -= element.scrollTop;
							let c = getComputedStyle(element);
							if (c) {
								left -= c.direction !== 'rtl' ? element.scrollLeft : -element.scrollLeft;
							}

							if (element === offsetParent) {
								left += getBorderLeftWidth(element);
								top += getBorderTopWidth(element);
								top += element.offsetTop;
								left += element.offsetLeft;
								offsetParent = element.offsetParent;
							}
						}

						return {
							left: left,
							top: top
						};
					}
					const element = document.querySelector('${selector}');

					if (!element) {
						throw new Error('Element not found: ${selector}');
					}

					const { left, top } = getTopLeftOffset(element);
					const { width, height } = getClientArea(element);
					let x, y;

					x = left + (width / 2);
					y = top + (height / 2);

					x = Math.round(x);
					y = Math.round(y);

					return { x, y };
				})();
			`);
			await page.mouse.click(x + (xoffset ? xoffset : 0), y + (yoffset ? yoffset : 0));
		},
		doubleClick: async (windowId, selector) => {
			await this.click(windowId, selector, 0, 0);
			await timeout(60);
			await this.click(windowId, selector, 0, 0);
			await timeout(100);
		},
		setValue: async (windowId, selector, text) => page.evaluate(`window.driver.setValue('${selector}', '${text}')`),
		getTitle: (windowId) => page.evaluate(`window.driver.getTitle()`),
		isActiveElement: (windowId, selector) => page.evaluate(`window.driver.isActiveElement('${selector}')`),
		getElements: (windowId, selector, recursive) => page.evaluate(`window.driver.getElements('${selector}', ${recursive})`),
		typeInEditor: (windowId, selector, text) => page.evaluate(`window.driver.typeInEditor('${selector}', '${text}')`),
		getTerminalBuffer: (windowId, selector) => page.evaluate(`window.driver.getTerminalBuffer('${selector}')`),
		writeInTerminal: (windowId, selector, text) => page.evaluate(`window.driver.writeInTerminal('${selector}', '${text}')`)
	};
}

function timeout(ms: number): Promise<void> {
	return new Promise<void>(r => setTimeout(r, ms));
}

// function runInDriver(call: string, args: (string | boolean)[]): Promise<any> {}

let args;
let server: ChildProcess | undefined;
let endpoint: string | undefined;

export async function launch(_args): Promise<void> {
	args = _args;

	// TODO: Don't open up the system browser
	const webUserDataDir = join(tmpdir(), `smoketest-${Math.random() * 10000000000}`);
	await promisify(mkdir)(webUserDataDir);
	server = spawn(join(args[0], 'resources/server/web.sh'), ['--driver', 'web', '--web-user-data-dir', webUserDataDir]);
	server.stderr.on('data', e => console.log('Server error: ' + e));
	process.on('exit', teardown);
	endpoint = await waitForEndpoint();
}

function teardown(): void {
	if (server) {
		server.kill();
		server = undefined;
	}
}

function waitForEndpoint(): Promise<string> {
	return new Promise<string>(r => {
		server!.stdout.on('data', d => {
			const matches = d.toString('ascii').match(/Web UI available at (.+)/);
			if (matches !== null) {
				r(matches[1]);
			}
		});
	});
}

export function connect(headless: boolean, outPath: string, handle: string): Promise<{ client: IDisposable, driver: IDriver }> {
	return new Promise(async (c) => {
		const browser = await puppeteer.launch({
			// Run in Edge dev on macOS
			// executablePath: '/Applications/Microsoft\ Edge\ Dev.app/Contents/MacOS/Microsoft\ Edge\ Dev',
			headless,
			slowMo: 80,
			args: [`--window-size=${width},${height}`]
		});
		const page = (await browser.pages())[0];
		await page.setViewport({ width, height });
		const endpointSplit = endpoint!.split('#');
		await page.goto(`${endpointSplit[0]}?folder=${args[1]}#${endpointSplit[1]}`);
		const result = {
			client: { dispose: () => teardown },
			driver: buildDriver(browser, page)
		};
		c(result);
	});
}

/**
 * Thenable is a common denominator between ES6 promises, Q, jquery.Deferred, WinJS.Promise,
 * and others. This API makes no assumption about what promise library is being used which
 * enables reusing existing code without migrating to a specific promise implementation. Still,
 * we recommend the use of native promises which are available in this editor.
 */
export interface Thenable<T> {
	/**
	* Attaches callbacks for the resolution and/or rejection of the Promise.
	* @param onfulfilled The callback to execute when the Promise is resolved.
	* @param onrejected The callback to execute when the Promise is rejected.
	* @returns A Promise for the completion of which ever callback is executed.
	*/
	then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>;
	then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>;
}

export interface IElement {
	tagName: string;
	className: string;
	textContent: string;
	attributes: { [name: string]: string; };
	children: IElement[];
	top: number;
	left: number;
}

export interface IDriver {
	_serviceBrand: any;

	getWindowIds(): Promise<number[]>;
	capturePage(windowId: number): Promise<string>;
	reloadWindow(windowId: number): Promise<void>;
	exitApplication(): Promise<void>;
	dispatchKeybinding(windowId: number, keybinding: string): Promise<void>;
	click(windowId: number, selector: string, xoffset?: number | undefined, yoffset?: number | undefined): Promise<void>;
	doubleClick(windowId: number, selector: string): Promise<void>;
	setValue(windowId: number, selector: string, text: string): Promise<void>;
	getTitle(windowId: number): Promise<string>;
	isActiveElement(windowId: number, selector: string): Promise<boolean>;
	getElements(windowId: number, selector: string, recursive?: boolean): Promise<IElement[]>;
	typeInEditor(windowId: number, selector: string, text: string): Promise<void>;
	getTerminalBuffer(windowId: number, selector: string): Promise<string[]>;
	writeInTerminal(windowId: number, selector: string, text: string): Promise<void>;
}

export interface IDisposable {
	dispose(): void;
}
