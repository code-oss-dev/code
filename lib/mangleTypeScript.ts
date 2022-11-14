/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ts from 'typescript';
import { error } from 'fancy-log';
import { basename, dirname, join, relative } from 'path';
import * as fs from 'fs';
import * as Vinyl from 'vinyl';

class ShortIdent {

	private static _keywords = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
		'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
		'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw',
		'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']);

	static alphabet: string[] = [];

	static {
		for (let i = 97; i < 122; i++) {
			this.alphabet.push(String.fromCharCode(i));
		}
		for (let i = 65; i < 90; i++) {
			this.alphabet.push(String.fromCharCode(i));
		}
	}


	private _value = 0;

	private readonly _isNameTaken: (name: string) => boolean;

	constructor(isNameTaken: (name: string) => boolean) {
		this._isNameTaken = name => ShortIdent._keywords.has(name) || isNameTaken(name);
	}

	next(): string {
		const candidate = ShortIdent.convert(this._value);
		this._value++;
		if (this._isNameTaken(candidate)) {
			// try again
			return this.next();
		}
		return candidate;
	}

	private static convert(n: number): string {
		const base = this.alphabet.length;
		let result = '';
		do {
			const rest = n % base;
			result += this.alphabet[rest];
			n = (n / base) | 0;
		} while (n > 0);
		return result;
	}
}


const enum FieldType {
	Public,
	Protected,
	Private
}

class ClassData {

	fields = new Map<string, { type: FieldType; pos: number }>();

	private replacements: Map<string, string> | undefined;

	parent: ClassData | undefined;
	children: ClassData[] | undefined;

	constructor(
		readonly fileName: string,
		readonly node: ts.ClassDeclaration | ts.ClassExpression,
	) {
		// analyse all fields (properties and methods). Find usages of all protected and
		// private ones and keep track of all public ones (to prevent naming collisions)

		const candidates: (ts.NamedDeclaration)[] = [];
		for (const member of node.members) {
			if (ts.isMethodDeclaration(member)) {
				// method `foo() {}`
				candidates.push(member);

			} else if (ts.isPropertyDeclaration(member)) {
				// property `foo = 234`
				candidates.push(member);

			} else if (ts.isGetAccessor(member)) {
				// getter: `get foo() { ... }`
				candidates.push(member);

			} else if (ts.isSetAccessor(member)) {
				// setter: `set foo() { ... }`
				candidates.push(member);

			} else if (ts.isConstructorDeclaration(member)) {
				// constructor-prop:`constructor(private foo) {}`
				for (const param of member.parameters) {
					if (hasModifier(param, ts.SyntaxKind.PrivateKeyword)
						|| hasModifier(param, ts.SyntaxKind.ProtectedKeyword)
						|| hasModifier(param, ts.SyntaxKind.PublicKeyword)
						|| hasModifier(param, ts.SyntaxKind.ReadonlyKeyword)
					) {
						candidates.push(param);
					}
				}
			}
		}
		for (const member of candidates) {
			const ident = ClassData._getMemberName(member);
			if (!ident) {
				continue;
			}
			const type = ClassData._getFieldType(member);
			this.fields.set(ident, { type, pos: member.name!.getStart() });
		}
	}

	private static _getMemberName(node: ts.NamedDeclaration): string | undefined {
		if (!node.name) {
			return undefined;
		}
		const { name } = node;
		let ident = name.getText();
		if (name.kind === ts.SyntaxKind.ComputedPropertyName) {
			if (name.expression.kind !== ts.SyntaxKind.StringLiteral) {
				// unsupported: [Symbol.foo] or [abc + 'field']
				return;
			}
			// ['foo']
			ident = name.expression.getText().slice(1, -1);
		}

		return ident;
	}

