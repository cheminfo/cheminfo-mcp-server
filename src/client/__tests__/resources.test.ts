import { afterAll, expect, test } from 'vitest';

import type { AppServer } from '../../__tests__/appServer.ts';
import {
  VIEW_URI,
  sampleView,
  startAppServer,
} from '../../__tests__/appServer.ts';
import { readAppResource } from '../../tools/apps.ts';
import type { FetchLike } from '../index.ts';
import { createToolClient, isModelVisible } from '../index.ts';

const server: AppServer = await startAppServer();

afterAll(async () => {
  await server.app.close();
});

test('the client lists the views, and reads a page again only when it changed', async () => {
  const statuses: number[] = [];
  const recording: FetchLike = async (url, init) => {
    const response = await fetch(url, init);
    if (url.pathname.endsWith('/read')) statuses.push(response.status);
    return response;
  };
  const client = createToolClient({
    baseUrl: server.baseUrl,
    fetch: recording,
  });
  const { listing, html } = await readAppResource(
    sampleView(server.baseUrl.origin),
  );

  const listed = await client.resources();
  const first = await client.readResource(VIEW_URI);
  const second = await client.readResource(VIEW_URI);
  const unknown = await client.readResource('ui://sample/other');

  const page = {
    contents: [
      {
        uri: VIEW_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: html,
        _meta: listing._meta,
      },
    ],
  };

  expect(listed).toStrictEqual({ ok: true, value: { resources: [listing] } });
  expect([first, second]).toStrictEqual([
    { ok: true, value: page },
    { ok: true, value: page },
  ]);
  expect(statuses).toStrictEqual([200, 304, 404]);
  expect(unknown.ok || unknown.failure.message).toBe(
    'No resource ui://sample/other.',
  );
});

test("the client passes a call's structuredContent and _meta on, and a host keeps a view's own tools from the model", async () => {
  const client = createToolClient({ baseUrl: server.baseUrl });

  const catalog = await client.catalog();
  const shown = await client.callTool('showMolecule', { name: 'benzene' });

  expect(
    catalog.ok &&
      catalog.value.tools.filter(isModelVisible).map((tool) => tool.name),
  ).toStrictEqual(['showMolecule', 'largeView']);
  expect(shown).toStrictEqual({
    ok: true,
    value: {
      result: { name: 'benzene' },
      molecules: [],
      structuredContent: { name: 'benzene', atoms: 6 },
      _meta: { 'org.example/view': { view: 'molecule', name: 'benzene' } },
    },
  });
});
