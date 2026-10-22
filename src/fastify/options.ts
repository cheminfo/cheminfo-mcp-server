import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ToolExample } from '../contract/index.ts';
import type { ContextResolution } from '../mcp/createMcpServer.ts';
import type { AppResourceList } from '../tools/apps.ts';
import type { ToolList, ToolRefusal } from '../tools/types.ts';

import type { RouteDocumentation } from './replies.ts';

/**
 * Which route a context is resolved for: MCP clients, or the JSON API.
 */
export type ToolRoute = 'mcp' | 'tools';

/**
 * Resolves the context of a request, or refuses it. The reply is given for
 * what a refusal must change besides its body, such as clearing a session
 * cookie that ended; the route sends the refusal.
 */
export type ContextResolver<Context> = (
  request: FastifyRequest,
  route: ToolRoute,
  reply: FastifyReply,
) => ContextResolution<Context> | Promise<ContextResolution<Context>>;

/**
 * The settings of one route, over the defaults of every route.
 */
export interface ToolRouteSettings {
  /**
   * The route's whole schema: its documentation, headers, body, params and
   * responses, as the server documents them. The run route's params must
   * still name `name`.
   * @default the package's own documentation
   */
  schema?: RouteDocumentation;
  /**
   * Largest body accepted, in bytes.
   * @default the `bodyLimit` of every POST route
   */
  bodyLimit?: number;
  /**
   * The route's Fastify `config`; on the two POST routes, merged over
   * `routeConfig`.
   * @default {}
   */
  config?: Record<string, unknown>;
}

/**
 * The settings of each route of a tool server.
 */
export interface ToolRoutesSettings {
  /**
   * `GET tools`, the catalog.
   * @default {}
   */
  catalog?: ToolRouteSettings;
  /**
   * `POST tools/:name`, one call as JSON; its `config` is merged over
   * `routeConfig`.
   * @default {}
   */
  run?: ToolRouteSettings;
  /**
   * `POST mcp`, MCP's Streamable HTTP; its `config` is merged over
   * `routeConfig`.
   * @default {}
   */
  mcp?: ToolRouteSettings;
  /**
   * `GET mcp` and `DELETE mcp`, which answer 405.
   * @default {}
   */
  mcpNotAllowed?: ToolRouteSettings;
  /**
   * `GET resources`, the app resources and their versions.
   * @default {}
   */
  resources?: ToolRouteSettings;
  /**
   * `GET resources/read?uri=…`, one resource's page, with its ETag.
   * @default {}
   */
  resourceRead?: ToolRouteSettings;
}

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
   * Questions the tools answer, with what a correct answer contains: `GET
   * tools` lists them, for a chat to show and a benchmark to ask.
   * @default []
   */
  examples?: readonly ToolExample[];
  /**
   * The MCP Apps the tools' answers are drawn with, or a function giving
   * them for a request (their assets may be served from its origin): MCP's
   * resources/list and resources/read, and `GET resources` and
   * `GET resources/read?uri=…` for a host speaking JSON, which a server
   * without this option does not have.
   * @default undefined - no resources, and no resource routes
   */
  resources?: AppResourceList<FastifyRequest>;
  /**
   * The JSON length of an answer's `_meta` above which the request's logger
   * warns.
   * @default 60000
   */
  metaWarnSize?: number;
  /**
   * The JSON length of the result a model reads above which the request's
   * logger warns.
   * @default 100000
   */
  resultWarnSize?: number;
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
  /**
   * The settings of each route: `catalog` (`GET tools`), `run`
   * (`POST tools/:name`), `mcp` (`POST mcp`), `mcpNotAllowed` (`GET` and
   * `DELETE mcp`), `resources` (`GET resources`) and `resourceRead`
   * (`GET resources/read`).
   * @default {}
   */
  routes?: ToolRoutesSettings;
  /**
   * A cheap check before the arguments are read, e.g. that a credential is
   * there at all: a refusal answers before anything else runs.
   * @default undefined - no check
   */
  precheck?: (
    request: FastifyRequest,
    route: ToolRoute,
  ) => ToolRefusal | undefined;
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
