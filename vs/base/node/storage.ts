/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Database, Statement } from 'vscode-sqlite3';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ThrottledDelayer, timeout } from 'vs/base/common/async';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { mapToString, setToString } from 'vs/base/common/map';
import { basename } from 'path';
import { mark } from 'vs/base/common/performance';
import { rename, unlinkIgnoreError, copy, renameIgnoreError } from 'vs/base/node/pfs';

export interface IStorageOptions {
	path: string;

	logging?: IStorageLoggingOptions;
}

export interface IStorageLoggingOptions {
	logError?: (error: string | Error) => void;
	logTrace?: (msg: string) => void;
}

enum StorageState {
	None,
	Initialized,
	Closed
}

export interface IStorage extends IDisposable {

	readonly size: number;
	readonly onDidChangeStorage: Event<string>;

	init(): Promise<void>;

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;

	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;

	getInteger(key: string, fallbackValue: number): number;
	getInteger(key: string, fallbackValue?: number): number | undefined;

	set(key: string, value: any): Thenable<void>;
	delete(key: string): Thenable<void>;

	close(): Thenable<void>;

	getItems(): Promise<Map<string, string>>;
	checkIntegrity(full: boolean): Promise<string>;
}

export class Storage extends Disposable implements IStorage {
	_serviceBrand: any;

	private static readonly FLUSH_DELAY = 100;

	private _onDidChangeStorage: Emitter<string> = this._register(new Emitter<string>());
	get onDidChangeStorage(): Event<string> { return this._onDidChangeStorage.event; }

	private state = StorageState.None;

	private storage: SQLiteStorageImpl;
	private cache: Map<string, string> = new Map<string, string>();

	private flushDelayer: ThrottledDelayer<void>;

	private pendingDeletes: Set<string> = new Set<string>();
	private pendingInserts: Map<string, string> = new Map();

	constructor(options: IStorageOptions) {
		super();

		this.storage = new SQLiteStorageImpl(options);

		this.flushDelayer = this._register(new ThrottledDelayer(Storage.FLUSH_DELAY));
	}

	get size(): number {
		return this.cache.size;
	}

	init(): Promise<void> {
		if (this.state !== StorageState.None) {
			return Promise.resolve(); // either closed or already initialized
		}

		this.state = StorageState.Initialized;

		return this.storage.getItems().then(items => {
			this.cache = items;
		});
	}

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;
	get(key: string, fallbackValue?: string): string | undefined {
		const value = this.cache.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return value;
	}

	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined {
		const value = this.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return value === 'true';
	}

	getInteger(key: string, fallbackValue: number): number;
	getInteger(key: string, fallbackValue?: number): number | undefined;
	getInteger(key: string, fallbackValue?: number): number | undefined {
		const value = this.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return parseInt(value, 10);
	}

	set(key: string, value: any): Thenable<void> {
		if (this.state === StorageState.Closed) {
			return Promise.resolve(); // Return early if we are already closed
		}

		// We remove the key for undefined/null values
		if (isUndefinedOrNull(value)) {
			return this.delete(key);
		}

		// Otherwise, convert to String and store
		const valueStr = String(value);

		// Return early if value already set
		const currentValue = this.cache.get(key);
		if (currentValue === valueStr) {
			return Promise.resolve();
		}

		// Update in cache and pending
		this.cache.set(key, valueStr);
		this.pendingInserts.set(key, valueStr);
		this.pendingDeletes.delete(key);

		// Event
		this._onDidChangeStorage.fire(key);

		// Accumulate work by scheduling after timeout
		return this.flushDelayer.trigger(() => this.flushPending());
	}

	delete(key: string): Thenable<void> {
		if (this.state === StorageState.Closed) {
			return Promise.resolve(); // Return early if we are already closed
		}

		// Remove from cache and add to pending
		const wasDeleted = this.cache.delete(key);
		if (!wasDeleted) {
			return Promise.resolve(); // Return early if value already deleted
		}

		if (!this.pendingDeletes.has(key)) {
			this.pendingDeletes.add(key);
		}

		this.pendingInserts.delete(key);

		// Event
		this._onDidChangeStorage.fire(key);

		// Accumulate work by scheduling after timeout
		return this.flushDelayer.trigger(() => this.flushPending());
	}

