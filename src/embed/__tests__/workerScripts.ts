import { resolveObjectURL } from 'node:buffer';
import { createContext, runInContext } from 'node:vm';

/**
 * A worker's global scope, whose loads are recorded.
 */
export interface WorkerGlobals {
  URL: typeof URL;
  importScripts: (...urls: string[]) => void;
  fetch: (input: unknown) => Promise<void>;
  XMLHttpRequest: new () => { open: (method: string, url: string) => void };
}

/**
 * A module bootstrap running in a global scope of its own, whose `import()`
 * never loads anything.
 */
export interface ModuleRun {
  /**
   * The worker's global scope.
   */
  globals: WorkerGlobals;
  /**
   * Where the page's messages arrive.
   */
  target: EventTarget;
  /**
   * The callbacks given to `setTimeout`, not run yet.
   */
  timers: Array<() => void>;
  /**
   * The addresses given to `import()`.
   */
  imports: string[];
  /**
   * The loads the worker made.
   */
  loads: string[];
  /**
   * Run a script in the worker's global scope.
   */
  evaluate: (script: string) => unknown;
}

/**
 * The script a `data:` URL carries.
 * @param url - The `data:` URL of a script.
 * @returns The script.
 */
export function decoded(url: string): string {
  return decodeURIComponent(url.slice('data:text/javascript,'.length));
}

/**
 * The script a `blob:` URL of this process holds.
 * @param url - The `blob:` URL.
 * @returns The script.
 */
export async function sourceOf(url: string): Promise<string> {
  const blob = resolveObjectURL(url);
  if (blob === undefined) throw new Error(`No blob at ${url}`);
  return blob.text();
}

/**
 * The address of the script a bootstrap runs.
 * @param url - The bootstrap's `blob:` URL.
 * @returns The script's absolute address.
 */
export async function scriptOf(url: string): Promise<string> {
  const source = await sourceOf(url);
  const literal = /^const base = (?<href>.+);$/m.exec(source)?.groups?.href;
  return JSON.parse(literal ?? '""') as string;
}

/**
 * A worker's global scope, whose loads are recorded.
 * @param loads - Where each load is written.
 * @returns The scope.
 */
export function workerGlobals(loads: string[]): WorkerGlobals {
  class XMLHttpRequest {
    open(method: string, url: string) {
      loads.push(`open ${method} ${url}`);
    }
  }
  return {
    URL,
    importScripts: (...urls) => {
      loads.push(`importScripts ${urls.join(' ')}`);
    },
    fetch: async (input) => {
      loads.push(`fetch ${String(input)}`);
    },
    XMLHttpRequest,
  };
}

/**
 * Run a module bootstrap in a global scope of its own.
 * @param source - The bootstrap.
 * @param load - What its `import()` returns, given the address.
 * @returns The run.
 */
export function runModuleBootstrap(
  source: string,
  load: (specifier: string) => Promise<unknown>,
): ModuleRun {
  const target = new EventTarget();
  const timers: Array<() => void> = [];
  const imports: string[] = [];
  const loads: string[] = [];
  const globals = workerGlobals(loads);
  const context = createContext({
    ...globals,
    MessageEvent,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    setTimeout: (callback: () => void) => {
      timers.push(callback);
    },
    importModule: (specifier: string) => {
      imports.push(specifier);
      return load(specifier);
    },
  });
  // `node:vm` runs no `import()` without a flag: the bootstrap calls a
  // stand-in, which records the address.
  runInContext(source.replace('import(', 'importModule('), context);
  return {
    globals: context as WorkerGlobals,
    target,
    timers,
    imports,
    loads,
    evaluate: (script) => runInContext(script, context),
  };
}
