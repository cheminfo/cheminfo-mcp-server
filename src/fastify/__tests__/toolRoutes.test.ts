import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, expect, test } from 'vitest';

import type { SampleServer } from '../../__tests__/sampleServer.ts';
import { startSampleServer } from '../../__tests__/sampleServer.ts';
import { METHANE, SAMPLE_TOKEN } from '../../__tests__/sampleTools.ts';

const server: SampleServer = await startSampleServer();

afterAll(async () => {
  await server.app.close();
});

function post(path: string, payload: object, headers: Record<string, string>) {
  return server.app.inject({
    method: 'POST',
    url: `/v1/${path}`,
    headers,
    payload,
  });
}

async function connect(headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('mcp', server.baseUrl), {
      requestInit: { headers },
    }),
  );
  return client;
}

function listTools(headers: Record<string, string>) {
  return fetch(new URL('mcp', server.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

test('GET tools is the catalog, the same for every caller', async () => {
  const response = await server.app.inject({ url: '/v1/tools' });
  const catalog = response.json<{ tools: Array<{ name: string }> }>();

  expect(response.statusCode).toBe(200);
  expect(catalog.tools.map((tool) => tool.name)).toStrictEqual([
    'addNumbers',
    'whoAmI',
    'drawBenzene',
    'explode',
    'loading',
    'writeMolfile',
  ]);
});

test('POST tools/:name answers the result and its side channels, uncached', async () => {
  const headers = { 'x-token': SAMPLE_TOKEN };
  const sum = await post('tools/addNumbers', { a: 2, b: 3 }, headers);
  const who = await post('tools/whoAmI', {}, headers);
  const drawn = await post('tools/drawBenzene', { label: 'C6H6' }, headers);

  expect([
    sum.statusCode,
    sum.headers['cache-control'],
    sum.json(),
  ]).toStrictEqual([200, 'no-store', { result: { sum: 5 }, molecules: [] }]);
  expect(who.json()).toStrictEqual({
    result: { email: 'alice@example.org' },
    molecules: [],
  });
  expect(drawn.json()).toStrictEqual({
    result: { name: 'benzene' },
    molecules: [{ smiles: 'c1ccccc1', label: 'C6H6' }],
    reactions: [{ rxnCode: 'gFp@DiTt@@@!gFp@DiTt@@@', label: 'C6H6' }],
  });
});

test('POST tools/:name refuses with a status, a code and a sentence', async () => {
  const anonymous = await post('tools/addNumbers', { a: 1, b: 2 }, {});
  const busy = await post(
    'tools/addNumbers',
    { a: 1, b: 2 },
    { 'x-token': 'busy' },
  );
  const unknown = await post(
    'tools/deleteAll',
    {},
    { 'x-token': SAMPLE_TOKEN },
  );
  const failed = await post('tools/explode', {}, { 'x-token': SAMPLE_TOKEN });

  expect([anonymous.statusCode, anonymous.json()]).toStrictEqual([
    401,
    { error: 'Send your token in x-token.', code: 'no-credentials' },
  ]);
  expect([busy.statusCode, busy.headers['retry-after']]).toStrictEqual([
    503,
    '60',
  ]);
  expect([unknown.statusCode, unknown.json()]).toStrictEqual([
    404,
    { error: 'Unknown sample tool: deleteAll', code: 'not-found' },
  ]);
  expect([failed.statusCode, failed.json()]).toStrictEqual([
    500,
    { error: 'The tool failed. Try again later.', code: 'internal' },
  ]);
  expect(server.errors).toHaveLength(1);
});

test('an MCP client lists the tools and calls one, reading the result as JSON text', async () => {
  const client = await connect({ 'x-token': SAMPLE_TOKEN });
  const { tools } = await client.listTools();
  const result = await client.callTool({
    name: 'addNumbers',
    arguments: { a: 4, b: 5 },
  });
  const failed = await client.callTool({ name: 'explode', arguments: {} });
  await client.close();

  expect(
    tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]),
  ).toStrictEqual([
    ['addNumbers', true],
    ['whoAmI', true],
    ['drawBenzene', true],
    ['explode', true],
    ['loading', true],
    ['writeMolfile', true],
  ]);
  expect(result.content).toStrictEqual([
    { type: 'text', text: JSON.stringify({ sum: 9 }, null, 2) },
  ]);
  expect([failed.isError, failed.content]).toStrictEqual([
    true,
    [{ type: 'text', text: 'The tool failed. Try again later.' }],
  ]);
});

test('MCP: no token is a 401 with Bearer, a foreign origin a 403, a server that cannot check lists the tools and says why', async () => {
  const anonymous = await listTools({});
  const foreign = await listTools({
    'x-token': SAMPLE_TOKEN,
    origin: 'https://evil.example',
  });
  const listed = await listTools({
    'x-token': SAMPLE_TOKEN,
    origin: 'https://inspector.example.org',
  });
  const client = await connect({ 'x-token': 'busy' });
  const { tools } = await client.listTools();
  const call = await client.callTool({
    name: 'addNumbers',
    arguments: { a: 1, b: 1 },
  });
  await client.close();

  expect([
    anonymous.status,
    anonymous.headers.get('www-authenticate'),
    await anonymous.json(),
  ]).toStrictEqual([
    401,
    'Bearer realm="sample-tools"',
    {
      jsonrpc: '2.0',
      error: { code: -32_001, message: 'Send your token in x-token.' },
      id: null,
    },
  ]);
  expect(foreign.status).toBe(403);
  expect(listed.status).toBe(200);
  expect(tools).toHaveLength(6);
  expect([call.isError, call.content]).toStrictEqual([
    true,
    [
      {
        type: 'text',
        text: 'Cannot check your token now. Try again in a minute.',
      },
    ],
  ]);
});

test('GET mcp is not allowed, and every well-known address answers 404 as JSON', async () => {
  const get = await server.app.inject({ url: '/v1/mcp' });
  const wellKnown = await server.app.inject({
    url: '/.well-known/oauth-protected-resource',
  });

  expect([get.statusCode, get.headers.allow]).toStrictEqual([405, 'POST']);
  expect([wellKnown.statusCode, wellKnown.json()]).toStrictEqual([
    404,
    { error: 'Not found.', code: 'not-found' },
  ]);
});

test('an unknown tool is a 404 before any credential; a tool refuses with its own status, extras and Retry-After', async () => {
  const failuresBefore = server.errors.length;
  const unknown = await post('tools/deleteAll', {}, {});
  const loading = await post('tools/loading', {}, { 'x-token': SAMPLE_TOKEN });
  const client = await connect({ 'x-token': SAMPLE_TOKEN });
  const call = await client.callTool({ name: 'loading', arguments: {} });
  await client.close();

  expect([unknown.statusCode, unknown.json()]).toStrictEqual([
    404,
    { error: 'Unknown sample tool: deleteAll', code: 'not-found' },
  ]);
  expect([
    loading.statusCode,
    loading.headers['retry-after'],
    loading.json(),
  ]).toStrictEqual([
    503,
    '30',
    {
      error: 'The copy is loading. Try again in a minute.',
      code: 'loading',
      mirror: { state: 'catching-up', progress: 0.4 },
    },
  ]);
  expect([call.isError, call.content]).toStrictEqual([
    true,
    [{ type: 'text', text: 'The copy is loading. Try again in a minute.' }],
  ]);
  expect(server.errors).toHaveLength(failuresBefore);
});

test("MCP answers a file's content after the result: a client has no side channel", async () => {
  const client = await connect({ 'x-token': SAMPLE_TOKEN });
  const written = await client.callTool({
    name: 'writeMolfile',
    arguments: {},
  });
  await client.close();

  expect(written.content).toStrictEqual([
    { type: 'text', text: JSON.stringify({ name: 'methane' }, null, 2) },
    { type: 'text', text: METHANE },
  ]);
});

test("allowedOrigins '*' lets any browser origin call MCP", async () => {
  const open = await startSampleServer({ allowedOrigins: '*' });
  const response = await fetch(new URL('mcp', open.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-token': SAMPLE_TOKEN,
      origin: 'https://anywhere.example',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  await open.app.close();

  expect(response.status).toBe(200);
});
