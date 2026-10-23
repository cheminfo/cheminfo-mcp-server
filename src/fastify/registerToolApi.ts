import type { FastifyInstance } from 'fastify';

import { createToolRoutes } from './mcpRoutes.ts';
import type { ToolRoutesOptions } from './options.ts';
import { wellKnownNotFound } from './replies.ts';

/**
 * What the OpenAPI document at `/docs/json` says of the API.
 */
export interface ToolApiDocumentation {
  /**
   * E.g. `equilibrium.cheminfo.org tools`.
   */
  title: string;
  /**
   * One or two sentences: what the tools answer, and for whom.
   */
  description: string;
  /**
   * The API's version.
   * @default the version of the routes' options
   */
  version?: string;
}

/**
 * Register a site's tool API: `createToolRoutes()` under `/v1`, its OpenAPI
 * documentation at `/docs` (`/docs/json` for the document), and the JSON 404
 * of `/.well-known/*`. The document names its server relatively (`..`) and
 * keeps the paths' `/v1`, so "Try it out" works behind a path prefix too.
 * Register it before any route that should be documented, and do not
 * register `wellKnownNotFound` again. Needs `@fastify/swagger` and
 * `@fastify/swagger-ui`.
 * @param app - The Fastify instance.
 * @param routesOptions - The tools, as `createToolRoutes()` takes them.
 * @param documentation - The document's title, description and version.
 */
export async function registerToolApi<Context>(
  app: FastifyInstance,
  routesOptions: ToolRoutesOptions<Context>,
  documentation: ToolApiDocumentation,
): Promise<void> {
  const [{ default: swagger }, { default: swaggerUi }] = await Promise.all([
    import('@fastify/swagger'),
    import('@fastify/swagger-ui'),
  ]);
  const { title, description, version = routesOptions.version } = documentation;
  await app.register(swagger, {
    openapi: {
      info: { title, description, version },
      // Relative to the document at /docs/json, so "Try it out" also works
      // behind a path prefix.
      servers: [{ url: '..' }],
    },
    // The paths keep their `/v1`: the server address above has none to strip.
    stripBasePath: false,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  // An MCP client probing for OAuth metadata must read JSON, never a page.
  await app.register(wellKnownNotFound);
  await app.register(createToolRoutes(routesOptions), { prefix: '/v1' });
}
