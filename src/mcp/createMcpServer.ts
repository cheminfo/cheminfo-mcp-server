import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { READ_ONLY_ANNOTATIONS } from '../contract/index.ts';
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
   * What the model is told about the tools as a whole.
   * @default ''
   */
  instructions?: string;
  tools: ReadonlyArray<ToolDefinition<ToolSchema, Context>>;
  /**
   * The request's context, or why its calls cannot run: the tools are still
   * listed, and each call answers that sentence as an error result.
   */
  context: ContextResolution<Context>;
}

/**
 * The MCP server of one request: every tool registered with its strict
 * schema, title and annotations; a call answers the tool's result as JSON
 * text, or an error result the model reads.
 * @param options - The server's identity, its tools and the context.
 * @returns The server, to connect to the request's transport.
 */
export function createMcpServer<Context>(
  options: McpServerOptions<Context>,
): McpServer {
  const { name, version, instructions = '', tools, context } = options;
  const server = new McpServer({ name, version }, { instructions });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations ?? READ_ONLY_ANNOTATIONS,
      },
      async (arguments_: Record<string, unknown>): Promise<CallToolResult> => {
        if (!context.ok) return errorResult(context.refusal.error);
        const run = await runTool(
          tools,
          tool.name,
          arguments_,
          context.context,
          {
            onError: options.onError,
          },
        );
        if (!run.ok) return errorResult(run.refusal.error);
        return {
          content: [
            { type: 'text', text: JSON.stringify(run.reply.result, null, 2) },
          ],
        };
      },
    );
  }
  return server;
}

/**
 * A refusal as an MCP tool result.
 * @param message - What the model reads.
 * @returns The error result.
 */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
