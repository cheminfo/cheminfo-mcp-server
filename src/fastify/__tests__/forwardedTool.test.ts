import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, expect, test } from 'vitest';

import type { SampleServer } from '../../__tests__/sampleServer.ts';
import { startSampleServer } from '../../__tests__/sampleServer.ts';
import { REMOTE_SCHEMA, SAMPLE_TOKEN } from '../../__tests__/sampleTools.ts';

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

test('a forwarded tool offers the other server its JSON Schema and passes the arguments through, over JSON and MCP', async () => {
  const headers = { 'x-token': SAMPLE_TOKEN };
  const catalog = await server.app.inject({ url: '/v1/tools' });
  const forwarded = await post(
    'tools/remoteSearch',
    { text: 'ester' },
    headers,
  );
  const client = await connect(headers);
  const { tools } = await client.listTools();
  const call = await client.callTool({
    name: 'remoteSearch',
    arguments: { text: 'ester' },
  });
  await client.close();

  const listed = catalog
    .json<{ tools: Array<{ name: string; inputSchema: object }> }>()
    .tools.find((tool) => tool.name === 'remoteSearch');

  expect(listed?.inputSchema).toStrictEqual({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...REMOTE_SCHEMA,
  });
  expect(forwarded.json()).toStrictEqual({
    result: { forwarded: { text: 'ester' } },
    molecules: [],
  });

  const mcpTool = tools.find((tool) => tool.name === 'remoteSearch');

  expect([
    mcpTool?.inputSchema.properties,
    mcpTool?.inputSchema.required,
  ]).toStrictEqual([REMOTE_SCHEMA.properties, REMOTE_SCHEMA.required]);
  expect(call.content).toStrictEqual([
    {
      type: 'text',
      text: JSON.stringify({ forwarded: { text: 'ester' } }, null, 2),
    },
  ]);
});
