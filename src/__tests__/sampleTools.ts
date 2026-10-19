import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ContextResolution } from '../mcp/createMcpServer.ts';
import { defineTool } from '../tools/types.ts';

/**
 * Who a request of the sample server acts for.
 */
export interface SampleContext {
  email: string;
}

/**
 * The token the sample server accepts.
 */
export const SAMPLE_TOKEN = 'secret-token';

export const additionTool = defineTool({
  name: 'addNumbers',
  title: 'Add two numbers',
  description: 'Add two numbers.',
  schema: z.strictObject({ a: z.number(), b: z.number() }),
  execute: ({ a, b }) => ({ result: { sum: a + b } }),
});

export const identityTool = defineTool({
  name: 'whoAmI',
  title: 'Who am I',
  description: 'The email the request acts for.',
  schema: z.strictObject({}),
  execute: (_parameters, context: SampleContext) => ({
    result: { email: context.email },
  }),
});

export const benzeneTool = defineTool({
  name: 'drawBenzene',
  title: 'Draw benzene',
  description: 'Benzene, drawn beside the answer.',
  schema: z.strictObject({ label: z.string().optional() }),
  execute: ({ label = 'benzene' }) => ({
    result: { name: 'benzene' },
    molecules: [{ smiles: 'c1ccccc1', label }],
    reactions: [{ rxnCode: 'gFp@DiTt@@@!gFp@DiTt@@@', label }],
  }),
});

export const failingTool = defineTool({
  name: 'explode',
  title: 'Explode',
  description: 'Always throws.',
  schema: z.strictObject({}),
  execute: () => {
    throw new Error('the database is on fire');
  },
});

/**
 * The four tools of the sample server.
 */
export const SAMPLE_TOOLS = [
  additionTool,
  identityTool,
  benzeneTool,
  failingTool,
];

/**
 * The sample server's context: the token in `x-token`, or a 401; `busy`
 * stands for a server that cannot check identities now (503).
 * @param request - The request.
 * @returns The context, or the refusal.
 */
export function resolveSampleContext(
  request: FastifyRequest,
): ContextResolution<SampleContext> {
  const token = request.headers['x-token'];
  if (token === SAMPLE_TOKEN) {
    return { ok: true, context: { email: 'alice@example.org' } };
  }
  if (token === 'busy') {
    return {
      ok: false,
      refusal: {
        status: 503,
        code: 'access-unverifiable',
        error: 'Cannot check your token now. Try again in a minute.',
        retryAfter: 60,
      },
    };
  }
  return {
    ok: false,
    refusal: {
      status: 401,
      code: 'no-credentials',
      error: 'Send your token in x-token.',
    },
  };
}