	private static _getFieldType(node: ts.Node): FieldType {
		if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) {
			return FieldType.Private;
		} else if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) {
			return FieldType.Protected;
		} else {
			return FieldType.Public;
		}
	}

	static _shouldMangle(type: FieldType): boolean {
		return type === FieldType.Private
			|| type === FieldType.Protected
			;
	}

	static makeImplicitPublicActuallyPublic(data: ClassData): void {
		// TS-HACK
		// A subtype can make an inherited protected field public. To prevent accidential
		// mangling of public fields we mark the original (protected) fields as public...
		for (const [name, info] of data.fields) {
			if (info.type !== FieldType.Public) {
				continue;
			}
			let parent: ClassData | undefined = data.parent;
			while (parent) {
				if (parent.fields.get(name)?.type === FieldType.Protected) {
					console.warn(`WARN: protected became PUBLIC: '${name}' defined ${parent.fileName}#${info.pos}, PUBLIC via ${data.fileName} (${info.pos})`);

					parent.fields.get(name)!.type = FieldType.Public;
				}
				parent = parent.parent;
			}
		}
	}

	static fillInReplacement(data: ClassData) {

		if (data.replacements) {
			// already done
			return;
		}

		// fill in parents first
		if (data.parent) {
			ClassData.fillInReplacement(data.parent);
		}

		data.replacements = new Map();

		const identPool = new ShortIdent(name => {

			// locally taken
			if (data._isNameTaken(name)) {
				return true;
			}

			// parents
			let parent: ClassData | undefined = data.parent;
			while (parent) {
				if (parent._isNameTaken(name)) {
					return true;
				}
				parent = parent.parent;
			}

			// children
			if (data.children) {
				const stack = [...data.children];
				while (stack.length) {
					const node = stack.pop()!;
					if (node._isNameTaken(name)) {
						return true;
					}
					if (node.children) {
						stack.push(...node.children);
					}
				}
			}

			return false;
		});

		for (const [name, info] of data.fields) {
			if (ClassData._shouldMangle(info.type)) {
				const shortName = identPool.next();
				data.replacements.set(name, shortName);
			}
		}
	}

	// a name is taken when a field that doesn't get mangled exists or
	// when the name is already in use for replacement
	private _isNameTaken(name: string) {
		if (this.fields.has(name) && !ClassData._shouldMangle(this.fields.get(name)!.type)) {
			// public field
			return true;
		}
		if (this.replacements) {
			for (const shortName of this.replacements.values()) {
				if (shortName === name) {
					// replaced already (happens wih super types)
					return true;
				}
			}
		}
		if ((<any>this.node.getSourceFile()).identifiers instanceof Map) {
			// taken by any other usage
			if ((<any>this.node.getSourceFile()).identifiers.has(name)) {
				return true;
			}
		}
		return false;
	}

	lookupShortName(name: string): string {
		let value = this.replacements!.get(name)!;
		let parent = this.parent;
		while (parent) {
			if (parent.replacements!.has(name) && parent.fields.get(name)?.type === FieldType.Protected) {
				value = parent.replacements!.get(name)! ?? value;
			}
			parent = parent.parent;
		}
		return value;
	}

	// --- parent chaining

	addChild(child: ClassData) {
		this.children ??= [];
		this.children.push(child);
		child.parent = this;
	}
}

class StaticLanguageServiceHost implements ts.LanguageServiceHost {

	private _scriptSnapshots: Map<string, ts.IScriptSnapshot> = new Map();

	constructor(readonly cmdLine: ts.ParsedCommandLine) {

	}

	getCompilationSettings(): ts.CompilerOptions {
		return this.cmdLine.options;
	}

	getScriptFileNames(): string[] {
		return this.cmdLine.fileNames;
	}
	getScriptVersion(_fileName: string): string {
		return '1';
	}
	getProjectVersion(): string {
		return '1';
	}
	getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
		let result: ts.IScriptSnapshot | undefined = this._scriptSnapshots.get(fileName);
		if (result === undefined) {
			const content = ts.sys.readFile(fileName);
			if (content === undefined) {
				return undefined;
			}
			result = ts.ScriptSnapshot.fromString(content);
			this._scriptSnapshots.set(fileName, result);
		}
		return result;
	}
	getCurrentDirectory(): string {
		return dirname(projectPath);
	}
	getDefaultLibFileName(options: ts.CompilerOptions): string {
		return ts.getDefaultLibFilePath(options);
	}
	directoryExists = ts.sys.directoryExists;
	getDirectories = ts.sys.getDirectories;
	fileExists = ts.sys.fileExists;
	readFile = ts.sys.readFile;
	readDirectory = ts.sys.readDirectory;
	// this is necessary to make source references work.
	realpath = ts.sys.realpath;
}

export class Mangler {

	private readonly allClassDataByKey = new Map<string, ClassData>();

	private readonly service: ts.LanguageService;

	constructor(readonly projectPath: string) {

		const existingOptions: Partial<ts.CompilerOptions> = {};

		const parsed = ts.readConfigFile(projectPath, ts.sys.readFile);
		if (parsed.error) {
			console.log(error);
			throw parsed.error;
		}

		const cmdLine = ts.parseJsonConfigFileContent(parsed.config, ts.sys, dirname(projectPath), existingOptions);
		if (cmdLine.errors.length > 0) {
			console.log(error);
			throw parsed.error;
		}

		const host = new StaticLanguageServiceHost(cmdLine);
		this.service = ts.createLanguageService(host);
	}


	// step 1: collect all class data and store it by symbols
	// step 2: hook up extends-chaines and populate field replacement maps
	// step 3: generate and apply rewrites
	async mangle() {

		// (1) find all classes and field info
		const visit = (node: ts.Node): void => {
			if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
				const anchor = node.name ?? node;
				const key = `${node.getSourceFile().fileName}|${anchor.getStart()}`;
				if (this.allClassDataByKey.has(key)) {
					throw new Error('DUPE?');
				}
				this.allClassDataByKey.set(key, new ClassData(node.getSourceFile().fileName, node));
			}
			ts.forEachChild(node, visit);
		};

