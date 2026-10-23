import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { expect, test } from 'vitest';

import { ToolRefusalError as MainToolRefusalError } from '../../index.ts';
import { ToolRefusalError } from '../index.ts';

const SOURCE = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Every module a fresh thread resolves to import an entry of the package.
 * @param entry - The entry, e.g. `threads/index.ts` under `src`.
 * @returns The URLs it resolved.
 */
function modulesOf(entry: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('fixtures/importProbe.ts', import.meta.url),
      {
        workerData: new URL(entry, new URL('../../', import.meta.url)).href,
        execArgv: [],
      },
    );
    worker.once('message', (message: { resolved: string[] }) => {
      resolve(message.resolved);
      void worker.terminate();
    });
    worker.once('error', reject);
  });
}

function packagesOf(urls: readonly string[]): string[] {
  const packages = new Set<string>();
  for (const url of urls) {
    const match = /\/node_modules\/(?<name>@[^/]+\/[^/]+|[^/@]+)\//.exec(url);
    if (match?.groups?.name !== undefined) packages.add(match.groups.name);
  }
  return [...packages].toSorted((first, second) => first.localeCompare(second));
}

test('the threads entry loads no package: no Fastify, no MCP SDK, no zod', async () => {
  const modules = await modulesOf('threads/index.ts');
  const files = new Set<string>();
  for (const url of modules) {
    if (!url.startsWith('file:')) continue;
    const path = relative(SOURCE, fileURLToPath(url));
    if (!path.startsWith('threads/__tests__')) files.add(path);
  }

  expect(packagesOf(modules)).toStrictEqual([]);
  expect(
    [...files].toSorted((first, second) => first.localeCompare(second)),
  ).toStrictEqual([
    'threads/index.ts',
    'threads/poolCalls.ts',
    'threads/runToolInThread.ts',
    'threads/serveToolThread.ts',
    'threads/threadMessages.ts',
    'threads/toolThreadPool.ts',
    'tools/refusals.ts',
    'tools/types.ts',
  ]);
});

test('the main entry, by contrast, loads the MCP SDK', async () => {
  const modules = await modulesOf('index.ts');

  expect(packagesOf(modules)).toContain('@modelcontextprotocol/sdk');
});

test('a refusal is one class, whichever entry it is imported from', () => {
  expect(ToolRefusalError).toBe(MainToolRefusalError);
});
