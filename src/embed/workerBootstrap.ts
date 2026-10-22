/**
 * The global symbol, `Symbol.for(RELEASE_KEY)`, under which a module worker's
 * bootstrap leaves the function releasing the messages it holds.
 */
const RELEASE_KEY = 'cheminfo-mcp-server/sandbox-worker';

/**
 * The classic script a worker is started from in an opaque origin. It first
 * makes `fetch`, `XMLHttpRequest` and `importScripts` resolve a relative
 * address against the real script's, then runs that script by its absolute
 * address: a classic one with `importScripts`, a module with a dynamic
 * `import()`, holding the messages posted to the worker until the module
 * listens.
 * @param href - The worker script's absolute address.
 * @param isModule - Whether the script is a module.
 * @returns The script.
 */
export function workerBootstrapSource(href: string, isModule: boolean): string {
  const patch = rebasePatch(href);
  if (!isModule) {
    return `{\n${patch}\n}\nimportScripts(${JSON.stringify(href)});`;
  }
  return `{\n${patch}\n${moduleRunner(href)}\n}`;
}

/**
 * The script that makes a worker's relative loads resolve against its real
 * address rather than against the bootstrap's.
 * @param href - The worker script's absolute address.
 * @returns The script, which leaves `base` and `rebase` in its scope.
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
}
const nativeImportScripts = globalThis.importScripts;
globalThis.importScripts = (...urls) => nativeImportScripts(...urls.map(rebase));`;
}

/**
 * The script that runs a module from a classic worker. A message the page
 * posts before the module listens would be lost, as the classic script ends
 * before the module is loaded: each one is held, and replayed, one task each,
 * once the module's synchronous part has run, as a module worker delivers it.
 * The `data:` module it imports first imports the one calling the release,
 * then the script, so that the release runs in the same evaluation. A module
 * that fails to load or to run is reported as an uncaught error, which the
 * page receives as an `error` event, naming the script rather than the
 * wrapping module.
 * @param href - The worker script's absolute address.
 * @returns The script.
 */
function moduleRunner(href: string): string {
  const key = JSON.stringify(RELEASE_KEY);
  const release = dataUrl(`globalThis[Symbol.for(${key})]?.();`);
  const wrapper = dataUrl(
    `import ${JSON.stringify(release)};\nimport ${JSON.stringify(href)};`,
  );
  return `const held = [];
const replayed = new WeakSet();
const hold = (event) => {
  if (replayed.has(event)) return;
  event.stopImmediatePropagation();
  held.push(event);
};
const replay = () => {
  const event = held.shift();
  if (event === undefined) {
    removeEventListener('message', hold);
    return;
  }
  const copy = new MessageEvent('message', { data: event.data, ports: event.ports });
  replayed.add(copy);
  dispatchEvent(copy);
  setTimeout(replay);
};
addEventListener('message', hold);
const release = Symbol.for(${key});
globalThis[release] = () => {
  delete globalThis[release];
  setTimeout(replay);
};
const wrapper = ${JSON.stringify(wrapper)};
import(wrapper).catch((error) => {
  const failure =
    typeof error?.message === 'string' && error.message.includes(wrapper)
      ? new TypeError(error.message.replaceAll(wrapper, base))
      : error;
  setTimeout(() => {
    throw failure;
  });
});`;
}

/**
 * The address of a script given in full.
 * @param source - The script.
 * @returns Its `data:` URL.
 */
function dataUrl(source: string): string {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
