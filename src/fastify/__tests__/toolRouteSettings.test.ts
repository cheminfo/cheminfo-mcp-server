import { fastify } from 'fastify';
import { afterAll, expect, test } from 'vitest';

import type { SampleServer } from '../../__tests__/sampleServer.ts';
import { startSampleServer } from '../../__tests__/sampleServer.ts';
import { SAMPLE_TOKEN, additionTool } from '../../__tests__/sampleTools.ts';
import { createToolRoutes } from '../mcpRoutes.ts';

const server: SampleServer = await startSampleServer();

afterAll(async () => {
  await server.app.close();
});

function postAddition(payload: object, headers: Record<string, string>) {
  return server.app.inject({
    method: 'POST',
    url: '/v1/tools/addNumbers',
    headers,
    payload,
  });
}

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

test('a call is checked in order: name, precheck, arguments, then the context, which an invalid call never reaches', async () => {
  const before = server.resolved.count;
  const anonymous = await postAddition({ a: 'one' }, {});
  const invalid = await postAddition({ a: 'one' }, { 'x-token': 'forged' });
  const refused = await postAddition({ a: 1, b: 2 }, { 'x-token': 'forged' });
  const tooLarge = await postAddition(
    { a: 1, b: 2, padding: 'x'.repeat(4096) },
    { 'x-token': SAMPLE_TOKEN },
  );

  expect([
    anonymous.statusCode,
    anonymous.json<{ code: string }>().code,
  ]).toStrictEqual([401, 'no-credentials']);
  expect([
    invalid.statusCode,
    invalid.json<{ code: string }>().code,
  ]).toStrictEqual([400, 'invalid-arguments']);
  expect(refused.statusCode).toBe(401);
  expect(server.resolved.count - before).toBe(1);
  expect(tooLarge.statusCode).toBe(413);
});

test("a route's own schema replaces the documentation, and Fastify enforces it", async () => {
  const app = fastify();
  await app.register(
    createToolRoutes({
      name: 'documented',
      version: '1.0.0',
      tools: [additionTool],
      routes: {
        run: {
          schema: {
            summary: 'Add, as documented here',
            params: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
            body: { type: 'object', maxProperties: 2 },
          },
        },
        mcpNotAllowed: {
          schema: { summary: 'Refused here', hide: true },
        },
      },
    }),
    { prefix: '/v1' },
  );
  const crowded = await app.inject({
    method: 'POST',
    url: '/v1/tools/addNumbers',
    payload: { a: 1, b: 2, c: 3 },
  });
  const sum = await app.inject({
    method: 'POST',
    url: '/v1/tools/addNumbers',
    payload: { a: 1, b: 2 },
  });
  await app.close();

  expect(crowded.statusCode).toBe(400);
  expect(crowded.json<{ message: string }>().message).toBe(
    'body must NOT have more than 2 properties',
  );
  expect(sum.json()).toStrictEqual({ result: { sum: 3 }, molecules: [] });
});

test('a resolver may change the reply of its refusal, e.g. to clear a cookie that ended', async () => {
  const app = fastify();
  await app.register(
    createToolRoutes<{ email: string }>({
      name: 'cookies',
      version: '1.0.0',
      tools: [additionTool],
      resolveContext: (_request, _route, reply) => {
        void reply.header('set-cookie', 'session=; Max-Age=0');
        return {
          ok: false,
          refusal: { status: 401, code: 'ended', error: 'Your session ended.' },
        };
      },
    }),
    { prefix: '/v1' },
  );
  const ended = await app.inject({
    method: 'POST',
    url: '/v1/tools/addNumbers',
    payload: { a: 1, b: 2 },
  });
  const notAllowed = await app.inject({ url: '/v1/mcp' });
  await app.close();

  expect([
    ended.statusCode,
    ended.headers['set-cookie'],
    ended.json(),
  ]).toStrictEqual([
    401,
    'session=; Max-Age=0',
    { error: 'Your session ended.', code: 'ended' },
  ]);
  expect(notAllowed.statusCode).toBe(405);
});

test('routeConfig reaches the two POST routes only, under their own config', async () => {
  const app = fastify();
  const limits: Array<[string, unknown]> = [];
  app.addHook('onRequest', async (request) => {
    const { limit } = request.routeOptions.config as { limit?: unknown };
    limits.push([`${request.method} ${request.url}`, limit]);
  });
  await app.register(
    createToolRoutes({
      name: 'limited',
      version: '1.0.0',
      tools: [additionTool],
      routeConfig: { limit: 'shared' },
      routes: { mcp: { config: { limit: 'mcp' } } },
    }),
    { prefix: '/v1' },
  );
  await app.inject({ url: '/v1/tools' });
  await app.inject({
    method: 'POST',
    url: '/v1/tools/addNumbers',
    payload: { a: 1, b: 2 },
  });
  await app.inject({
    method: 'POST',
    url: '/v1/mcp',
    headers: { accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  await app.inject({ url: '/v1/mcp' });
  await app.close();

  expect(limits).toStrictEqual([
    ['GET /v1/tools', undefined],
    ['POST /v1/tools/addNumbers', 'shared'],
    ['POST /v1/mcp', 'mcp'],
    ['GET /v1/mcp', undefined],
  ]);
});
