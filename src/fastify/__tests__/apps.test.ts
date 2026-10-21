import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, expect, test } from 'vitest';

import type { AppServer } from '../../__tests__/appServer.ts';
import {
  VIEW_URI,
  sampleView,
  startAppServer,
} from '../../__tests__/appServer.ts';
import { readAppResource } from '../../tools/apps.ts';

const server: AppServer = await startAppServer();
const origin = server.baseUrl.origin;
// The origin Fastify's inject() sends.
const injected = 'http://localhost:80';

afterAll(async () => {
  await server.app.close();
});

function readResource(query: string, headers: Record<string, string> = {}) {
  return server.app.inject({ url: `/v1/resources/read${query}`, headers });
}

async function connect(): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('mcp', server.baseUrl)),
  );
  return client;
}

test("the catalog and MCP's tools/list carry each tool's view, MCP also under the key older hosts read", async () => {
  const catalog = await server.app.inject({ url: '/v1/tools' });
  const client = await connect();
  const { tools } = await client.listTools();
  await client.close();

  expect(
    catalog
      .json<{ tools: Array<{ name: string; _meta?: unknown }> }>()
      .tools.map((tool) => [tool.name, tool._meta]),
  ).toStrictEqual([
    [
      'showMolecule',
      { 'org.example/kind': 'molecule', ui: { resourceUri: VIEW_URI } },
    ],
    ['moleculePage', { ui: { resourceUri: VIEW_URI, visibility: ['app'] } }],
    ['largeView', undefined],
  ]);
  expect(tools.map((tool) => [tool.name, tool._meta])).toStrictEqual([
    [
      'showMolecule',
      {
        'org.example/kind': 'molecule',
        ui: { resourceUri: VIEW_URI },
        'ui/resourceUri': VIEW_URI,
      },
    ],
    [
      'moleculePage',
      {
        ui: { resourceUri: VIEW_URI, visibility: ['app'] },
        'ui/resourceUri': VIEW_URI,
      },
    ],
    ['largeView', undefined],
  ]);
});

test('a call answers its structuredContent and _meta, over JSON and MCP; a tool for the view only is callable', async () => {
  const shown = await server.app.inject({
    method: 'POST',
    url: '/v1/tools/showMolecule',
    payload: { name: 'benzene' },
  });
  const page = await server.app.inject({
    method: 'POST',
    url: '/v1/tools/moleculePage',
    payload: { offset: 10 },
  });
  const client = await connect();
  const called = await client.callTool({
    name: 'showMolecule',
    arguments: { name: 'benzene' },
  });
  await client.close();

  expect(shown.json()).toStrictEqual({
    result: { name: 'benzene' },
    molecules: [],
    structuredContent: { name: 'benzene', atoms: 6 },
    _meta: { 'org.example/view': { view: 'molecule', name: 'benzene' } },
  });
  expect(page.json()).toStrictEqual({
    result: { offset: 10 },
    molecules: [],
    _meta: { 'org.example/view': { view: 'page', offset: 10 } },
  });
  expect(called).toStrictEqual({
    content: [
      { type: 'text', text: JSON.stringify({ name: 'benzene' }, null, 2) },
    ],
    structuredContent: { name: 'benzene', atoms: 6 },
    _meta: { 'org.example/view': { view: 'molecule', name: 'benzene' } },
  });
});

