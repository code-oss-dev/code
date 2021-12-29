/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Configuration, IEnvConfiguration } from 'vs/editor/browser/config/configuration';
import { EditorFontLigatures, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { TestAccessibilityService } from 'vs/platform/accessibility/test/common/testAccessibilityService';

export class TestConfiguration extends Configuration {

	constructor(opts: IEditorOptions) {
		super(false, opts, null, new TestAccessibilityService());
		this._recomputeOptions();
	}

	protected override _getEnvConfiguration(): IEnvConfiguration {
		return {
			extraEditorClassName: '',
			outerWidth: 100,
			outerHeight: 100,
			emptySelectionClipboard: true,
			pixelRatio: 1,
			zoomLevel: 0,
			accessibilitySupport: AccessibilitySupport.Unknown
		};
	}

	protected override readConfiguration(styling: BareFontInfo): FontInfo {
		return new FontInfo({
			zoomLevel: 0,
			pixelRatio: 1,
			fontFamily: 'mockFont',
			fontWeight: 'normal',
			fontSize: 14,
			fontFeatureSettings: EditorFontLigatures.OFF,
			lineHeight: 19,
			letterSpacing: 1.5,
			isMonospace: true,
			typicalHalfwidthCharacterWidth: 10,
			typicalFullwidthCharacterWidth: 20,
			canUseHalfwidthRightwardsArrow: true,
			spaceWidth: 10,
			middotWidth: 10,
			wsmiddotWidth: 10,
			maxDigitWidth: 10,
		}, true);
	}
}
