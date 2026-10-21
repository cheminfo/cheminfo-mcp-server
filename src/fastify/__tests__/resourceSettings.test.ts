import type { FastifyRequest } from 'fastify';
import { fastify } from 'fastify';
import { expect, test } from 'vitest';

import { VIEW_URI, sampleView } from '../../__tests__/appServer.ts';
import { additionTool } from '../../__tests__/sampleTools.ts';
import type { AppResourceList } from '../../tools/apps.ts';
import { createToolRoutes } from '../mcpRoutes.ts';

/**
 * A server with the given resources, its read route's schema replaced by
 * one with no query string, and Cache-Control set by the server itself.
 * @param resources - The resources.
 * @returns The server.
 */
async function serverWith(resources: AppResourceList<FastifyRequest>) {
  const app = fastify();
  app.addHook('onRequest', async (_request, reply) => {
    void reply.header('cache-control', 'no-store');
  });
  await app.register(
    createToolRoutes({
      name: 'resources',
      version: '1.0.0',
      tools: [additionTool],
      resources,
      routes: {
        resources: { schema: { summary: 'Our views' } },
        resourceRead: { schema: { summary: 'One of our views' } },
      },
    }),
    { prefix: '/v1' },
  );
  return app;
}

test("a server's own Cache-Control is kept, and a read route without a schema still checks the uri", async () => {
  const app = await serverWith([sampleView('https://views.example.org')]);
  const listed = await app.inject({ url: '/v1/resources' });
  const read = await app.inject({
    url: `/v1/resources/read?uri=${encodeURIComponent(VIEW_URI)}`,
  });
  const weak = await app.inject({
    url: `/v1/resources/read?uri=${encodeURIComponent(VIEW_URI)}`,
    headers: { 'if-none-match': `W/${String(read.headers.etag)}` },
  });
  const empty = await app.inject({ url: '/v1/resources/read?uri=' });
  const twice = await app.inject({ url: '/v1/resources/read?uri=a&uri=b' });
  await app.close();

  expect([
    listed.headers['cache-control'],
    read.headers['cache-control'],
    read.statusCode,
  ]).toStrictEqual(['no-store', 'no-store', 200]);
  expect(weak.statusCode).toBe(304);
  expect([empty.statusCode, empty.json()]).toStrictEqual([
    400,
    { error: 'Give the uri of a resource.', code: 'invalid-arguments' },
  ]);
  expect(twice.statusCode).toBe(400);
});

test('resources that cannot be listed answer 500 on both routes', async () => {
  const app = await serverWith(() => {
    throw new Error('the build is gone');
  });
  const listed = await app.inject({ url: '/v1/resources' });
  const read = await app.inject({ url: '/v1/resources/read?uri=ui://a/b' });
  await app.close();

  const failed = {
    error: 'The resource could not be read. Try again later.',
    code: 'internal',
  };

  expect([listed.statusCode, listed.json()]).toStrictEqual([500, failed]);
  expect([read.statusCode, read.json()]).toStrictEqual([500, failed]);
});

test('a server without resources has no resource routes', async () => {
  const app = fastify();
  await app.register(
    createToolRoutes({
      name: 'plain',
      version: '1.0.0',
      tools: [additionTool],
    }),
    { prefix: '/v1' },
  );
  const listed = await app.inject({ url: '/v1/resources' });
  const read = await app.inject({ url: '/v1/resources/read?uri=ui://a/b' });
  await app.close();

  expect([listed.statusCode, read.statusCode]).toStrictEqual([404, 404]);
});