	close(): Thenable<void> {
		if (this.state === StorageState.Closed) {
			return Promise.resolve(); // return if already closed
		}

		// Update state
		this.state = StorageState.Closed;

		// Trigger new flush to ensure data is persisted and then close
		// even if there is an error flushing. We must always ensure
		// the DB is closed to avoid corruption.
		const onDone = () => this.storage.close();
		return this.flushDelayer.trigger(() => this.flushPending(), 0 /* immediately */).then(onDone, onDone);
	}

	private flushPending(): Thenable<void> {

		// Get pending data
		const updateRequest: IUpdateRequest = { insert: this.pendingInserts, delete: this.pendingDeletes };

		// Reset pending data for next run
		this.pendingDeletes = new Set<string>();
		this.pendingInserts = new Map<string, string>();

		// Update in storage
		return this.storage.updateItems(updateRequest);
	}

	getItems(): Promise<Map<string, string>> {
		return this.storage.getItems();
	}

	checkIntegrity(full: boolean): Promise<string> {
		return this.storage.checkIntegrity(full);
	}
}

export interface IUpdateRequest {
	readonly insert?: Map<string, string>;
	readonly delete?: Set<string>;
}

interface IOpenDatabaseResult {
	db: Database;
	path: string;
}

export class SQLiteStorageImpl {

	private static measuredRequireDuration: boolean; // TODO@Ben remove me after a while

	private static IN_MEMORY_PATH = ':memory:';
	private static BUSY_OPEN_TIMEOUT = 2000; // timeout in ms to retry when opening DB fails with SQLITE_BUSY

	private name: string;
	private logger: SQLiteStorageLogger;

	private whenOpened: Promise<IOpenDatabaseResult>;

	constructor(options: IStorageOptions) {
		this.name = basename(options.path);
		this.logger = new SQLiteStorageLogger(options.logging);

		this.whenOpened = this.open(options.path);
	}

	getItems(): Promise<Map<string, string>> {
		return this.whenOpened.then(({ db }) => {
			const items = new Map<string, string>();

			return this.all(db, 'SELECT * FROM ItemTable').then(rows => {
				rows.forEach(row => items.set(row.key, row.value));

				if (this.logger.isTracing) {
					this.logger.trace(`[storage ${this.name}] getItems(): ${mapToString(items)}`);
				}

				return items;
			});
		});
	}

	updateItems(request: IUpdateRequest): Promise<void> {
		let updateCount = 0;
		if (request.insert) {
			updateCount += request.insert.size;
		}
		if (request.delete) {
			updateCount += request.delete.size;
		}

		if (updateCount === 0) {
			return Promise.resolve();
		}

		if (this.logger.isTracing) {
			this.logger.trace(`[storage ${this.name}] updateItems(): insert(${request.insert ? mapToString(request.insert) : '0'}), delete(${request.delete ? setToString(request.delete) : '0'})`);
		}

		return this.whenOpened.then(({ db }) => {
			return this.transaction(db, () => {
				if (request.insert && request.insert.size > 0) {
					this.prepare(db, 'INSERT INTO ItemTable VALUES (?,?)', stmt => {
						request.insert!.forEach((value, key) => {
							stmt.run([key, value]);
						});
					});
				}

				if (request.delete && request.delete.size) {
					this.prepare(db, 'DELETE FROM ItemTable WHERE key=?', stmt => {
						request.delete!.forEach(key => {
							stmt.run(key);
						});
					});
				}
			});
		});
	}

	close(): Promise<void> {
		this.logger.trace(`[storage ${this.name}] close()`);

		return this.whenOpened.then(result => {
			return new Promise((resolve, reject) => {
				result.db.close(error => {
					if (error) {
						this.logger.error(`[storage ${this.name}] close(): ${error}`);

						return reject(error);
					}

					// If the DB closed successfully and we are not running in-memory
					// make a backup of the DB so that we can use it as fallback in
					// case the actual DB becomes corrupt.
					if (result.path !== SQLiteStorageImpl.IN_MEMORY_PATH) {
						return this.backup(result).then(resolve, error => {
							this.logger.error(`[storage ${this.name}] backup(): ${error}`);

							return resolve(); // ignore failing backup
						});
					}

					return resolve();
				});
			});
		});
	}

