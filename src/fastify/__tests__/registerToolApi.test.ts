import { fastify } from 'fastify';
import { expect, test } from 'vitest';

import { additionTool } from '../../__tests__/sampleTools.ts';
import { registerToolApi } from '../registerToolApi.ts';

async function apiServer(version?: string) {
  const app = fastify();
  await registerToolApi(
    app,
    { name: 'sample', version: '1.2.3', tools: [additionTool] },
    {
      title: 'sample.cheminfo.org tools',
      description: 'Sums, for chats and MCP clients.',
      ...(version !== undefined && { version }),
    },
  );
  return app;
}

test('the document names its server relatively and keeps the paths’ /v1', async () => {
  const app = await apiServer();
  const response = await app.inject({ method: 'GET', url: '/docs/json' });
  await app.close();
  const document = response.json<{
    info: unknown;
    servers: unknown;
    paths: Record<string, Record<string, unknown>>;
  }>();

  expect(response.statusCode).toBe(200);
  expect(document.info).toStrictEqual({
    title: 'sample.cheminfo.org tools',
    description: 'Sums, for chats and MCP clients.',
    version: '1.2.3',
  });
  expect(document.servers).toStrictEqual([{ url: '..' }]);
  expect(
    Object.entries(document.paths).map(([path, methods]) => [
      path,
      Object.keys(methods),
    ]),
  ).toStrictEqual([
    ['/v1/tools', ['get']],
    ['/v1/tools/{name}', ['post']],
    ['/v1/mcp', ['post', 'get', 'delete']],
  ]);
});

test('the documentation may carry its own version', async () => {
  const app = await apiServer('2.0.0');
  const response = await app.inject({ method: 'GET', url: '/docs/json' });
  await app.close();

  expect(response.json<{ info: { version: string } }>().info.version).toBe(
    '2.0.0',
  );
});

test('the tools answer under /v1, the UI at /docs, and /.well-known as JSON', async () => {
  const app = await apiServer();
  const call = await app.inject({
    method: 'POST',
    url: '/v1/tools/addNumbers',
    payload: { a: 2, b: 3 },
  });
  const page = await app.inject({ method: 'GET', url: '/docs/' });
  const probe = await app.inject({
    method: 'GET',
    url: '/.well-known/oauth-authorization-server',
  });
  await app.close();

  expect([call.statusCode, call.json()]).toStrictEqual([
    200,
    { result: { sum: 5 }, molecules: [] },
  ]);
  expect([page.statusCode, page.headers['content-type']]).toStrictEqual([
    200,
    'text/html; charset=utf-8',
  ]);
  expect([probe.statusCode, probe.json()]).toStrictEqual([
    404,
    { error: 'Not found.', code: 'not-found' },
  ]);
});
