import { expect, test } from 'vitest';

import type { SandboxScope, SandboxWorkerOptions } from '../index.ts';
import { installSandboxWorkers, workerBootstrapUrl } from '../index.ts';

import { decoded, scriptOf, sourceOf } from './workerScripts.ts';

class FakeWorker {
  readonly url: string;
  readonly options: SandboxWorkerOptions | undefined;

  constructor(url: string | URL, options?: SandboxWorkerOptions) {
    this.url = String(url);
    this.options = options;
  }
}

test('in an opaque origin a worker starts as a classic one from a blob URL running its script', async () => {
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
  const moduleSource = await sourceOf(module.url);
  const classicSource = await sourceOf(classic.url);
  const wrapper = JSON.parse(
    /^const wrapper = (?<url>.+);$/m.exec(moduleSource)?.groups?.url ?? '""',
  ) as string;
  const [release, script] = decoded(wrapper).split('\n', 2);

  expect(module).toBeInstanceOf(FakeWorker);
  expect(module.url).toMatch(/^blob:/);
  expect(module.options).toStrictEqual({ type: 'classic', name: 'occ' });
  expect(release).toBe(
    `import "data:text/javascript,${encodeURIComponent('globalThis[Symbol.for("cheminfo-mcp-server/sandbox-worker")]?.();')}";`,
  );
  expect(script).toBe(
    'import "https://3d.example/assets/occWorker-Dc_lersu.js";',
  );
  expect(classic.url).toMatch(/^blob:/);
  expect(classic.options).toStrictEqual({ type: 'classic' });
  expect(classicSource.split('\n').at(-1)).toBe(
    'importScripts("https://3d.example/assets/w.js");',
  );
});

test('a relative address resolves against the document base when the worker is made', async () => {
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

  await expect(
    Promise.all([first, second, third].map((worker) => scriptOf(worker.url))),
  ).resolves.toStrictEqual([
    'https://3d.example/assets/w.js',
    'https://3d.example/fr/assets/w.js',
    'https://3d.example/de/assets/w.js',
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

test('a data or blob address is started as it is, with its own options', async () => {
  const scope: SandboxScope = { origin: 'null', Worker: FakeWorker };
  installSandboxWorkers(scope);
  const Worker = scope.Worker as typeof FakeWorker;
  const inline = new Worker('blob:null/1234', { type: 'module' });

  expect([inline.url, inline.options]).toStrictEqual([
    'blob:null/1234',
    { type: 'module' },
  ]);
  expect(workerBootstrapUrl('data:text/javascript,postMessage(1)')).toBe(
    'data:text/javascript,postMessage(1)',
  );
  expect(workerBootstrapUrl('blob:null/1234')).toBe('blob:null/1234');
  await expect(
    scriptOf(
      workerBootstrapUrl(
        'w.js?v="1"',
        { type: 'module' },
        'https://x.example/a/',
      ),
    ),
  ).resolves.toBe('https://x.example/a/w.js?v=%221%22');
});

test('a bootstrap is made once per script and kind of script', () => {
  const module = workerBootstrapUrl('https://x.example/once.js', {
    type: 'module',
  });
  const classic = workerBootstrapUrl('https://x.example/once.js');

  expect(
    workerBootstrapUrl(
      'once.js',
      { type: 'module', name: 'second' },
      'https://x.example/',
    ),
  ).toBe(module);
  expect(classic).not.toBe(module);
  expect(
    workerBootstrapUrl('https://x.example/once.js', { type: 'classic' }),
  ).toBe(classic);
});
