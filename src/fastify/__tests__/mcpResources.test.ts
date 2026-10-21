import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyRequest } from 'fastify';
import { fastify } from 'fastify';
import { expect, test } from 'vitest';

import { BROKEN_VIEW, sampleView } from '../../__tests__/appServer.ts';
import { additionTool } from '../../__tests__/sampleTools.ts';
import type { AppResourceList } from '../../tools/apps.ts';
import { createToolRoutes } from '../mcpRoutes.ts';

/**
 * Connect to a server with the given resources, and read what it logged.
 * @param resources - The resources.
 * @returns The client, the logged errors, and how to close both.
 */
async function connect(resources: AppResourceList<FastifyRequest>) {
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
      name: 'views',
      version: '1.0.0',
      tools: [additionTool],
      resources,
    }),
    { prefix: '/v1' },
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/v1/mcp`),
    ),
  );
  const close = async () => {
    await client.close();
    await app.close();
  };
  return { client, logged, close };
}

test('resources that cannot be listed are logged, and MCP still answers every tool, without resources', async () => {
  const { client, logged, close } = await connect(() => {
    throw new Error('the views broke');
  });
  const { tools } = await client.listTools();
  const sum = await client.callTool({
    name: 'addNumbers',
    arguments: { a: 1, b: 2 },
  });
  const capabilities = client.getServerCapabilities();
  await close();

  expect(tools.map((tool) => tool.name)).toStrictEqual(['addNumbers']);
  expect(sum.content).toStrictEqual([
    { type: 'text', text: JSON.stringify({ sum: 3 }, null, 2) },
  ]);
  expect(capabilities?.resources).toBeUndefined();
  expect(
    logged.map(({ msg, err }) => [msg, (err as { message: string }).message]),
  ).toStrictEqual(
    // initialize, its notification, tools/list and tools/call
    Array.from({ length: 4 }, () => [
      'The app resources failed',
      'the views broke',
    ]),
  );
});

test('of two resources with one uri the first is served, the other logged; a page that cannot be made is logged and answered RESOURCE_FAILED', async () => {
  const view = sampleView('https://views.example.org');
  const { client, logged, close } = await connect([
    view,
    { ...view, name: 'Another' },
    BROKEN_VIEW,
  ]);
  const { resources } = await client.listResources();
  let broken: unknown;
  try {
    await client.readResource({ uri: BROKEN_VIEW.uri });
  } catch (error) {
    broken = error;
  }
  await close();

  expect(resources.map(({ uri, name }) => [uri, name])).toStrictEqual([
    [view.uri, 'Sample view'],
    [BROKEN_VIEW.uri, 'Broken view'],
  ]);
  expect((broken as Error).message).toBe(
    'MCP error -32603: The resource could not be read. Try again later.',
  );
  expect(
    logged.map(({ msg, uri, err }) => [
      msg,
      uri,
      (err as { message: string }).message,
    ]),
  ).toStrictEqual([
    // initialize, its notification, resources/list and resources/read
    ...Array.from({ length: 4 }, () => [
      'An app resource failed',
      view.uri,
      'Another resource has the uri ui://sample/view: this one is left out.',
    ]),
    ['An app resource failed', BROKEN_VIEW.uri, 'the build is gone'],
  ]);
});