	private backup(db: IOpenDatabaseResult): Promise<void> {
		if (db.path === SQLiteStorageImpl.IN_MEMORY_PATH) {
			return Promise.resolve(); // no backups when running in-memory
		}

		const backupPath = this.toBackupPath(db.path);

		return unlinkIgnoreError(backupPath).then(() => copy(db.path, backupPath));
	}

	private toBackupPath(path: string): string {
		return `${path}.backup`;
	}

	checkIntegrity(full: boolean): Promise<string> {
		this.logger.trace(`[storage ${this.name}] checkIntegrity(full: ${full})`);

		return this.whenOpened.then(({ db }) => {
			return this.get(db, full ? 'PRAGMA integrity_check' : 'PRAGMA quick_check').then(row => {
				return full ? row['integrity_check'] : row['quick_check'];
			});
		});
	}

	private open(path: string): Promise<IOpenDatabaseResult> {
		this.logger.trace(`[storage ${this.name}] open()`);

		return new Promise((resolve, reject) => {
			const fallbackToInMemoryDatabase = (error: Error) => {
				this.logger.error(`[storage ${this.name}] open(): Error (open DB): ${error}`);
				this.logger.error(`[storage ${this.name}] open(): Falling back to in-memory DB`);

				// In case of any error to open the DB, use an in-memory
				// DB so that we always have a valid DB to talk to.
				this.doOpen(SQLiteStorageImpl.IN_MEMORY_PATH).then(resolve, reject);
			};

			this.doOpen(path).then(resolve, error => {

				// TODO@Ben check if this is still happening. This error code should only arise if
				// another process is locking the same DB we want to open at that time. This typically
				// never happens because a DB connection is limited per window. However, in the event
				// of a window reload, it may be possible that the previous connection was not properly
				// closed while the new connection is already established.
				if (error.code === 'SQLITE_BUSY') {
					return this.handleSQLiteBusy(path).then(resolve, fallbackToInMemoryDatabase);
				}

				// This error code indicates that even though the DB file exists,
				// SQLite cannot open it and signals it is corrupt or not a DB.
				if (error.code === 'SQLITE_CORRUPT' || error.code === 'SQLITE_NOTADB') {
					return this.handleSQLiteCorrupt(path, error).then(resolve, fallbackToInMemoryDatabase);
				}

				// Otherwise give up and fallback to in-memory DB
				return fallbackToInMemoryDatabase(error);
			});
		});
	}

	private handleSQLiteBusy(path: string): Promise<IOpenDatabaseResult> {
		this.logger.error(`[storage ${this.name}] open(): Retrying after ${SQLiteStorageImpl.BUSY_OPEN_TIMEOUT}ms due to SQLITE_BUSY`);

		// Retry after some time if the DB is busy
		return timeout(SQLiteStorageImpl.BUSY_OPEN_TIMEOUT).then(() => this.doOpen(path));
	}

	private handleSQLiteCorrupt(path: string, error: any): Promise<IOpenDatabaseResult> {
		this.logger.error(`[storage ${this.name}] open(): Unable to open DB due to ${error.code}`);

		// Move corrupt DB to a different filename and try to load from backup
		// If that fails, a new empty DB is being created automatically
		return rename(path, this.toCorruptPath(path))
			.then(() => renameIgnoreError(this.toBackupPath(path), path))
			.then(() => this.doOpen(path));
	}

	private toCorruptPath(path: string): string {
		const randomSuffix = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 4);

