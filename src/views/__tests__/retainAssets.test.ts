import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fastify } from 'fastify';
import { expect, test } from 'vitest';

import { retainAssets } from '../retainAssets.ts';
import { registerViewAssets } from '../viewAssets.ts';

/**
 * A build of one asset, in a folder of its own.
 * @returns The folder that holds the build (`views`) and the retained files.
 */
function folders(): string {
  const parent = mkdtempSync(join(tmpdir(), 'views-'));
  mkdirSync(join(parent, 'views', 'assets'), { recursive: true });
  writeFileSync(join(parent, 'views', 'assets', 'app-1a2b.js'), 'export {};\n');
  return parent;
}

test('the build and the retained folder may be given from the working directory', async () => {
  const parent = folders();
  const app = fastify();
  const working = process.cwd();
  process.chdir(parent);
  try {
    await registerViewAssets(app, {
      root: 'views',
      retainDirectory: 'retained',
    });
  } finally {
    process.chdir(working);
  }
  const response = await app.inject({ url: '/views/assets/app-1a2b.js' });
  await app.close();

  expect([response.statusCode, response.body]).toStrictEqual([
    200,
    'export {};\n',
  ]);
});

test('a build that is not a folder, or a retained folder that cannot be written, stops the server', async () => {
  const parent = folders();
  const notFolder = join(parent, 'file');
  writeFileSync(notFolder, '');
  const locked = join(parent, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o500);

  await expect(
    retainAssets(notFolder, join(parent, 'retained'), 30),
  ).rejects.toThrow('ENOTDIR');
  await expect(
    retainAssets(join(parent, 'views', 'assets'), locked, 30),
  ).rejects.toThrow('EACCES');

  chmodSync(locked, 0o700);
});
