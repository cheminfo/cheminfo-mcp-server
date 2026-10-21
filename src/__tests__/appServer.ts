import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { fastify } from 'fastify';
import { z } from 'zod';

import { createToolRoutes } from '../fastify/mcpRoutes.ts';
import type { AppResource } from '../tools/apps.ts';
import { defineTool } from '../tools/types.ts';

/**
 * The address of the sample view.
 */
export const VIEW_URI = 'ui://sample/view';

/**
 * A tool whose answer a view draws.
 */
export const showTool = defineTool({
  name: 'showMolecule',
  title: 'Show a molecule',
  description: 'A molecule, drawn by the view.',
  schema: z.strictObject({ name: z.string() }),
  ui: { resourceUri: VIEW_URI },
  meta: { 'org.example/kind': 'molecule' },
  execute: ({ name }) => ({
    result: { name },
    structuredContent: { name, atoms: 6 },
    meta: { 'org.example/view': { view: 'molecule', name } },
  }),
});

/**
 * A tool only the view calls, for its next page.
 */
export const pageTool = defineTool({
  name: 'moleculePage',
  title: 'A page of molecules',
  description: 'The next page, for the view.',
  schema: z.strictObject({ offset: z.number().int().min(0) }),
  ui: { resourceUri: VIEW_URI, visibility: ['app'] },
  execute: ({ offset }) => ({
    result: { offset },
    meta: { 'org.example/view': { view: 'page', offset } },
  }),
});

/**
 * A tool whose result and `_meta` are longer than the server's warning
 * sizes.
 */
export const largeTool = defineTool({
  name: 'largeView',
  title: 'A large view',
  description: 'Answers a large result and a large _meta.',
  schema: z.strictObject({}),
  execute: () => ({
    result: { text: 'y'.repeat(150) },
    meta: { blob: 'x'.repeat(200) },
  }),
});

/**
 * The sample view, its page made from the request's origin.
 * @param origin - Where the request came to.
 * @returns The resource.
 */
export function sampleView(origin: string): AppResource {
  return {
    uri: VIEW_URI,
    name: 'Sample view',
    description: 'Draws a molecule.',
    html: () => `<!doctype html><script src="${origin}/view.js"></script>`,
    csp: { resourceDomains: [origin], connectDomains: [] },
    permissions: { clipboardWrite: {} },
    prefersBorder: true,
  };
}

/**
 * A view whose page cannot be made.
 */
export const BROKEN_VIEW: AppResource = {
  uri: 'ui://sample/broken',
  name: 'Broken view',
  html: () => {
    throw new Error('the build is gone');
  },
};

/**
 * The app server, its address, and the warnings its logger wrote.
 */
export interface AppServer {
  app: FastifyInstance;
  baseUrl: URL;
  warnings: Array<Record<string, unknown>>;
}

/**
 * A server with a view, a tool for the model and the view, one for the
 * view only and one with a large result (over 120 characters) and a large
 * `_meta` (over 100), listening
 * on a free port of 127.0.0.1.
 * @returns The server; close its `app` after the tests.
 */
export async function startAppServer(): Promise<AppServer> {
  const warnings: Array<Record<string, unknown>> = [];
  const app = fastify({
    logger: {
      level: 'warn',
      stream: {
        write: (line: string) => {
          warnings.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    },
  });
  await app.register(
    createToolRoutes({
      name: 'app-tools',
      version: '1.0.0',
      tools: [showTool, pageTool, largeTool],
      resources: (request) => [
        sampleView(`${request.protocol}://${request.host}`),
        BROKEN_VIEW,
      ],
      metaWarnSize: 100,
      resultWarnSize: 120,
    }),
    { prefix: '/v1' },
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, baseUrl: new URL(`http://127.0.0.1:${port}/v1/`), warnings };
}
