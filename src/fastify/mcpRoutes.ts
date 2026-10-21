import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ToolCatalog } from '../contract/index.ts';
import { createMcpServer } from '../mcp/createMcpServer.ts';
import { buildToolCatalog } from '../tools/catalog.ts';
import { parseToolArguments } from '../tools/parseToolArguments.ts';
import { executeTool, findTool, unknownToolMessage } from '../tools/runTool.ts';
import { toolsOf } from '../tools/types.ts';

import type {
  ContextResolver,
  ToolRouteSettings,
  ToolRoutesOptions,
  ToolRoutesSettings,
} from './options.ts';
import { rpcError, sendRefusal, withDocumentation } from './replies.ts';
import { requestMcpResources, requestRunOptions } from './requestRunOptions.ts';
import { registerResourceRoutes } from './resourceRoutes.ts';
import { refuseMcp, serveMcp } from './serveMcp.ts';

/**
 * The routes of a tool server, to register under the API's prefix (`/v1`):
 * `GET tools` (the catalog), `POST tools/:name` (one call, as JSON, with the
 * structures drawn beside it) and `POST mcp` (MCP's Streamable HTTP,
 * stateless: a server per request, JSON answers). A call is checked in this
 * order: the tool's name (404), the precheck, the arguments (400), then the
 * context, so a server spends nothing on a call it would refuse anyway. A
 * refusal of the context answers its status before MCP starts, except a
 * 503: MCP then lists the tools and each call says why.
 * @param options - The server, its tools and how a request is resolved.
 * @returns The plugin.
 */
export function createToolRoutes<Context>(
  options: ToolRoutesOptions<Context>,
): FastifyPluginAsync {
  const { name, version, instructions = '', bodyLimit = 65_536 } = options;
  const settingsOf = (
    route: keyof ToolRoutesSettings,
  ): Required<Omit<ToolRouteSettings, 'schema'>> &
    Pick<ToolRouteSettings, 'schema'> => {
    const settings = options.routes?.[route] ?? {};
    const shared =
      route === 'run' || route === 'mcp' ? options.routeConfig : undefined;
    return {
      schema: settings.schema,
      bodyLimit: settings.bodyLimit ?? bodyLimit,
      config: { ...shared, ...settings.config },
    };
  };
  const run = settingsOf('run');
  const mcp = settingsOf('mcp');
  const catalogRoute = settingsOf('catalog');
  const notAllowed = settingsOf('mcpNotAllowed');
  const resources = {
    resources: options.resources,
    list: settingsOf('resources'),
    read: settingsOf('resourceRead'),
  };
  const resolve: ContextResolver<Context> =
    options.resolveContext ??
    (() => ({ ok: true, context: undefined as Context }));
  let staticCatalog: Promise<ToolCatalog> | undefined;
  const catalog = () =>
    typeof options.tools === 'function'
      ? buildToolCatalog(options.tools(), instructions)
      : (staticCatalog ??= buildToolCatalog(options.tools, instructions));
  const runOptions = (request: FastifyRequest) =>
    requestRunOptions(request, options);

  return async (app) => {
    if (options.resources !== undefined) {
      registerResourceRoutes(app, resources);
    }

    app.get(
      '/tools',
      {
        config: catalogRoute.config,
        schema: withDocumentation(
          catalogRoute.schema ?? {
            tags: ['tools'],
            summary: 'The tools, as an LLM sees them',
          },
        ),
      },
      async () => catalog(),
    );

    app.post<{ Params: { name: string } }>(
      '/tools/:name',
      {
        bodyLimit: run.bodyLimit,
        config: run.config,
        schema: withDocumentation(
          run.schema ?? {
            tags: ['tools'],
            summary: 'Run one tool',
            description:
              'The body holds the arguments. The answer is `result`, what the model reads, and the structures, schemes, spectra and files drawn beside it.',
            params: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        ),
      },
      async (request, reply) => {
        const toolName = request.params.name;
        const tool = findTool(toolsOf(options.tools), toolName);
        if (tool === undefined) {
          return sendRefusal(reply, {
            status: 404,
            code: 'not-found',
            error: unknownToolMessage(toolName, options),
          });
        }
        const prechecked = options.precheck?.(request, 'tools');
        if (prechecked) return sendRefusal(reply, prechecked);
        const parsed = parseToolArguments(tool, request.body ?? {});
        if (!parsed.success) {
          return sendRefusal(reply, {
            status: 400,
            code: 'invalid-arguments',
            error: parsed.error,
          });
        }
        const resolved = await resolve(request, 'tools', reply);
        if (!resolved.ok) return sendRefusal(reply, resolved.refusal);
        const answered = await executeTool(
          tool,
          parsed.data,
          resolved.context,
          runOptions(request),
        );
        if (!answered.ok) return sendRefusal(reply, answered.refusal);
        return reply.header('cache-control', 'no-store').send(answered.reply);
      },
    );

    app.post(
      '/mcp',
      {
        bodyLimit: mcp.bodyLimit,
        config: mcp.config,
        schema: withDocumentation(
          mcp.schema ?? {
            tags: ['mcp'],
            summary: 'MCP endpoint (Streamable HTTP, stateless)',
            description:
              'JSON-RPC messages of the Model Context Protocol. Send `Accept: application/json, text/event-stream`.',
          },
        ),
      },
      async (request, reply) => {
        const { origin } = request.headers;
        const own = options.ownOrigin
          ? options.ownOrigin(request)
          : `${request.protocol}://${request.host}`;
        if (
          origin !== undefined &&
          origin !== own &&
          !isAllowedOrigin(origin, options.allowedOrigins)
        ) {
          return rpcError(
            reply,
            403,
            'This origin may not call the MCP endpoint.',
          );
        }
        const prechecked = options.precheck?.(request, 'mcp');
        if (prechecked) return refuseMcp(reply, prechecked, name);
        const resolved = await resolve(request, 'mcp', reply);
        if (!resolved.ok && resolved.refusal.status !== 503) {
          return refuseMcp(reply, resolved.refusal, name);
        }
        const server = createMcpServer({
          name,
          version,
          instructions,
          tools: toolsOf(options.tools),
          ...(await requestMcpResources(request, options.resources)),
          context: resolved,
          ...runOptions(request),
        });
        await serveMcp(request, reply, server);
        return reply;
      },
    );

    for (const method of ['GET', 'DELETE'] as const) {
      app.route({
        method,
        url: '/mcp',
        config: notAllowed.config,
        schema: withDocumentation(
          notAllowed.schema ?? {
            tags: ['mcp'],
            summary: 'Not allowed: no session is kept',
          },
        ),
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

/**
 * Whether a foreign browser origin may call the MCP endpoint.
 * @param origin - The request's Origin.
 * @param allowed - The allowed origins, or `'*'` for any.
 * @returns True when allowed.
 */
function isAllowedOrigin(
  origin: string,
  allowed: readonly string[] | '*' | undefined,
): boolean {
  return allowed === '*' || (allowed ?? []).includes(origin);
}
