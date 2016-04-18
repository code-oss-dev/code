/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import {illegalArgument, illegalState, canceled} from 'vs/base/common/errors';
import {create} from 'vs/base/common/types';
import {forEach} from 'vs/base/common/collections';
import {Graph} from 'vs/base/common/graph';
import * as descriptors from 'vs/platform/instantiation/common/descriptors';
import * as instantiation from 'vs/platform/instantiation/common/instantiation';
import ServiceCollection from 'vs/platform/instantiation/common/serviceCollection';

import IInstantiationService = instantiation.IInstantiationService;
import ServiceIdentifier = instantiation.ServiceIdentifier;

/**
 * Creates a new instance of an instantiation service.
 */
export function createInstantiationService(services?: ServiceCollection | { [legacyId: string]: any }): IInstantiationService {
	let map:{ [legacyId: string]: any };
	if (typeof services === 'undefined') {
		map = Object.create(null);
	} else if (services instanceof ServiceCollection) {
		map = Object.create(null);
		services.forEach((id, service) => {
			map[instantiation._util.getServiceId(id)] = service;
		});
	} else if(typeof services === 'object') {
		map = services;
	} else {
		throw new Error('invalid arg');
	}

	let result = new InstantiationService(map, new AccessLock());
	return result;
}

class AccessLock {

	private _value: number = 0;

	public get locked() {
		return this._value === 0;
	}

	public runUnlocked<R>(r: () => R): R {
		this._value++;
		try {
			return r();
		} finally {
			this._value--;
		}
	}
}

class ServicesMap {

	constructor(private _services: any, private _lock: AccessLock) {
		forEach(this._services, (entry) => {

			// add a accessor to myselves
			this.registerService(entry.key, entry.value);
		});
	}

	public registerService(name: string, service: any): void {
		// add a accessor to myselves
		Object.defineProperty(this, name, {
			get: () => {
				if (this._lock.locked) {
					throw illegalState('the services map can only be used during construction');
				}
				if (!service) {
					throw illegalArgument(`service with '${name}' not found`);
				}
				if (service instanceof descriptors.SyncDescriptor) {
					let cached = this._services[name];
					if (cached instanceof descriptors.SyncDescriptor) {
						this._ensureInstances(name, service);
						service = this._services[name];
					} else {
						service = cached;
					}
				}
				return service;
			},
			set: (value: any) => {
				throw illegalState('services cannot be changed');
			},
			configurable: false,
			enumerable: false
		});
		// add to services map
		this._services[name] = service;
	}

	public get lock(): AccessLock {
		return this._lock;
	}

	public get services(): any {
		return this._services;
	}

	private _ensureInstances(serviceId: string, desc: descriptors.SyncDescriptor<any>): void {

		let seen: { [n: string]: boolean } = Object.create(null);
		let graph = new Graph<{ serviceId: string, desc: descriptors.SyncDescriptor<any> }>(i => i.serviceId);

		function throwCycleError() {
			const err = new Error('[createInstance cyclic dependency between services]');
			err.message = graph.toString();
			throw err;
		}

		let stack = [{ serviceId, desc }];
		while (stack.length) {
			let item = stack.pop();
			graph.lookupOrInsertNode(item);

			// check for cycles between the descriptors
			if (seen[item.serviceId]) {
				throwCycleError();
			}
			seen[item.serviceId] = true;

			// check all dependencies for existence and if the need to be created first
			let dependencies = instantiation._util.getServiceDependencies(item.desc.ctor);
			if (Array.isArray(dependencies)) {
				for (let dependency of dependencies) {
					let instanceOrDesc = this.services[dependency.serviceId];
					if (!instanceOrDesc) {
						throw new Error(`[createInstance] ${serviceId} depends on ${dependency.serviceId} which is NOT registered.`);
					}

					if (instanceOrDesc instanceof descriptors.SyncDescriptor) {
						const d = { serviceId: dependency.serviceId, desc: instanceOrDesc };
						stack.push(d);
						graph.insertEdge(item, d);
					}
				}
			}
		}

		while (true) {
			let roots = graph.roots();

			// if there is no more roots but still
			// nodes in the graph we have a cycle
			if (roots.length === 0) {
				if (graph.length !== 0) {
					throwCycleError();
				}
				break;
			}

			for (let root of roots) {
				let instance = this.createInstance(root.data.desc, []);
				this._services[root.data.serviceId] = instance;
				graph.removeNode(root.data);
			}
		}
	}

