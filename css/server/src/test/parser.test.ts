/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import {Parser} from '../parser/cssParser';
import {TokenType} from '../parser/cssScanner';
import * as nodes from '../parser/cssNodes';
import {ParseError} from '../parser/cssErrors';

export function assertNode(text: string, parser: Parser, f: () => nodes.Node): nodes.Node {
	let node = parser.internalParse(text, f);
	assert.ok(node !== null, 'no node returned');
	let markers = nodes.ParseErrorCollector.entries(node);
	if (markers.length > 0) {
		assert.ok(false, 'node has errors: ' + markers[0].getMessage() + ', offset: ' + markers[0].getNode().offset);
	}
	assert.ok(parser.accept(TokenType.EOF), 'Expect scanner at EOF');
	return node;
}

export function assertFunction(text: string, parser: Parser, f: () => nodes.Node): void {
	assertNode(text, parser, f);
}

export function assertNoNode(text: string, parser: Parser, f: () => nodes.Node): void {
	let node = parser.internalParse(text, f);
	assert.ok(node === null);
}

export function assertError(text: string, parser: Parser, f: () => nodes.Node, error: nodes.IRule): void {
	let node = parser.internalParse(text, f);
	assert.ok(node !== null, 'no node returned');
	let markers = nodes.ParseErrorCollector.entries(node);
	if (markers.length === 0) {
		assert.ok(false, 'no errors but error expected: ' + error.message);
	} else {
		markers = markers.sort((a, b) => { return a.getOffset() - b.getOffset(); });
		assert.equal(markers[0].getRule().id, error.id);
	}

}

