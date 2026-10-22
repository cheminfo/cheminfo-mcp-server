import { workerBootstrapSource } from './workerBootstrap.ts';

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
const bootstraps = new Map<string, string>();

/**
 * Let a page framed by an `embedView` start its workers. A chat draws the view
 * in a sandboxed frame, whose sandbox every frame inside it inherits: the page
 * then runs in an opaque origin (`origin` is `'null'`), where
 * `new Worker(url)` fails for any http(s) script (Chromium throws "cannot be
 * accessed from origin 'null'", Firefox and WebKit fire an error event).
 *
 * In such a page, and only there, every worker is started as a classic worker
 * from a `blob:` URL (see {@link workerBootstrapUrl}), which runs in the
 * page's own origin. Its script rebases the worker's relative loads on the
 * real script's address, then runs that script: a classic one with
 * `importScripts`, a module with a dynamic `import()`, the messages posted
 * before the module listens being held, then delivered. Neither a `data:`
 * worker, whose origin is a new opaque one, nor a module `blob:` one would
 * do: in a `data:` worker WebKit refuses to read any `Blob` (`stream()`,
 * `arrayBuffer()`, `text()`, `FileReader`, a `blob:` URL fetched), and
 * Chromium never runs a module worker from a `blob:` URL in an opaque origin.
 *
 * A relative address resolves against the document's base URL when the
 * worker is made. Inside the worker `self.location` is the `blob:` URL, so an
 * address built from it still fails, as do those of Vite's default `iife`
 * worker format, which rewrites `import.meta.url` to `self.location.href`. Use
 * module workers (`type: 'module'`, Vite `worker.format: 'es'`), whose
 * `import.meta.url` is the script's own address. A `data:` or `blob:` worker
 * is started as it is: a module `blob:` one does not run in Chromium. The
 * site serves the scripts and what they fetch with
 * `Access-Control-Allow-Origin: *`, as the requests come from an opaque
 * origin.
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
      super(...workerArguments(url, options, base));
    }
  }
  installed.add(SandboxWorker);
  scope.Worker = SandboxWorker;
}

/**
 * The address a worker is started from in an opaque origin: a `blob:` URL of
 * the classic script that runs the worker's own (see
 * {@link installSandboxWorkers}), made once per script and kept for the
 * page's lifetime. A worker started from it is a classic one, whatever its
 * `type`. A `data:` or `blob:` address is kept as it is.
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
  return workerArguments(url, options, base)[0];
}

/**
 * What a worker is started with in an opaque origin.
 * @param url - The worker's script, as the page names it.
 * @param options - The worker's options.
 * @param base - The address against which a relative one resolves.
 * @returns The address to start the worker from, and its options.
 */
function workerArguments(
  url: string | URL,
  options: SandboxWorkerOptions | undefined,
  base: string | undefined,
): [string, SandboxWorkerOptions | undefined] {
  const href = new URL(String(url), base).href;
  if (href.startsWith('data:') || href.startsWith('blob:')) {
    return [href, options];
  }
  const source = workerBootstrapSource(href, options?.type === 'module');
  let bootstrap = bootstraps.get(source);
  if (bootstrap === undefined) {
    bootstrap = URL.createObjectURL(
      new Blob([source], { type: 'text/javascript' }),
    );
    bootstraps.set(source, bootstrap);
  }
  return [bootstrap, { ...options, type: 'classic' }];
}
