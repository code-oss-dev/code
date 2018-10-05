/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SQLiteStorage, ISQLiteStorageOptions } from 'vs/base/node/storage';
import { generateUuid } from 'vs/base/common/uuid';
import { join } from 'path';
import { tmpdir } from 'os';
import { equal, ok } from 'assert';
import { mkdirp, del } from 'vs/base/node/pfs';

suite('Storage pasero', () => {

	function uniqueStorageDir(): string {
		const id = generateUuid();

		return join(tmpdir(), 'vsctests', id, 'storage', id);
	}

	async function testDBBasics(path, errorLogger?: (error) => void) {
		const options: ISQLiteStorageOptions = { path };
		if (errorLogger) {
			options.logging = {
				errorLogger
			};
		}

		const storage = new SQLiteStorage(options);

		const items = new Map<string, string>();
		items.set('foo', 'bar');
		items.set('some/foo/path', 'some/bar/path');
		items.set(JSON.stringify({ foo: 'bar' }), JSON.stringify({ bar: 'foo' }));

		let storedItems = await storage.getItems();
		equal(storedItems.size, 0);

		await storage.setItems(items);

		storedItems = await storage.getItems();
		equal(storedItems.size, items.size);
		equal(storedItems.get('foo'), 'bar');
		equal(storedItems.get('some/foo/path'), 'some/bar/path');
		equal(storedItems.get(JSON.stringify({ foo: 'bar' })), JSON.stringify({ bar: 'foo' }));

		await storage.deleteItems(['foo']);
		storedItems = await storage.getItems();
		equal(storedItems.size, items.size - 1);
		ok(!storedItems.has('foo'));
		equal(storedItems.get('some/foo/path'), 'some/bar/path');
		equal(storedItems.get(JSON.stringify({ foo: 'bar' })), JSON.stringify({ bar: 'foo' }));

		await storage.setItems(items);
		storedItems = await storage.getItems();
		equal(storedItems.size, items.size);
		equal(storedItems.get('foo'), 'bar');
		equal(storedItems.get('some/foo/path'), 'some/bar/path');
		equal(storedItems.get(JSON.stringify({ foo: 'bar' })), JSON.stringify({ bar: 'foo' }));

		const itemsChange = new Map<string, string>();
		itemsChange.set('foo', 'otherbar');
		await storage.setItems(itemsChange);

		storedItems = await storage.getItems();
		equal(storedItems.get('foo'), 'otherbar');

		await storage.deleteItems(['foo', 'some/foo/path', JSON.stringify({ foo: 'bar' })]);
		storedItems = await storage.getItems();
		equal(storedItems.size, 0);
	}

	test('basics', async () => {
		const storageDir = uniqueStorageDir();

		await mkdirp(storageDir);

		testDBBasics(join(storageDir, 'storage.db'));

		await del(storageDir, tmpdir());
	});

	test('basics (broken DB falls back to in-memory)', async () => {
		let expectedError: any;

		await testDBBasics(join(__dirname, 'broken.db'), error => {
			expectedError = error;
		});

		ok(expectedError);
	});

	test('real world example', async () => {
		const storageDir = uniqueStorageDir();

		await mkdirp(storageDir);

		const storage = new SQLiteStorage({
			path: join(storageDir, 'storage.db')
		});

		const items1 = new Map<string, string>();
		items1.set('colorthemedata', '{"id":"vs vscode-theme-defaults-themes-light_plus-json","label":"Light+ (default light)","settingsId":"Default Light+","selector":"vs.vscode-theme-defaults-themes-light_plus-json","themeTokenColors":[{"settings":{"foreground":"#000000ff","background":"#ffffffff"}},{"scope":["meta.embedded","source.groovy.embedded"],"settings":{"foreground":"#000000ff"}},{"scope":"emphasis","settings":{"fontStyle":"italic"}},{"scope":"strong","settings":{"fontStyle":"bold"}},{"scope":"meta.diff.header","settings":{"foreground":"#000080"}},{"scope":"comment","settings":{"foreground":"#008000"}},{"scope":"constant.language","settings":{"foreground":"#0000ff"}},{"scope":["constant.numeric"],"settings":{"foreground":"#09885a"}},{"scope":"constant.regexp","settings":{"foreground":"#811f3f"}},{"name":"css tags in selectors, xml tags","scope":"entity.name.tag","settings":{"foreground":"#800000"}},{"scope":"entity.name.selector","settings":{"foreground":"#800000"}},{"scope":"entity.other.attribute-name","settings":{"foreground":"#ff0000"}},{"scope":["entity.other.attribute-name.class.css","entity.other.attribute-name.class.mixin.css","entity.other.attribute-name.id.css","entity.other.attribute-name.parent-selector.css","entity.other.attribute-name.pseudo-class.css","entity.other.attribute-name.pseudo-element.css","source.css.less entity.other.attribute-name.id","entity.other.attribute-name.attribute.scss","entity.other.attribute-name.scss"],"settings":{"foreground":"#800000"}},{"scope":"invalid","settings":{"foreground":"#cd3131"}},{"scope":"markup.underline","settings":{"fontStyle":"underline"}},{"scope":"markup.bold","settings":{"fontStyle":"bold","foreground":"#000080"}},{"scope":"markup.heading","settings":{"fontStyle":"bold","foreground":"#800000"}},{"scope":"markup.italic","settings":{"fontStyle":"italic"}},{"scope":"markup.inserted","settings":{"foreground":"#09885a"}},{"scope":"markup.deleted","settings":{"foreground":"#a31515"}},{"scope":"markup.changed","settings":{"foreground":"#0451a5"}},{"scope":["punctuation.definition.quote.begin.markdown","punctuation.definition.list.begin.markdown"],"settings":{"foreground":"#0451a5"}},{"scope":"markup.inline.raw","settings":{"foreground":"#800000"}},{"name":"brackets of XML/HTML tags","scope":"punctuation.definition.tag","settings":{"foreground":"#800000"}},{"scope":"meta.preprocessor","settings":{"foreground":"#0000ff"}},{"scope":"meta.preprocessor.string","settings":{"foreground":"#a31515"}},{"scope":"meta.preprocessor.numeric","settings":{"foreground":"#09885a"}},{"scope":"meta.structure.dictionary.key.python","settings":{"foreground":"#0451a5"}},{"scope":"storage","settings":{"foreground":"#0000ff"}},{"scope":"storage.type","settings":{"foreground":"#0000ff"}},{"scope":"storage.modifier","settings":{"foreground":"#0000ff"}},{"scope":"string","settings":{"foreground":"#a31515"}},{"scope":["string.comment.buffered.block.pug","string.quoted.pug","string.interpolated.pug","string.unquoted.plain.in.yaml","string.unquoted.plain.out.yaml","string.unquoted.block.yaml","string.quoted.single.yaml","string.quoted.double.xml","string.quoted.single.xml","string.unquoted.cdata.xml","string.quoted.double.html","string.quoted.single.html","string.unquoted.html","string.quoted.single.handlebars","string.quoted.double.handlebars"],"settings":{"foreground":"#0000ff"}},{"scope":"string.regexp","settings":{"foreground":"#811f3f"}},{"name":"String interpolation","scope":["punctuation.definition.template-expression.begin","punctuation.definition.template-expression.end","punctuation.section.embedded"],"settings":{"foreground":"#0000ff"}},{"name":"Reset JavaScript string interpolation expression","scope":["meta.template.expression"],"settings":{"foreground":"#000000"}},{"scope":["support.constant.property-value","support.constant.font-name","support.constant.media-type","support.constant.media","constant.other.color.rgb-value","constant.other.rgb-value","support.constant.color"],"settings":{"foreground":"#0451a5"}},{"scope":["support.type.vendored.property-name","support.type.property-name","variable.css","variable.scss","variable.other.less","source.coffee.embedded"],"settings":{"foreground":"#ff0000"}},{"scope":["support.type.property-name.json"],"settings":{"foreground":"#0451a5"}},{"scope":"keyword","settings":{"foreground":"#0000ff"}},{"scope":"keyword.control","settings":{"foreground":"#0000ff"}},{"scope":"keyword.operator","settings":{"foreground":"#000000"}},{"scope":["keyword.operator.new","keyword.operator.expression","keyword.operator.cast","keyword.operator.sizeof","keyword.operator.instanceof","keyword.operator.logical.python"],"settings":{"foreground":"#0000ff"}},{"scope":"keyword.other.unit","settings":{"foreground":"#09885a"}},{"scope":["punctuation.section.embedded.begin.php","punctuation.section.embedded.end.php"],"settings":{"foreground":"#800000"}},{"scope":"support.function.git-rebase","settings":{"foreground":"#0451a5"}},{"scope":"constant.sha.git-rebase","settings":{"foreground":"#09885a"}},{"name":"coloring of the Java import and package identifiers","scope":["storage.modifier.import.java","variable.language.wildcard.java","storage.modifier.package.java"],"settings":{"foreground":"#000000"}},{"name":"this.self","scope":"variable.language","settings":{"foreground":"#0000ff"}},{"name":"Function declarations","scope":["entity.name.function","support.function","support.constant.handlebars"],"settings":{"foreground":"#795E26"}},{"name":"Types declaration and references","scope":["meta.return-type","support.class","support.type","entity.name.type","entity.name.class","storage.type.numeric.go","storage.type.byte.go","storage.type.boolean.go","storage.type.string.go","storage.type.uintptr.go","storage.type.error.go","storage.type.rune.go","storage.type.cs","storage.type.generic.cs","storage.type.modifier.cs","storage.type.variable.cs","storage.type.annotation.java","storage.type.generic.java","storage.type.java","storage.type.object.array.java","storage.type.primitive.array.java","storage.type.primitive.java","storage.type.token.java","storage.type.groovy","storage.type.annotation.groovy","storage.type.parameters.groovy","storage.type.generic.groovy","storage.type.object.array.groovy","storage.type.primitive.array.groovy","storage.type.primitive.groovy"],"settings":{"foreground":"#267f99"}},{"name":"Types declaration and references, TS grammar specific","scope":["meta.type.cast.expr","meta.type.new.expr","support.constant.math","support.constant.dom","support.constant.json","entity.other.inherited-class"],"settings":{"foreground":"#267f99"}},{"name":"Control flow keywords","scope":"keyword.control","settings":{"foreground":"#AF00DB"}},{"name":"Variable and parameter name","scope":["variable","meta.definition.variable.name","support.variable","entity.name.variable"],"settings":{"foreground":"#001080"}},{"name":"Object keys, TS grammar specific","scope":["meta.object-literal.key"],"settings":{"foreground":"#001080"}},{"name":"CSS property value","scope":["support.constant.property-value","support.constant.font-name","support.constant.media-type","support.constant.media","constant.other.color.rgb-value","constant.other.rgb-value","support.constant.color"],"settings":{"foreground":"#0451a5"}},{"name":"Regular expression groups","scope":["punctuation.definition.group.regexp","punctuation.definition.group.assertion.regexp","punctuation.definition.character-class.regexp","punctuation.character.set.begin.regexp","punctuation.character.set.end.regexp","keyword.operator.negation.regexp","support.other.parenthesis.regexp"],"settings":{"foreground":"#d16969"}},{"scope":["constant.character.character-class.regexp","constant.other.character-class.set.regexp","constant.other.character-class.regexp","constant.character.set.regexp"],"settings":{"foreground":"#811f3f"}},{"scope":"keyword.operator.quantifier.regexp","settings":{"foreground":"#000000"}},{"scope":["keyword.operator.or.regexp","keyword.control.anchor.regexp"],"settings":{"foreground":"#ff0000"}},{"scope":"constant.character","settings":{"foreground":"#0000ff"}},{"scope":"constant.character.escape","settings":{"foreground":"#ff0000"}},{"scope":"token.info-token","settings":{"foreground":"#316bcd"}},{"scope":"token.warn-token","settings":{"foreground":"#cd9731"}},{"scope":"token.error-token","settings":{"foreground":"#cd3131"}},{"scope":"token.debug-token","settings":{"foreground":"#800080"}}],"extensionData":{"extensionId":"vscode.theme-defaults","extensionPublisher":"vscode","extensionName":"theme-defaults","extensionIsBuiltin":true},"colorMap":{"editor.background":"#ffffff","editor.foreground":"#000000","editor.inactiveSelectionBackground":"#e5ebf1","editorIndentGuide.background":"#d3d3d3","editorIndentGuide.activeBackground":"#939393","editor.selectionHighlightBackground":"#add6ff4d","editorSuggestWidget.background":"#f3f3f3","activityBarBadge.background":"#007acc","sideBarTitle.foreground":"#6f6f6f","list.hoverBackground":"#e8e8e8","input.placeholderForeground":"#767676","settings.textInputBorder":"#cecece","settings.numberInputBorder":"#cecece"}}');
		items1.set('commandpalette.mru.cache', '{"usesLRU":true,"entries":[{"key":"revealFileInOS","value":3},{"key":"extension.openInGitHub","value":4},{"key":"workbench.extensions.action.openExtensionsFolder","value":11},{"key":"workbench.action.showRuntimeExtensions","value":14},{"key":"workbench.action.toggleTabsVisibility","value":15},{"key":"extension.liveServerPreview.open","value":16},{"key":"workbench.action.openIssueReporter","value":18},{"key":"workbench.action.openProcessExplorer","value":19},{"key":"workbench.action.toggleSharedProcess","value":20},{"key":"workbench.action.configureLocale","value":21},{"key":"workbench.action.appPerf","value":22},{"key":"workbench.action.reportPerformanceIssueUsingReporter","value":23},{"key":"workbench.action.openGlobalKeybindings","value":25},{"key":"workbench.action.output.toggleOutput","value":27},{"key":"extension.sayHello","value":29}]}');
		items1.set('cpp.1.lastsessiondate', 'Fri Oct 05 2018');
		items1.set('debug.actionswidgetposition', '0.6880952380952381');

		const items2 = new Map<string, string>();
		items2.set('workbench.editors.files.textfileeditor', '{"textEditorViewState":[["file:///Users/bpasero/Documents/ticino-playground/play.htm",{"0":{"cursorState":[{"inSelectionMode":false,"selectionStart":{"lineNumber":6,"column":16},"position":{"lineNumber":6,"column":16}}],"viewState":{"scrollLeft":0,"firstPosition":{"lineNumber":1,"column":1},"firstPositionDeltaTop":0},"contributionsState":{"editor.contrib.folding":{},"editor.contrib.wordHighlighter":false}}}],["file:///Users/bpasero/Documents/ticino-playground/nakefile.js",{"0":{"cursorState":[{"inSelectionMode":false,"selectionStart":{"lineNumber":7,"column":81},"position":{"lineNumber":7,"column":81}}],"viewState":{"scrollLeft":0,"firstPosition":{"lineNumber":1,"column":1},"firstPositionDeltaTop":20},"contributionsState":{"editor.contrib.folding":{},"editor.contrib.wordHighlighter":false}}}],["file:///Users/bpasero/Desktop/vscode2/.gitattributes",{"0":{"cursorState":[{"inSelectionMode":false,"selectionStart":{"lineNumber":9,"column":12},"position":{"lineNumber":9,"column":12}}],"viewState":{"scrollLeft":0,"firstPosition":{"lineNumber":1,"column":1},"firstPositionDeltaTop":20},"contributionsState":{"editor.contrib.folding":{},"editor.contrib.wordHighlighter":false}}}],["file:///Users/bpasero/Desktop/vscode2/src/vs/workbench/parts/search/browser/openAnythingHandler.ts",{"0":{"cursorState":[{"inSelectionMode":false,"selectionStart":{"lineNumber":1,"column":1},"position":{"lineNumber":1,"column":1}}],"viewState":{"scrollLeft":0,"firstPosition":{"lineNumber":1,"column":1},"firstPositionDeltaTop":0},"contributionsState":{"editor.contrib.folding":{},"editor.contrib.wordHighlighter":false}}}]]}');

		const items3 = new Map<string, string>();
		items3.set('nps/iscandidate', 'false');
		items3.set('telemetry.instanceid', 'd52bfcd4-4be6-476b-a38f-d44c717c41d6');
		items3.set('workbench.activity.pinnedviewlets', '[{"id":"workbench.view.explorer","pinned":true,"order":0,"visible":true},{"id":"workbench.view.search","pinned":true,"order":1,"visible":true},{"id":"workbench.view.scm","pinned":true,"order":2,"visible":true},{"id":"workbench.view.debug","pinned":true,"order":3,"visible":true},{"id":"workbench.view.extensions","pinned":true,"order":4,"visible":true},{"id":"workbench.view.extension.gitlens","pinned":true,"order":7,"visible":true},{"id":"workbench.view.extension.test","pinned":false,"visible":false}]');
		items3.set('workbench.panel.height', '419');
		items3.set('very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.very.long.key.', 'is long');

		let storedItems = await storage.getItems();
		equal(storedItems.size, 0);

		await Promise.all([
			await storage.setItems(items1),
			await storage.setItems(items2),
			await storage.setItems(items3)
		]);

		storedItems = await storage.getItems();
		equal(storedItems.size, items1.size + items2.size + items3.size);

		const items1Keys: string[] = [];
		items1.forEach((value, key) => {
			items1Keys.push(key);
			equal(storedItems.get(key), value);
		});

		const items2Keys: string[] = [];
		items2.forEach((value, key) => {
			items2Keys.push(key);
			equal(storedItems.get(key), value);
		});

		const items3Keys: string[] = [];
		items3.forEach((value, key) => {
			items3Keys.push(key);
			equal(storedItems.get(key), value);
		});

		await Promise.all([
			await storage.deleteItems(items1Keys),
			await storage.deleteItems(items2Keys),
			await storage.deleteItems(items3Keys)
		]);

		storedItems = await storage.getItems();
		equal(storedItems.size, 0);

		await Promise.all([
			await storage.setItems(items1),
			await storage.getItems(),
			await storage.setItems(items2),
			await storage.getItems(),
			await storage.setItems(items3),
			await storage.getItems(),
		]);

		storedItems = await storage.getItems();
		equal(storedItems.size, items1.size + items2.size + items3.size);

		await del(storageDir, tmpdir());
	});
});