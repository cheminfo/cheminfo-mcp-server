import { resolve } from 'node:path';

import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';

import {
  isEtagHeld,
  sendRefusal,
  withDocumentation,
} from '../fastify/replies.ts';
import { contentVersion } from '../tools/contentVersion.ts';

import { retainAssets } from './retainAssets.ts';
import type { ViewBuildOptions } from './viewBuild.ts';
import { readViewBuild } from './viewBuild.ts';
import {
  VIEW_LOADER_CACHE_CONTROL,
  VIEW_LOADER_FILE,
  viewLoaderScript,
} from './viewLoader.ts';

/**
 * Options of {@link registerViewAssets}.
 */
export interface ViewAssetsOptions extends ViewBuildOptions {
  /**
   * The views build's folder, absolute or from the working directory: its
   * files are in `<root>/assets/`.
   */
  root: string;
  /**
   * Where the assets are served, under the plugin's own prefix.
   * @default '/views/assets'
   */
  prefix?: string;
  /**
   * A folder that keeps the assets of earlier builds, so a view loaded
   * before a deploy still finds the chunks it imports later. Each build's
   * assets are copied there at startup, and served when the build no longer
   * has them. It must hold nothing else: a file no build has had for
   * `retainDays` is deleted.
   * @default undefined - only the current build is served
   */
  retainDirectory?: string;
  /**
   * Days a retained asset the current build no longer has is kept.
   * @default 30
   */
  retainDays?: number;
  /**
   * Serve `<prefix>/loader.js`, which loads the current build (see
   * viewLoaderScript()), for pages made by `viewResource({ loader: true })`.
   * It is read from the build on each request and asked again every time.
   * @default false
   */
  loader?: boolean;
}

/**
 * The headers of every answer under the assets' prefix: a view runs in a
 * host's sandbox, on another origin, and loads these files from there,
 * without credentials.
 */
export const VIEW_ASSET_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
  'x-content-type-options': 'nosniff',
};

/**
 * How a hashed asset is cached: a year, never revalidated.
 */
export const VIEW_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * One file of the flat assets folder: no subfolder, no dotfile.
 */
const ASSET_NAME = /^\/[\w-][\w.-]*$/;

/**
 * Serve a views build's assets, `GET <prefix>/<file>` from `<root>/assets/`
 * (then `retainDirectory`), to any origin and without credentials: the hashed
 * app, its chunks and its stylesheets, cached for a year, with their content
 * types. Anything else under the prefix answers 404 `not-found`, never
 * stored and never a page: a subfolder, a dotfile, a path out of the
 * folder, a missing file, or every file while the views are not built.
 * With `loader`, `<prefix>/loader.js` loads the current build, and is never
 * kept without asking. Needs `@fastify/static`.
 * @param app - Fastify instance.
 * @param options - The build, where it is served, and what is retained.
 */
export async function registerViewAssets(
  app: FastifyInstance,
  options: ViewAssetsOptions,
): Promise<void> {
  const { default: fastifyStatic } = await import('@fastify/static');
  const current = resolve(options.root, 'assets');
  const retained =
    options.retainDirectory === undefined
      ? undefined
      : resolve(options.retainDirectory);
  if (retained !== undefined) {
    await retainAssets(current, retained, options.retainDays ?? 30);
  }
  await app.register(
    async (scope) => {
      scope.addHook('onRequest', async (_request, reply) => {
        void reply.headers(VIEW_ASSET_HEADERS);
      });
      scope.setNotFoundHandler((_request, reply) => notFound(reply));
      // The folder itself, which a page's own wildcard route would answer.
      scope.route({
        method: ['GET', 'HEAD'],
        url: '/',
        prefixTrailingSlash: 'no-slash',
        schema: withDocumentation({ hide: true }),
        handler: (_request, reply) => notFound(reply),
      });
      if (options.loader === true) {
        scope.route({
          method: ['GET', 'HEAD'],
          url: `/${VIEW_LOADER_FILE}`,
          schema: withDocumentation({ hide: true }),
          handler: async (request, reply) => {
            const build = await readViewBuild(options.root, options);
            if (build === undefined) return notFound(reply);
            const source = viewLoaderScript(build.assets);
            const etag = `"${await contentVersion(source)}"`;
            void reply
              .header('cache-control', VIEW_LOADER_CACHE_CONTROL)
              .header('etag', etag);
            if (isEtagHeld(request.headers['if-none-match'], etag)) {
              return reply.code(304).send();
            }
            return reply.type('text/javascript; charset=utf-8').send(source);
          },
        });
      }
      scope.setErrorHandler((error: FastifyError, request, reply) => {
        const status = error.statusCode ?? 500;
        if (status >= 400 && status < 500) return notFound(reply);
        request.log.error({ err: error }, 'A view asset failed');
        return sendRefusal(reply.header('cache-control', 'no-store'), {
          status: 500,
          code: 'internal',
          error: 'The file could not be read. Try again later.',
        });
      });
      await scope.register(fastifyStatic, {
        root: retained === undefined ? current : [current, retained],
        prefix: '/',
        decorateReply: false,
        index: false,
        wildcard: true,
        dotfiles: 'ignore',
        cacheControl: false,
        suppressWarning: true,
        allowedPath: (path) => ASSET_NAME.test(path),
        setHeaders: (reply) => {
          void reply.header('cache-control', VIEW_ASSET_CACHE_CONTROL);
        },
      });
    },
    { prefix: options.prefix ?? '/views/assets' },
  );
}

/**
 * The not-found answer, never stored.
 * @param reply - The reply.
 * @returns The reply, sent.
 */
function notFound(reply: FastifyReply): FastifyReply {
  return sendRefusal(reply.header('cache-control', 'no-store'), {
    status: 404,
    code: 'not-found',
    error: 'Not found.',
  });
}
