import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ResourceList, ResourceRead } from '../contract/index.ts';
import { APP_MIME_TYPE } from '../contract/index.ts';
import type { AppResourceList, ReadAppResource } from '../tools/apps.ts';
import {
  RESOURCE_FAILED,
  appResourcesOf,
  readAppResource,
  uniqueResources,
} from '../tools/apps.ts';

import type { ToolRouteSettings } from './options.ts';
import { isEtagHeld, sendRefusal, withDocumentation } from './replies.ts';

/**
 * The settings registerResourceRoutes() reads.
 */
export interface ResourceRouteSettings {
  /**
   * The app resources, or the function giving them for a request.
   */
  resources: AppResourceList<FastifyRequest> | undefined;
  /**
   * `GET resources`.
   */
  list: Pick<ToolRouteSettings, 'schema' | 'config'>;
  /**
   * `GET resources/read`.
   */
  read: Pick<ToolRouteSettings, 'schema' | 'config'>;
}

/**
 * The app resources for a host speaking JSON: `GET resources` lists them
 * with the version of each (one whose page cannot be made is logged and
 * left out), `GET resources/read?uri=…` answers one as MCP's
 * resources/read does, with that version as its ETag, and 304 to a host
 * that holds it. Neither is stored without asking again (`no-cache`, unless
 * the server set a Cache-Control already).
 * @param app - Fastify instance, under the API's prefix.
 * @param settings - The resources, and each route's settings.
 */
export function registerResourceRoutes(
  app: FastifyInstance,
  settings: ResourceRouteSettings,
): void {
  app.get(
    '/resources',
    {
      config: settings.list.config,
      schema: withDocumentation(
        settings.list.schema ?? {
          tags: ['resources'],
          summary: 'The MCP Apps the tools are drawn with, and their versions',
        },
      ),
    },
    async (request, reply) => {
      let resources: Awaited<ReturnType<typeof appResourcesOf>>;
      try {
        resources = uniqueResources(
          await appResourcesOf(settings.resources, request),
        );
      } catch (error) {
        return failed(request, reply, error);
      }
      const read = await Promise.allSettled(resources.map(readAppResource));
      const body: ResourceList = { resources: [] };
      for (let index = 0; index < read.length; index++) {
        const outcome = read[index] as PromiseSettledResult<ReadAppResource>;
        if (outcome.status === 'fulfilled') {
          body.resources.push(outcome.value.listing);
        } else {
          request.log.error(
            { err: outcome.reason, uri: resources[index]?.uri },
            'An app resource failed',
          );
        }
      }
      return revalidated(reply).send(body);
    },
  );

  app.get<{ Querystring: { uri?: unknown } }>(
    '/resources/read',
    {
      config: settings.read.config,
      schema: withDocumentation(
        settings.read.schema ?? {
          tags: ['resources'],
          summary: 'One MCP App, as resources/read answers it',
          querystring: {
            type: 'object',
            properties: {
              uri: { type: 'string', description: 'e.g. ui://molecules/view' },
            },
          },
        },
      ),
    },
    async (request, reply) => {
      const { uri } = request.query;
      if (typeof uri !== 'string' || uri === '') {
        return sendRefusal(reply, {
          status: 400,
          code: 'invalid-arguments',
          error: 'Give the uri of a resource.',
        });
      }
      let read: ReadAppResource | undefined;
      try {
        const resources = await appResourcesOf(settings.resources, request);
        const resource = resources.find((candidate) => candidate.uri === uri);
        if (resource !== undefined) read = await readAppResource(resource);
      } catch (error) {
        return failed(request, reply, error);
      }
      if (read === undefined) {
        return sendRefusal(reply, {
          status: 404,
          code: 'not-found',
          error: `No resource ${uri}.`,
        });
      }
      const etag = `"${read.listing.version}"`;
      revalidated(reply).header('etag', etag);
      if (isEtagHeld(request.headers['if-none-match'], etag)) {
        return reply.code(304).send();
      }
      const body: ResourceRead = {
        contents: [
          {
            uri,
            mimeType: APP_MIME_TYPE,
            text: read.html,
            ...(read.listing._meta !== undefined && {
              _meta: read.listing._meta,
            }),
          },
        ],
      };
      return reply.send(body);
    },
  );
}

/**
 * Ask a host to check before reusing what it stored, unless the server
 * already said how the answer is cached.
 * @param reply - The reply.
 * @returns The reply.
 */
function revalidated(reply: FastifyReply): FastifyReply {
  return reply.hasHeader('cache-control')
    ? reply
    : reply.header('cache-control', 'no-cache');
}

/**
 * A resource that could not be made: logged, and a 500 the host reads.
 * @param request - The request.
 * @param reply - The reply.
 * @param error - What failed.
 * @returns The reply, sent.
 */
function failed(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  request.log.error({ err: error }, 'An app resource failed');
  return sendRefusal(reply, {
    status: 500,
    code: 'internal',
    error: RESOURCE_FAILED,
  });
}