		for (const file of this.service.getProgram()!.getSourceFiles()) {
			if (!file.isDeclarationFile) {
				ts.forEachChild(file, visit);
			}
		}
		console.log(`done COLLECTING ${this.allClassDataByKey.size} classes`);


		const setupParents = (data: ClassData) => {
			const extendsClause = data.node.heritageClauses?.find(h => h.token === ts.SyntaxKind.ExtendsKeyword);
			if (!extendsClause) {
				// no EXTENDS-clause
				return;
			}

			const info = this.service.getDefinitionAtPosition(data.fileName, extendsClause.types[0].expression.getEnd());
			if (!info || info.length === 0) {
				// throw new Error('SUPER type not found');
				return;
			}

			if (info.length !== 1) {
				// inherits from declared/library type
				return;
			}

			const [definition] = info;
			const key = `${definition.fileName}|${definition.textSpan.start}`;
			const parent = this.allClassDataByKey.get(key);
			if (!parent) {
				// throw new Error(`SUPER type not found: ${key}`);
				return;
			}
			parent.addChild(data);
		};

		// (1.1) connect all class info
		for (const data of this.allClassDataByKey.values()) {
			setupParents(data);
		}

		// (1.2) TS-HACK: mark implicit-public protected field as public
		for (const data of this.allClassDataByKey.values()) {
			ClassData.makeImplicitPublicActuallyPublic(data);
		}

		// (2) fill in replacement strings
		for (const data of this.allClassDataByKey.values()) {
			ClassData.fillInReplacement(data);
		}
		console.log(`done creating REPLACEMENTS`);

		// (3) prepare rename edits
		type Edit = { newText: string; offset: number; length: number };
		const editsByFile = new Map<string, Edit[]>();

		const appendEdit = (fileName: string, edit: Edit) => {
			const edits = editsByFile.get(fileName);
			if (!edits) {
				editsByFile.set(fileName, [edit]);
			} else {
				edits.push(edit);
			}
		};

		for (const data of this.allClassDataByKey.values()) {

			if (hasModifier(data.node, ts.SyntaxKind.DeclareKeyword)) {
				continue;
			}

			fields: for (const [name, info] of data.fields) {
				if (!ClassData._shouldMangle(info.type)) {
					continue fields;
				}

				// TS-HACK: protected became public via 'some' child
				// and because of that we might need to ignore this now
				let parent = data.parent;
				while (parent) {
					if (parent.fields.get(name)?.type === FieldType.Public) {
						continue fields;
					}
					parent = parent.parent;
				}

				const newText = data.lookupShortName(name);
				const locations = this.service.findRenameLocations(data.fileName, info.pos, false, false, true) ?? [];
				for (const loc of locations) {
					appendEdit(loc.fileName, {
						newText: (loc.prefixText || '') + newText + (loc.suffixText || ''),
						offset: loc.textSpan.start,
						length: loc.textSpan.length
					});
				}
			}
		}

		console.log(`done preparing EDITS for ${editsByFile.size} files`);

		// (4) apply renames
		let savedBytes = 0;
		const result: Vinyl[] = [];

		for (const item of this.service.getProgram()!.getSourceFiles()) {

			let newFullText: string;
			const edits = editsByFile.get(item.fileName);
			if (!edits) {
				// just copy
				newFullText = item.getFullText();

			} else {
				// apply renames
				edits.sort((a, b) => b.offset - a.offset);
				const characters = item.getFullText().split('');

				let lastEdit: Edit | undefined;

				for (const edit of edits) {
					if (lastEdit) {
						if (lastEdit.offset === edit.offset) {
							//
							if (lastEdit.length !== edit.length || lastEdit.newText !== edit.newText) {
								console.log('OVERLAPPING edit', item.fileName, edit.offset, edits);
								throw new Error('OVERLAPPING edit');
							} else {
								continue;
							}
						}
					}
					lastEdit = edit;
					const removed = characters.splice(edit.offset, edit.length, edit.newText);
					savedBytes += removed.length - edit.newText.length;
				}
				newFullText = characters.join('');
			}

			const projectBase = dirname(projectPath);
			const newProjectBase = join(dirname(projectBase), basename(projectBase) + '-mangle');
			const newFilePath = join(newProjectBase, relative(projectBase, item.fileName));

			const file = new Vinyl({ path: newFilePath, contents: Buffer.from(newFullText) });
			result.push(file);
		}

		console.log(`DONE saved ${savedBytes / 1000}kb`);

		return result;
	}
}

// --- ast utils

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
	const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
	return Boolean(modifiers?.find(mode => mode.kind === kind));
}


const projectPath = 1
	? join(__dirname, '../../src/tsconfig.json')
	: '/Users/jrieken/Code/_samples/3wm/mangePrivate/tsconfig.json';

new Mangler(projectPath).mangle().then(async files => {
	for (const file of files) {
		await fs.promises.writeFile(file.path, file.contents);
	}
});
