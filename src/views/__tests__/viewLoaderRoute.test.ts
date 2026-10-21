import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fastify } from 'fastify';
import { expect, test } from 'vitest';

import type { ViewAssetsOptions } from '../viewAssets.ts';
import { registerViewAssets } from '../viewAssets.ts';
import { viewAssets } from '../viewBuild.ts';
import { viewLoaderScript } from '../viewLoader.ts';

import { MANIFEST } from './viewManifests.ts';

const NOT_FOUND = { error: 'Not found.', code: 'not-found' };

/**
 * A views build with its manifest.
 * @param manifest - What its manifest holds.
 * @returns The build's folder.
 */
function built(manifest: string): string {
  const root = mkdtempSync(join(tmpdir(), 'views-'));
  mkdirSync(join(root, '.vite'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, '.vite', 'manifest.json'), manifest);
  writeFileSync(join(root, 'assets', 'index-Bq3x9k2a.js'), 'export {};\n');
  return root;
}

/**
 * Ask for the loader of a server serving a build's assets.
 * @param options - The build, and whether the loader is served.
 * @param headers - The request's headers.
 * @returns The response.
 */
async function askLoader(
  options: ViewAssetsOptions,
  headers: Record<string, string> = {},
) {
  const app = fastify();
  await registerViewAssets(app, options);
  const response = await app.inject({
    url: '/views/assets/loader.js',
    headers,
  });
  await app.close();
  return response;
}

test('the loader is served beside the assets, to any origin, asked again every time, with an ETag, weak or in a list', async () => {
  const root = built(JSON.stringify(MANIFEST));
  const loader = await askLoader({ root, loader: true });
  const etag = String(loader.headers.etag);
  const again = await askLoader(
    { root, loader: true },
    { 'if-none-match': etag },
  );
  const weak = await askLoader(
    { root, loader: true },
    { 'if-none-match': `"000000000000", W/${etag}` },
  );

  expect([
    loader.statusCode,
    loader.headers['content-type'],
    loader.headers['cache-control'],
    loader.headers['access-control-allow-origin'],
    loader.body,
  ]).toStrictEqual([
    200,
    'text/javascript; charset=utf-8',
    'no-cache',
    '*',
    viewLoaderScript(viewAssets(MANIFEST)),
  ]);
  expect(loader.headers.etag).toMatch(/^"[\da-f]{12}"$/);
  expect([again.statusCode, again.body]).toStrictEqual([304, '']);
  expect(weak.statusCode).toBe(304);
});

test('without the option, while the views are not built, or from a broken build, there is no loader', async () => {
  const root = built(JSON.stringify(MANIFEST));
  const off = await askLoader({ root });
  const unbuilt = mkdtempSync(join(tmpdir(), 'no-views-'));
  const empty = await askLoader({ root: unbuilt, loader: true });
  const broken = await askLoader({
    root: built('{"index.html": {'),
    loader: true,
  });

  expect([off.statusCode, off.json()]).toStrictEqual([404, NOT_FOUND]);
  expect([empty.statusCode, empty.json()]).toStrictEqual([404, NOT_FOUND]);
  expect([broken.statusCode, broken.json()]).toStrictEqual([
    500,
    {
      error: 'The file could not be read. Try again later.',
      code: 'internal',
    },
  ]);
});
