/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventType } from 'vs/base/browser/dom';
import { IMarkdownString, MarkdownString } from 'vs/base/common/htmlContent';
import { DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { posix, win32 } from 'vs/base/common/path';
import { isMacintosh, OperatingSystem, OS } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { ITunnelService } from 'vs/platform/tunnel/common/tunnel';
import { ITerminalLinkDetector, ITerminalLinkOpener, ITerminalSimpleLink, TerminalBuiltinLinkType, TerminalLinkType } from 'vs/workbench/contrib/terminal/browser/links/links';
import { TerminalLink } from 'vs/workbench/contrib/terminal/browser/links/terminalLink';
import { TerminalExternalLinkDetector } from 'vs/workbench/contrib/terminal/browser/links/terminalExternalLinkDetector';
import { TerminalLinkDetectorAdapter } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkDetectorAdapter';
import { TerminalLocalFileLinkOpener, TerminalLocalFolderInWorkspaceLinkOpener, TerminalLocalFolderOutsideWorkspaceLinkOpener, TerminalSearchLinkOpener, TerminalUrlLinkOpener } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkOpeners';
import { TerminalLocalLinkDetector } from 'vs/workbench/contrib/terminal/browser/links/terminalLocalLinkDetector';
import { TerminalUriLinkDetector } from 'vs/workbench/contrib/terminal/browser/links/terminalUriLinkDetector';
import { lineAndColumnClause, lineAndColumnClauseGroupCount, unixLineAndColumnMatchIndex, unixLocalLinkClause, winDrivePrefix, winLineAndColumnMatchIndex, winLocalLinkClause } from 'vs/workbench/contrib/terminal/browser/links/terminalValidatedLocalLinkProvider';
import { TerminalWordLinkDetector } from 'vs/workbench/contrib/terminal/browser/links/terminalWordLinkDetector';
import { ITerminalExternalLinkProvider, ITerminalInstance, TerminalLinkQuickPickEvent } from 'vs/workbench/contrib/terminal/browser/terminal';
import { ILinkHoverTargetOptions, TerminalHover } from 'vs/workbench/contrib/terminal/browser/widgets/terminalHoverWidget';
import { TerminalWidgetManager } from 'vs/workbench/contrib/terminal/browser/widgets/widgetManager';
import { IXtermCore } from 'vs/workbench/contrib/terminal/browser/xterm-private';
import { ITerminalCapabilityStore, TerminalCapability } from 'vs/workbench/contrib/terminal/common/capabilities/capabilities';
import { ITerminalConfiguration, ITerminalProcessManager, TERMINAL_CONFIG_SECTION } from 'vs/workbench/contrib/terminal/common/terminal';
import type { ILink, ILinkProvider, IViewportRange, Terminal } from 'xterm';

export type XtermLinkMatcherHandler = (event: MouseEvent | undefined, link: string) => Promise<void>;
export type XtermLinkMatcherValidationCallback = (uri: string, callback: (isValid: boolean) => void) => void;

interface IPath {
	join(...paths: string[]): string;
	normalize(path: string): string;
	sep: '\\' | '/';
}

/**
 * An object responsible for managing registration of link matchers and link providers.
 */
export class TerminalLinkManager extends DisposableStore {
	private _widgetManager: TerminalWidgetManager | undefined;
	private _processCwd: string | undefined;
	private readonly _standardLinkProviders: Map<string, ILinkProvider> = new Map();
	private readonly _linkProvidersDisposables: IDisposable[] = [];
	private readonly _openers: Map<TerminalLinkType, ITerminalLinkOpener> = new Map();

	constructor(
		private readonly _xterm: Terminal,
		private readonly _processManager: ITerminalProcessManager,
		capabilities: ITerminalCapabilityStore,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@ITunnelService private readonly _tunnelService: ITunnelService
	) {
		super();

		// Setup link detectors in their order of priority
		this._setupLinkDetector(TerminalUriLinkDetector.id, this._instantiationService.createInstance(TerminalUriLinkDetector, this._xterm, this._resolvePath.bind(this)));
		if (this._configurationService.getValue<ITerminalConfiguration>(TERMINAL_CONFIG_SECTION).enableFileLinks) {
			this._setupLinkDetector(TerminalLocalLinkDetector.id, this._instantiationService.createInstance(TerminalLocalLinkDetector, this._xterm, this._processManager.os || OS, this._resolvePath.bind(this)));
		}
		this._setupLinkDetector(TerminalWordLinkDetector.id, this._instantiationService.createInstance(TerminalWordLinkDetector, this._xterm));

		capabilities.get(TerminalCapability.CwdDetection)?.onDidChangeCwd(cwd => {
			this.processCwd = cwd;
		});

		// Setup link openers
		this._openers.set(TerminalBuiltinLinkType.LocalFile, this._instantiationService.createInstance(TerminalLocalFileLinkOpener, this._processManager.os || OS));
		this._openers.set(TerminalBuiltinLinkType.LocalFolderInWorkspace, this._instantiationService.createInstance(TerminalLocalFolderInWorkspaceLinkOpener));
		this._openers.set(TerminalBuiltinLinkType.LocalFolderOutsideWorkspace, this._instantiationService.createInstance(TerminalLocalFolderOutsideWorkspaceLinkOpener));
		this._openers.set(TerminalBuiltinLinkType.Search, this._instantiationService.createInstance(TerminalSearchLinkOpener, capabilities));
		this._openers.set(TerminalBuiltinLinkType.Url, this._instantiationService.createInstance(TerminalUrlLinkOpener, !!this._processManager.remoteAuthority));

		// TODO: Verify external link providers work

		this._registerStandardLinkProviders();
	}

	private _setupLinkDetector(id: string, detector: ITerminalLinkDetector, isExternal: boolean = false): ILinkProvider {
		const detectorAdapter = this._instantiationService.createInstance(TerminalLinkDetectorAdapter, detector);
		detectorAdapter.onDidActivateLink(e => {
			// Prevent default electron link handling so Alt+Click mode works normally
			e.event?.preventDefault();
			// Require correct modifier on click unless event is coming from linkQuickPick selection
			if (e.event && !(e.event instanceof TerminalLinkQuickPickEvent) && !this._isLinkActivationModifierDown(e.event)) {
				return;
			}
			// Just call the handler if there is no before listener
			this._openLink(e.link);
		});
		detectorAdapter.onDidShowHover(e => this._tooltipCallback(e.link, e.viewportRange, e.modifierDownCallback, e.modifierUpCallback));
		if (!isExternal) {
			this._standardLinkProviders.set(id, detectorAdapter);
		}
		return detectorAdapter;
	}

	private async _openLink(link: ITerminalSimpleLink): Promise<void> {
		this._logService.debug('Opening link', link);
		const opener = this._openers.get(link.type);
		if (!opener) {
			throw new Error(`No matching opener for link type "${link.type}"`);
		}
		await opener.open(link);
	}

	async openRecentLink(type: 'file' | 'web'): Promise<ILink | undefined> {
		let links;
		let i = this._xterm.buffer.active.length;
		while ((!links || links.length === 0) && i >= this._xterm.buffer.active.viewportY) {
			links = await this._getLinksForType(i, type);
			i--;
		}

		if (!links || links.length < 1) {
			return undefined;
		}
		const event = new TerminalLinkQuickPickEvent(EventType.CLICK);
		links[0].activate(event, links[0].text);
		return links[0];
	}

	async getLinks(): Promise<IDetectedLinks> {
		const wordResults: ILink[] = [];
		const webResults: ILink[] = [];
		const fileResults: ILink[] = [];

		for (let i = this._xterm.buffer.active.length - 1; i >= this._xterm.buffer.active.viewportY; i--) {
			const links = await this._getLinksForLine(i);
			if (links) {
				const { wordLinks, webLinks, fileLinks } = links;
				if (wordLinks && wordLinks.length) {
					wordResults.push(...wordLinks.reverse());
				}
				if (webLinks && webLinks.length) {
					webResults.push(...webLinks.reverse());
				}
				if (fileLinks && fileLinks.length) {
					fileResults.push(...fileLinks.reverse());
				}
			}
		}
		return { webLinks: webResults, fileLinks: fileResults, wordLinks: wordResults };
	}

	private async _getLinksForLine(y: number): Promise<IDetectedLinks | undefined> {
		let unfilteredWordLinks = await this._getLinksForType(y, 'word');
		const webLinks = await this._getLinksForType(y, 'web');
		const fileLinks = await this._getLinksForType(y, 'file');
		const words = new Set();
		let wordLinks;
		if (unfilteredWordLinks) {
			wordLinks = [];
			for (const link of unfilteredWordLinks) {
				if (!words.has(link.text) && link.text.length > 1) {
					wordLinks.push(link);
					words.add(link.text);
				}
			}
		}
		return { wordLinks, webLinks, fileLinks };
	}

	// TODO: Convert to use ITerminalSimpleLink
	protected async _getLinksForType(y: number, type: 'word' | 'web' | 'file'): Promise<ILink[] | undefined> {
		switch (type) {
			case 'word':
				return (await new Promise<ILink[] | undefined>(r => this._standardLinkProviders.get(TerminalWordLinkDetector.id)?.provideLinks(y, r)));
			case 'web':
				return (await new Promise<ILink[] | undefined>(r => this._standardLinkProviders.get(TerminalUriLinkDetector.id)?.provideLinks(y, r)));
			case 'file':
				return (await new Promise<ILink[] | undefined>(r => this._standardLinkProviders.get(TerminalLocalLinkDetector.id)?.provideLinks(y, r)));
		}
	}

	private _tooltipCallback(link: TerminalLink, viewportRange: IViewportRange, modifierDownCallback?: () => void, modifierUpCallback?: () => void) {
		if (!this._widgetManager) {
			return;
		}

		const core = (this._xterm as any)._core as IXtermCore;
		const cellDimensions = {
			width: core._renderService.dimensions.actualCellWidth,
			height: core._renderService.dimensions.actualCellHeight
		};
		const terminalDimensions = {
			width: this._xterm.cols,
			height: this._xterm.rows
		};

		// Don't pass the mouse event as this avoids the modifier check
		this._showHover({
			viewportRange,
			cellDimensions,
			terminalDimensions,
			modifierDownCallback,
			modifierUpCallback
		}, this._getLinkHoverString(link.text, link.label), (text) => link.activate(undefined, text), link);
	}

	private _showHover(
		targetOptions: ILinkHoverTargetOptions,
		text: IMarkdownString,
		linkHandler: (url: string) => void,
		link?: TerminalLink
	) {
		if (this._widgetManager) {
			const widget = this._instantiationService.createInstance(TerminalHover, targetOptions, text, linkHandler);
			const attached = this._widgetManager.attachWidget(widget);
			if (attached) {
				link?.onInvalidated(() => attached.dispose());
			}
		}
	}

	setWidgetManager(widgetManager: TerminalWidgetManager): void {
		this._widgetManager = widgetManager;
	}

	set processCwd(processCwd: string) {
		this._processCwd = processCwd;
	}

	private _clearLinkProviders(): void {
		dispose(this._linkProvidersDisposables);
		this._linkProvidersDisposables.length = 0;
	}

	private _registerStandardLinkProviders(): void {
		for (const p of this._standardLinkProviders.values()) {
			this._linkProvidersDisposables.push(this._xterm.registerLinkProvider(p));
		}
	}

	registerExternalLinkProvider(instance: ITerminalInstance, linkProvider: ITerminalExternalLinkProvider): IDisposable {
		// Clear and re-register the standard link providers so they are a lower priority than the new one
		this._clearLinkProviders();
		// TODO: Support multiple extensions
		const wrappedLinkProvider = this._setupLinkDetector('extension', new TerminalExternalLinkDetector('extension', this._xterm, instance, linkProvider), true);
		const newLinkProvider = this._xterm.registerLinkProvider(wrappedLinkProvider);
		this._linkProvidersDisposables.push(newLinkProvider);
		this._registerStandardLinkProviders();
		return newLinkProvider;
	}

	protected get _localLinkRegex(): RegExp {
		if (!this._processManager) {
			throw new Error('Process manager is required');
		}
		const baseLocalLinkClause = this._processManager.os === OperatingSystem.Windows ? winLocalLinkClause : unixLocalLinkClause;
		// Append line and column number regex
		return new RegExp(`${baseLocalLinkClause}(${lineAndColumnClause})`);
	}

	protected _isLinkActivationModifierDown(event: MouseEvent): boolean {
		const editorConf = this._configurationService.getValue<{ multiCursorModifier: 'ctrlCmd' | 'alt' }>('editor');
		if (editorConf.multiCursorModifier === 'ctrlCmd') {
			return !!event.altKey;
		}
		return isMacintosh ? event.metaKey : event.ctrlKey;
	}

	private _getLinkHoverString(uri: string, label: string | undefined): IMarkdownString {
		const editorConf = this._configurationService.getValue<{ multiCursorModifier: 'ctrlCmd' | 'alt' }>('editor');

		let clickLabel = '';
		if (editorConf.multiCursorModifier === 'ctrlCmd') {
			if (isMacintosh) {
				clickLabel = nls.localize('terminalLinkHandler.followLinkAlt.mac', "option + click");
			} else {
				clickLabel = nls.localize('terminalLinkHandler.followLinkAlt', "alt + click");
			}
		} else {
			if (isMacintosh) {
				clickLabel = nls.localize('terminalLinkHandler.followLinkCmd', "cmd + click");
			} else {
				clickLabel = nls.localize('terminalLinkHandler.followLinkCtrl', "ctrl + click");
			}
		}

		let fallbackLabel: string;
		if (this._tunnelService.canTunnel(URI.parse(uri))) {
			fallbackLabel = nls.localize('followForwardedLink', "Follow link using forwarded port");
		} else {
			fallbackLabel = nls.localize('followLink', "Follow link");
		}

		const markdown = new MarkdownString('', true);
		// Escapes markdown in label & uri
		if (label) {
			label = markdown.appendText(label).value;
			markdown.value = '';
		}
		if (uri) {
			uri = markdown.appendText(uri).value;
			markdown.value = '';
		}

		label = label || fallbackLabel;
		// Use the label when uri is '' so the link displays correctly
		uri = uri || label;
		// Although if there is a space in the uri, just replace it completely
		if (/(\s|&nbsp;)/.test(uri)) {
			uri = nls.localize('followLinkUrl', 'Link');
		}

		return markdown.appendMarkdown(`[${label}](${uri}) (${clickLabel})`);
	}

	private get _osPath(): IPath {
		if (!this._processManager) {
			throw new Error('Process manager is required');
		}
		if (this._processManager.os === OperatingSystem.Windows) {
			return win32;
		}
		return posix;
	}

	protected _preprocessPath(link: string): string | null {
		if (!this._processManager) {
			throw new Error('Process manager is required');
		}
		if (link.charAt(0) === '~') {
			// Resolve ~ -> userHome
			if (!this._processManager.userHome) {
				return null;
			}
			link = this._osPath.join(this._processManager.userHome, link.substring(1));
		} else if (link.charAt(0) !== '/' && link.charAt(0) !== '~') {
			// Resolve workspace path . | .. | <relative_path> -> <path>/. | <path>/.. | <path>/<relative_path>
			if (this._processManager.os === OperatingSystem.Windows) {
				if (!link.match('^' + winDrivePrefix) && !link.startsWith('\\\\?\\')) {
					if (!this._processCwd) {
						// Abort if no workspace is open
						return null;
					}
					link = this._osPath.join(this._processCwd, link);
				} else {
					// Remove \\?\ from paths so that they share the same underlying
					// uri and don't open multiple tabs for the same file
					link = link.replace(/^\\\\\?\\/, '');
				}
			} else {
				if (!this._processCwd) {
					// Abort if no workspace is open
					return null;
				}
				link = this._osPath.join(this._processCwd, link);
			}
		}
		link = this._osPath.normalize(link);

		return link;
	}

	private async _resolvePath(link: string, uri?: URI): Promise<{ uri: URI, link: string, isDirectory: boolean } | undefined> {
		if (!this._processManager) {
			throw new Error('Process manager is required');
		}

		if (uri) {
			try {
				const stat = await this._fileService.resolve(uri);
				return { uri, link, isDirectory: stat.isDirectory };
			}
			catch (e) {
				// Does not exist
				return undefined;
			}
		}

		const preprocessedLink = this._preprocessPath(link);
		if (!preprocessedLink) {
			return undefined;
		}

		const linkUrl = this.extractLinkUrl(preprocessedLink);
		if (!linkUrl) {
			return undefined;
		}

		try {
			let uri: URI;
			if (this._processManager.remoteAuthority) {
				uri = URI.from({
					scheme: Schemas.vscodeRemote,
					authority: this._processManager.remoteAuthority,
					path: linkUrl
				});
			} else {
				uri = URI.file(linkUrl);
			}

			try {
				const stat = await this._fileService.resolve(uri);
				return { uri, link, isDirectory: stat.isDirectory };
			}
			catch (e) {
				// Does not exist
				return undefined;
			}
		} catch {
			// Errors in parsing the path
			return undefined;
		}
	}

	/**
	 * Returns line and column number of URl if that is present.
	 *
	 * @param link Url link which may contain line and column number.
	 */
	extractLineColumnInfo(link: string): LineColumnInfo {
		const matches: string[] | null = this._localLinkRegex.exec(link);
		const lineColumnInfo: LineColumnInfo = {
			lineNumber: 1,
			columnNumber: 1
		};

		if (!matches || !this._processManager) {
			return lineColumnInfo;
		}

		const lineAndColumnMatchIndex = this._processManager.os === OperatingSystem.Windows ? winLineAndColumnMatchIndex : unixLineAndColumnMatchIndex;
		for (let i = 0; i < lineAndColumnClause.length; i++) {
			const lineMatchIndex = lineAndColumnMatchIndex + (lineAndColumnClauseGroupCount * i);
			const rowNumber = matches[lineMatchIndex];
			if (rowNumber) {
				lineColumnInfo['lineNumber'] = parseInt(rowNumber, 10);
				// Check if column number exists
				const columnNumber = matches[lineMatchIndex + 2];
				if (columnNumber) {
					lineColumnInfo['columnNumber'] = parseInt(columnNumber, 10);
				}
				break;
			}
		}

		return lineColumnInfo;
	}

	/**
	 * Returns url from link as link may contain line and column information.
	 *
	 * @param link url link which may contain line and column number.
	 */
	extractLinkUrl(link: string): string | null {
		const matches: string[] | null = this._localLinkRegex.exec(link);
		if (!matches) {
			return null;
		}
		return matches[1];
	}
}

export interface LineColumnInfo {
	lineNumber: number;
	columnNumber: number;
}

export interface IDetectedLinks {
	wordLinks?: ILink[];
	webLinks?: ILink[];
	fileLinks?: ILink[];
}
