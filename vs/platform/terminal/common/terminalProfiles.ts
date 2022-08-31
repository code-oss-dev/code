/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { URI, UriComponents } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IExtensionTerminalProfile, ITerminalProfile, TerminalIcon } from 'vs/platform/terminal/common/terminal';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';

export function createProfileSchemaEnums(detectedProfiles: ITerminalProfile[], extensionProfiles?: readonly IExtensionTerminalProfile[]): {
	values: (string | null)[] | undefined;
	markdownDescriptions: string[] | undefined;
} {
	const result: { name: string | null; description: string }[] = [{
		name: null,
		description: localize('terminalAutomaticProfile', 'Automatically detect the default')
	}];
	result.push(...detectedProfiles.map(e => {
		return {
			name: e.profileName,
			description: createProfileDescription(e)
		};
	}));
	if (extensionProfiles) {
		result.push(...extensionProfiles.map(extensionProfile => {
			return {
				name: extensionProfile.title,
				description: createExtensionProfileDescription(extensionProfile)
			};
		}));
	}
	return {
		values: result.map(e => e.name),
		markdownDescriptions: result.map(e => e.description)
	};
}

function createProfileDescription(profile: ITerminalProfile): string {
	let description = `$(${ThemeIcon.isThemeIcon(profile.icon) ? profile.icon.id : profile.icon ? profile.icon : Codicon.terminal.id}) ${profile.profileName}\n- path: ${profile.path}`;
	if (profile.args) {
		if (typeof profile.args === 'string') {
			description += `\n- args: "${profile.args}"`;
		} else {
			description += `\n- args: [${profile.args.length === 0 ? '' : `'${profile.args.join(`','`)}'`}]`;
		}
	}
	if (profile.overrideName !== undefined) {
		description += `\n- overrideName: ${profile.overrideName}`;
	}
	if (profile.color) {
		description += `\n- color: ${profile.color}`;
	}
	if (profile.env) {
		description += `\n- env: ${JSON.stringify(profile.env)}`;
	}
	return description;
}

function createExtensionProfileDescription(profile: IExtensionTerminalProfile): string {
	const description = `$(${ThemeIcon.isThemeIcon(profile.icon) ? profile.icon.id : profile.icon ? profile.icon : Codicon.terminal.id}) ${profile.title}\n- extensionIdentifier: ${profile.extensionIdentifier}`;
	return description;
}


export function terminalProfileArgsMatch(args1: string | string[] | undefined, args2: string | string[] | undefined): boolean {
	if (!args1 && !args2) {
		return true;
	} else if (typeof args1 === 'string' && typeof args2 === 'string') {
		return args1 === args2;
	} else if (Array.isArray(args1) && Array.isArray(args2)) {
		if (args1.length !== args2.length) {
			return false;
		}
		for (let i = 0; i < args1.length; i++) {
			if (args1[i] !== args2[i]) {
				return false;
			}
		}
		return true;
	}
	return false;
}

export function terminalIconsEqual(a?: TerminalIcon, b?: TerminalIcon): boolean {
	if (!a && !b) {
		return true;
	} else if (!a || !b) {
		return false;
	}

	if (ThemeIcon.isThemeIcon(a) && ThemeIcon.isThemeIcon(b)) {
		return a.id === b.id && a.color === b.color;
	}
	if (typeof a === 'object' && 'light' in a && 'dark' in a
		&& typeof b === 'object' && 'light' in b && 'dark' in b) {
		const castedIcon = (a as { light: unknown; dark: unknown });
		const castedIconTwo = (b as { light: unknown; dark: unknown });
		if ((URI.isUri(castedIcon.light) || isUriComponents(castedIcon.light)) && (URI.isUri(castedIcon.dark) || isUriComponents(castedIcon.dark))
			&& (URI.isUri(castedIconTwo.light) || isUriComponents(castedIconTwo.light)) && (URI.isUri(castedIconTwo.dark) || isUriComponents(castedIconTwo.dark))) {
			return castedIcon.light.path === castedIconTwo.light.path && castedIcon.dark.path === castedIconTwo.dark.path;
		}
	}
	if ((URI.isUri(a) && URI.isUri(b)) || (isUriComponents(a) || isUriComponents(b))) {
		const castedIcon = (a as { scheme: unknown; path: unknown });
		const castedIconTwo = (b as { scheme: unknown; path: unknown });
		return castedIcon.path === castedIconTwo.path && castedIcon.scheme === castedIconTwo.scheme;
	}

	return false;
}


export function isUriComponents(thing: unknown): thing is UriComponents {
	if (!thing) {
		return false;
	}
	return typeof (<any>thing).path === 'string' &&
		typeof (<any>thing).scheme === 'string';
}
