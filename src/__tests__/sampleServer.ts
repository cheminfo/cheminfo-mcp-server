import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { fastify } from 'fastify';

import { createToolRoutes } from '../fastify/mcpRoutes.ts';
import { wellKnownNotFound } from '../fastify/replies.ts';

import type { SampleContext } from './sampleTools.ts';
import { SAMPLE_TOOLS, resolveSampleContext } from './sampleTools.ts';

/**
 * The sample server, its address once listening, and how to close it.
 */
export interface SampleServer {
  app: FastifyInstance;
  /**
   * The API root, with its trailing slash: `http://127.0.0.1:<port>/v1/`.
   */
  baseUrl: URL;
  /**
   * What the tools threw.
   */
  errors: unknown[];
}

/**
 * The sample tools served under `/v1`, listening on a free port of
 * 127.0.0.1, with the well-known routes at the root.
 * @returns The server; close its `app` after the tests.
 */
export async function startSampleServer(): Promise<SampleServer> {
  const errors: unknown[] = [];
  const app = fastify();
  await app.register(wellKnownNotFound);
  await app.register(
    createToolRoutes<SampleContext>({
      name: 'sample-tools',
      version: '1.2.3',
      instructions: 'Sample tools for the tests.',
      tools: SAMPLE_TOOLS,
      resolveContext: resolveSampleContext,
      allowedOrigins: ['https://inspector.example.org'],
      unknownToolMessage: (tool) => `Unknown sample tool: ${tool}`,
      onError: (error) => {
        errors.push(error);
      },
    }),
    { prefix: '/v1' },
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, baseUrl: new URL(`http://127.0.0.1:${port}/v1/`), errors };
}
