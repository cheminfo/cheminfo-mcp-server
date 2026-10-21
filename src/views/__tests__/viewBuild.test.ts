import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import type { ViewManifest } from '../viewBuild.ts';
import { readViewBuild, viewAssets } from '../viewBuild.ts';

import { ENTRY_ONLY, MANIFEST } from './viewManifests.ts';

test('the view loads the entry module, the modules it imports and their stylesheets, and OpenChemLib alone of what it imports on demand', () => {
  expect(viewAssets(MANIFEST)).toStrictEqual({
    script: 'assets/index-Bq3x9k2a.js',
    styles: ['assets/index-C7aB8cD9.css', 'assets/vendor-F0e1d2c3.css'],
    preloads: [
      'assets/vendor-D4fE5gH6.js',
      'assets/react-K2m4n6p8.js',
      'assets/openchemlib-Q9w8e7r6.js',
    ],
  });
});

test('a server names the chunks imported on demand that its view fetches at once', () => {
  expect([
    viewAssets(MANIFEST, { preload: ['fr'] }).preloads,
    viewAssets(MANIFEST, { preload: [] }).preloads,
  ]).toStrictEqual([
    [
      'assets/vendor-D4fE5gH6.js',
      'assets/react-K2m4n6p8.js',
      'assets/fr-KWC-k3fC.js',
    ],
    ['assets/vendor-D4fE5gH6.js', 'assets/react-K2m4n6p8.js'],
  ]);
});

test.each([
  [
    { 'a.js': { file: 'assets/a.js' } },
    'The views build has 0 entries; the view loads exactly one.',
  ],
  [
    {
      'a.html': { file: 'assets/a.js', isEntry: true },
      'b.html': { file: 'assets/b.js', isEntry: true },
    },
    'The views build has 2 entries; the view loads exactly one.',
  ],
  [
    {
      'index.html': {
        file: 'assets/a.js',
        isEntry: true,
        imports: ['_gone.js'],
      },
    },
    'The views manifest has no chunk "_gone.js".',
  ],
  [
    { 'index.html': { file: 'other/a.js', isEntry: true } },
    'The views build names a file outside its assets folder: "other/a.js".',
  ],
  [
    { 'index.html': { file: 'assets/sub/a.js', isEntry: true } },
    'The views build names a file outside its assets folder: "assets/sub/a.js".',
  ],
  [
    {
      'index.html': {
        file: 'assets/a.js',
        isEntry: true,
        css: ['assets/../../x.css'],
      },
    },
    'The views build names a file outside its assets folder: "assets/../../x.css".',
  ],
] satisfies Array<[ViewManifest, string]>)(
  'a build the view cannot load is refused (%#)',
  (manifest, error) => {
    expect(() => viewAssets(manifest)).toThrow(error);
  },
);

test('the build is read from its folder, and there is none while the views are not built', async () => {
  const built = mkdtempSync(join(tmpdir(), 'views-'));
  mkdirSync(join(built, '.vite'));
  writeFileSync(
    join(built, '.vite', 'manifest.json'),
    JSON.stringify(MANIFEST),
  );
  const empty = mkdtempSync(join(tmpdir(), 'no-views-'));

  await expect(readViewBuild(built)).resolves.toStrictEqual({
    manifest: MANIFEST,
    assets: viewAssets(MANIFEST),
  });
  await expect(readViewBuild(empty)).resolves.toBeUndefined();
});

test('the manifest is also read where the views build names it, the default place first', async () => {
  const named = mkdtempSync(join(tmpdir(), 'views-'));
  writeFileSync(join(named, 'manifest.json'), JSON.stringify(MANIFEST));
  const both = mkdtempSync(join(tmpdir(), 'views-'));
  mkdirSync(join(both, '.vite'));
  writeFileSync(
    join(both, '.vite', 'manifest.json'),
    JSON.stringify(ENTRY_ONLY),
  );
  writeFileSync(join(both, 'manifest.json'), JSON.stringify(MANIFEST));

  const fromNamed = await readViewBuild(named);
  const fromBoth = await readViewBuild(both);

  expect([fromNamed?.manifest, fromBoth?.manifest]).toStrictEqual([
    MANIFEST,
    ENTRY_ONLY,
  ]);
});

test('a manifest that is not a Vite manifest is an error, never an empty view', async () => {
  const broken = mkdtempSync(join(tmpdir(), 'views-'));
  mkdirSync(join(broken, '.vite'));
  writeFileSync(join(broken, '.vite', 'manifest.json'), '{"index.html": {');
  const wrong = mkdtempSync(join(tmpdir(), 'views-'));
  mkdirSync(join(wrong, '.vite'));
  writeFileSync(
    join(wrong, '.vite', 'manifest.json'),
    JSON.stringify({ 'index.html': { isEntry: true } }),
  );

  await expect(readViewBuild(broken)).rejects.toThrow(SyntaxError);
  await expect(readViewBuild(wrong)).rejects.toThrow(
    'Invalid input: expected string, received undefined',
  );
});
