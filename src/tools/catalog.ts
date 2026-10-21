import { toJSONSchema } from 'zod';

import type { CatalogTool, ToolCatalog } from '../contract/index.ts';
import { READ_ONLY_ANNOTATIONS } from '../contract/index.ts';

import { contentVersion } from './contentVersion.ts';
import type { ToolDefinition, ToolSchema } from './types.ts';

/**
 * The catalog of a server's tools: name, title, description, the strict
 * JSON Schema an LLM is offered and the annotations of each, its `_meta`
 * when it has a view or meta of its own, with the instructions. Its version
 * changes when any of them changes.
 * @param tools - The tools, in the order they are offered.
 * @param instructions - What the model is told about them as a whole.
 * @returns The catalog.
 */
export async function buildToolCatalog<Context>(
  tools: ReadonlyArray<ToolDefinition<ToolSchema, Context>>,
  instructions: string,
): Promise<ToolCatalog> {
  const described: CatalogTool[] = Array.from(tools, (tool) => {
    const entry: CatalogTool = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: toJSONSchema(tool.schema),
      annotations: tool.annotations ?? READ_ONLY_ANNOTATIONS,
    };
    const meta = toolMetaOf(tool);
    if (meta !== undefined) entry._meta = meta;
    return entry;
  });
  const version = await contentVersion(
    JSON.stringify({ tools: described, instructions }),
  );
  return { version, tools: described, instructions };
}

/**
 * A tool's `_meta`: its own fields, then its `ui`.
 * @param tool - The tool.
 * @returns The `_meta`, or undefined when it has neither.
 */
export function toolMetaOf(
  tool: Pick<ToolDefinition, 'ui' | 'meta'>,
): Record<string, unknown> | undefined {
  if (tool.ui === undefined && tool.meta === undefined) return undefined;
  return tool.ui === undefined
    ? { ...tool.meta }
    : { ...tool.meta, ui: tool.ui };
}
