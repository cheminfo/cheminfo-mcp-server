import type { FastifyRequest } from 'fastify';

import type { ContextResolution } from '../mcp/createMcpServer.ts';
import type { ToolList } from '../tools/types.ts';

/**
 * Which route a context is resolved for: MCP clients, or the JSON API.
 */
export type ToolRoute = 'mcp' | 'tools';

/**
 * Resolves the context of a request, or refuses it.
 */
export type ContextResolver<Context> = (
  request: FastifyRequest,
  route: ToolRoute,
) => ContextResolution<Context> | Promise<ContextResolution<Context>>;

/**
 * The options every server gives.
 */
export interface ToolRoutesBaseOptions<Context> {
  /**
   * The server's name: MCP's `initialize`, and the realm of a 401.
   */
  name: string;
  /**
   * Its version, as MCP's `initialize` reports it.
   */
  version: string;
  /**
   * What the model is told about the tools as a whole.
   * @default ''
   */
  instructions?: string;
  tools: ToolList<Context>;
  /**
   * Browser origins allowed on `POST mcp` besides the page's own, or `'*'`
   * for any: only for a server that reads no credential, where a page
   * elsewhere can do nothing a script could not.
   * @default []
   */
  allowedOrigins?: readonly string[] | '*';
  /**
   * The page's own origin.
   * @default `${request.protocol}://${request.host}`
   */
  ownOrigin?: (request: FastifyRequest) => string;
  /**
   * Largest body accepted on the two POST routes, in bytes.
   * @default 65536
   */
  bodyLimit?: number;
  /**
   * Merged into the `config` of the two POST routes: a rate limit, typically.
   * @default {}
   */
  routeConfig?: Record<string, unknown>;
  /**
   * Told when a tool throws.
   * @default undefined - the request's logger logs it
   */
  onError?: (error: unknown, name: string, request: FastifyRequest) => void;
  /**
   * The sentence of a 404 for a tool that does not exist.
   * @default (name) => `Unknown tool: ${name}`
   */
  unknownToolMessage?: (name: string) => string;
}

/**
 * The options of `createToolRoutes`: a server whose tools need a
 * context must say how a request gets one.
 */
export type ToolRoutesOptions<Context> = ToolRoutesBaseOptions<Context> &
  (undefined extends Context
    ? {
        /**
         * Resolves a request's context, or refuses it.
         * @default every request is answered, with an undefined context
         */
        resolveContext?: ContextResolver<Context>;
      }
    : { resolveContext: ContextResolver<Context> });
