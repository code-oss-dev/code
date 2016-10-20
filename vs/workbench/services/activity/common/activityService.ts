/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export interface IBadge {
	getDescription(): string;
}

export class BaseBadge implements IBadge {
	public descriptorFn: (args: any) => string;

	constructor(descriptorFn: (args: any) => string) {
		this.descriptorFn = descriptorFn;
	}

	/* protected */ public getDescription(): string {
		return this.descriptorFn(null);
	}
}

export class NumberBadge extends BaseBadge {
	public number: number;

	constructor(number: number, descriptorFn: (args: any) => string) {
		super(descriptorFn);

		this.number = number;
	}

	/* protected */ public getDescription(): string {
		return this.descriptorFn(this.number);
	}
}

export class TextBadge extends BaseBadge {
	public text: string;

	constructor(text: string, descriptorFn: (args: any) => string) {
		super(descriptorFn);

		this.text = text;
	}
}

export class IconBadge extends BaseBadge {

	constructor(descriptorFn: (args: any) => string) {
		super(descriptorFn);
	}
}

export class ProgressBadge extends BaseBadge {
}

export const IActivityService = createDecorator<IActivityService>('activityService');

export interface IActivityService {
	_serviceBrand: any;

	/**
	 * Show activity in the activitybar for the given viewlet or panel.
	 */
	showActivity(compositeId: string, badge: IBadge, clazz?: string): void;

	/**
	 * Clears activity shown in the activitybar for the given viewlet or panel.
	 */
	clearActivity(compositeId: string): void;

	/**
	 * Get all registered viewlets and whether they are enabled/disabled.
	 */
	getRegisteredViewletsIsEnabled(): { [viewletId: string]: boolean };

	/**
	 * Enable/disable viewlet.
	 */
	toggleViewlet(viewletId: string): void;

	/**
	 * Get the external viewlet id that is about to open.
	 */
	getExternalViewletIdToOpen(): string;
}