suite('CSS - Parser', () => {

	test('Test stylesheet', function () {
		let parser = new Parser();
		assertNode('@charset "demo" ;', parser, parser._parseStylesheet.bind(parser));
		assertNode('body { margin: 0px; padding: 3em, 6em; }', parser, parser._parseStylesheet.bind(parser));
		assertNode('--> <!--', parser, parser._parseStylesheet.bind(parser));
		assertNode('', parser, parser._parseStylesheet.bind(parser));
		assertNode('<!-- --> @import "string"; <!-- -->', parser, parser._parseStylesheet.bind(parser));
		assertNode('@media asdsa { } <!-- --> <!-- -->', parser, parser._parseStylesheet.bind(parser));
		assertNode('@media screen, projection { }', parser, parser._parseStylesheet.bind(parser));
		assertNode('@media screen and (max-width: 400px) {  @-ms-viewport { width: 320px; }}', parser, parser._parseStylesheet.bind(parser));
		assertNode('@-ms-viewport { width: 320px; height: 768px; }', parser, parser._parseStylesheet.bind(parser));
		assertNode('#boo, far {} \n.far boo {}', parser, parser._parseStylesheet.bind(parser));
		assertNode('@-moz-keyframes darkWordHighlight { from { background-color: inherit; } to { background-color: rgba(83, 83, 83, 0.7); } }', parser, parser._parseStylesheet.bind(parser));
		assertNode('@import "foo";', parser, parser._parseStylesheet.bind(parser));
		assertNode('@import url(/css/screen.css) screen, projection;', parser, parser._parseStylesheet.bind(parser));
		assertNode('@page { margin: 2.5cm; }', parser, parser._parseStylesheet.bind(parser));
		assertNode('@font-face { font-family: "Example Font"; }', parser, parser._parseStylesheet.bind(parser));
		assertNode('@namespace "http://www.w3.org/1999/xhtml";', parser, parser._parseStylesheet.bind(parser));
		assertNode('@namespace pref url(http://test);', parser, parser._parseStylesheet.bind(parser));
		assertNode('@-moz-document url(http://test), url-prefix(http://www.w3.org/Style/) { body { color: purple; background: yellow; } }', parser, parser._parseStylesheet.bind(parser));
		assertNode('E E[foo] E[foo="bar"] E[foo~="bar"] E[foo^="bar"] E[foo$="bar"] E[foo*="bar"] E[foo|="en"] {}', parser, parser._parseStylesheet.bind(parser));
		assertNode('input[type=\"submit\"] {}', parser, parser._parseStylesheet.bind(parser));
		assertNode('E:root E:nth-child(n) E:nth-last-child(n) E:nth-of-type(n) E:nth-last-of-type(n) E:first-child E:last-child {}', parser, parser._parseStylesheet.bind(parser));
		assertNode('E:first-of-type E:last-of-type E:only-child E:only-of-type E:empty E:link E:visited E:active E:hover E:focus E:target E:lang(fr) E:enabled E:disabled E:checked {}', parser, parser._parseStylesheet.bind(parser));
		assertNode('E::first-line E::first-letter E::before E::after {}', parser, parser._parseStylesheet.bind(parser));
		assertNode('E.warning E#myid E:not(s) {}', parser, parser._parseStylesheet.bind(parser));
		assertError('@namespace;', parser, parser._parseStylesheet.bind(parser), ParseError.URIExpected);
		assertError('@namespace url(http://test)', parser, parser._parseStylesheet.bind(parser), ParseError.SemiColonExpected);
		assertError('@mskeyframes darkWordHighlight { from { background-color: inherit; } to { background-color: rgba(83, 83, 83, 0.7); } }', parser, parser._parseStylesheet.bind(parser), ParseError.UnknownAtRule);
		assertError('@charset;', parser, parser._parseStylesheet.bind(parser), ParseError.IdentifierExpected);
		assertError('@charset \'utf8\'', parser, parser._parseStylesheet.bind(parser), ParseError.SemiColonExpected);
	});

	test('Stylesheet /Panic/', function () {
		let parser = new Parser();
		assertError('#boo, far } \n.far boo {}', parser, parser._parseStylesheet.bind(parser), ParseError.LeftCurlyExpected);
		assertError('#boo, far { far: 43px; \n.far boo {}', parser, parser._parseStylesheet.bind(parser), ParseError.RightCurlyExpected);
	});

	test('@font-face', function () {
		let parser = new Parser();
		assertNode('@font-face {}', parser, parser._parseFontFace.bind(parser));
		assertNode('@font-face { src: url(http://test) }', parser, parser._parseFontFace.bind(parser));
		assertNode('@font-face { font-style: normal; font-stretch: normal; }', parser, parser._parseFontFace.bind(parser));
		assertError('@font-face { font-style: normal font-stretch: normal; }', parser, parser._parseFontFace.bind(parser), ParseError.SemiColonExpected);
	});

	test('@keyframe selector', function () {
		let parser = new Parser();
		assertNode('from {}', parser, parser._parseKeyframeSelector.bind(parser));
		assertNode('to {}', parser, parser._parseKeyframeSelector.bind(parser));
		assertNode('0% {}', parser, parser._parseKeyframeSelector.bind(parser));
		assertNode('10% {}', parser, parser._parseKeyframeSelector.bind(parser));
		assertNode('100000% {}', parser, parser._parseKeyframeSelector.bind(parser));
		assertNode('from { width: 100% }', parser, parser._parseKeyframeSelector.bind(parser));
		assertNode('from { width: 100%; to: 10px; }', parser, parser._parseKeyframeSelector.bind(parser));
	});

	test('@keyframe', function () {
		let parser = new Parser();
		assertNode('@keyframes name {}', parser, parser._parseKeyframe.bind(parser));
		assertNode('@-webkit-keyframes name {}', parser, parser._parseKeyframe.bind(parser));
		assertNode('@-o-keyframes name {}', parser, parser._parseKeyframe.bind(parser));
		assertNode('@-moz-keyframes name {}', parser, parser._parseKeyframe.bind(parser));
		assertNode('@keyframes name { from {} to {}}', parser, parser._parseKeyframe.bind(parser));
		assertNode('@keyframes name { from {} 80% {} 100% {}}', parser, parser._parseKeyframe.bind(parser));
		assertNode('@keyframes name { from { top: 0px; } 80% { top: 100px; } 100% { top: 50px; }}', parser, parser._parseKeyframe.bind(parser));
		assertNode('@keyframes name { from { top: 0px; } 70%, 80% { top: 100px; } 100% { top: 50px; }}', parser, parser._parseKeyframe.bind(parser));
		assertNode('@keyframes name { from { top: 0px; left: 1px; right: 2px }}', parser, parser._parseKeyframe.bind(parser));
		assertError('@keyframes name { from { top: 0px; left: 1px, right: 2px }}', parser, parser._parseKeyframe.bind(parser), ParseError.SemiColonExpected);
		assertError('@keyframes )', parser, parser._parseKeyframe.bind(parser), ParseError.IdentifierExpected);
		assertError('@keyframes name { { top: 0px; } }', parser, parser._parseKeyframe.bind(parser), ParseError.RightCurlyExpected);
		assertError('@keyframes name { from, #123', parser, parser._parseKeyframe.bind(parser), ParseError.PercentageExpected);
	});

	test('Test import', function () {
		let parser = new Parser();
		assertNode('@import "asdasdsa"', parser, parser._parseImport.bind(parser));
		assertNode('@ImPort "asdsadsa"', parser, parser._parseImport.bind(parser));
		assertNode('@import "asdasd" dsfsdf', parser, parser._parseImport.bind(parser));
		assertError('@import', parser, parser._parseImport.bind(parser), ParseError.URIOrStringExpected);
	});

	test('Test media', function () {
		let parser = new Parser();
		assertNode('@media asdsa { }', parser, parser._parseMedia.bind(parser));
		assertNode('@meDia sadd{}  ', parser, parser._parseMedia.bind(parser));
		assertNode('@media somename, othername2 { }', parser, parser._parseMedia.bind(parser));
		assertNode('@media only screen and (max-width:850px) { }', parser, parser._parseMedia.bind(parser));
		assertNode('@media only screen and (max-width:850px) { }', parser, parser._parseMedia.bind(parser));
		assertNode('@media all and (min-width:500px) { }', parser, parser._parseMedia.bind(parser));
		assertNode('@media screen and (color), projection and (color) { }', parser, parser._parseMedia.bind(parser));
		assertNode('@media not screen and (device-aspect-ratio: 16/9) { }', parser, parser._parseMedia.bind(parser));
		assertNode('@media print and (min-resolution: 300dpi) { }', parser, parser._parseMedia.bind(parser));
		assertNode('@media print and (min-resolution: 118dpcm) { }', parser, parser._parseMedia.bind(parser));
		assertNode('@media print { @page { margin: 10% } blockquote, pre { page-break-inside: avoid } }', parser, parser._parseMedia.bind(parser));
		assertNode('@media print { body:before { } }', parser, parser._parseMedia.bind(parser));
		assertError('@media somename othername2 { }', parser, parser._parseMedia.bind(parser), ParseError.LeftCurlyExpected);
		assertError('@media not, screen { }', parser, parser._parseMedia.bind(parser), ParseError.IdentifierExpected);
		assertError('@media not screen and foo { }', parser, parser._parseMedia.bind(parser), ParseError.LeftParenthesisExpected);
		assertError('@media not screen and () { }', parser, parser._parseMedia.bind(parser), ParseError.IdentifierExpected);
		assertError('@media not screen and (color:) { }', parser, parser._parseMedia.bind(parser), ParseError.TermExpected);
		assertError('@media not screen and (color:#234567 { }', parser, parser._parseMedia.bind(parser), ParseError.RightParenthesisExpected);
	});

	test('Test media_list', function () {
		let parser = new Parser();
		assertNode('somename', parser, parser._parseMediaList.bind(parser));
		assertNode('somename, othername', parser, parser._parseMediaList.bind(parser));
	});

	test('medium', function () {
		let parser = new Parser();
		assertNode('somename', parser, parser._parseMedium.bind(parser));
		assertNode('-asdas', parser, parser._parseMedium.bind(parser));
		assertNode('-asda34s', parser, parser._parseMedium.bind(parser));
	});

	test('page', function () {
		let parser = new Parser();
		assertNode('@page : name{ }', parser, parser._parsePage.bind(parser));
		assertNode('@page :left, :right { }', parser, parser._parsePage.bind(parser));
		assertNode('@page : name{ some : "asdas" }', parser, parser._parsePage.bind(parser));
		assertNode('@page : name{ some : "asdas" !important }', parser, parser._parsePage.bind(parser));
		assertNode('@page : name{ some : "asdas" !important; some : "asdas" !important }', parser, parser._parsePage.bind(parser));
		assertNode('@page rotated { size : landscape }', parser, parser._parsePage.bind(parser));
		assertNode('@page :left { margin-left: 4cm; margin-right: 3cm; }', parser, parser._parsePage.bind(parser));
		assertNode('@page {  @top-right-corner { content: url(foo.png); border: solid green; } }', parser, parser._parsePage.bind(parser));
		assertNode('@page {  @top-left-corner { content: " "; border: solid green; } @bottom-right-corner { content: counter(page); border: solid green; } }', parser, parser._parsePage.bind(parser));
		assertError('@page {  @top-left-corner foo { content: " "; border: solid green; } }', parser, parser._parsePage.bind(parser), ParseError.LeftCurlyExpected);
		assertError('@page {  @XY foo { content: " "; border: solid green; } }', parser, parser._parsePage.bind(parser), ParseError.UnknownAtRule);
		assertError('@page :left { margin-left: 4cm margin-right: 3cm; }', parser, parser._parsePage.bind(parser), ParseError.SemiColonExpected);
		assertError('@page : { }', parser, parser._parsePage.bind(parser), ParseError.IdentifierExpected);
		assertError('@page :left, { }', parser, parser._parsePage.bind(parser), ParseError.IdentifierExpected);
	});

	test('pseudo page', function () {
		let parser = new Parser();
		assertNode(': some ', parser, parser._parsePageSelector.bind(parser));
	});

	test('operator', function () {
		let parser = new Parser();
		assertNode('/', parser, parser._parseOperator.bind(parser));
		assertNode('*', parser, parser._parseOperator.bind(parser));
		assertNode('+', parser, parser._parseOperator.bind(parser));
		assertNode('-', parser, parser._parseOperator.bind(parser));
	});

	test('combinator', function () {
		let parser = new Parser();
		assertNode('+', parser, parser._parseCombinator.bind(parser));
		assertNode('+  ', parser, parser._parseCombinator.bind(parser));
		assertNode('>  ', parser, parser._parseCombinator.bind(parser));
		assertNode('>', parser, parser._parseCombinator.bind(parser));
	});

	test('unary_operator', function () {
		let parser = new Parser();
		assertNode('-', parser, parser._parseUnaryOperator.bind(parser));
		assertNode('+', parser, parser._parseUnaryOperator.bind(parser));
	});

	test('Property', function () {
		let parser = new Parser();
		assertNode('asdsa', parser, parser._parseProperty.bind(parser));
		assertNode('asdsa334', parser, parser._parseProperty.bind(parser));

		assertNode('--color', parser, parser._parseProperty.bind(parser));
		assertNode('--primary-font', parser, parser._parseProperty.bind(parser));
		assertNode('-color', parser, parser._parseProperty.bind(parser));
		assertNode('somevar', parser, parser._parseProperty.bind(parser));
		assertNode('some--let', parser, parser._parseProperty.bind(parser));
		assertNode('somevar--', parser, parser._parseProperty.bind(parser));
	});

	test('Ruleset', function () {
		let parser = new Parser();
		assertNode('name{ }', parser, parser._parseRuleset.bind(parser));
		assertNode('	name\n{ some : "asdas" }', parser, parser._parseRuleset.bind(parser));
		assertNode('		name{ some : "asdas" !important }', parser, parser._parseRuleset.bind(parser));
		assertNode('name{ \n some : "asdas" !important; some : "asdas" }', parser, parser._parseRuleset.bind(parser));
		assertNode('* {}', parser, parser._parseRuleset.bind(parser));
		assertNode('.far{}', parser, parser._parseRuleset.bind(parser));
		assertNode('boo {}', parser, parser._parseRuleset.bind(parser));
		assertNode('.far #boo {}', parser, parser._parseRuleset.bind(parser));
		assertNode('boo { prop: value }', parser, parser._parseRuleset.bind(parser));
		assertNode('boo { prop: value; }', parser, parser._parseRuleset.bind(parser));
		assertNode('boo { prop: value; prop: value }', parser, parser._parseRuleset.bind(parser));
		assertNode('boo { prop: value; prop: value; }', parser, parser._parseRuleset.bind(parser));
	});

	test('Ruleset /Panic/', function () {
		let parser = new Parser();
		//	assertNode('boo { : value }', parser, parser._parseRuleset.bind(parser));
		assertError('boo { prop: ; }', parser, parser._parseRuleset.bind(parser), ParseError.PropertyValueExpected);
		assertError('boo { prop }', parser, parser._parseRuleset.bind(parser), ParseError.ColonExpected);
		assertError('boo { prop: ; far: 12em; }', parser, parser._parseRuleset.bind(parser), ParseError.PropertyValueExpected);
		//	assertNode('boo { prop: ; 1ar: 12em; }', parser, parser._parseRuleset.bind(parser));
	});

	test('selector', function () {
		let parser = new Parser();
		assertNode('asdsa', parser, parser._parseSelector.bind(parser));
		assertNode('asdsa + asdas', parser, parser._parseSelector.bind(parser));
		assertNode('asdsa + asdas + name', parser, parser._parseSelector.bind(parser));
		assertNode('asdsa + asdas + name', parser, parser._parseSelector.bind(parser));
		assertNode('name #id#anotherid', parser, parser._parseSelector.bind(parser));
		assertNode('name.far .boo', parser, parser._parseSelector.bind(parser));
		assertNode('name .name .zweitername', parser, parser._parseSelector.bind(parser));
		assertNode('*', parser, parser._parseSelector.bind(parser));
		assertNode('#id', parser, parser._parseSelector.bind(parser));
		assertNode('far.boo', parser, parser._parseSelector.bind(parser));
	});

	test('simple selector', function () {
		let parser = new Parser();
		assertNode('name', parser, parser._parseSimpleSelector.bind(parser));
		assertNode('#id#anotherid', parser, parser._parseSimpleSelector.bind(parser));
		assertNode('name.far', parser, parser._parseSimpleSelector.bind(parser));
		assertNode('name.erstername.zweitername', parser, parser._parseSimpleSelector.bind(parser));
	});

	test('element name', function () {
		let parser = new Parser();
		assertNode('name', parser, parser._parseElementName.bind(parser));
		assertNode('*', parser, parser._parseElementName.bind(parser));
	});

	test('attrib', function () {
		let parser = new Parser();
		assertNode('[name]', parser, parser._parseAttrib.bind(parser));
		assertNode('[name = name2]', parser, parser._parseAttrib.bind(parser));
		assertNode('[name ~= name3]', parser, parser._parseAttrib.bind(parser));
		assertNode('[name~=name3]', parser, parser._parseAttrib.bind(parser));
		assertNode('[name |= name3]', parser, parser._parseAttrib.bind(parser));
		assertNode('[name |= "this is a striiiing"]', parser, parser._parseAttrib.bind(parser));
	});

	test('pseudo', function () {
		let parser = new Parser();
		assertNode(':some', parser, parser._parsePseudo.bind(parser));
		assertNode(':some(thing)', parser, parser._parsePseudo.bind(parser));
		assertNode(':nth-child(12)', parser, parser._parsePseudo.bind(parser));
		assertNode(':lang(it)', parser, parser._parsePseudo.bind(parser));
		assertNode(':not(.class)', parser, parser._parsePseudo.bind(parser));
		assertNode(':not(:disabled)', parser, parser._parsePseudo.bind(parser));
		assertNode(':not(#foo)', parser, parser._parsePseudo.bind(parser));
	});

	test('declaration', function () {
		let parser = new Parser();
		assertNode('name : "this is a string" !important', parser, parser._parseDeclaration.bind(parser));
		assertNode('name : "this is a string"', parser, parser._parseDeclaration.bind(parser));
		assertNode('property:12', parser, parser._parseDeclaration.bind(parser));
		assertNode('-vendor-property: 12', parser, parser._parseDeclaration.bind(parser));
		assertNode('font-size: 12px', parser, parser._parseDeclaration.bind(parser));
		assertNode('color : #888 /4', parser, parser._parseDeclaration.bind(parser));
		assertNode('filter : progid:DXImageTransform.Microsoft.Shadow(color=#000000,direction=45)', parser, parser._parseDeclaration.bind(parser));
		assertNode('filter : progid: DXImageTransform.\nMicrosoft.\nDropShadow(\noffx=2, offy=1, color=#000000)', parser, parser._parseDeclaration.bind(parser));
		assertNode('font-size: 12px', parser, parser._parseDeclaration.bind(parser));
		assertNode('*background: #f00 /* IE 7 and below */', parser, parser._parseDeclaration.bind(parser));
		assertNode('_background: #f60 /* IE 6 and below */', parser, parser._parseDeclaration.bind(parser));
		assertNode('background-image: linear-gradient(to right, silver, white 50px, white calc(100% - 50px), silver)', parser, parser._parseDeclaration.bind(parser));

		assertNode('--color: #F5F5F5', parser, parser._parseDeclaration.bind(parser));
		assertNode('--color: 0', parser, parser._parseDeclaration.bind(parser));
		assertNode('--color: 255', parser, parser._parseDeclaration.bind(parser));
		assertNode('--color: 25.5', parser, parser._parseDeclaration.bind(parser));
		assertNode('--color: 25px', parser, parser._parseDeclaration.bind(parser));
		assertNode('--color: 25.5px', parser, parser._parseDeclaration.bind(parser));
		assertNode('--primary-font: "wf_SegoeUI","Segoe UI","Segoe","Segoe WP"', parser, parser._parseDeclaration.bind(parser));
		assertError('--color : ', parser, parser._parseDeclaration.bind(parser), ParseError.PropertyValueExpected);
		assertError('--color value', parser, parser._parseDeclaration.bind(parser), ParseError.ColonExpected);
	});


	test('term', function () {
		let parser = new Parser();
		assertNode('"asdasd"', parser, parser._parseTerm.bind(parser));
		assertNode('name', parser, parser._parseTerm.bind(parser));
		assertNode('#FFFFFF', parser, parser._parseTerm.bind(parser));
		assertNode('url("this is a url")', parser, parser._parseTerm.bind(parser));
		assertNode('+324', parser, parser._parseTerm.bind(parser));
		assertNode('-45', parser, parser._parseTerm.bind(parser));
		assertNode('+45', parser, parser._parseTerm.bind(parser));
		assertNode('-45%', parser, parser._parseTerm.bind(parser));
		assertNode('-45mm', parser, parser._parseTerm.bind(parser));
		assertNode('-45em', parser, parser._parseTerm.bind(parser));
		assertNode('"asdsa"', parser, parser._parseTerm.bind(parser));
		assertNode('faa', parser, parser._parseTerm.bind(parser));
		assertNode('url("this is a striiiiing")', parser, parser._parseTerm.bind(parser));
		assertNode('#FFFFFF', parser, parser._parseTerm.bind(parser));
		assertNode('name(asd)', parser, parser._parseTerm.bind(parser));
		assertNode('calc(50% + 20px)', parser, parser._parseTerm.bind(parser));
		assertNode('calc(50% + (100%/3 - 2*1em - 2*1px))', parser, parser._parseTerm.bind(parser));
		assertNoNode('%(\'repetitions: %S file: %S\', 1 + 2, "directory/file.less")', parser, parser._parseTerm.bind(parser)); // less syntax
		assertNoNode('~"ms:alwaysHasItsOwnSyntax.For.Stuff()"', parser, parser._parseTerm.bind(parser)); // less syntax
	});

	test('function', function () {
		let parser = new Parser();
		assertNode('name( "bla" )', parser, parser._parseFunction.bind(parser));
		assertNode('name( name )', parser, parser._parseFunction.bind(parser));
		assertNode('name( -500mm )', parser, parser._parseFunction.bind(parser));
		assertNode('\u060frf()', parser, parser._parseFunction.bind(parser));
		assertNode('über()', parser, parser._parseFunction.bind(parser));

		assertNoNode('über ()', parser, parser._parseFunction.bind(parser));
		assertNoNode('%()', parser, parser._parseFunction.bind(parser));
		assertNoNode('% ()', parser, parser._parseFunction.bind(parser));

		assertFunction('let(--color)', parser, parser._parseFunction.bind(parser));
		assertFunction('let(--color, somevalue)', parser, parser._parseFunction.bind(parser));
		assertFunction('let(--variable1, --variable2)', parser, parser._parseFunction.bind(parser));
		assertFunction('let(--variable1, let(--variable2))', parser, parser._parseFunction.bind(parser));
		assertFunction('fun(value1, value2)', parser, parser._parseFunction.bind(parser));
	});

	test('Test Token prio', function () {
		let parser = new Parser();
		assertNode('!important', parser, parser._parsePrio.bind(parser));
		assertNode('!/*demo*/important', parser, parser._parsePrio.bind(parser));
		assertNode('! /*demo*/ important', parser, parser._parsePrio.bind(parser));
		assertNode('! /*dem o*/  important', parser, parser._parsePrio.bind(parser));
	});

	test('hexcolor', function () {
		let parser = new Parser();
		assertNode('#FFF', parser, parser._parseHexColor.bind(parser));
		assertNode('#FFFFFF', parser, parser._parseHexColor.bind(parser));
	});

	test('Test class', function () {
		let parser = new Parser();
		assertNode('.faa', parser, parser._parseClass.bind(parser));
		assertNode('faa', parser, parser._parseElementName.bind(parser));
		assertNode('*', parser, parser._parseElementName.bind(parser));
		assertNode('.faa42', parser, parser._parseClass.bind(parser));
	});


	test('Prio', function () {
		let parser = new Parser();
		assertNode('!important', parser, parser._parsePrio.bind(parser));
	});

	test('Expr', function () {
		let parser = new Parser();
		assertNode('45,5px', parser, parser._parseExpr.bind(parser));
		assertNode(' 45 , 5px ', parser, parser._parseExpr.bind(parser));
		assertNode('5/6', parser, parser._parseExpr.bind(parser));
		assertNode('36mm, -webkit-calc(100%-10px)', parser, parser._parseExpr.bind(parser));
	});

});

