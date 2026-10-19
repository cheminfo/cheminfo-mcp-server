import { toJSONSchema } from 'zod';

import type { CatalogTool, ToolCatalog } from '../contract/index.ts';
import { READ_ONLY_ANNOTATIONS } from '../contract/index.ts';

import type { ToolDefinition, ToolSchema } from './types.ts';

/**
 * The catalog of a server's tools: name, title, description, the strict
 * JSON Schema an LLM is offered and the annotations of each, with the
 * instructions. Its version changes when any of them changes.
 * @param tools - The tools, in the order they are offered.
 * @param instructions - What the model is told about them as a whole.
 * @returns The catalog.
 */
export async function buildToolCatalog<Context>(
  tools: ReadonlyArray<ToolDefinition<ToolSchema, Context>>,
  instructions: string,
): Promise<ToolCatalog> {
  const described: CatalogTool[] = Array.from(tools, (tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: toJSONSchema(tool.schema),
    annotations: tool.annotations ?? READ_ONLY_ANNOTATIONS,
  }));
  const digest = await sha256(
    JSON.stringify({ tools: described, instructions }),
  );
  return { version: digest.slice(0, 12), tools: described, instructions };
}

/**
 * SHA-256 with the global Web Crypto, so the same code runs in a browser.
 * @param text - What to hash.
 * @returns 64 hex digits.
 */
async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
