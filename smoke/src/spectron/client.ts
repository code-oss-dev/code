/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from 'spectron';
import { IScreenshot } from '../helpers/screenshot';
import { RawResult, Element } from 'webdriverio';

/**
 * Abstracts the Spectron's WebdriverIO managed client property on the created Application instances.
 */
export class SpectronClient {

	private readonly trials = 50;
	private readonly trialWait = 100; // in milliseconds

	constructor(private spectron: Application, private shot: IScreenshot) {
		// noop
	}

	public windowByIndex(index: number): Promise<any> {
		return this.spectron.client.windowByIndex(index);
	}

	public async keys(keys: string[] | string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.keys(keys);
	}

	public async getText(selector: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.getText(selector);
	}

	public async getHTML(selector: string, capture: boolean = true, accept: (result: string) => boolean = (result: string) => !!result): Promise<any> {
		await this.screenshot();
		return this.wait(this.spectron.client.getHTML, selector, accept, `getHTML with selector ${selector}`);
	}

	public async click(selector: string): Promise<any> {
		await this.screenshot();
		return this.wait(this.spectron.client.click, selector, void 0, `click with selector ${selector}`);
	}

	public async doubleClick(selector: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.wait(this.spectron.client.doubleClick, selector, void 0, `doubleClick with selector ${selector}`);
	}

	public async leftClick(selector: string, xoffset: number, yoffset: number, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.leftClick(selector, xoffset, yoffset);
	}

	public async rightClick(selector: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.rightClick(selector);
	}

	public async moveToObject(selector: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.moveToObject(selector);
	}

	public async setValue(selector: string, text: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.setValue(selector, text);
	}

	public async elements(selector: string, accept: (result: Element[]) => boolean = result => result.length > 0): Promise<any> {
		await this.screenshot(true);
		return this.wait<RawResult<Element[]>>(this.spectron.client.elements, selector, result => accept(result.value), `elements with selector ${selector}`);
	}

	public async element(selector: string, accept: (result: Element | undefined) => boolean = result => !!result): Promise<any> {
		await this.screenshot();
		return this.wait<RawResult<Element>>(this.spectron.client.element, selector, result => accept(result ? result.value : void 0), `element with selector ${selector}`);
	}

	public async elementActive(selector: string, accept: (result: Element | undefined) => boolean = result => !!result): Promise<any> {
		await this.screenshot();
		return this.wait<RawResult<Element>>(this.spectron.client.elementActive, selector, result => accept(result ? result.value : void 0), `elementActive with selector ${selector}`);
	}

	public async dragAndDrop(sourceElem: string, destinationElem: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.dragAndDrop(sourceElem, destinationElem);
	}

	public async selectByValue(selector: string, value: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.selectByValue(selector, value);
	}

	public async getValue(selector: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.getValue(selector);
	}

	public async getAttribute(selector: string, attribute: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return Promise.resolve(this.spectron.client.getAttribute(selector, attribute));
	}

	public clearElement(selector: string): any {
		return this.spectron.client.clearElement(selector);
	}

	public buttonDown(): any {
		return this.spectron.client.buttonDown();
	}

	public buttonUp(): any {
		return this.spectron.client.buttonUp();
	}

	public async isVisible(selector: string, capture: boolean = true): Promise<any> {
		await this.screenshot(capture);
		return this.spectron.client.isVisible(selector);
	}

	public getTitle(): string {
		return this.spectron.client.getTitle();
	}

	private async wait<T>(func: (...args: any[]) => any, args: any, accept: (result: T) => boolean = result => !!result, functionDetails: string): Promise<T> {
		let trial = 1;

		while (true) {
			if (trial > this.trials) {
				return new Promise<T>((res, rej) => rej(`${functionDetails}: Timed out after ${this.trials * this.trialWait} seconds.`));
			}

			let result;
			try {
				result = await func.call(this, args);
			} catch (e) {
			}

			if (accept(result)) {
				return result;
			}

			await new Promise(resolve => setTimeout(resolve, this.trialWait));
			trial++;
		}
	}

	private async screenshot(capture: boolean = true): Promise<any> {
		try {
			await this.shot.capture();
		} catch (e) {
			throw new Error(`Screenshot could not be captured: ${e}`);
		}
	}
}