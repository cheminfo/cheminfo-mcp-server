/**
 * What the bootstrap reads of a worker's options.
 */
export interface SandboxWorkerOptions {
  /**
   * The kind of script the worker runs.
   * @default 'classic'
   */
  type?: 'classic' | 'module';
  /**
   * The worker's name, for the developer tools.
   * @default undefined
   */
  name?: string;
}

/**
 * A `Worker` constructor, or a stand-in for one.
 */
export type WorkerConstructor = new (
  url: string | URL,
  options?: SandboxWorkerOptions,
) => object;

/**
 * What {@link installSandboxWorkers} reads of the page's global scope:
 * `globalThis` in a page.
 */
export interface SandboxScope {
  /**
   * The page's origin, `'null'` in an opaque one.
   * @default undefined - not an opaque origin: workers are left as they are
   */
  origin?: string;
  /**
   * The page's address.
   * @default undefined - a worker's address must then be absolute
   */
  location?: { href: string };
  /**
   * The page's document, against whose base URL a worker's relative address
   * resolves, as `new Worker()` resolves it.
   * @default undefined - the address resolves against `location.href`
   */
  document?: { baseURI: string };
  /**
   * The page's `Worker` constructor, replaced by one starting the bootstrap.
   * @default undefined - no worker to start: nothing is installed
   */
  Worker?: WorkerConstructor;
}

const installed = new WeakSet<object>();

/**
 * Let a page framed by an `embedView` start its workers. A chat draws the view
 * in a sandboxed frame, whose sandbox every frame inside it inherits: the page
 * then runs in an opaque origin (`origin` is `'null'`), where
 * `new Worker(url)` fails for any http(s) script (Chromium throws "cannot be
 * accessed from origin 'null'", Firefox and WebKit fire an error event).
 *
 * In such a page, and only there, every worker is started from a `data:` URL
 * (see {@link workerBootstrapUrl}) that rebases the worker's relative loads on
 * the real script's address, then runs that script. A relative address
 * resolves against the document's base URL when the worker is made. Inside
 * the worker `self.location` is the `data:` URL, so an address built from it
 * still fails, as do those of Vite's default `iife` worker format, which
 * rewrites `import.meta.url` to `self.location.href`. Use module workers
 * (`type: 'module'`, Vite `worker.format: 'es'`), whose `import.meta.url` is
 * the script's own address. A `blob:` worker is started as it is: a module
 * one does not run in Chromium. The site serves the scripts and what they
 * fetch with `Access-Control-Allow-Origin: *`, as the requests come from an
 * opaque origin.
 *
 * Call it before any module that makes a worker is evaluated (see
 * `installEmbedPage`). Anywhere else it does nothing.
 * @param scope - The page's global scope.
 */
export function installSandboxWorkers(
  scope: SandboxScope = globalThis as SandboxScope,
): void {
  const NativeWorker = scope.Worker;
  if (
    scope.origin !== 'null' ||
    NativeWorker === undefined ||
    installed.has(NativeWorker)
  ) {
    return;
  }
  class SandboxWorker extends NativeWorker {
    constructor(url: string | URL, options?: SandboxWorkerOptions) {
      const base = scope.document?.baseURI ?? scope.location?.href;
      super(workerBootstrapUrl(url, options, base), options);
    }
  }
  installed.add(SandboxWorker);
  scope.Worker = SandboxWorker;
}

/**
 * The address a worker is started from in an opaque origin: a `data:` URL
 * whose script first makes `fetch`, `XMLHttpRequest` and `importScripts`
 * resolve a relative address against the real script's, then runs that
 * script by its absolute address: a module imports it, a classic script calls
 * `importScripts`. A `data:` or `blob:` address is kept as it is.
 * @param url - The worker's script, as the page names it.
 * @param options - The worker's options.
 * @param base - The address against which a relative one resolves.
 * @returns The address to start the worker from.
 */
export function workerBootstrapUrl(
  url: string | URL,
  options: SandboxWorkerOptions = {},
  base?: string,
): string {
  const href = new URL(String(url), base).href;
  if (href.startsWith('data:') || href.startsWith('blob:')) return href;
  const patch = rebasePatch(href);
  const script = JSON.stringify(href);
  const source =
    options.type === 'module'
      ? `import ${JSON.stringify(dataUrl(patch))};\nimport ${script};`
      : `{\n${patch}\nconst nativeImportScripts = importScripts;\nglobalThis.importScripts = (...urls) => nativeImportScripts(...urls.map(rebase));\n}\nimportScripts(${script});`;
  return dataUrl(source);
}

/**
 * The script that makes a worker's relative loads resolve against its real
 * address rather than against its `data:` URL.
 * @param href - The worker script's absolute address.
 * @returns The script, which leaves `rebase` in its scope.
 */
function rebasePatch(href: string): string {
  return `const base = ${JSON.stringify(href)};
const rebase = (url) => {
  if (typeof url !== 'string') return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => nativeFetch(rebase(input), init);
if (typeof XMLHttpRequest === 'function') {
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return nativeOpen.call(this, method, rebase(url), ...rest);
  };
}`;
}

/**
 * The address of a script given in full.
 * @param source - The script.
 * @returns Its `data:` URL.
 */
function dataUrl(source: string): string {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
