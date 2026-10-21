import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { fastify } from 'fastify';
import { expect, test, vi } from 'vitest';

import { additionTool } from '../../__tests__/sampleTools.ts';
import { createToolRoutes } from '../mcpRoutes.ts';

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const ACCEPT = { accept: 'application/json, text/event-stream' };

test('a refusal of the context other than 503 answers its status before MCP starts, with Retry-After', async () => {
  const app = fastify();
  await app.register(
    createToolRoutes<{ email: string }>({
      name: 'busy',
      version: '1.0.0',
      tools: [additionTool],
      resolveContext: () => ({
        ok: false,
        refusal: {
          status: 429,
          code: 'too-many',
          error: 'Too many calls. Wait a minute.',
          retryAfter: 30,
        },
      }),
    }),
    { prefix: '/v1' },
  );
  const response = await app.inject({
    method: 'POST',
    url: '/v1/mcp',
    headers: ACCEPT,
    payload: LIST,
  });
  await app.close();

  expect([
    response.statusCode,
    response.headers['retry-after'],
    response.headers['www-authenticate'],
    response.json(),
  ]).toStrictEqual([
    429,
    '30',
    undefined,
    {
      jsonrpc: '2.0',
      error: { code: -32_001, message: 'Too many calls. Wait a minute.' },
      id: null,
    },
  ]);
});

test('a failure inside MCP answers a JSON-RPC 500 and is logged, never a stack', async () => {
  const logged: Array<Record<string, unknown>> = [];
  const app = fastify({
    logger: {
      level: 'error',
      stream: {
        write: (line: string) => {
          logged.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    },
  });
  await app.register(
    createToolRoutes({
      name: 'fragile',
      version: '1.0.0',
      tools: [additionTool],
    }),
    { prefix: '/v1' },
  );
  const spy = vi
    .spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest')
    .mockRejectedValueOnce(new Error('the transport broke'));
  const response = await app.inject({
    method: 'POST',
    url: '/v1/mcp',
    headers: ACCEPT,
    payload: LIST,
  });
  spy.mockRestore();
  await app.close();

  expect([response.statusCode, response.json()]).toStrictEqual([
    500,
    {
      jsonrpc: '2.0',
      error: { code: -32_603, message: 'Internal server error' },
      id: null,
    },
  ]);
  expect(
    logged.map(({ msg, err }) => [msg, (err as { message: string }).message]),
  ).toStrictEqual([['The MCP request failed', 'the transport broke']]);
});