	public invokeFunction<R>(fn: Function, args: any[]): R {

		return this._lock.runUnlocked(() => {

			let accessor: instantiation.ServicesAccessor = {
				get: <T>(id: instantiation.ServiceIdentifier<T>) => {
					let value = instantiation._util.getServiceId(id);
					return <T>this[value];
				}
			};

			return fn.apply(undefined, [accessor].concat(args));
		});
	}

	public createInstance<T>(descriptor: descriptors.SyncDescriptor<T>, args: any[]): T {
		let allArguments: any[] = [];
		let serviceInjections = instantiation._util.getServiceDependencies(descriptor.ctor) || [];
		let fixedArguments = descriptor.staticArguments().concat(args);
		let expectedFirstServiceIndex = fixedArguments.length;
		let actualFirstServiceIndex = Number.MAX_VALUE;
		serviceInjections.forEach(serviceInjection => {
			// @IServiceName
			let {serviceId, index} = serviceInjection;
			let service = this._lock.runUnlocked(() => this[serviceId]);
			allArguments[index] = service;
			actualFirstServiceIndex = Math.min(actualFirstServiceIndex, index);
		});

		// insert the fixed arguments into the array of all ctor
		// arguments. don't overwrite existing values tho it indicates
		// something is off
		let i = 0;
		for (let arg of fixedArguments) {
			let hasValue = allArguments[i] !== void 0;
			if (!hasValue) {
				allArguments[i] = arg;
			}
			i += 1;
		}

		allArguments.unshift(descriptor.ctor); // ctor is first arg

		// services are the last arguments of ctor-calls. We check if static ctor arguments
		// (like those from a [sync|async] desriptor) or args that are passed by createInstance
		// don't override positions of those arguments
		if (actualFirstServiceIndex !== Number.MAX_VALUE
			&& actualFirstServiceIndex !== expectedFirstServiceIndex) {

			let msg = `[createInstance] constructor '${descriptor.ctor.name}' has first` +
				` service dependency at position ${actualFirstServiceIndex + 1} but is called with` +
				` ${expectedFirstServiceIndex - 1} static arguments that are expected to come first`;

			// throw new Error(msg);
			console.warn(msg);
		}

		return this._lock.runUnlocked(() => {
			const instance = create.apply(null, allArguments);
			descriptor._validate(instance);
			return <T>instance;
		});
	}
}

class InstantiationService implements IInstantiationService {
	public serviceId = IInstantiationService;

	private _servicesMap: ServicesMap;

	constructor(services: any, lock: AccessLock) {
		services['instantiationService'] = this;
		this._servicesMap = new ServicesMap(services, lock);
	}

	createChild(services: ServiceCollection): IInstantiationService {

		const result = new InstantiationService(Object.create(null), this._servicesMap.lock);

		// insert new services
		services.forEach((id, instanceOrDescriptor) => {
			result.addSingleton(id, instanceOrDescriptor);
		});

		// fill gaps existing services
		forEach(this._servicesMap.services, (entry) => {
			let id = instantiation.createDecorator(entry.key);
			if (!services.has(id) && entry.key !== 'instantiationService') {
				result.addSingleton(id, entry.value);
			}
		});

		return result;
	}

