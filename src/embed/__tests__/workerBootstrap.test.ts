import { runInNewContext } from 'node:vm';

import { expect, test } from 'vitest';

import { workerBootstrapUrl } from '../index.ts';

import {
  decoded,
  runModuleBootstrap,
  sourceOf,
  workerGlobals,
} from './workerScripts.ts';

const SCRIPT = 'https://3d.example/assets/w.js';

/**
 * The module bootstrap of `SCRIPT`.
 * @returns Its source.
 */
async function moduleSource() {
  return sourceOf(workerBootstrapUrl(SCRIPT, { type: 'module' }));
}

/**
 * The script of the module the wrapper imports first.
 * @param wrapper - The `data:` URL the bootstrap imports.
 * @returns The script releasing the messages.
 */
function releaseScript(wrapper: string) {
  const first = decoded(wrapper).split('\n', 1)[0] ?? '';
  return decoded(JSON.parse(first.slice('import '.length, -1)) as string);
}

/**
 * What an `import()` that never loads returns.
 * @returns A promise that never settles.
 */
function never(): Promise<never> {
  return new Promise(() => {
    // The module is never loaded.
  });
}

/**
 * Wait until the pending promise callbacks have run.
 */
async function settled() {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test("a classic worker's relative loads resolve against its own script", async () => {
  const loads: string[] = [];
  const globals = workerGlobals(loads);
  runInNewContext(await sourceOf(workerBootstrapUrl(SCRIPT)), globals);
  globals.importScripts('chunk.js', '/vendor/b.js');
  await globals.fetch('../data/table.json');
  new globals.XMLHttpRequest().open('GET', 'occ.wasm');

  expect(loads).toStrictEqual([
    'importScripts https://3d.example/assets/w.js',
    'importScripts https://3d.example/assets/chunk.js https://3d.example/vendor/b.js',
    'fetch https://3d.example/data/table.json',
    'open GET https://3d.example/assets/occ.wasm',
  ]);
});

test("a module worker's relative loads resolve against its own script", async () => {
  const source = await moduleSource();
  const run = runModuleBootstrap(source, never);
  await run.globals.fetch('data.json');
  await run.globals.fetch(new URL('https://cdn.example/x.json'));
  await run.globals.fetch('http://[invalid');
  run.globals.importScripts('chunk.js');
  new run.globals.XMLHttpRequest().open('GET', 'occ.wasm');

  expect(source.split('import(')).toHaveLength(2);
  expect(run.imports).toHaveLength(1);
  expect(decoded(run.imports[0] ?? '').split('\n', 2)[1]).toBe(
    `import "${SCRIPT}";`,
  );
  expect(run.loads).toStrictEqual([
    'fetch https://3d.example/assets/data.json',
    'fetch https://cdn.example/x.json',
    'fetch http://[invalid',
    'importScripts https://3d.example/assets/chunk.js',
    'open GET https://3d.example/assets/occ.wasm',
  ]);
});

test('a module worker holds the messages posted before its script runs, then delivers each in a task of its own', async () => {
  const run = runModuleBootstrap(await moduleSource(), never);
  const received: unknown[] = [];
  const channel = new MessageChannel();
  const post = (data: unknown, ports: MessagePort[] = []) => {
    run.target.dispatchEvent(new MessageEvent('message', { data, ports }));
  };
  post(1);
  post(2, [channel.port1]);
  const releaseType = `typeof globalThis[Symbol.for('cheminfo-mcp-server/sandbox-worker')]`;
  const before = run.evaluate(releaseType);
  // The evaluation of the wrapper: the release module, then the script,
  // which listens.
  run.evaluate(releaseScript(run.imports[0] ?? ''));
  run.target.addEventListener('message', (event) => {
    const { data, ports } = event as MessageEvent;
    received.push(
      ports[0] === channel.port1 ? `${String(data)} with port` : data,
    );
  });
  post(3);
  const delivered: unknown[][] = [[...received]];
  while (run.timers.length > 0) {
    run.timers.shift()?.();
    delivered.push([...received]);
  }
  post(4);
  channel.port1.close();

  expect([before, run.evaluate(releaseType)]).toStrictEqual([
    'function',
    'undefined',
  ]);
  expect(delivered).toStrictEqual([
    [],
    [1],
    [1, '2 with port'],
    [1, '2 with port', 3],
    [1, '2 with port', 3],
  ]);
  expect(received).toStrictEqual([1, '2 with port', 3, 4]);
  expect(run.timers).toHaveLength(0);
});

test('a module that cannot be loaded is an uncaught error naming its script', async () => {
  const source = await moduleSource();
  const failure = new Error('top-level failure');
  const unloadable = runModuleBootstrap(source, async (specifier) => {
    throw new TypeError(
      `Failed to fetch dynamically imported module: ${specifier}`,
    );
  });
  const throwing = runModuleBootstrap(source, async () => {
    throw failure;
  });
  await settled();
  const thrown = [unloadable, throwing].map((run) => {
    try {
      run.timers[0]?.();
    } catch (error) {
      return error;
    }
    return undefined;
  });

  expect(
    [unloadable.timers, throwing.timers].map((timers) => timers.length),
  ).toStrictEqual([1, 1]);
  expect([
    (thrown[0] as Error).name,
    (thrown[0] as Error).message,
  ]).toStrictEqual([
    'TypeError',
    `Failed to fetch dynamically imported module: ${SCRIPT}`,
  ]);
  expect(thrown[1]).toBe(failure);
});
