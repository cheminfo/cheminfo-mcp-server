import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ToolCatalog } from '../contract/index.ts';
import { createMcpServer } from '../mcp/createMcpServer.ts';
import { buildToolCatalog } from '../tools/catalog.ts';
import { findTool, runTool, unknownToolMessage } from '../tools/runTool.ts';
import { toolsOf } from '../tools/types.ts';

import type { ContextResolver, ToolRoutesOptions } from './options.ts';
import { rpcError, sendRefusal, withDocumentation } from './replies.ts';
import { refuseMcp, serveMcp } from './serveMcp.ts';

/**
 * The routes of a tool server, to register under the API's prefix (`/v1`):
 * `GET tools` (the catalog), `POST tools/:name` (one call, as JSON, with the
 * structures drawn beside it; an unknown name is a 404 before the context is
 * resolved) and `POST mcp` (MCP's Streamable HTTP,
 * stateless: a server per request, JSON answers). A refusal of the context
 * answers its status before MCP starts, except a 503: MCP then lists the
 * tools and each call says why.
 * @param options - The server, its tools and how a request is resolved.
 * @returns The plugin.
 */
export function createToolRoutes<Context>(
  options: ToolRoutesOptions<Context>,
): FastifyPluginAsync {
  const { name, version, instructions = '', bodyLimit = 65_536 } = options;
  const resolve: ContextResolver<Context> =
    options.resolveContext ??
    (() => ({ ok: true, context: undefined as Context }));
  const config = options.routeConfig ?? {};
  let staticCatalog: Promise<ToolCatalog> | undefined;
  const catalog = () =>
    typeof options.tools === 'function'
      ? buildToolCatalog(options.tools(), instructions)
      : (staticCatalog ??= buildToolCatalog(options.tools, instructions));
  const onError =
    (request: FastifyRequest) => (error: unknown, tool: string) =>
      options.onError
        ? options.onError(error, tool, request)
        : request.log.error({ err: error, tool }, 'A tool failed');

  return async (app) => {
    app.get(
      '/tools',
      {
        schema: withDocumentation({
          tags: ['tools'],
          summary: 'The tools, as an LLM sees them',
        }),
      },
      async () => catalog(),
    );

    app.post<{ Params: { name: string } }>(
      '/tools/:name',
      {
        bodyLimit,
        config,
        schema: withDocumentation({
          tags: ['tools'],
          summary: 'Run one tool',
          description:
            'The body holds the arguments. The answer is `result`, what the model reads, and the structures, schemes, spectra and files drawn beside it.',
          params: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        }),
      },
      async (request, reply) => {
        // The name is checked first: an unknown tool is a 404, whoever asks.
        const tools = toolsOf(options.tools);
        const toolName = request.params.name;
        if (findTool(tools, toolName) === undefined) {
          return sendRefusal(reply, {
            status: 404,
            code: 'not-found',
            error: unknownToolMessage(toolName, options),
          });
        }
        const resolved = await resolve(request, 'tools');
        if (!resolved.ok) return sendRefusal(reply, resolved.refusal);
        const run = await runTool(
          tools,
          toolName,
          request.body ?? {},
          resolved.context,
          {
            onError: onError(request),
            unknownToolMessage: options.unknownToolMessage,
          },
        );
        if (!run.ok) return sendRefusal(reply, run.refusal);
        return reply.header('cache-control', 'no-store').send(run.reply);
      },
    );

    app.post(
      '/mcp',
      {
        bodyLimit,
        config,
        schema: withDocumentation({
          tags: ['mcp'],
          summary: 'MCP endpoint (Streamable HTTP, stateless)',
          description:
            'JSON-RPC messages of the Model Context Protocol. Send `Accept: application/json, text/event-stream`.',
        }),
      },
      async (request, reply) => {
        const { origin } = request.headers;
        const own = options.ownOrigin
          ? options.ownOrigin(request)
          : `${request.protocol}://${request.host}`;
        if (
          origin !== undefined &&
          origin !== own &&
          !(options.allowedOrigins ?? []).includes(origin)
        ) {
          return rpcError(
            reply,
            403,
            'This origin may not call the MCP endpoint.',
          );
        }
        const resolved = await resolve(request, 'mcp');
        if (!resolved.ok && resolved.refusal.status !== 503) {
          return refuseMcp(reply, resolved.refusal, name);
        }
        const server = createMcpServer({
          name,
          version,
          instructions,
          tools: toolsOf(options.tools),
          context: resolved,
          onError: onError(request),
        });
        await serveMcp(request, reply, server);
        return reply;
      },
    );

    for (const method of ['GET', 'DELETE'] as const) {
      app.route({
        method,
        url: '/mcp',
        schema: withDocumentation({
          tags: ['mcp'],
          summary: 'Not allowed: no session is kept',
        }),
        handler: async (_request, reply) =>
          rpcError(
            reply.header('allow', 'POST'),
            405,
            'Method not allowed: this MCP endpoint is stateless, use POST.',
          ),
      });
    }
  };
}
