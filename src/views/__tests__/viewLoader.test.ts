import { expect, test } from 'vitest';

import { viewAssets } from '../viewBuild.ts';
import { viewLoaderScript } from '../viewLoader.ts';

import { ENTRY_ONLY, MANIFEST } from './viewManifests.ts';

test('the loader adds the stylesheets and the preloads, then imports the hashed entry, beside itself', () => {
  expect(viewLoaderScript(viewAssets(MANIFEST)).split('\n')).toStrictEqual([
    "const base = new URL('./', import.meta.url);",
    'const add = (rel, file) => {',
    "  const link = document.createElement('link');",
    '  link.rel = rel;',
    "  link.crossOrigin = '';",
    '  link.href = new URL(file, base).href;',
    '  document.head.append(link);',
    '};',
    'for (const file of ["index-C7aB8cD9.css", "vendor-F0e1d2c3.css"]) add(\'stylesheet\', file);',
    'for (const file of ["vendor-D4fE5gH6.js", "react-K2m4n6p8.js", "openchemlib-Q9w8e7r6.js"]) add(\'modulepreload\', file);',
    'await import(new URL("index-Bq3x9k2a.js", base).href);',
    '',
  ]);
  expect(
    viewLoaderScript(viewAssets(ENTRY_ONLY)).split('\n').slice(8, 11),
  ).toStrictEqual([
    "for (const file of []) add('stylesheet', file);",
    "for (const file of []) add('modulepreload', file);",
    'await import(new URL("main-1a2b.js", base).href);',
  ]);
});
