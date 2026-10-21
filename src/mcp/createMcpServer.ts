import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  APP_MIME_TYPE,
  READ_ONLY_ANNOTATIONS,
  toCallToolResult,
  toErrorCallToolResult,
} from '../contract/index.ts';
import type { AppResource } from '../tools/apps.ts';
import {
  RESOURCE_FAILED,
  appResourceUi,
  readAppResource,
  uniqueResources,
} from '../tools/apps.ts';
import { toolMetaOf } from '../tools/catalog.ts';
import type { RunToolOptions } from '../tools/runTool.ts';
import { runTool } from '../tools/runTool.ts';
import type {
  ToolDefinition,
  ToolRefusal,
  ToolSchema,
} from '../tools/types.ts';

/**
 * What a request resolved to: the context its calls run with, or a refusal.
 */
export type ContextResolution<Context> =
  { ok: true; context: Context } | { ok: false; refusal: ToolRefusal };

/**
 * Options of {@link createMcpServer}.
 */
export interface McpServerOptions<Context> extends RunToolOptions {
  /**
   * The server's name, as MCP's `initialize` reports it.
   */
  name: string;
  /**
   * Its version, as MCP's `initialize` reports it.
   */
  version: string;
  /**
   * What the model is told about the tools as a whole; none is sent when
   * empty.
   * @default ''
   */
  instructions?: string;
  tools: ReadonlyArray<ToolDefinition<ToolSchema, Context>>;
  /**
   * The request's context, or why its calls cannot run: the tools are still
   * listed, and each call answers that sentence as an error result.
   */
  context: ContextResolution<Context>;
  /**
   * The MCP Apps the tools' answers are drawn with, served by
   * resources/list and resources/read.
   * @default []
   */
  resources?: readonly AppResource[];
  /**
   * Told when a resource's page cannot be made, or a resource is left out
   * because another has its uri; the host reads only RESOURCE_FAILED.
   * @default undefined
   */
  onResourceError?: (error: unknown, uri: string) => void;
}

/**
 * The `_meta` key older MCP Apps hosts read a tool's resource from.
 */
export const LEGACY_RESOURCE_URI_KEY = 'ui/resourceUri';

/**
 * The MCP server of one request: every tool registered with its strict
 * schema, title, annotations and `_meta` (its view, also under the key older
 * hosts read); a call answers the tool's result as JSON text, then the
 * content of each file it produced (an MCP client has no side channel), with
 * its `structuredContent` and `_meta`, or an error result the model reads.
 * The app resources are listed and read as MCP Apps.
 * @param options - The server's identity, its tools, resources and context.
 * @returns The server, to connect to the request's transport.
 */
export function createMcpServer<Context>(
  options: McpServerOptions<Context>,
): McpServer {
  const { name, version, instructions = '', tools, context } = options;
  const server = new McpServer(
    { name, version },
    instructions === '' ? undefined : { instructions },
  );
  for (const tool of tools) {
    const meta = toolMetaOf(tool);
    const resourceUri = resourceUriOf(meta);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations ?? READ_ONLY_ANNOTATIONS,
        ...(meta !== undefined && {
          _meta:
            resourceUri === undefined
              ? meta
              : { ...meta, [LEGACY_RESOURCE_URI_KEY]: resourceUri },
        }),
      },
      async (arguments_: Record<string, unknown>): Promise<CallToolResult> => {
        if (!context.ok) return toErrorCallToolResult(context.refusal.error);
        const run = await runTool(
          tools,
          tool.name,
          arguments_,
          context.context,
          options,
        );
        return run.ok
          ? toCallToolResult(run.reply)
          : toErrorCallToolResult(run.refusal.error);
      },
    );
  }
  const resources = uniqueResources(options.resources ?? [], (uri) =>
    options.onResourceError?.(
      new Error(`Another resource has the uri ${uri}: this one is left out.`),
      uri,
    ),
  );
  for (const resource of resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: APP_MIME_TYPE,
        _meta: { ui: appResourceUi(resource) },
      },
      async () => {
        let read: Awaited<ReturnType<typeof readAppResource>>;
        try {
          read = await readAppResource(resource);
        } catch (error) {
          options.onResourceError?.(error, resource.uri);
          // The SDK answers a thrown error as JSON-RPC's internal error,
          // with its message.
          throw new Error(RESOURCE_FAILED, { cause: error });
        }
        const { listing, html } = read;
        return {
          contents: [
            {
              uri: resource.uri,
              mimeType: APP_MIME_TYPE,
              text: html,
              _meta: listing._meta,
            },
          ],
        };
      },
    );
  }
  return server;
}

/**
 * The resource a tool's `_meta.ui` names, read leniently: a field this
 * version does not know never hides it.
 * @param meta - The tool's `_meta`.
 * @returns The resource's uri, if any.
 */
function resourceUriOf(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  const ui = meta?.ui;
  if (typeof ui !== 'object' || ui === null) return undefined;
  const { resourceUri } = ui as { resourceUri?: unknown };
  return typeof resourceUri === 'string' ? resourceUri : undefined;
}
