import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { createMcpServer } from '../mcp/createMcpServer.ts';
import type { ToolRefusal } from '../tools/types.ts';

import { rpcError } from './replies.ts';

/**
 * Answer a refused MCP request: a JSON-RPC error with the refusal's status,
 * Bearer's challenge on a 401, Retry-After when given.
 * @param reply - The reply.
 * @param refusal - Why.
 * @param realm - The server's name.
 * @returns The reply, sent.
 */
export function refuseMcp(
  reply: FastifyReply,
  refusal: ToolRefusal,
  realm: string,
): FastifyReply {
  if (refusal.status === 401) {
    void reply.header('www-authenticate', `Bearer realm="${realm}"`);
  }
  if (refusal.retryAfter !== undefined) {
    void reply.header('retry-after', String(refusal.retryAfter));
  }
  return rpcError(reply, refusal.status, refusal.error);
}

/**
 * Hand the request to MCP's transport, which writes the raw response: the
 * headers already set on the reply are carried over, the answer is never
 * cached, and the server closes with the connection.
 * @param request - The request.
 * @param reply - The reply, hijacked.
 * @param server - The request's MCP server.
 */
export async function serveMcp(
  request: FastifyRequest,
  reply: FastifyReply,
  server: ReturnType<typeof createMcpServer>,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  reply.hijack();
  for (const [header, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) reply.raw.setHeader(header, value);
  }
  reply.raw.setHeader('cache-control', 'no-store');
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  } catch (error) {
    request.log.error({ err: error }, 'The MCP request failed');
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'content-type': 'application/json' });
      reply.raw.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32_603, message: 'Internal server error' },
          id: null,
        }),
      );
    }
  }
}
