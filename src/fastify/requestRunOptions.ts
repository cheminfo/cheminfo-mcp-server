import type { FastifyRequest } from 'fastify';

import type { AppResource, AppResourceList } from '../tools/apps.ts';
import { appResourcesOf } from '../tools/apps.ts';
import type { ExecuteToolOptions } from '../tools/runTool.ts';

import type { ToolRoutesBaseOptions } from './options.ts';

/**
 * How the calls of one request report: a tool that throws to the server's
 * `onError`, else to the request's logger, and an answer whose `_meta` or
 * result passes its size as a warning of the request's logger.
 * @param request - The request.
 * @param options - The server's options.
 * @returns The options executeTool() reads.
 */
export function requestRunOptions(
  request: FastifyRequest,
  options: Pick<
    ToolRoutesBaseOptions<unknown>,
    'onError' | 'metaWarnSize' | 'resultWarnSize'
  >,
): ExecuteToolOptions {
  const { metaWarnSize = 60_000, resultWarnSize = 100_000 } = options;
  return {
    onError: (error, tool) =>
      options.onError
        ? options.onError(error, tool, request)
        : request.log.error({ err: error, tool }, 'A tool failed'),
    onLargeMeta: (tool, size) =>
      request.log.warn(
        { tool, size, limit: metaWarnSize },
        "A tool's answer carries a large _meta",
      ),
    metaWarnSize,
    onLargeResult: (tool, size) =>
      request.log.warn(
        { tool, size, limit: resultWarnSize },
        "A tool's result is large",
      ),
    resultWarnSize,
  };
}

/**
 * The app resources MCP serves for a request: none when they cannot be
 * listed, which is logged, so the tools always answer.
 * @param request - The request.
 * @param resources - The server's resources, or the function giving them.
 * @returns The resources, and who is told when one fails.
 */
export async function requestMcpResources(
  request: FastifyRequest,
  resources: AppResourceList<FastifyRequest> | undefined,
): Promise<{
  resources: readonly AppResource[];
  onResourceError: (error: unknown, uri: string) => void;
}> {
  const onResourceError = (error: unknown, uri: string) =>
    request.log.error({ err: error, uri }, 'An app resource failed');
  try {
    return {
      resources: await appResourcesOf(resources, request),
      onResourceError,
    };
  } catch (error) {
    request.log.error({ err: error }, 'The app resources failed');
    return { resources: [], onResourceError };
  }
}