test('MCP lists and reads the views as MCP Apps, each with its _meta.ui; one whose page cannot be made is an error', async () => {
  const client = await connect();
  const { resources } = await client.listResources();
  const read = await client.readResource({ uri: VIEW_URI });
  let broken: unknown;
  try {
    await client.readResource({ uri: 'ui://sample/broken' });
  } catch (error) {
    broken = error;
  }
  await client.close();

  const ui = {
    csp: { resourceDomains: [origin], connectDomains: [] },
    permissions: { clipboardWrite: {} },
    prefersBorder: true,
  };

  expect(resources).toStrictEqual([
    {
      uri: VIEW_URI,
      name: 'Sample view',
      description: 'Draws a molecule.',
      mimeType: 'text/html;profile=mcp-app',
      _meta: { ui },
    },
    {
      uri: 'ui://sample/broken',
      name: 'Broken view',
      mimeType: 'text/html;profile=mcp-app',
      _meta: { ui: {} },
    },
  ]);
  expect(read.contents).toStrictEqual([
    {
      uri: VIEW_URI,
      mimeType: 'text/html;profile=mcp-app',
      text: `<!doctype html><script src="${origin}/view.js"></script>`,
      _meta: { ui },
    },
  ]);
  expect(broken).toBeInstanceOf(McpError);
});

test('GET resources lists the views with their versions, leaving out and logging one that cannot be made', async () => {
  const before = server.warnings.length;
  const listed = await server.app.inject({ url: '/v1/resources' });
  const { listing } = await readAppResource(sampleView(injected));

  expect([
    listed.statusCode,
    listed.headers['cache-control'],
    listed.json(),
  ]).toStrictEqual([200, 'no-cache', { resources: [listing] }]);
  expect(listing.version).toMatch(/^[\da-f]{12}$/);
  expect(
    server.warnings.slice(before).map(({ msg, uri }) => [msg, uri]),
  ).toStrictEqual([['An app resource failed', 'ui://sample/broken']]);
});

test('GET resources/read answers a view with its version as ETag, 304 to a host that holds it, 404, 400 and 500 otherwise', async () => {
  const uri = `?uri=${encodeURIComponent(VIEW_URI)}`;
  const { listing, html } = await readAppResource(sampleView(injected));
  const etag = `"${listing.version}"`;

  const first = await readResource(uri);
  const again = await readResource(uri, { 'if-none-match': etag });
  const stale = await readResource(uri, { 'if-none-match': '"000000000000"' });
  const unknown = await readResource('?uri=ui://sample/other');
  const missing = await readResource('');
  const broken = await readResource(
    `?uri=${encodeURIComponent('ui://sample/broken')}`,
  );

  expect([
    first.statusCode,
    first.headers.etag,
    first.headers['cache-control'],
    first.json(),
  ]).toStrictEqual([
    200,
    etag,
    'no-cache',
    {
      contents: [
        {
          uri: VIEW_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: html,
          _meta: listing._meta,
        },
      ],
    },
  ]);
  expect([again.statusCode, again.body]).toStrictEqual([304, '']);
  expect(stale.statusCode).toBe(200);
  expect([unknown.statusCode, unknown.json()]).toStrictEqual([
    404,
    { error: 'No resource ui://sample/other.', code: 'not-found' },
  ]);
  expect(missing.statusCode).toBe(400);
  expect([broken.statusCode, broken.json()]).toStrictEqual([
    500,
    {
      error: 'The resource could not be read. Try again later.',
      code: 'internal',
    },
  ]);
});

test("an answer whose _meta or result passes the server's size is logged as a warning, by tool and size", async () => {
  const before = server.warnings.length;
  const large = await server.app.inject({
    method: 'POST',
    url: '/v1/tools/largeView',
    payload: {},
  });
  const client = await connect();
  await client.callTool({ name: 'largeView', arguments: {} });
  await client.close();

  expect(large.statusCode).toBe(200);
  expect(
    server.warnings
      .slice(before)
      .map(({ level, msg, tool, size, limit }) => [
        level,
        msg,
        tool,
        size,
        limit,
      ]),
  ).toStrictEqual([
    [40, "A tool's answer carries a large _meta", 'largeView', 211, 100],
    [40, "A tool's result is large", 'largeView', 161, 120],
    [40, "A tool's answer carries a large _meta", 'largeView', 211, 100],
    [40, "A tool's result is large", 'largeView', 161, 120],
  ]);
});
