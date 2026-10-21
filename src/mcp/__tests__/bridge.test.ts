import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, expect, test } from 'vitest';

import type { AppServer } from '../../__tests__/appServer.ts';
import { VIEW_URI, startAppServer } from '../../__tests__/appServer.ts';
import { createToolClient } from '../../client/index.ts';
import { forwardAppResource } from '../../tools/apps.ts';
import { proxySchema } from '../../tools/proxySchema.ts';
import type { ToolDefinition } from '../../tools/types.ts';
import { ToolRefusalError, defineTool } from '../../tools/types.ts';
import { createMcpServer } from '../createMcpServer.ts';

const remote: AppServer = await startAppServer();

afterAll(async () => {
  await remote.app.close();
});

/**
 * A stdio-like bridge: the remote server's tools and views, served again
 * by an MCP server of its own.
 * @returns A client connected to the bridge.
 */
async function connectBridge(): Promise<Client> {
  const client = createToolClient({ baseUrl: remote.baseUrl });
  const catalog = await client.catalog();
  const listed = await client.resources();
  if (!catalog.ok || !listed.ok) throw new Error('The remote is down.');
  const tools: ToolDefinition[] = catalog.value.tools.map((entry) =>
    defineTool({
      name: entry.name,
      title: entry.title ?? entry.name,
      description: entry.description,
      schema: proxySchema(entry.inputSchema),
      meta: entry._meta,
      async execute(parameters) {
        const run = await client.callTool(entry.name, parameters);
        if (!run.ok) {
          throw new ToolRefusalError({
            status: 502,
            code: 'refused',
            error: run.failure.message,
          });
        }
        return {
          result: run.value.result,
          structuredContent: run.value.structuredContent,
          meta: run.value._meta,
        };
      },
    }),
  );
  const resources = listed.value.resources.map((listing) =>
    forwardAppResource(listing, async (uri) => {
      const read = await client.readResource(uri);
      if (!read.ok) throw new Error(read.failure.message);
      return read.value.contents[0]?.text ?? '';
    }),
  );
  const server = createMcpServer({
    name: 'bridge',
    version: '1.0.0',
    tools,
    resources,
    context: { ok: true, context: undefined },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: 'test', version: '1.0.0' });
  await mcp.connect(clientSide);
  return mcp;
}

test("a bridge passes the remote's views on: the tools' _meta, the resources, and each answer's structuredContent and _meta", async () => {
  const mcp = await connectBridge();
  const { tools } = await mcp.listTools();
  const { resources } = await mcp.listResources();
  const read = await mcp.readResource({ uri: VIEW_URI });
  const called = await mcp.callTool({
    name: 'showMolecule',
    arguments: { name: 'benzene' },
  });
  await mcp.close();

  const origin = remote.baseUrl.origin;
  const ui = {
    csp: { resourceDomains: [origin], connectDomains: [] },
    permissions: { clipboardWrite: {} },
    prefersBorder: true,
  };

  expect(tools[1]?._meta).toStrictEqual({
    ui: { resourceUri: VIEW_URI, visibility: ['app'] },
    'ui/resourceUri': VIEW_URI,
  });
  expect(resources.map(({ uri, _meta }) => [uri, _meta])).toStrictEqual([
    [VIEW_URI, { ui }],
  ]);
  expect(read.contents).toStrictEqual([
    {
      uri: VIEW_URI,
      mimeType: 'text/html;profile=mcp-app',
      text: `<!doctype html><script src="${origin}/view.js"></script>`,
      _meta: { ui },
    },
  ]);
  expect([called.structuredContent, called._meta]).toStrictEqual([
    { name: 'benzene', atoms: 6 },
    { 'org.example/view': { view: 'molecule', name: 'benzene' } },
  ]);
});
