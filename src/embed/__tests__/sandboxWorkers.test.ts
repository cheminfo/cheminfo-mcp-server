import { runInNewContext } from 'node:vm';

import { expect, test } from 'vitest';

import type { SandboxScope, SandboxWorkerOptions } from '../index.ts';
import { installSandboxWorkers, workerBootstrapUrl } from '../index.ts';

class FakeWorker {
  readonly url: string;
  readonly options: SandboxWorkerOptions | undefined;

  constructor(url: string | URL, options?: SandboxWorkerOptions) {
    this.url = String(url);
    this.options = options;
  }
}

interface WorkerGlobals {
  URL: typeof URL;
  importScripts: (...urls: string[]) => void;
  fetch: (input: unknown) => Promise<void>;
  XMLHttpRequest: new () => { open: (method: string, url: string) => void };
}

function decoded(url: string) {
  return decodeURIComponent(url.slice('data:text/javascript,'.length));
}

function lastLine(url: string) {
  return decoded(url).split('\n').at(-1);
}

/**
 * A worker's global scope, whose loads are recorded.
 * @param loads - Where each load is written.
 * @returns The scope, for `runInNewContext`.
 */
function workerGlobals(loads: string[]): WorkerGlobals {
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

test('in an opaque origin a worker starts from a data URL running its script', () => {
  const scope: SandboxScope = {
    origin: 'null',
    location: { href: 'https://3d.example/conformers?smiles=O&embed=1' },
    Worker: FakeWorker,
  };

  installSandboxWorkers(scope);
  const installedOnce = scope.Worker;
  installSandboxWorkers(scope);

  expect(scope.Worker).toBe(installedOnce);
  expect(scope.Worker).not.toBe(FakeWorker);

  const Worker = scope.Worker as typeof FakeWorker;
  const module = new Worker('/assets/occWorker-Dc_lersu.js', {
    type: 'module',
    name: 'occ',
  });
  const classic = new Worker(new URL('https://3d.example/assets/w.js'));
  const [patch, ...rest] = decoded(module.url).split('\n');

  expect(module).toBeInstanceOf(FakeWorker);
  expect(patch).toMatch(/^import "data:text\/javascript,[^"]+";$/);
  expect(rest).toStrictEqual([
    'import "https://3d.example/assets/occWorker-Dc_lersu.js";',
  ]);
  expect(module.options).toStrictEqual({ type: 'module', name: 'occ' });
  expect(lastLine(classic.url)).toBe(
    'importScripts("https://3d.example/assets/w.js");',
  );
  expect(classic.options).toBeUndefined();
});

test("a worker's relative loads resolve against its own script", async () => {
  const script = 'https://3d.example/assets/w.js';
  const classic: string[] = [];
  const classicGlobals = workerGlobals(classic);
  runInNewContext(decoded(workerBootstrapUrl(script)), classicGlobals);
  classicGlobals.importScripts('chunk.js', '/vendor/b.js');
  await classicGlobals.fetch('../data/table.json');
  new classicGlobals.XMLHttpRequest().open('GET', 'occ.wasm');

  expect(classic).toStrictEqual([
    'importScripts https://3d.example/assets/w.js',
    'importScripts https://3d.example/assets/chunk.js https://3d.example/vendor/b.js',
    'fetch https://3d.example/data/table.json',
    'open GET https://3d.example/assets/occ.wasm',
  ]);

  const source = decoded(workerBootstrapUrl(script, { type: 'module' }));
  const patch = /^import "(?<url>[^"]+)";/.exec(source)?.groups?.url ?? '';
  const module: string[] = [];
  const moduleGlobals = workerGlobals(module);
  runInNewContext(decoded(patch), moduleGlobals);
  await moduleGlobals.fetch('data.json');
  await moduleGlobals.fetch(new URL('https://cdn.example/x.json'));
  await moduleGlobals.fetch('http://[invalid');

  expect(module).toStrictEqual([
    'fetch https://3d.example/assets/data.json',
    'fetch https://cdn.example/x.json',
    'fetch http://[invalid',
  ]);
});

test('a relative address resolves against the document base when the worker is made', () => {
  const document = { baseURI: 'https://3d.example/' };
  const location = { href: 'https://3d.example/fr/conformers?smiles=CCCC' };
  const scope: SandboxScope = {
    origin: 'null',
    location,
    document,
    Worker: FakeWorker,
  };
  installSandboxWorkers(scope);
  const Worker = scope.Worker as typeof FakeWorker;
  const first = new Worker('assets/w.js', { type: 'module' });
  document.baseURI = 'https://3d.example/fr/';
  const second = new Worker('assets/w.js', { type: 'module' });
  delete scope.document;
  location.href = 'https://3d.example/de/conformers';
  const third = new Worker('assets/w.js', { type: 'module' });

  expect(
    [first, second, third].map((worker) => lastLine(worker.url)),
  ).toStrictEqual([
    'import "https://3d.example/assets/w.js";',
    'import "https://3d.example/fr/assets/w.js";',
    'import "https://3d.example/de/assets/w.js";',
  ]);
});

test('a page with an origin of its own keeps its workers as they are', () => {
  const scope: SandboxScope = {
    origin: 'https://3d.example',
    location: { href: 'https://3d.example/' },
    Worker: FakeWorker,
  };

  installSandboxWorkers(scope);
  const withoutWorker: SandboxScope = { origin: 'null' };
  installSandboxWorkers(withoutWorker);

  expect(scope.Worker).toBe(FakeWorker);
  expect(withoutWorker).toStrictEqual({ origin: 'null' });
});

test('a data or blob address is not wrapped again', () => {
  expect(workerBootstrapUrl('data:text/javascript,postMessage(1)')).toBe(
    'data:text/javascript,postMessage(1)',
  );
  expect(workerBootstrapUrl('blob:null/1234')).toBe('blob:null/1234');
  expect(
    lastLine(
      workerBootstrapUrl(
        'w.js?v="1"',
        { type: 'module' },
        'https://x.example/a/',
      ),
    ),
  ).toBe('import "https://x.example/a/w.js?v=%221%22";');
});
