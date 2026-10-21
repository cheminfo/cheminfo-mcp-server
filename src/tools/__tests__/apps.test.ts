import { expect, test } from 'vitest';

import type { AppResource } from '../apps.ts';
import {
  appResourceUi,
  appResourcesOf,
  forwardAppResource,
  readAppResource,
} from '../apps.ts';

const VIEW: AppResource = {
  uri: 'ui://a/view',
  name: 'A view',
  description: 'Draws a.',
  html: '<p>a</p>',
  csp: { resourceDomains: ['https://a.org'] },
  permissions: { clipboardWrite: {} },
  domain: 'a.sandbox.example',
  prefersBorder: false,
};

test("a resource's _meta.ui holds what it sets, and nothing for a bare one", () => {
  expect([
    appResourceUi(VIEW),
    appResourceUi({ uri: 'ui://b', name: 'B', html: '' }),
  ]).toStrictEqual([
    {
      csp: { resourceDomains: ['https://a.org'] },
      permissions: { clipboardWrite: {} },
      domain: 'a.sandbox.example',
      prefersBorder: false,
    },
    {},
  ]);
});

test('the version of a resource follows its page and its _meta', async () => {
  const same = await readAppResource({ ...VIEW, html: () => '<p>a</p>' });
  const page = await readAppResource({ ...VIEW, html: '<p>b</p>' });
  const meta = await readAppResource({ ...VIEW, prefersBorder: true });
  const { listing } = await readAppResource(VIEW);

  expect(listing.version).toMatch(/^[\da-f]{12}$/);
  expect([
    same.listing.version === listing.version,
    page.listing.version === listing.version,
    meta.listing.version === listing.version,
  ]).toStrictEqual([true, false, false]);
});

test('a forwarded resource is listed as the other server lists it, its page read from there', async () => {
  const { listing } = await readAppResource(VIEW);
  const asked: string[] = [];
  const readHtml = async (uri: string) => {
    asked.push(uri);
    return '<p>a</p>';
  };

  const forwarded = await readAppResource(
    forwardAppResource(listing, readHtml),
  );
  const bare = forwardAppResource(
    {
      uri: 'ui://b',
      name: 'B',
      mimeType: 'text/html;profile=mcp-app',
      version: '000000000000',
    },
    readHtml,
  );

  expect(forwarded).toStrictEqual({ listing, html: '<p>a</p>' });
  expect(asked).toStrictEqual(['ui://a/view']);
  expect([
    bare.uri,
    bare.name,
    bare.description,
    appResourceUi(bare),
  ]).toStrictEqual(['ui://b', 'B', undefined, {}]);
});

test('the resources of a request are the list, or what the function gives', async () => {
  expect([
    await appResourcesOf(undefined, 'request'),
    await appResourcesOf([VIEW], 'request'),
    await appResourcesOf(
      (request: string) => [{ ...VIEW, name: request }],
      'r',
    ),
  ]).toStrictEqual([[], [VIEW], [{ ...VIEW, name: 'r' }]]);
});