	addSingleton<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | descriptors.SyncDescriptor<T>): void {
		let name = instantiation._util.getServiceId(id);
		this._servicesMap.registerService(name, instanceOrDescriptor);
	}

	getInstance<T>(id: ServiceIdentifier<T>): T {
		let name = instantiation._util.getServiceId(id);
		let result = this._servicesMap.lock.runUnlocked(() => this._servicesMap[name]);
		return result;
	}

	createInstance<T>(ctor: instantiation.IConstructorSignature0<T>, ...rest: any[]): T;
	createInstance<A1, T>(ctor: instantiation.IConstructorSignature1<A1, T>, ...rest: any[]): T;
	createInstance<A1, A2, T>(ctor: instantiation.IConstructorSignature2<A1, A2, T>, ...rest: any[]): T;
	createInstance<A1, A2, A3, T>(ctor: instantiation.IConstructorSignature3<A1, A2, A3, T>, ...rest: any[]): T;
	createInstance<A1, A2, A3, A4, T>(ctor: instantiation.IConstructorSignature4<A1, A2, A3, A4, T>, first: A1, second: A2, third: A3, fourth: A4): T;
	createInstance<A1, A2, A3, A4, A5, T>(ctor: instantiation.IConstructorSignature5<A1, A2, A3, A4, A5, T>, first: A1, second: A2, third: A3, fourth: A4, fifth: A5): T;
	createInstance<A1, A2, A3, A4, A5, A6, T>(ctor: instantiation.IConstructorSignature6<A1, A2, A3, A4, A5, A6, T>, first: A1, second: A2, third: A3, fourth: A4, fifth: A5, sixth: A6): T;
	createInstance<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>, first: A1, second: A2, third: A3, fourth: A4, fifth: A5, sixth: A6, seventh: A7): T;
	createInstance<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, first: A1, second: A2, third: A3, fourth: A4, fifth: A5, sixth: A6, seventh: A7, eigth: A8): T;

	createInstance<T>(descriptor: descriptors.SyncDescriptor0<T>): T;
	createInstance<A1, T>(descriptor: descriptors.SyncDescriptor1<A1, T>, a1: A1): T;
	createInstance<A1, A2, T>(descriptor: descriptors.SyncDescriptor2<A1, A2, T>, a1: A1, a2: A2): T;
	createInstance<A1, A2, A3, T>(descriptor: descriptors.SyncDescriptor3<A1, A2, A3, T>, a1: A1, a2: A2, a3: A3): T;
	createInstance<A1, A2, A3, A4, T>(descriptor: descriptors.SyncDescriptor4<A1, A2, A3, A4, T>, a1: A1, a2: A2, a3: A3, a4: A4): T;
	createInstance<A1, A2, A3, A4, A5, T>(descriptor: descriptors.SyncDescriptor5<A1, A2, A3, A4, A5, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): T;
	createInstance<A1, A2, A3, A4, A5, A6, T>(descriptor: descriptors.SyncDescriptor6<A1, A2, A3, A4, A5, A6, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6): T;
	createInstance<A1, A2, A3, A4, A5, A6, A7, T>(descriptor: descriptors.SyncDescriptor7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7): T;
	createInstance<A1, A2, A3, A4, A5, A6, A7, A8, T>(descriptor: descriptors.SyncDescriptor8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8): T;

	createInstance<T>(descriptor: descriptors.AsyncDescriptor0<T>): TPromise<T>;
	createInstance<A1, T>(descriptor: descriptors.AsyncDescriptor1<A1, T>, a1: A1): TPromise<T>;
	createInstance<A1, A2, T>(descriptor: descriptors.AsyncDescriptor2<A1, A2, T>, a1: A1, a2: A2): TPromise<T>;
	createInstance<A1, A2, A3, T>(descriptor: descriptors.AsyncDescriptor3<A1, A2, A3, T>, a1: A1, a2: A2, a3: A3): TPromise<T>;
	createInstance<A1, A2, A3, A4, T>(descriptor: descriptors.AsyncDescriptor4<A1, A2, A3, A4, T>, a1: A1, a2: A2, a3: A3, a4: A4): TPromise<T>;
	createInstance<A1, A2, A3, A4, A5, T>(descriptor: descriptors.AsyncDescriptor5<A1, A2, A3, A4, A5, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): TPromise<T>;
	createInstance<A1, A2, A3, A4, A5, A6, T>(descriptor: descriptors.AsyncDescriptor6<A1, A2, A3, A4, A5, A6, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6): TPromise<T>;
	createInstance<A1, A2, A3, A4, A5, A6, A7, T>(descriptor: descriptors.AsyncDescriptor7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7): TPromise<T>;
	createInstance<A1, A2, A3, A4, A5, A6, A7, A8, T>(descriptor: descriptors.AsyncDescriptor8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8): TPromise<T>;

	createInstance<T>(descriptor: descriptors.SyncDescriptor<T>, ...args: any[]): T;
	createInstance<T>(descriptor: descriptors.AsyncDescriptor<T>, ...args: any[]): TPromise<T>;

	createInstance<T>(param: any): any {

		let rest = new Array<any>(arguments.length - 1);
		for (let i = 1, len = arguments.length; i < len; i++) {
			rest[i - 1] = arguments[i];
		}

		if (param instanceof descriptors.SyncDescriptor) {
			return this._servicesMap.createInstance(<descriptors.SyncDescriptor<T>>param, rest);
		} else if (param instanceof descriptors.AsyncDescriptor) {
			return this._createInstanceAsync(<descriptors.AsyncDescriptor<T>>param, rest);
		} else {
			return this._servicesMap.createInstance(new descriptors.SyncDescriptor(<instantiation.IConstructorSignature0<T>>param), rest);
		}
	}

	_createInstanceAsync<T>(descriptor: descriptors.AsyncDescriptor<T>, args: any[]): TPromise<T> {

		let canceledError: Error;

		return new TPromise((c, e, p) => {
			require([descriptor.moduleName], (_module?: any) => {
				if (canceledError) {
					e(canceledError);
				}

				if (!_module) {
					return e(illegalArgument('module not found: ' + descriptor.moduleName));
				}

				let ctor: Function;
				if (!descriptor.ctorName) {
					ctor = _module;
				} else {
					ctor = _module[descriptor.ctorName];
				}

				if (typeof ctor !== 'function') {
					return e(illegalArgument('not a function: ' + descriptor.ctorName || descriptor.moduleName));
				}

				try {
					args.unshift.apply(args, descriptor.staticArguments()); // instead of spread in ctor call
					c(this._servicesMap.createInstance(new descriptors.SyncDescriptor<T>(ctor), args));
				} catch (error) {
					return e(error);
				}
			}, e);
		}, () => {
			canceledError = canceled();
		});
	}

	invokeFunction<R>(ctor: instantiation.IFunctionSignature0<R>): R;
	invokeFunction<A1, R>(ctor: instantiation.IFunctionSignature1<A1, R>, first: A1): R;
	invokeFunction<A1, A2, R>(ctor: instantiation.IFunctionSignature2<A1, A2, R>, first: A1, second: A2): R;
	invokeFunction<A1, A2, A3, R>(ctor: instantiation.IFunctionSignature3<A1, A2, A3, R>, first: A1, second: A2, third: A3): R;
	invokeFunction<A1, A2, A3, A4, R>(ctor: instantiation.IFunctionSignature4<A1, A2, A3, A4, R>, first: A1, second: A2, third: A3, fourth: A4): R;
	invokeFunction<A1, A2, A3, A4, A5, R>(ctor: instantiation.IFunctionSignature5<A1, A2, A3, A4, A5, R>, first: A1, second: A2, third: A3, fourth: A4, fifth: A5): R;
	invokeFunction<A1, A2, A3, A4, A5, A6, R>(ctor: instantiation.IFunctionSignature6<A1, A2, A3, A4, A5, A6, R>, first: A1, second: A2, third: A3, fourth: A4, fifth: A5, sixth: A6): R;
	invokeFunction<A1, A2, A3, A4, A5, A6, A7, R>(ctor: instantiation.IFunctionSignature7<A1, A2, A3, A4, A5, A6, A7, R>, first: A1, second: A2, third: A3, fourth: A4, fifth: A5, sixth: A6, seventh: A7): R;
	invokeFunction<A1, A2, A3, A4, A5, A6, A7, A8, R>(ctor: instantiation.IFunctionSignature8<A1, A2, A3, A4, A5, A6, A7, A8, R>, first: A1, second: A2, third: A3, fourth: A4, fifth: A5, sixth: A6, seventh: A7, eigth: A8): R;
	invokeFunction<R>(signature: any, ...args: any[]): R {
		return this._servicesMap.invokeFunction<R>(signature, args);
	}
}
