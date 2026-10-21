import { expect, test } from 'vitest';

import { viewAssets } from '../viewBuild.ts';
import type { ViewResourceOptions } from '../viewResource.ts';
import { viewResource, viewsBaseUrl } from '../viewResource.ts';

import { ENTRY_ONLY, MANIFEST } from './viewManifests.ts';

const BUILD = { manifest: MANIFEST, assets: viewAssets(MANIFEST) };
const SMALL = { manifest: ENTRY_ONLY, assets: viewAssets(ENTRY_ONLY) };
const ELN: Omit<ViewResourceOptions, 'baseUrl'> = {
  uri: 'ui://scipeaks/eln',
  name: 'SciPeaks ELN',
  description: 'Shows the results of the ELN tools.',
  permissions: { clipboardWrite: {} },
  prefersBorder: true,
};
const ASSETS = 'https://eln.epfl.ch/mcp/views/assets';

test('the base of the assets is the public URL, else the origin the request came to', () => {
  const request = { protocol: 'http', host: 'localhost:11017' };

  expect([
    viewsBaseUrl('https://eln.epfl.ch/mcp/', request),
    viewsBaseUrl(undefined, request),
  ]).toStrictEqual(['https://eln.epfl.ch/mcp/', 'http://localhost:11017/']);
});

test('the resource is a small page that loads the hashed app, under a policy naming its origin and no origin to call', () => {
  expect(
    viewResource(BUILD, { ...ELN, baseUrl: 'https://eln.epfl.ch/mcp/' }),
  ).toStrictEqual({
    uri: 'ui://scipeaks/eln',
    name: 'SciPeaks ELN',
    description: 'Shows the results of the ELN tools.',
    html: [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="utf-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
      '    <meta name="color-scheme" content="light dark" />',
      '    <title>SciPeaks ELN</title>',
      `    <link rel="stylesheet" crossorigin href="${ASSETS}/index-C7aB8cD9.css" />`,
      `    <link rel="stylesheet" crossorigin href="${ASSETS}/vendor-F0e1d2c3.css" />`,
      `    <link rel="modulepreload" crossorigin href="${ASSETS}/vendor-D4fE5gH6.js" />`,
      `    <link rel="modulepreload" crossorigin href="${ASSETS}/react-K2m4n6p8.js" />`,
      `    <link rel="modulepreload" crossorigin href="${ASSETS}/openchemlib-Q9w8e7r6.js" />`,
      `    <script type="module" crossorigin src="${ASSETS}/index-Bq3x9k2a.js"></script>`,
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      '  </body>',
      '</html>',
      '',
    ].join('\n'),
    csp: { resourceDomains: ['https://eln.epfl.ch'], connectDomains: [] },
    permissions: { clipboardWrite: {} },
    prefersBorder: true,
  });
});

test('in development the assets come from the origin of the request, a missing trailing slash added, under the path asked', () => {
  const local = viewResource(SMALL, {
    uri: 'ui://chat/molecule',
    name: 'Molecule <view>',
    baseUrl: 'http://localhost:11017',
  });
  const ipv6 = viewResource(SMALL, {
    ...ELN,
    baseUrl: 'http://[::1]:11050/mcp',
    assetsPath: 'static/views',
  });

  expect([
    local.csp,
    local.description,
    local.prefersBorder,
    (local.html as string).split('\n').slice(6, 8),
  ]).toStrictEqual([
    { resourceDomains: ['http://localhost:11017'], connectDomains: [] },
    undefined,
    undefined,
    [
      '    <title>Molecule &lt;view&gt;</title>',
      '    <script type="module" crossorigin src="http://localhost:11017/views/assets/main-1a2b.js"></script>',
    ],
  ]);
  expect([ipv6.csp, (ipv6.html as string).split('\n', 8)[7]]).toStrictEqual([
    { resourceDomains: ['http://[::1]:11050'], connectDomains: [] },
    '    <script type="module" crossorigin src="http://[::1]:11050/mcp/static/views/main-1a2b.js"></script>',
  ]);
});

test.each([
  'http://a"b/',
  "http://a'onload=x/",
  'data:text/html,<p>view</p>',
  'ftp://eln.epfl.ch/',
  'https://user:secret@eln.epfl.ch/',
  'https://eln.epfl.ch/mcp/?page=search',
  'https://eln.epfl.ch/mcp/#top',
  'https://eln.epfl.ch/a(b)/',
  'not a url',
])('a base URL that is not a plain http(s) address is refused: %s', (base) => {
  expect(() => viewResource(BUILD, { ...ELN, baseUrl: base })).toThrow(
    'The views are served from an address that is not a plain http or https URL.',
  );
});

test.each(['/views', 'views/', '../assets', 'a"b', ''])(
  'an assets path that is not plain segments is refused: %s',
  (assetsPath) => {
    expect(() =>
      viewResource(BUILD, { ...ELN, baseUrl: 'https://a.org/', assetsPath }),
    ).toThrow(`Not a path of plain segments: ${JSON.stringify(assetsPath)}.`);
  },
);

test('a path character that HTML would read is escaped by the URL, never written as it is', () => {
  const { html } = viewResource(SMALL, {
    ...ELN,
    baseUrl: 'https://eln.epfl.ch/a"b<c>/',
  });

  expect((html as string).split('\n', 8)[7]).toBe(
    '    <script type="module" crossorigin src="https://eln.epfl.ch/a%22b%3Cc%3E/views/assets/main-1a2b.js"></script>',
  );
});

test('a page that loads the build through the loader names no hashed file, so it never changes with the build', () => {
  const options = {
    ...ELN,
    baseUrl: 'https://eln.epfl.ch/mcp/',
    loader: true,
  };
  const page = viewResource(BUILD, options);

  expect((page.html as string).split('\n').slice(6, 9)).toStrictEqual([
    '    <title>SciPeaks ELN</title>',
    `    <script type="module" crossorigin src="${ASSETS}/loader.js"></script>`,
    '  </head>',
  ]);
  expect(viewResource(SMALL, options).html).toBe(page.html);
});

test('a host name with its final dot is a plain address', () => {
  const request = { protocol: 'http', host: 'localhost.:11017' };
  const page = viewResource(SMALL, {
    ...ELN,
    baseUrl: viewsBaseUrl(undefined, request),
  });

  expect(page.csp).toStrictEqual({
    resourceDomains: ['http://localhost.:11017'],
    connectDomains: [],
  });
});
