import type { FastifyPluginAsync, FastifyReply, FastifySchema } from 'fastify';

import type { ToolRefusal } from '../tools/types.ts';

/**
 * Answer a refusal of the JSON API: its status, `{error, code}` followed
 * by its extra fields, and Retry-After when given.
 * @param reply - The reply.
 * @param refusal - Why.
 * @returns The reply, sent.
 */
export function sendRefusal(
  reply: FastifyReply,
  refusal: ToolRefusal,
): FastifyReply {
  if (refusal.retryAfter !== undefined) {
    void reply.header('retry-after', String(refusal.retryAfter));
  }
  return reply
    .code(refusal.status)
    .send({ error: refusal.error, code: refusal.code, ...refusal.extra });
}

/**
 * Answer with a JSON-RPC error envelope, as MCP clients expect.
 * @param reply - The reply.
 * @param status - The HTTP status.
 * @param message - The error's message.
 * @returns The reply, sent.
 */
export function rpcError(
  reply: FastifyReply,
  status: number,
  message: string,
): FastifyReply {
  return reply.code(status).send({
    jsonrpc: '2.0',
    error: { code: status === 405 ? -32_000 : -32_001, message },
    id: null,
  });
}

/**
 * `/.well-known/*` answers 404 as JSON, never the page: an MCP client probing
 * for OAuth metadata fails on HTML. Register it at the root, without prefix.
 * @param app - The Fastify instance.
 */
export const wellKnownNotFound: FastifyPluginAsync = async (app) => {
  app.get(
    '/.well-known/*',
    { schema: withDocumentation({ hide: true }) },
    async (_request, reply) =>
      reply.code(404).send({ error: 'Not found.', code: 'not-found' }),
  );
};

/**
 * A route's schema, with the fields `@fastify/swagger` reads.
 */
export interface RouteDocumentation extends FastifySchema {
  /**
   * The Swagger tags.
   * @default undefined
   */
  tags?: string[];
  /**
   * One line for the Swagger UI.
   * @default undefined
   */
  summary?: string;
  /**
   * More, in Markdown.
   * @default undefined
   */
  description?: string;
  /**
   * Leave the route out of the documentation.
   * @default false
   */
  hide?: boolean;
}

/**
 * A route's schema with its documentation, for servers that run
 * `@fastify/swagger`; without it the extra fields are ignored.
 * @param schema - The schema and its documentation.
 * @returns The schema, as Fastify types it.
 */
export function withDocumentation(schema: RouteDocumentation): FastifySchema {
  return schema;
}
