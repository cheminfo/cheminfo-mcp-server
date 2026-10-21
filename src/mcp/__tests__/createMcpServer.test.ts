import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { defineTool } from '../../tools/types.ts';
import type { ContextResolution } from '../createMcpServer.ts';
import { createMcpServer } from '../createMcpServer.ts';

const taggedTool = defineTool({
  name: 'tagged',
  title: 'Tagged',
  description: 'Carries meta of its own, and no view.',
  schema: z.strictObject({}),
  meta: { 'org.example/tag': 'kept' },
  execute: (_parameters, context: { email: string }) => ({
    result: { email: context.email },
  }),
});

/**
 * A client of a server holding the tagged tool, with no resources and no
 * instructions.
 * @param context - The context its calls run with, or the refusal.
 * @returns The connected client.
 */
async function connect(
  context: ContextResolution<{ email: string }>,
): Promise<Client> {
  const server = createMcpServer({
    name: 'plain',
    version: '1.0.0',
    tools: [taggedTool],
    context,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

test("a tool's own meta is listed as it is, and a server without resources or instructions declares neither", async () => {
  const client = await connect({ ok: true, context: { email: 'a@b.ch' } });
  const { tools } = await client.listTools();
  const called = await client.callTool({ name: 'tagged', arguments: {} });
  const capabilities = client.getServerCapabilities();
  const instructions = client.getInstructions();
  await client.close();

  expect(tools[0]?._meta).toStrictEqual({ 'org.example/tag': 'kept' });
  expect(called.content).toStrictEqual([
    { type: 'text', text: JSON.stringify({ email: 'a@b.ch' }, null, 2) },
  ]);
  expect([capabilities?.resources, instructions]).toStrictEqual([
    undefined,
    undefined,
  ]);
});

test('a refused context still lists the tools, and each call answers why as an error result', async () => {
  const client = await connect({
    ok: false,
    refusal: { status: 503, code: 'loading', error: 'The copy is loading.' },
  });
  const { tools } = await client.listTools();
  const called = await client.callTool({ name: 'tagged', arguments: {} });
  await client.close();

  expect(tools.map((tool) => tool.name)).toStrictEqual(['tagged']);
  expect([called.isError, called.content]).toStrictEqual([
    true,
    [{ type: 'text', text: 'The copy is loading.' }],
  ]);
});