		return `${path}.${randomSuffix}.corrupt`;
	}

	private doOpen(path: string): Promise<IOpenDatabaseResult> {
		// TODO@Ben clean up performance markers
		return new Promise((resolve, reject) => {
			let measureRequireDuration = false;
			if (!SQLiteStorageImpl.measuredRequireDuration) {
				SQLiteStorageImpl.measuredRequireDuration = true;
				measureRequireDuration = true;

				mark('willRequireSQLite');
			}
			import('vscode-sqlite3').then(sqlite3 => {
				if (measureRequireDuration) {
					mark('didRequireSQLite');
				}

				const db: Database = new (this.logger.isTracing ? sqlite3.verbose().Database : sqlite3.Database)(path, error => {
					if (error) {
						return db.close(() => reject(error));
					}

					// The following exec() statement serves two purposes:
					// - create the DB if it does not exist yet
					// - validate that the DB is not corrupt (the open() call does not throw otherwise)
					mark('willSetupSQLiteSchema');
					this.exec(db, [
						'PRAGMA user_version = 1;',
						'CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)'
					].join('')).then(() => {
						mark('didSetupSQLiteSchema');

						resolve({ path, db });
					}, error => {
						mark('didSetupSQLiteSchema');

						db.close(() => reject(error));
					});
				});

				// Errors
				db.on('error', error => this.logger.error(`[storage ${this.name}] Error (event): ${error}`));

				// Tracing
				if (this.logger.isTracing) {
					db.on('trace', sql => this.logger.trace(`[storage ${this.name}] Trace (event): ${sql}`));
				}
			});
		});
	}

	private exec(db: Database, sql: string): Promise<void> {
		return new Promise((resolve, reject) => {
			db.exec(sql, error => {
				if (error) {
					this.logger.error(`[storage ${this.name}] exec(): ${error}`);

					return reject(error);
				}

				return resolve();
			});
		});
	}

	private get(db: Database, sql: string): Promise<object> {
		return new Promise((resolve, reject) => {
			db.get(sql, (error, row) => {
				if (error) {
					this.logger.error(`[storage ${this.name}] get(): ${error}`);

					return reject(error);
				}

				return resolve(row);
			});
		});
	}

	private all(db: Database, sql: string): Promise<{ key: string, value: string }[]> {
		return new Promise((resolve, reject) => {
			db.all(sql, (error, rows) => {
				if (error) {
					this.logger.error(`[storage ${this.name}] all(): ${error}`);

					return reject(error);
				}

				return resolve(rows);
			});
		});
	}

	private transaction(db: Database, transactions: () => void): Promise<void> {
		return new Promise((resolve, reject) => {
			db.serialize(() => {
				db.run('BEGIN TRANSACTION');

				transactions();

				db.run('END TRANSACTION', error => {
					if (error) {
						this.logger.error(`[storage ${this.name}] transaction(): ${error}`);

						return reject(error);
					}

					return resolve();
				});
			});
		});
	}

	private prepare(db: Database, sql: string, runCallback: (stmt: Statement) => void): void {
		const stmt = db.prepare(sql);

		const statementErrorListener = error => {
			this.logger.error(`[storage ${this.name}] prepare(): ${error} (${sql})`);
		};

		stmt.on('error', statementErrorListener);

		runCallback(stmt);

		stmt.finalize(error => {
			if (error) {
				statementErrorListener(error);
			}

			stmt.removeListener('error', statementErrorListener);
		});
	}
}

class SQLiteStorageLogger {
	private readonly logTrace: (msg: string) => void;
	private readonly logError: (error: string | Error) => void;

	constructor(options?: IStorageLoggingOptions) {
		if (options && typeof options.logTrace === 'function') {
			this.logTrace = options.logTrace;
		}

		if (options && typeof options.logError === 'function') {
			this.logError = options.logError;
		}
	}

	get isTracing(): boolean {
		return !!this.logTrace;
	}

	trace(msg: string): void {
		if (this.logTrace) {
			this.logTrace(msg);
		}
	}

	error(error: string | Error): void {
		if (this.logError) {
			this.logError(error);
		}
	}
}

export class NullStorage extends Disposable implements IStorage {

	readonly size = 0;
	readonly onDidChangeStorage = Event.None;

	private items = new Map<string, string>();

	init(): Promise<void> { return Promise.resolve(); }

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;
	get(key: string, fallbackValue?: string): string | undefined {
		return void 0;
	}

	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined {
		return void 0;
	}

	getInteger(key: string, fallbackValue: number): number;
	getInteger(key: string, fallbackValue?: number): number | undefined;
	getInteger(key: string, fallbackValue?: number): number | undefined {
		return void 0;
	}

	set(key: string, value: any): Promise<void> {
		return Promise.resolve();
	}

	delete(key: string): Promise<void> {
		return Promise.resolve();
	}

	close(): Promise<void> {
		return Promise.resolve();
	}

	getItems(): Promise<Map<string, string>> {
		return Promise.resolve(this.items);
	}

	checkIntegrity(full: boolean): Promise<string> {
		return Promise.resolve('ok');
	}
}