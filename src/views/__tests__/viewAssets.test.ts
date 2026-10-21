import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { fastify } from 'fastify';
import { expect, test } from 'vitest';

import type { ViewAssetsOptions } from '../viewAssets.ts';
import { registerViewAssets } from '../viewAssets.ts';

const NOT_FOUND = { error: 'Not found.', code: 'not-found' };
const PAGE = '<html><body>the page</body></html>';

/**
 * A views build: two assets, a font, a dotfile, a subfolder, the build's
 * own HTML and a file beside the assets folder.
 * @returns The build's folder.
 */
function build(): string {
  const root = mkdtempSync(join(tmpdir(), 'views-'));
  const assets = join(root, 'assets');
  mkdirSync(join(assets, 'sub'), { recursive: true });
  writeFileSync(join(assets, 'index-Bq3x9k2a.js'), 'export const view = 1;\n');
  writeFileSync(join(assets, 'index-C7aB8cD9.css'), 'body { margin: 0; }\n');
  writeFileSync(join(assets, 'inter-1a2b.woff2'), 'woff2');
  writeFileSync(join(assets, '.env'), 'SECRET=1\n');
  writeFileSync(join(assets, 'sub', 'nested-1a2b.js'), 'nested\n');
  writeFileSync(join(root, 'index.html'), '<!doctype html><p>views</p>');
  writeFileSync(join(root, 'secret.json'), '{"secret":1}\n');
  return root;
}

/**
 * A server whose page answers every address, with the views' assets.
 * @param options - Where the build is, and what is retained.
 * @returns The server.
 */
async function serverWith(
  options: ViewAssetsOptions,
): Promise<FastifyInstance> {
  const app = fastify();
  app.get('/*', (_request, reply) => reply.type('text/html').send(PAGE));
  await registerViewAssets(app, options);
  return app;
}

test('an asset is served to any origin, without credentials, cached for a year, with its type', async () => {
  const app = await serverWith({ root: build() });
  const script = await app.inject({
    url: '/views/assets/index-Bq3x9k2a.js',
    headers: { origin: 'null', 'sec-fetch-site': 'cross-site' },
  });
  const style = await app.inject({ url: '/views/assets/index-C7aB8cD9.css' });
  const font = await app.inject({ url: '/views/assets/inter-1a2b.woff2' });
  const head = await app.inject({
    method: 'HEAD',
    url: '/views/assets/index-Bq3x9k2a.js',
  });

  expect([script.statusCode, script.body]).toStrictEqual([
    200,
    'export const view = 1;\n',
  ]);
  expect({
    'access-control-allow-origin':
      script.headers['access-control-allow-origin'],
    'cross-origin-resource-policy':
      script.headers['cross-origin-resource-policy'],
    'cache-control': script.headers['cache-control'],
    'content-type': script.headers['content-type'],
    'x-content-type-options': script.headers['x-content-type-options'],
    'set-cookie': script.headers['set-cookie'],
  }).toStrictEqual({
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'cache-control': 'public, max-age=31536000, immutable',
    'content-type': 'application/javascript; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'set-cookie': undefined,
  });
  expect([
    style.headers['content-type'],
    font.headers['content-type'],
  ]).toStrictEqual(['text/css; charset=utf-8', 'font/woff2']);
  expect([
    head.statusCode,
    head.body,
    head.headers['content-length'],
  ]).toStrictEqual([200, '', '23']);
});

test.each([
  '/views/assets/missing-1a2b.js',
  '/views/assets/.env',
  '/views/assets/sub/nested-1a2b.js',
  '/views/assets/..%2fsecret.json',
  '/views/assets/%2e%2e%2fsecret.json',
  '/views/assets/..%5csecret.json',
  '/views/assets/INDEX-BQ3X9K2A.JS',
  '/views/assets/',
  '/views/assets',
])('%s answers 404 not-found, never a file nor the page', async (url) => {
  const app = await serverWith({ root: build() });
  const response = await app.inject({ url });

  expect([
    response.statusCode,
    response.json(),
    response.headers['cache-control'],
  ]).toStrictEqual([404, NOT_FOUND, 'no-store']);
});

test("a method other than GET or HEAD finds no asset, and the build's own HTML stays the page's", async () => {
  const app = await serverWith({ root: build() });
  const posted = await app.inject({
    method: 'POST',
    url: '/views/assets/index-Bq3x9k2a.js',
    payload: {},
  });
  const views = await app.inject({ url: '/views/index.html' });

  expect([posted.statusCode, posted.json()]).toStrictEqual([404, NOT_FOUND]);
  expect([
    views.body,
    views.headers['access-control-allow-origin'],
  ]).toStrictEqual([PAGE, undefined]);
});

test('while the views are not built, every asset answers 404 and the server starts, under the prefix asked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'no-views-'));
  const app = await serverWith({ root, prefix: '/static/views' });
  const response = await app.inject({ url: '/static/views/index-Bq3x9k2a.js' });

  expect([response.statusCode, response.json()]).toStrictEqual([
    404,
    NOT_FOUND,
  ]);
});

test('a retained asset is still served after a deploy, until no build has had it for retainDays', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'retained-'));
  const retainDirectory = join(parent, 'v');
  const first = build();
  await serverWith({ root: first, retainDirectory });
  const second = build();
  rmSync(join(second, 'assets', 'index-Bq3x9k2a.js'));
  writeFileSync(join(second, 'assets', 'index-Zz9y8x7w.js'), 'export {};\n');
  const old = join(retainDirectory, 'gone-0000.js');
  writeFileSync(old, 'old\n');
  const longAgo = new Date(Date.now() - 31 * 86_400_000);
  utimesSync(old, longAgo, longAgo);

  const app = await serverWith({ root: second, retainDirectory });
  const earlier = await app.inject({ url: '/views/assets/index-Bq3x9k2a.js' });
  const current = await app.inject({ url: '/views/assets/index-Zz9y8x7w.js' });

  expect([earlier.statusCode, earlier.body]).toStrictEqual([
    200,
    'export const view = 1;\n',
  ]);
  expect([current.statusCode, current.body]).toStrictEqual([
    200,
    'export {};\n',
  ]);
  expect(existsSync(old)).toBe(false);
  expect(
    readdirSync(retainDirectory).toSorted((a, b) => a.localeCompare(b)),
  ).toStrictEqual([
    'index-Bq3x9k2a.js',
    'index-C7aB8cD9.css',
    'index-Zz9y8x7w.js',
    'inter-1a2b.woff2',
  ]);
});
